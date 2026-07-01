from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from database import User, Group, Expense, ExpenseSplit, Settlement
from routes.deps import get_db, get_current_user_id
from services.helpers import _add_notification, _add_system_message, _push_group_event
from schemas import SettlementCreate, SettlementResponse

router = APIRouter()


@router.post("/settlements/", response_model=SettlementResponse)
def create_settlement(
    req: SettlementCreate,
    current_user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    if req.payer_id != current_user_id:
        raise HTTPException(status_code=403, detail="Cannot settle on behalf of another user")
    payer = db.query(User).filter(User.id == req.payer_id).first()
    payee = db.query(User).filter(User.id == req.payee_id).first()
    if not payer or not payee:
        raise HTTPException(status_code=404, detail="User not found")

    if req.expense_id:
        # Expense-level: prevent duplicate pending settlement for same expense
        existing = db.query(Settlement).filter(
            Settlement.payer_id == req.payer_id,
            Settlement.expense_id == req.expense_id,
            Settlement.status == "pending"
        ).first()
        if existing:
            raise HTTPException(status_code=400,
                                detail="A pending payment request already exists for this expense")
    elif req.group_id:
        # Group-level (Settle All): prevent duplicate pending settlement for same group pair
        existing = db.query(Settlement).filter(
            Settlement.payer_id == req.payer_id,
            Settlement.payee_id == req.payee_id,
            Settlement.group_id == req.group_id,
            Settlement.expense_id == None,
            Settlement.status == "pending",
        ).first()
        if existing:
            raise HTTPException(status_code=400,
                                detail="A pending settlement already exists for this group. Wait for approval first.")

    new_settlement = Settlement(
        payer_id=req.payer_id, payee_id=req.payee_id, amount=req.amount,
        group_id=req.group_id, expense_id=req.expense_id
    )
    db.add(new_settlement)
    db.commit()
    db.refresh(new_settlement)

    group_name = "a group"
    if req.group_id:
        group = db.query(Group).filter(Group.id == req.group_id).first()
        if group:
            group_name = group.name

    if req.expense_id:
        msg = f"{payer.name} sent a payment of £{req.amount:.2f} in {group_name}. Please approve it."
    else:
        msg = f"{payer.name} wants to settle all debts (£{req.amount:.2f}) in {group_name}. Please approve it."

    _add_notification(db, req.payee_id, msg, group_id=req.group_id)

    return SettlementResponse(
        id=new_settlement.id, payer_id=new_settlement.payer_id, payer_name=payer.name,
        payee_id=new_settlement.payee_id, payee_name=payee.name,
        amount=float(new_settlement.amount), group_id=new_settlement.group_id,
        expense_id=new_settlement.expense_id, status=new_settlement.status,
        created_at=new_settlement.created_at.isoformat()
    )


@router.post("/settlements/{settlement_id}/approve")
def approve_settlement(
    settlement_id: int,
    current_user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    settlement = db.query(Settlement).filter(Settlement.id == settlement_id).first()
    if not settlement:
        raise HTTPException(status_code=404, detail="Settlement not found")
    if settlement.payee_id != current_user_id:
        raise HTTPException(status_code=403, detail="Only the payee can approve this settlement")
    if settlement.status != "pending":
        raise HTTPException(status_code=400, detail="Settlement is not pending")

    settlement.status = "approved"

    if settlement.expense_id:
        # Single expense payment — add a message to that expense
        _add_system_message(
            db, settlement.expense_id, settlement.payee_id,
            f"{settlement.payer.name} paid £{settlement.amount:.2f} — confirmed by {settlement.payee.name}"
        )
    elif settlement.group_id:
        # Group-level "Settle All" — cascade: mark every matching expense in the group as cleared
        expenses = db.query(Expense).filter(
            Expense.group_id == settlement.group_id,
            Expense.payer_id == settlement.payee_id,   # creditor paid these expenses
            Expense.status == "active",
        ).all()
        for exp in expenses:
            split = db.query(ExpenseSplit).filter(
                ExpenseSplit.expense_id == exp.id,
                ExpenseSplit.user_id == settlement.payer_id,   # debtor has a split here
            ).first()
            if not split:
                continue
            # Skip if already cleared for this expense
            already_cleared = db.query(Settlement).filter(
                Settlement.payer_id == settlement.payer_id,
                Settlement.expense_id == exp.id,
                Settlement.status == "approved",
            ).first()
            if already_cleared:
                continue
            cleared = Settlement(
                payer_id=settlement.payer_id,
                payee_id=settlement.payee_id,
                amount=float(split.amount),
                group_id=settlement.group_id,
                expense_id=exp.id,
                status="approved",
            )
            db.add(cleared)
            _add_system_message(
                db, exp.id, settlement.payee_id,
                f"{settlement.payer.name} paid £{float(split.amount):.2f} — cleared via Settle All"
            )

    _add_notification(
        db, settlement.payer_id,
        f"Your payment of £{settlement.amount:.2f} was approved by {settlement.payee.name}!"
    )
    db.commit()
    _push_group_event(db, settlement.group_id)
    return {"message": "Settlement approved."}


@router.get("/settlements/{settlement_id}/breakdown")
def get_settlement_breakdown(
    settlement_id: int,
    current_user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    settlement = db.query(Settlement).filter(Settlement.id == settlement_id).first()
    if not settlement:
        raise HTTPException(status_code=404, detail="Settlement not found")
    if current_user_id not in (settlement.payer_id, settlement.payee_id):
        raise HTTPException(status_code=403, detail="Forbidden")

    if settlement.expense_id:
        exp = db.query(Expense).filter(Expense.id == settlement.expense_id).first()
        if not exp:
            return []
        return [{
            "expense_id": exp.id,
            "description": exp.description,
            "date": exp.date.isoformat(),
            "total_amount": float(exp.amount),
            "your_share": float(settlement.amount),
        }]

    if not settlement.group_id:
        return []

    expenses = db.query(Expense).filter(
        Expense.group_id == settlement.group_id,
        Expense.payer_id == settlement.payee_id,
        Expense.status == "active",
    ).order_by(Expense.date.desc()).all()

    result = []
    for exp in expenses:
        split = db.query(ExpenseSplit).filter(
            ExpenseSplit.expense_id == exp.id,
            ExpenseSplit.user_id == settlement.payer_id,
        ).first()
        if not split:
            continue
        result.append({
            "expense_id": exp.id,
            "description": exp.description,
            "date": exp.date.isoformat(),
            "total_amount": float(exp.amount),
            "your_share": float(split.amount),
        })
    return result


@router.post("/settlements/{settlement_id}/reject")
def reject_settlement(
    settlement_id: int,
    current_user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    settlement = db.query(Settlement).filter(Settlement.id == settlement_id).first()
    if not settlement:
        raise HTTPException(status_code=404, detail="Settlement not found")
    if settlement.payee_id != current_user_id:
        raise HTTPException(status_code=403, detail="Only the payee can reject this settlement")
    settlement.status = "rejected"
    _add_notification(
        db, settlement.payer_id,
        f"Your payment of £{settlement.amount:.2f} was rejected by {settlement.payee.name}."
    )
    db.commit()
    _push_group_event(db, settlement.group_id)
    return {"message": "Settlement rejected."}
