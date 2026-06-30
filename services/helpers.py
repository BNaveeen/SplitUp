import asyncio
from datetime import datetime
from typing import Optional
from sqlalchemy.orm import Session, joinedload, selectinload

from database import (
    User, Group, Expense, ExpenseSplit,
    Notification as _Notification,
    ExpenseMessage as _ExpenseMessage,
    Settlement as _Settlement,
)
from services.realtime import manager, get_event_loop
from services.cache import invalidate_balance


def _push_group_event(db: Session, group_id: Optional[int]):
    if not group_id:
        return
    loop = get_event_loop()
    if not loop:
        return
    invalidate_balance(group_id)
    group = db.query(Group).filter(Group.id == group_id).first()
    if not group:
        return
    member_ids = [m.id for m in group.members]
    if not member_ids:
        return

    async def _do():
        await manager.broadcast_to_users(member_ids, {"type": "group_refresh", "group_id": group_id})

    try:
        asyncio.run_coroutine_threadsafe(_do(), loop)
    except Exception:
        pass


def _add_notification(db: Session, user_id: int, message: str,
                      expense_id: int = None, group_id: int = None):
    n = _Notification(user_id=user_id, message=message,
                      expense_id=expense_id, group_id=group_id, is_read=0)
    db.add(n)
    db.flush()
    loop = get_event_loop()
    if not loop:
        return

    async def _push():
        await manager.send_to_user(user_id, {
            "type": "notification", "id": n.id, "message": message,
            "group_id": group_id, "expense_id": expense_id,
            "is_read": 0, "created_at": datetime.utcnow().isoformat()
        })

    try:
        asyncio.run_coroutine_threadsafe(_push(), loop)
    except Exception:
        pass


def _add_system_message(db: Session, expense_id: int, user_id: int, text: str):
    user = db.query(User).filter(User.id == user_id).first()
    user_name = user.name if user else "System"
    msg = _ExpenseMessage(expense_id=expense_id, user_id=user_id,
                          text=f"{user_name} {text}", is_system=1)
    db.add(msg)


_EXPENSE_LOAD_OPTIONS = [
    joinedload(Expense.payer),
    joinedload(Expense.created_by),
    selectinload(Expense.splits).joinedload(ExpenseSplit.user),
    selectinload(Expense.approvals),
    selectinload(Expense.messages),
]


def _format_expense(e: Expense, db: Session = None) -> dict:
    last_msg = getattr(e, "messages", [])
    last_message_at = last_msg[-1].created_at.isoformat() if last_msg else None
    last_message_text = last_msg[-1].text if last_msg else None
    settlement_statuses = []
    if db is not None:
        s_map = {s.payer_id: s.status for s in db.query(_Settlement).filter(
            _Settlement.expense_id == e.id,
            _Settlement.status.in_(["pending", "approved"])
        ).all()}
        for split in e.splits:
            if split.user_id == e.payer_id:
                continue
            st = s_map.get(split.user_id)
            settlement_statuses.append({
                "user_id": split.user_id,
                "user_name": split.user.name if split.user else "?",
                "amount": float(split.amount),
                "status": "cleared" if st == "approved" else "pending" if st == "pending" else "unpaid",
            })
    return {
        "id": e.id, "description": e.description, "amount": float(e.amount),
        "payer_id": e.payer_id, "payer_name": e.payer.name if e.payer else "Unknown",
        "created_by_id": e.created_by_id,
        "created_by_name": e.created_by.name if e.created_by else "Unknown",
        "status": e.status, "group_id": e.group_id,
        "date": e.date.isoformat() if e.date else None,
        "splits": [
            {"user_id": s.user_id, "amount": float(s.amount),
             "user_name": s.user.name if s.user else "?"}
            for s in e.splits
        ],
        "approvals": [
            {"user_id": a.user_id,
             "user_name": a.user.name if a.user else "?",
             "approved": a.approved}
            for a in getattr(e, "approvals", [])
        ],
        "last_message_at": last_message_at,
        "last_message_text": last_message_text,
        "created_at": (
            e.created_at.isoformat() if getattr(e, "created_at", None)
            else e.date.isoformat() if e.date else None
        ),
        "settlement_statuses": settlement_statuses,
        "receipt_image": getattr(e, "receipt_image", None),
        "category": getattr(e, "category", None),
        "recurrence": getattr(e, "recurrence", None),
        "next_due": (getattr(e, "next_due", None).isoformat() if getattr(e, "next_due", None) else None),
    }
