from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from database import User, Group, Expense, ExpenseSplit, ExpenseMessage, ExpenseDeletionApproval, Notification, Settlement
from routes.deps import get_db, get_current_user_id, hash_password
from services.helpers import _format_expense, _EXPENSE_LOAD_OPTIONS
from services.cache import invalidate_all_balances
from schemas import UserRegister, UserResponse, SettlementResponse

router = APIRouter()


def _require_admin(current_user_id: int, db: Session) -> User:
    admin = db.query(User).filter(User.id == current_user_id, User.is_admin == True).first()
    if not admin:
        raise HTTPException(status_code=403, detail="Admin privileges required")
    return admin


@router.get("/admin/users", response_model=List[UserResponse])
def admin_get_users(
    current_user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    _require_admin(current_user_id, db)
    return db.query(User).all()


@router.post("/admin/users", response_model=UserResponse)
def admin_create_user(
    user: UserRegister,
    is_admin_flag: bool = False,
    current_user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    _require_admin(current_user_id, db)
    if db.query(User).filter(User.email == user.email).first():
        raise HTTPException(status_code=400, detail="Email already registered")
    hashed = hash_password(user.password)
    new_user = User(name=user.name, email=user.email.strip().lower(),
                    password=hashed, is_admin=is_admin_flag, is_verified=True)
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    return new_user


@router.put("/admin/users/{user_id}/toggle_admin", response_model=UserResponse)
def admin_toggle_admin(
    user_id: int,
    current_user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    _require_admin(current_user_id, db)
    if user_id == current_user_id:
        raise HTTPException(status_code=400, detail="Cannot toggle your own admin status")
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    user.is_admin = not user.is_admin
    db.commit()
    db.refresh(user)
    return user


@router.delete("/admin/users/{user_id}")
def admin_delete_user(
    user_id: int,
    current_user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    _require_admin(current_user_id, db)
    if user_id == current_user_id:
        raise HTTPException(status_code=400, detail="Cannot delete yourself")
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    db.delete(user)
    db.commit()
    return {"message": "User deleted"}


@router.delete("/admin/groups/{group_id}")
def admin_delete_group(
    group_id: int,
    current_user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    _require_admin(current_user_id, db)
    group = db.query(Group).filter(Group.id == group_id).first()
    if not group:
        raise HTTPException(status_code=404, detail="Group not found")
    db.delete(group)
    db.commit()
    return {"message": "Group deleted"}


@router.get("/admin/stats")
def admin_get_stats(
    current_user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    _require_admin(current_user_id, db)
    return {
        "total_users": db.query(User).count(),
        "total_groups": db.query(Group).count(),
        "active_expenses": db.query(Expense).filter(Expense.status == "active").count(),
        "pending_deletions": db.query(Expense).filter(
            Expense.status.in_(["pending_deletion", "approved_for_deletion"])
        ).count(),
        "deleted_expenses": db.query(Expense).filter(Expense.status == "deleted").count(),
        "total_expense_amount": float(
            db.query(func.sum(Expense.amount)).filter(Expense.status == "active").scalar() or 0
        ),
        "total_settlements": db.query(Settlement).count(),
        "pending_settlements": db.query(Settlement).filter(Settlement.status == "pending").count(),
        "approved_settlements": db.query(Settlement).filter(Settlement.status == "approved").count(),
        "total_notifications": db.query(Notification).count(),
        "unread_notifications": db.query(Notification).filter(Notification.is_read == 0).count(),
    }


@router.get("/admin/groups")
def admin_list_groups(
    current_user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    _require_admin(current_user_id, db)
    groups = db.query(Group).all()
    result = []
    for g in groups:
        active_count = db.query(Expense).filter(
            Expense.group_id == g.id, Expense.status == "active"
        ).count()
        result.append({
            "id": g.id, "name": g.name,
            "member_count": len(g.members),
            "expense_count": active_count,
            "members": [{"id": m.id, "name": m.name} for m in g.members],
        })
    return result


@router.get("/admin/expenses")
def admin_list_expenses(
    status: Optional[str] = None,
    current_user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    _require_admin(current_user_id, db)
    q = db.query(Expense).options(*_EXPENSE_LOAD_OPTIONS)
    if status:
        q = q.filter(Expense.status == status)
    return [_format_expense(e, db) for e in q.order_by(Expense.date.desc()).limit(200).all()]


@router.get("/admin/settlements")
def admin_list_settlements(
    current_user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    _require_admin(current_user_id, db)
    settlements = db.query(Settlement).order_by(Settlement.created_at.desc()).limit(200).all()
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


class WipeConfirmRequest(BaseModel):
    confirm: str  # Must equal "DELETE ALL TRANSACTIONS"


@router.post("/admin/wipe_transactions")
def admin_wipe_transactions(
    req: WipeConfirmRequest,
    current_user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    _require_admin(current_user_id, db)
    if req.confirm != "DELETE ALL TRANSACTIONS":
        raise HTTPException(status_code=400, detail="Confirmation phrase does not match")
    # Delete in dependency order: splits → approvals → messages → settlements → notifications → expenses
    db.query(ExpenseSplit).delete(synchronize_session=False)
    db.query(ExpenseDeletionApproval).delete(synchronize_session=False)
    db.query(ExpenseMessage).delete(synchronize_session=False)
    db.query(Settlement).delete(synchronize_session=False)
    db.query(Notification).delete(synchronize_session=False)
    db.query(Expense).delete(synchronize_session=False)
    db.commit()
    invalidate_all_balances()
    return {"message": "All transactions wiped. Users and groups are intact."}


@router.get("/admin/notifications")
def admin_list_notifications(
    user_id: Optional[int] = None,
    current_user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    _require_admin(current_user_id, db)
    q = db.query(Notification)
    if user_id:
        q = q.filter(Notification.user_id == user_id)
    return [
        {
            "id": n.id, "user_id": n.user_id,
            "user_name": n.user.name if n.user else "?",
            "message": n.message, "group_id": n.group_id,
            "expense_id": n.expense_id, "is_read": n.is_read,
            "created_at": n.created_at.isoformat()
        }
        for n in q.order_by(Notification.created_at.desc()).limit(500).all()
    ]


# ── Subscription management ────────────────────────────────────────────────────

from database import Subscription as SubscriptionModel, FeatureFlag as FeatureFlagModel
from services.subscription import get_user_plan, get_all_flags_by_plan, seed_default_flags, PLANS, DEFAULT_FLAGS
from schemas import PlanUpdateRequest, FeatureFlagUpdateRequest


@router.get("/admin/subscriptions")
def admin_get_subscriptions(
    current_user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    _require_admin(current_user_id, db)
    users = db.query(User).all()
    result = []
    for u in users:
        sub = db.query(SubscriptionModel).filter(
            SubscriptionModel.user_id == u.id,
            SubscriptionModel.is_active == True
        ).first()
        result.append({
            "user_id": u.id,
            "user_name": u.name,
            "user_email": u.email,
            "plan": sub.plan if sub else "free",
            "started_at": sub.started_at.isoformat() if sub else None,
            "expires_at": sub.expires_at.isoformat() if sub and sub.expires_at else None,
        })
    return result


@router.put("/admin/users/{user_id}/plan")
def admin_set_plan(
    user_id: int,
    req: PlanUpdateRequest,
    current_user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    _require_admin(current_user_id, db)
    if req.plan not in PLANS:
        raise HTTPException(status_code=400, detail=f"Invalid plan. Must be one of: {PLANS}")
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    sub = db.query(SubscriptionModel).filter(SubscriptionModel.user_id == user_id).first()
    if sub:
        sub.plan = req.plan
        sub.is_active = True
    else:
        sub = SubscriptionModel(user_id=user_id, plan=req.plan, is_active=True)
        db.add(sub)
    db.commit()
    return {"user_id": user_id, "plan": req.plan, "message": f"Plan updated to {req.plan}"}


@router.get("/admin/feature-flags")
def admin_get_feature_flags(
    current_user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    _require_admin(current_user_id, db)
    seed_default_flags(db)
    return get_all_flags_by_plan(db)


@router.put("/admin/feature-flags/{plan}/{feature_key}")
def admin_update_feature_flag(
    plan: str,
    feature_key: str,
    req: FeatureFlagUpdateRequest,
    current_user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    _require_admin(current_user_id, db)
    if plan not in PLANS:
        raise HTTPException(status_code=400, detail=f"Invalid plan: {plan}")
    flag = db.query(FeatureFlagModel).filter(
        FeatureFlagModel.plan == plan,
        FeatureFlagModel.feature_key == feature_key,
    ).first()
    if flag:
        flag.enabled = req.enabled
        flag.limit_value = req.limit_value
    else:
        flag = FeatureFlagModel(
            plan=plan, feature_key=feature_key,
            enabled=req.enabled, limit_value=req.limit_value,
        )
        db.add(flag)
    db.commit()
    return {"plan": plan, "feature_key": feature_key, "enabled": req.enabled, "limit_value": req.limit_value}
