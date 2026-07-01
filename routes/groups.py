from typing import List
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from database import User, Group, Expense, ExpenseSplit, Settlement, group_members
from routes.deps import get_db, get_current_user_id
from services.helpers import _push_group_event, _format_expense, _EXPENSE_LOAD_OPTIONS
from services.cache import get_cached_balances, set_cached_balances
from schemas import (
    GroupCreate, GroupDetailResponse, GroupRenameRequest,
    AddMemberRequest, AddMemberByIdRequest, MembershipResponse, UpdateRoleRequest,
    ExpenseResponse, BalanceEntry,
)

router = APIRouter()


@router.post("/groups/", response_model=GroupDetailResponse)
def create_group(
    group: GroupCreate,
    current_user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    if group.creator_id != current_user_id:
        raise HTTPException(status_code=403, detail="Cannot create group on behalf of another user")
    creator = db.query(User).filter(User.id == group.creator_id).first()
    if not creator:
        raise HTTPException(status_code=404, detail="Creator user not found")
    new_group = Group(name=group.name)
    db.add(new_group)
    db.flush()
    db.execute(group_members.insert().values(
        user_id=creator.id, group_id=new_group.id, role="super_admin", is_active=True
    ))
    db.commit()
    db.refresh(new_group)
    return new_group


@router.get("/groups/", response_model=List[GroupDetailResponse])
def get_groups(
    current_user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    return db.query(Group).all()


@router.get("/groups/{group_id}/", response_model=GroupDetailResponse)
def get_group(
    group_id: int,
    current_user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    group = db.query(Group).filter(Group.id == group_id).first()
    if not group:
        raise HTTPException(status_code=404, detail="Group not found")
    return group


@router.put("/groups/{group_id}/name", response_model=GroupDetailResponse)
def rename_group(
    group_id: int,
    req: GroupRenameRequest,
    current_user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    if req.requester_id != current_user_id:
        raise HTTPException(status_code=403, detail="Forbidden")
    group = db.query(Group).filter(Group.id == group_id).first()
    if not group:
        raise HTTPException(status_code=404, detail="Group not found")
    row = db.execute(group_members.select().where(
        group_members.c.user_id == current_user_id,
        group_members.c.group_id == group_id
    )).first()
    if not row or row.role != "super_admin":
        raise HTTPException(status_code=403, detail="Only the group super admin can rename this group")
    new_name = req.name.strip()
    if not new_name:
        raise HTTPException(status_code=400, detail="Group name cannot be empty")
    group.name = new_name
    db.commit()
    db.refresh(group)
    _push_group_event(db, group_id)
    return group


@router.post("/groups/{group_id}/members/", response_model=GroupDetailResponse)
def add_group_member(
    group_id: int,
    req: AddMemberRequest,
    current_user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    group = db.query(Group).filter(Group.id == group_id).first()
    if not group:
        raise HTTPException(status_code=404, detail="Group not found")
    if not any(m.id == current_user_id for m in group.members):
        raise HTTPException(status_code=403, detail="You are not a member of this group")
    user = db.query(User).filter(User.email.ilike(req.email.strip())).first()
    if not user:
        raise HTTPException(status_code=404, detail=f"No user found with email '{req.email}'")
    if user in group.members:
        raise HTTPException(status_code=400, detail="User is already a member of this group")
    db.execute(group_members.insert().values(
        user_id=user.id, group_id=group.id, role="member", is_active=True
    ))
    db.commit()
    db.refresh(group)
    return group


@router.post("/groups/{group_id}/members/by_id", response_model=GroupDetailResponse)
def add_group_member_by_id(
    group_id: int,
    req: AddMemberByIdRequest,
    current_user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    if req.admin_user_id != current_user_id:
        raise HTTPException(status_code=403, detail="Forbidden")
    group = db.query(Group).filter(Group.id == group_id).first()
    if not group:
        raise HTTPException(status_code=404, detail="Group not found")
    row = db.execute(group_members.select().where(
        (group_members.c.group_id == group_id) & (group_members.c.user_id == current_user_id)
    )).first()
    if not row or row.role not in ("admin", "super_admin"):
        raise HTTPException(status_code=403, detail="Admin privileges required")
    user = db.query(User).filter(User.id == req.user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if user in group.members:
        raise HTTPException(status_code=400, detail="User is already a member of this group")
    db.execute(group_members.insert().values(
        user_id=user.id, group_id=group.id, role="member", is_active=True
    ))
    db.commit()
    db.refresh(group)
    return group


@router.get("/groups/{group_id}/expenses/", response_model=List[ExpenseResponse])
def get_group_expenses(
    group_id: int,
    current_user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    group = db.query(Group).filter(Group.id == group_id).first()
    if not group:
        raise HTTPException(status_code=404, detail="Group not found")
    row = db.execute(group_members.select().where(
        (group_members.c.group_id == group_id) & (group_members.c.user_id == current_user_id)
    )).first()
    if not row:
        raise HTTPException(status_code=403, detail="You are not a member of this group")
    if not bool(row.is_active):
        raise HTTPException(status_code=403, detail="Your access to this group is currently disabled")
    expenses = (db.query(Expense)
                .options(*_EXPENSE_LOAD_OPTIONS)
                .filter(Expense.group_id == group_id)
                .order_by(Expense.date.desc()).all())
    return [_format_expense(e, db) for e in expenses]


@router.get("/groups/{group_id}/balances/", response_model=List[BalanceEntry])
def get_group_balances(
    group_id: int,
    current_user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    group = db.query(Group).filter(Group.id == group_id).first()
    if not group:
        raise HTTPException(status_code=404, detail="Group not found")

    cached = get_cached_balances(group_id)
    if cached is not None:
        return cached

    paid_query = db.query(
        Expense.payer_id.label("user_id"),
        func.sum(Expense.amount).label("total_paid")
    ).filter(
        Expense.group_id == group_id, Expense.status != "deleted"
    ).group_by(Expense.payer_id).all()

    owed_query = db.query(
        ExpenseSplit.user_id.label("user_id"),
        func.sum(ExpenseSplit.amount).label("total_owed")
    ).join(Expense).filter(
        Expense.group_id == group_id, Expense.status != "deleted"
    ).group_by(ExpenseSplit.user_id).all()

    # Include all users involved (members + any ex-members who paid/split)
    member_names = {m.id: m.name for m in group.members}
    involved_ids = {m.id for m in group.members}
    involved_ids.update(uid for uid, _ in paid_query)
    involved_ids.update(uid for uid, _ in owed_query)
    extra_ids = involved_ids - set(member_names)
    if extra_ids:
        extra_users = db.query(User).filter(User.id.in_(extra_ids)).all()
        member_names.update({u.id: u.name for u in extra_users})
    net = {uid: 0.0 for uid in involved_ids}

    for user_id, total_paid in paid_query:
        if total_paid:
            net[user_id] += float(total_paid)
    for user_id, total_owed in owed_query:
        if total_owed:
            net[user_id] -= float(total_owed)

    # Only count expense-level settlements; group-level "Settle All" records are
    # already represented by their per-expense cascade entries, so counting both
    # would double-subtract and corrupt the net balances.
    approved = db.query(Settlement).filter(
        Settlement.group_id == group_id,
        Settlement.status == "approved",
        Settlement.expense_id != None,
    ).all()
    for s in approved:
        if s.payer_id in net:
            net[s.payer_id] += float(s.amount)
        if s.payee_id in net:
            net[s.payee_id] -= float(s.amount)

    creditors = sorted([(uid, amt) for uid, amt in net.items() if amt > 0.005], key=lambda x: -x[1])
    debtors   = sorted([(uid, abs(amt)) for uid, amt in net.items() if amt < -0.005], key=lambda x: -x[1])
    balances, ci, di = [], 0, 0
    creditors, debtors = list(creditors), list(debtors)
    while ci < len(creditors) and di < len(debtors):
        cid, camp = creditors[ci]
        did, damt = debtors[di]
        settle = min(camp, damt)
        balances.append(BalanceEntry(
            from_user_id=did, from_user_name=member_names.get(did, "?"),
            to_user_id=cid, to_user_name=member_names.get(cid, "?"),
            amount=round(settle, 2)
        ))
        creditors[ci] = (cid, camp - settle)
        debtors[di]   = (did, damt - settle)
        if creditors[ci][1] < 0.005:
            ci += 1
        if debtors[di][1] < 0.005:
            di += 1

    set_cached_balances(group_id, balances)
    return balances


@router.get("/groups/{group_id}/memberships", response_model=List[MembershipResponse])
def get_group_memberships(
    group_id: int,
    current_user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    rows = db.execute(group_members.select().where(group_members.c.group_id == group_id)).fetchall()
    result = []
    for row in rows:
        user = db.query(User).filter(User.id == row.user_id).first()
        if user:
            in_split = db.query(ExpenseSplit).join(Expense).filter(
                Expense.group_id == group_id, ExpenseSplit.user_id == user.id
            ).first()
            is_payer = db.query(Expense).filter(
                Expense.group_id == group_id, Expense.payer_id == user.id
            ).first()
            result.append(MembershipResponse(
                user_id=user.id, user_name=user.name, user_email=user.email,
                role=row.role or "member", is_active=bool(row.is_active),
                has_transactions=bool(in_split or is_payer),
            ))
    return result


@router.put("/groups/{group_id}/members/{user_id}/role")
def update_member_role(
    group_id: int,
    user_id: int,
    req: UpdateRoleRequest,
    current_user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    if req.admin_user_id != current_user_id:
        raise HTTPException(status_code=403, detail="Forbidden")
    if req.role not in ("super_admin", "admin", "member"):
        raise HTTPException(status_code=400, detail="Invalid role")
    admin_row = db.execute(group_members.select().where(
        (group_members.c.group_id == group_id) & (group_members.c.user_id == current_user_id)
    )).first()
    if not admin_row or admin_row.role not in ("admin", "super_admin"):
        raise HTTPException(status_code=403, detail="Admin privileges required")
    if req.role in ("super_admin", "admin") and admin_row.role != "super_admin":
        raise HTTPException(status_code=403, detail="Only super admin can promote members")
    db.execute(group_members.update().where(
        (group_members.c.group_id == group_id) & (group_members.c.user_id == user_id)
    ).values(role=req.role))
    db.commit()
    return {"message": f"Role updated to {req.role}"}


@router.delete("/groups/{group_id}/members/{user_id}")
def remove_group_member(
    group_id: int,
    user_id: int,
    admin_user_id: int,
    current_user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    if admin_user_id != current_user_id:
        raise HTTPException(status_code=403, detail="Forbidden")
    admin_row = db.execute(group_members.select().where(
        (group_members.c.group_id == group_id) & (group_members.c.user_id == current_user_id)
    )).first()
    if not admin_row or admin_row.role not in ("admin", "super_admin"):
        raise HTTPException(status_code=403, detail="Admin privileges required")
    target_row = db.execute(group_members.select().where(
        (group_members.c.group_id == group_id) & (group_members.c.user_id == user_id)
    )).first()
    if not target_row:
        raise HTTPException(status_code=404, detail="Member not found in group")
    if target_row.role == "super_admin":
        raise HTTPException(status_code=403, detail="Cannot remove the group super admin")
    active_splits = db.query(ExpenseSplit).join(Expense).filter(
        Expense.group_id == group_id,
        ExpenseSplit.user_id == user_id,
        Expense.status == "active"
    ).count()
    db.execute(group_members.delete().where(
        (group_members.c.group_id == group_id) & (group_members.c.user_id == user_id)
    ))
    db.commit()
    warning = (f"Removed, but this user had {active_splits} active expense split(s) in the group."
               if active_splits > 0 else None)
    return {"message": "Member removed", "warning": warning}


@router.put("/groups/{group_id}/members/{user_id}/deactivate")
def toggle_member_active(
    group_id: int,
    user_id: int,
    admin_user_id: int,
    current_user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    if admin_user_id != current_user_id:
        raise HTTPException(status_code=403, detail="Forbidden")
    admin_row = db.execute(group_members.select().where(
        (group_members.c.group_id == group_id) & (group_members.c.user_id == current_user_id)
    )).first()
    if not admin_row or admin_row.role not in ("admin", "super_admin"):
        raise HTTPException(status_code=403, detail="Admin privileges required")
    target_row = db.execute(group_members.select().where(
        (group_members.c.group_id == group_id) & (group_members.c.user_id == user_id)
    )).first()
    if not target_row:
        raise HTTPException(status_code=404, detail="Member not found in group")
    if target_row.role == "super_admin":
        raise HTTPException(status_code=403, detail="Cannot deactivate the group super admin")
    new_status = not bool(target_row.is_active)
    db.execute(group_members.update().where(
        (group_members.c.group_id == group_id) & (group_members.c.user_id == user_id)
    ).values(is_active=new_status))
    db.commit()
    return {"message": "activated" if new_status else "deactivated", "is_active": new_status}
