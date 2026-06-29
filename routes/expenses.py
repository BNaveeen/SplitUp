from datetime import datetime
from typing import List
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from database import User, Group, Expense, ExpenseSplit, ExpenseDeletionApproval, ExpenseMessage
from routes.deps import get_db, get_current_user_id
from services.helpers import (
    _push_group_event, _add_notification, _add_system_message,
    _format_expense, _EXPENSE_LOAD_OPTIONS,
)
from services.realtime import manager
from schemas import ExpenseCreate, ExpenseResponse, ExpenseMessageCreate, ExpenseMessageResponse

router = APIRouter()


@router.post("/expenses/", response_model=ExpenseResponse)
def split_expense(
    expense: ExpenseCreate,
    current_user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    if expense.created_by_id != current_user_id:
        raise HTTPException(status_code=403, detail="Cannot create expense on behalf of another user")
    payer = db.query(User).filter(User.id == expense.payer_id).first()
    if not payer:
        raise HTTPException(status_code=404, detail="Payer user not found")
    if expense.group_id:
        group = db.query(Group).filter(Group.id == expense.group_id).first()
        if not group:
            raise HTTPException(status_code=404, detail="Group not found")
    total_split = sum(s.amount for s in expense.splits)
    if abs(total_split - expense.amount) > 0.02:
        raise HTTPException(status_code=400,
                            detail=f"Split amounts ({total_split:.2f}) do not match expense ({expense.amount:.2f})")

    expense_date = datetime.utcnow()
    if expense.date:
        try:
            expense_date = datetime.fromisoformat(expense.date)
        except ValueError:
            pass

    new_expense = Expense(
        description=expense.description, amount=expense.amount,
        payer_id=expense.payer_id, created_by_id=expense.created_by_id,
        group_id=expense.group_id, date=expense_date,
        receipt_image=expense.receipt_image,
        category=expense.category,
    )
    db.add(new_expense)
    db.commit()
    db.refresh(new_expense)

    for split in expense.splits:
        split_user = db.query(User).filter(User.id == split.user_id).first()
        if not split_user:
            db.delete(new_expense)
            db.commit()
            raise HTTPException(status_code=404, detail=f"User {split.user_id} in split not found")
        db.add(ExpenseSplit(expense_id=new_expense.id, user_id=split.user_id, amount=split.amount))
    db.commit()
    db.refresh(new_expense)

    involved_users = {s.user_id for s in expense.splits}
    involved_users.add(expense.payer_id)
    for uid in involved_users:
        if uid != expense.created_by_id:
            _add_notification(db, uid,
                              f"You were added to a new expense: {new_expense.description}",
                              expense_id=new_expense.id, group_id=new_expense.group_id)

    split_users = {u.id: u.name for u in db.query(User).filter(
        User.id.in_([s.user_id for s in expense.splits])
    ).all()}
    split_names = ", ".join(split_users.get(s.user_id, f"User {s.user_id}") for s in expense.splits)
    _add_system_message(db, new_expense.id, new_expense.created_by_id,
                        f"created this expense — £{float(new_expense.amount):.2f} paid by {payer.name}, "
                        f"split between: {split_names}")
    db.commit()
    _push_group_event(db, new_expense.group_id)
    return _format_expense(new_expense, db)


@router.put("/expenses/{expense_id}", response_model=ExpenseResponse)
def update_expense(
    expense_id: int,
    expense_update: ExpenseCreate,
    current_user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    expense = db.query(Expense).filter(Expense.id == expense_id).first()
    if not expense:
        raise HTTPException(status_code=404, detail="Expense not found")
    if expense.created_by_id != current_user_id:
        raise HTTPException(status_code=403, detail="Only the creator can edit this expense")

    total_split = sum(s.amount for s in expense_update.splits)
    if abs(total_split - expense_update.amount) > 0.02:
        raise HTTPException(status_code=400,
                            detail=f"Split amounts ({total_split:.2f}) do not match expense ({expense_update.amount:.2f})")

    old_desc, old_amount = expense.description, float(expense.amount)
    old_payer = db.query(User).filter(User.id == expense.payer_id).first()
    old_payer_name = old_payer.name if old_payer else "Unknown"

    expense.description = expense_update.description
    expense.amount = expense_update.amount
    expense.payer_id = expense_update.payer_id
    expense.category = expense_update.category
    if expense_update.date:
        try:
            expense.date = datetime.fromisoformat(expense_update.date)
        except ValueError:
            pass

    db.query(ExpenseSplit).filter(ExpenseSplit.expense_id == expense.id).delete()
    for split in expense_update.splits:
        db.add(ExpenseSplit(expense_id=expense.id, user_id=split.user_id, amount=split.amount))
    db.commit()
    db.refresh(expense)

    changes = []
    if old_desc != expense.description:
        changes.append(f'description: "{old_desc}" → "{expense.description}"')
    if abs(old_amount - float(expense.amount)) > 0.005:
        changes.append(f"amount: £{old_amount:.2f} → £{float(expense.amount):.2f}")
    new_payer = db.query(User).filter(User.id == expense.payer_id).first()
    new_payer_name = new_payer.name if new_payer else "Unknown"
    if old_payer_name != new_payer_name:
        changes.append(f"paid by: {old_payer_name} → {new_payer_name}")
    split_user_map = {u.id: u.name for u in db.query(User).filter(
        User.id.in_([s.user_id for s in expense.splits])
    ).all()}
    new_split_names = ", ".join(split_user_map.get(s.user_id, f"User {s.user_id}") for s in expense.splits)
    change_summary = "; ".join(changes) if changes else f"£{float(expense.amount):.2f} paid by {new_payer_name}"
    _add_system_message(db, expense.id, expense.created_by_id,
                        f"updated this expense — {change_summary}, split between: {new_split_names}")

    involved_users = {s.user_id for s in expense.splits}
    involved_users.add(expense.payer_id)
    for uid in involved_users:
        if uid != current_user_id:
            _add_notification(db, uid, f"Expense updated: {expense.description}",
                              expense_id=expense.id, group_id=expense.group_id)
    db.commit()
    _push_group_event(db, expense.group_id)
    return _format_expense(expense, db)


@router.delete("/expenses/{expense_id}")
def delete_expense(
    expense_id: int,
    requester_id: int,
    current_user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    if requester_id != current_user_id:
        raise HTTPException(status_code=403, detail="Forbidden")
    expense = db.query(Expense).filter(Expense.id == expense_id).first()
    if not expense:
        raise HTTPException(status_code=404, detail="Expense not found")
    if expense.created_by_id != current_user_id:
        raise HTTPException(status_code=403, detail="Only the creator can delete this expense")
    if expense.status in ("pending_deletion", "approved_for_deletion", "deleted"):
        raise HTTPException(status_code=400, detail=f"Expense cannot be deleted (status: {expense.status})")

    involved_user_ids = {s.user_id for s in expense.splits if s.user_id is not None}
    if expense.payer_id is not None:
        involved_user_ids.add(expense.payer_id)
    if not involved_user_ids:
        involved_user_ids = {current_user_id}

    if len(involved_user_ids) == 1 and current_user_id in involved_user_ids:
        expense.status = "deleted"
        db.commit()
        _push_group_event(db, expense.group_id)
        return {"message": "Expense deleted immediately"}

    expense.status = "pending_deletion"
    for appr in list(expense.approvals):
        db.delete(appr)
    db.flush()
    for uid in involved_user_ids:
        db.add(ExpenseDeletionApproval(
            expense_id=expense.id, user_id=uid,
            approved=1 if uid == current_user_id else 0
        ))
        if uid != current_user_id:
            _add_notification(db, uid,
                              f"Deletion requested for expense: {expense.description}",
                              expense_id=expense.id, group_id=expense.group_id)
    _add_system_message(db, expense.id, current_user_id, "Requested deletion of this expense.")
    db.commit()
    _push_group_event(db, expense.group_id)
    return {"message": "Deletion request initiated"}


@router.post("/expenses/{expense_id}/approve_deletion")
def approve_deletion(
    expense_id: int,
    user_id: int,
    current_user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    if user_id != current_user_id:
        raise HTTPException(status_code=403, detail="Forbidden")
    approval = db.query(ExpenseDeletionApproval).filter(
        ExpenseDeletionApproval.expense_id == expense_id,
        ExpenseDeletionApproval.user_id == current_user_id
    ).first()
    if not approval:
        raise HTTPException(status_code=404, detail="Approval request not found")
    approval.approved = 1
    db.commit()

    pending_approvals = db.query(ExpenseDeletionApproval).filter(
        ExpenseDeletionApproval.expense_id == expense_id,
        ExpenseDeletionApproval.approved == 0
    ).count()
    if pending_approvals == 0:
        rejections = db.query(ExpenseDeletionApproval).filter(
            ExpenseDeletionApproval.expense_id == expense_id,
            ExpenseDeletionApproval.approved == -1
        ).count()
        expense = db.query(Expense).filter(Expense.id == expense_id).first()
        if rejections > 0:
            expense.status = "active"
            expense.deletion_approved_at = None
            for appr in list(expense.approvals):
                db.delete(appr)
            db.flush()
            _add_system_message(db, expense_id, current_user_id,
                                "Deletion request was rejected and cancelled.")
            db.commit()
            _push_group_event(db, expense.group_id)
            return {"message": "Deletion was rejected by someone and cancelled"}
        expense.status = "approved_for_deletion"
        expense.deletion_approved_at = datetime.utcnow()
        _add_system_message(db, expense_id, current_user_id,
                            "All users approved deletion. Deleting in 10 minutes.")
        db.commit()
        _push_group_event(db, expense.group_id)
        return {"message": "All approved. Expense will be deleted in 10 minutes."}

    exp = db.query(Expense).filter(Expense.id == expense_id).first()
    _add_system_message(db, expense_id, current_user_id, "Approved the deletion request.")
    db.commit()
    _push_group_event(db, exp.group_id if exp else None)
    return {"message": "Approval recorded"}


@router.post("/expenses/{expense_id}/reject_deletion")
def reject_deletion(
    expense_id: int,
    user_id: int,
    current_user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    if user_id != current_user_id:
        raise HTTPException(status_code=403, detail="Forbidden")
    expense = db.query(Expense).filter(Expense.id == expense_id).first()
    if not expense:
        raise HTTPException(status_code=404, detail="Expense not found")
    approval = db.query(ExpenseDeletionApproval).filter(
        ExpenseDeletionApproval.expense_id == expense_id,
        ExpenseDeletionApproval.user_id == current_user_id
    ).first()
    if not approval:
        raise HTTPException(status_code=404, detail="Approval request not found")
    approval.approved = -1
    db.commit()

    pending_approvals = db.query(ExpenseDeletionApproval).filter(
        ExpenseDeletionApproval.expense_id == expense_id,
        ExpenseDeletionApproval.approved == 0
    ).count()
    if pending_approvals == 0:
        expense.status = "active"
        for appr in list(expense.approvals):
            db.delete(appr)
        db.flush()
        _add_system_message(db, expense_id, current_user_id,
                            "Rejected the deletion request. Deletion cancelled.")
        db.commit()
        _push_group_event(db, expense.group_id)
        return {"message": "Deletion rejected by at least one user and cancelled"}
    _add_system_message(db, expense_id, current_user_id, "Rejected the deletion request.")
    db.commit()
    _push_group_event(db, expense.group_id)
    return {"message": "Rejection recorded"}


@router.post("/expenses/{expense_id}/cancel_deletion")
def cancel_deletion(
    expense_id: int,
    user_id: int,
    current_user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    if user_id != current_user_id:
        raise HTTPException(status_code=403, detail="Forbidden")
    expense = db.query(Expense).filter(Expense.id == expense_id).first()
    if not expense:
        raise HTTPException(status_code=404, detail="Expense not found")
    if expense.status not in ["pending_deletion", "approved_for_deletion"]:
        raise HTTPException(status_code=400, detail="Expense is not pending deletion")
    expense.status = "active"
    expense.deletion_approved_at = None
    for appr in list(expense.approvals):
        db.delete(appr)
    db.flush()
    _add_system_message(db, expense_id, current_user_id, "Cancelled the deletion.")
    db.commit()
    _push_group_event(db, expense.group_id)
    return {"message": "Deletion cancelled"}


@router.get("/expenses/{expense_id}/chat", response_model=List[ExpenseMessageResponse])
def get_expense_chat(
    expense_id: int,
    current_user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    messages = (db.query(ExpenseMessage)
                .filter(ExpenseMessage.expense_id == expense_id)
                .order_by(ExpenseMessage.created_at.asc()).all())
    return [
        {"id": m.id, "user_id": m.user_id,
         "user_name": m.user.name if m.user else "System",
         "text": m.text, "is_system": getattr(m, "is_system", 0),
         "created_at": m.created_at.isoformat()}
        for m in messages
    ]


@router.post("/expenses/{expense_id}/chat", response_model=ExpenseMessageResponse)
async def post_expense_chat(
    expense_id: int,
    msg: ExpenseMessageCreate,
    current_user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    if msg.user_id != current_user_id:
        raise HTTPException(status_code=403, detail="Forbidden")
    new_msg = ExpenseMessage(expense_id=expense_id, user_id=msg.user_id,
                             text=msg.text, is_system=0)
    db.add(new_msg)
    db.commit()
    db.refresh(new_msg)

    expense = db.query(Expense).filter(Expense.id == expense_id).first()
    mentioned_users = set(msg.mentions) if getattr(msg, "mentions", None) else set()
    involved_users = set()
    if expense:
        involved_users = {s.user_id for s in expense.splits}
        involved_users.add(expense.payer_id)
        for uid in involved_users:
            if uid != msg.user_id:
                if uid in mentioned_users:
                    _add_notification(
                        db, uid,
                        f"{new_msg.user.name} mentioned you in {expense.description}: {msg.text}",
                        expense_id=expense.id, group_id=expense.group_id
                    )
                else:
                    _add_notification(
                        db, uid,
                        f"New comment on {expense.description}: {msg.text}",
                        expense_id=expense.id, group_id=expense.group_id
                    )
        db.commit()

    msg_payload = {
        "type": "new_message", "expense_id": expense_id, "id": new_msg.id,
        "user_id": new_msg.user_id,
        "user_name": new_msg.user.name if new_msg.user else "Unknown",
        "text": new_msg.text, "is_system": 0,
        "created_at": new_msg.created_at.isoformat()
    }
    await manager.broadcast_to_users(list(involved_users), msg_payload)
    return {
        "id": new_msg.id, "user_id": new_msg.user_id,
        "user_name": new_msg.user.name if new_msg.user else "Unknown",
        "text": new_msg.text, "is_system": 0,
        "created_at": new_msg.created_at.isoformat()
    }
