from datetime import datetime, timedelta
from typing import List
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import or_, and_, select
from sqlalchemy.orm import Session

from database import User, Expense, ExpenseSplit, Notification, Settlement, group_members, EmailVerification
from routes.deps import get_db, get_current_user_id, limiter
from services.helpers import _format_expense, _EXPENSE_LOAD_OPTIONS
from services.email import generate_otp, send_email, otp_email_html
from schemas import (
    UserResponse, UserUpdate, NotificationResponse, ExpenseResponse,
    SettlementResponse, GroupDetailResponse,
    LinkEmailRequest, VerifyLinkedEmailRequest, UnlinkEmailRequest,
)

router = APIRouter()


@router.get("/users/", response_model=List[UserResponse])
def get_users(
    current_user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    connected = {current_user_id}
    user = db.query(User).filter(User.id == current_user_id).first()
    if user:
        for g in user.groups:
            for m in g.members:
                connected.add(m.id)

    paid_ids = [r[0] for r in db.query(Expense.id).filter(Expense.payer_id == current_user_id).all()]
    split_ids = [r[0] for r in db.query(ExpenseSplit.expense_id).filter(ExpenseSplit.user_id == current_user_id).all()]
    all_exp_ids = list(set(paid_ids + split_ids))
    if all_exp_ids:
        connected.update([r[0] for r in db.query(Expense.payer_id).filter(Expense.id.in_(all_exp_ids)).all()])
        connected.update([r[0] for r in db.query(ExpenseSplit.user_id).filter(ExpenseSplit.expense_id.in_(all_exp_ids)).all()])

    return db.query(User).filter(User.id.in_(connected)).all()


@router.get("/users/search")
def search_users(
    q: str,
    exclude_group_id: int = None,
    current_user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    from database import Group
    query = db.query(User).filter((User.name.ilike(f"%{q}%")) | (User.email.ilike(f"%{q}%")))
    results = query.limit(20).all()
    if exclude_group_id:
        group = db.query(Group).filter(Group.id == exclude_group_id).first()
        existing_ids = {m.id for m in group.members} if group else set()
        results = [u for u in results if u.id not in existing_ids]
    return [{"id": u.id, "name": u.name, "email": u.email} for u in results]


@router.put("/users/{user_id}", response_model=UserResponse)
def update_user(
    user_id: int,
    update_data: UserUpdate,
    current_user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    if user_id != current_user_id:
        raise HTTPException(status_code=403, detail="Cannot update another user's profile")
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    user.name = update_data.name
    if update_data.title is not None:
        user.title = update_data.title or None
    db.commit()
    db.refresh(user)
    return user


@router.get("/users/{user_id}/groups/", response_model=List[GroupDetailResponse])
def get_user_groups(
    user_id: int,
    current_user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    if user_id != current_user_id:
        raise HTTPException(status_code=403, detail="Forbidden")
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    # Build response with only *active* members so the member count on the
    # group card reflects who's actually participating (not deactivated users).
    result = []
    for group in user.groups:
        active_ids = {
            row.user_id for row in db.execute(
                select(group_members.c.user_id).where(
                    (group_members.c.group_id == group.id) &
                    (group_members.c.is_active == True)
                )
            ).fetchall()
        }
        result.append({
            "id": group.id,
            "name": group.name,
            "members": [m for m in group.members if m.id in active_ids],
        })
    return result


@router.get("/users/{user_id}/all_balances")
def get_user_all_balances(
    user_id: int,
    current_user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    if user_id != current_user_id:
        raise HTTPException(status_code=403, detail="Forbidden")
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    from routes.groups import get_group_balances
    global_balances = {}
    for group in user.groups:
        group_bals = get_group_balances(group.id, current_user_id=current_user_id, db=db)
        for bal in group_bals:
            if bal.from_user_id == user_id:
                other_id, other_name, amount = bal.to_user_id, bal.to_user_name, -bal.amount
            elif bal.to_user_id == user_id:
                other_id, other_name, amount = bal.from_user_id, bal.from_user_name, bal.amount
            else:
                continue
            if other_id not in global_balances:
                global_balances[other_id] = {
                    "other_user_id": other_id,
                    "other_user_name": other_name,
                    "net_balance": 0.0,
                    "group_balances": [],
                }
            global_balances[other_id]["net_balance"] += amount
            global_balances[other_id]["group_balances"].append(
                {"group_id": group.id, "group_name": group.name, "amount": amount}
            )

    for bal in global_balances.values():
        bal["net_balance"] = round(bal["net_balance"], 2)
    return list(global_balances.values())


@router.get("/users/{user_id}/expenses/", response_model=List[ExpenseResponse])
def get_user_expenses(
    user_id: int,
    current_user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    if user_id != current_user_id:
        raise HTTPException(status_code=403, detail="Forbidden")
    split_expense_ids = db.query(ExpenseSplit.expense_id).filter(
        ExpenseSplit.user_id == user_id
    ).subquery()
    expenses = (db.query(Expense)
                .options(*_EXPENSE_LOAD_OPTIONS)
                .filter(Expense.id.in_(split_expense_ids))
                .order_by(Expense.date.desc()).all())
    return [_format_expense(e, db) for e in expenses]


@router.get("/users/{user_id}/notifications", response_model=List[NotificationResponse])
def get_notifications(
    user_id: int,
    current_user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    if user_id != current_user_id:
        raise HTTPException(status_code=403, detail="Cannot view another user's notifications")
    notifs = (db.query(Notification)
              .filter(Notification.user_id == user_id)
              .order_by(Notification.created_at.desc()).all())
    return [
        {"id": n.id, "user_id": n.user_id, "message": n.message,
         "group_id": n.group_id, "expense_id": n.expense_id,
         "is_read": n.is_read, "created_at": n.created_at.isoformat()}
        for n in notifs
    ]


@router.post("/notifications/{notif_id}/mark_read")
def mark_notification_read(
    notif_id: int,
    current_user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    n = db.query(Notification).filter(Notification.id == notif_id).first()
    if n and n.user_id != current_user_id:
        raise HTTPException(status_code=403, detail="Not your notification")
    if n:
        n.is_read = 1
        db.commit()
    return {"message": "marked read"}


@router.get("/users/{user_id}/pending_settlements", response_model=List[SettlementResponse])
def get_pending_settlements(
    user_id: int,
    current_user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    if user_id != current_user_id:
        raise HTTPException(status_code=403, detail="Forbidden")
    settlements = db.query(Settlement).filter(
        Settlement.payee_id == user_id, Settlement.status == "pending"
    ).all()
    return [
        SettlementResponse(
            id=s.id, payer_id=s.payer_id,
            payer_name=s.payer.name if s.payer else "?",
            payee_id=s.payee_id,
            payee_name=s.payee.name if s.payee else "?",
            amount=float(s.amount), group_id=s.group_id,
            expense_id=s.expense_id, status=s.status,
            created_at=s.created_at.isoformat()
        )
        for s in settlements
    ]


@router.get("/users/{user_id}/all_settlements", response_model=List[SettlementResponse])
def get_all_settlements(
    user_id: int,
    current_user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    if user_id != current_user_id:
        raise HTTPException(status_code=403, detail="Forbidden")
    settlements = (
        db.query(Settlement)
        .filter(or_(Settlement.payer_id == user_id, Settlement.payee_id == user_id))
        .order_by(Settlement.created_at.desc())
        .limit(200)
        .all()
    )
    return [
        SettlementResponse(
            id=s.id, payer_id=s.payer_id,
            payer_name=s.payer.name if s.payer else "?",
            payee_id=s.payee_id,
            payee_name=s.payee.name if s.payee else "?",
            amount=float(s.amount), group_id=s.group_id,
            expense_id=s.expense_id, status=s.status,
            created_at=s.created_at.isoformat()
        )
        for s in settlements
    ]


@router.get("/users/{user_id}/initiated_settlements", response_model=List[SettlementResponse])
def get_initiated_settlements(
    user_id: int,
    current_user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    if user_id != current_user_id:
        raise HTTPException(status_code=403, detail="Forbidden")
    settlements = db.query(Settlement).filter(
        Settlement.payer_id == user_id,
        Settlement.status.in_(["pending", "approved"])
    ).all()
    return [
        SettlementResponse(
            id=s.id, payer_id=s.payer_id,
            payer_name=s.payer.name if s.payer else "?",
            payee_id=s.payee_id,
            payee_name=s.payee.name if s.payee else "?",
            amount=float(s.amount), group_id=s.group_id,
            expense_id=s.expense_id, status=s.status,
            created_at=s.created_at.isoformat()
        )
        for s in settlements
    ]


# ── Linked email endpoints ─────────────────────────────────────────────────────

@router.post("/users/{user_id}/link-email", response_model=dict)
@limiter.limit("5/minute")
def link_email(
    request: Request,
    user_id: int,
    body: LinkEmailRequest,
    current_user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    if current_user_id != user_id:
        raise HTTPException(403, "Forbidden")
    if body.email_type not in ("personal", "work"):
        raise HTTPException(400, "email_type must be 'personal' or 'work'")

    new_email = body.email.strip().lower()
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(404, "User not found")
    if new_email == user.email.lower():
        raise HTTPException(400, "That is already your primary login email")

    # Work email: user must belong to an org and the email domain must match
    if body.email_type == "work":
        if not user.organisation_id:
            raise HTTPException(400, "You must belong to a company to add a work email")
        org_domain = user.organisation_domain
        if org_domain:
            email_domain = new_email.split("@")[-1] if "@" in new_email else ""
            if email_domain != org_domain.lower().lstrip("@"):
                raise HTTPException(400, f"Work email must use your company domain (@{org_domain.lstrip('@')})")

    # Email must not be taken by any other user (primary or linked)
    taken = db.query(User).filter(
        User.id != user_id,
        or_(
            User.email.ilike(new_email),
            and_(User.personal_email.isnot(None), User.personal_email.ilike(new_email)),
            and_(User.work_email.isnot(None), User.work_email.ilike(new_email)),
        )
    ).first()
    if taken:
        raise HTTPException(400, "That email is already linked to another account")

    # Store a pending (unverified) email on the user so the frontend knows what's pending
    if body.email_type == "personal":
        user.personal_email = new_email
        user.personal_email_verified = False
    else:
        user.work_email = new_email
        user.work_email_verified = False
    db.flush()

    # Send OTP to the new address
    db.query(EmailVerification).filter(EmailVerification.email == new_email).delete()
    otp = generate_otp()
    db.add(EmailVerification(email=new_email, otp=otp,
                             expires_at=datetime.utcnow() + timedelta(minutes=10)))
    db.commit()
    db.refresh(user)

    label = "personal" if body.email_type == "personal" else "work"
    send_email(
        new_email,
        f"Verify your {label} email — SplitUp",
        otp_email_html(otp, f"Use this code to verify your {label} email address and link it to your SplitUp account."),
    )
    return {"message": "otp_sent", "email": new_email}


@router.post("/users/{user_id}/verify-linked-email", response_model=UserResponse)
@limiter.limit("10/minute")
def verify_linked_email(
    request: Request,
    user_id: int,
    body: VerifyLinkedEmailRequest,
    current_user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    if current_user_id != user_id:
        raise HTTPException(403, "Forbidden")

    email = body.email.strip().lower()
    ev = (db.query(EmailVerification)
          .filter(EmailVerification.email == email, EmailVerification.used == False)
          .order_by(EmailVerification.created_at.desc())
          .first())
    if not ev or ev.otp != body.otp.strip() or datetime.utcnow() > ev.expires_at:
        raise HTTPException(400, "Invalid or expired code")

    ev.used = True
    user = db.query(User).filter(User.id == user_id).first()
    if body.email_type == "personal":
        user.personal_email = email
        user.personal_email_verified = True
    else:
        user.work_email = email
        user.work_email_verified = True
    db.commit()
    db.refresh(user)
    return user


@router.delete("/users/{user_id}/unlink-email", response_model=UserResponse)
def unlink_email(
    user_id: int,
    body: UnlinkEmailRequest,
    current_user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    if current_user_id != user_id:
        raise HTTPException(403, "Forbidden")
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(404, "User not found")
    if body.email_type == "personal":
        user.personal_email = None
        user.personal_email_verified = False
    elif body.email_type == "work":
        user.work_email = None
        user.work_email_verified = False
    else:
        raise HTTPException(400, "email_type must be 'personal' or 'work'")
    db.commit()
    db.refresh(user)
    return user
