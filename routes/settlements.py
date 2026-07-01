from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from database import User, Group, Settlement
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
        existing = db.query(Settlement).filter(
            Settlement.payer_id == req.payer_id,
            Settlement.expense_id == req.expense_id,
            Settlement.status == "pending"
        ).first()
        if existing:
            raise HTTPException(status_code=400,
                                detail="A pending payment request already exists for this expense")

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
    _add_notification(
        db, req.payee_id,
        f"{payer.name} sent a payment of £{req.amount} in {group_name}. Please approve it.",
        group_id=req.group_id
    )

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
        _add_system_message(
            db, settlement.expense_id, settlement.payee_id,
            f"{settlement.payer.name} paid £{settlement.amount:.2f} — confirmed by {settlement.payee.name}"
        )
    _add_notification(
        db, settlement.payer_id,
        f"Your payment of £{settlement.amount} was approved by {settlement.payee.name}!"
    )
    db.commit()
    _push_group_event(db, settlement.group_id)
    return {"message": "Settlement approved."}


@router.post("/settlements/quick_settle")
def quick_settle(
    req: SettlementCreate,
    current_user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    """Create a settlement and mark it approved immediately — used by the People tab 'Settle All'."""
    if req.payer_id != current_user_id:
        raise HTTPException(status_code=403, detail="Cannot settle on behalf of another user")
    payer = db.query(User).filter(User.id == req.payer_id).first()
    payee = db.query(User).filter(User.id == req.payee_id).first()
    if not payer or not payee:
        raise HTTPException(status_code=404, detail="User not found")

    settlement = Settlement(
        payer_id=req.payer_id, payee_id=req.payee_id,
        amount=req.amount, group_id=req.group_id,
        status="approved",
    )
    db.add(settlement)
    db.commit()

    group_name = "a group"
    if req.group_id:
        group = db.query(Group).filter(Group.id == req.group_id).first()
        if group:
            group_name = group.name
    _add_notification(
        db, req.payee_id,
        f"{payer.name} marked £{req.amount:.2f} as settled in {group_name}.",
        group_id=req.group_id,
    )
    _push_group_event(db, req.group_id)
    return {"message": "Settled."}


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
        f"Your payment of £{settlement.amount} was rejected by {settlement.payee.name}."
    )
    db.commit()
    _push_group_event(db, settlement.group_id)
    return {"message": "Settlement rejected."}
