from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from database import Subscription, GroupBudget, Expense
from routes.deps import get_db, get_current_user_id
from services.subscription import (
    get_all_features, get_all_flags_by_plan, get_user_plan,
    DEFAULT_FLAGS, PLANS, PLAN_PRICES, check_feature,
)
from schemas import GroupBudgetCreate, GroupBudgetResponse

router = APIRouter()


@router.get("/subscription")
def get_my_subscription(
    current_user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    return get_all_features(db, current_user_id)


@router.get("/trial-info")
def get_trial_info(
    current_user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    from database import AppSettings
    settings = db.query(AppSettings).first()
    if not settings:
        return {"personal_trial_active": False, "personal_trial_days": 30,
                "work_trial_active": False, "work_trial_days": 30}
    return {
        "personal_trial_active": settings.personal_trial_active,
        "personal_trial_days": settings.personal_trial_days,
        "work_trial_active": settings.work_trial_active,
        "work_trial_days": settings.work_trial_days,
    }


@router.get("/plans")
def get_plans(db: Session = Depends(get_db)):
    flags = get_all_flags_by_plan(db)
    return {
        plan: {
            'price': PLAN_PRICES[plan],
            'features': flags[plan],
        }
        for plan in PLANS
    }


@router.post("/groups/{group_id}/budget", response_model=GroupBudgetResponse)
def set_group_budget(
    group_id: int,
    req: GroupBudgetCreate,
    current_user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    if not check_feature(db, current_user_id, 'group_budget'):
        raise HTTPException(status_code=403, detail={
            "message": "Group budgets require a Pro plan.",
            "upgrade_to": "pro", "feature": "group_budget",
            "current_plan": get_user_plan(db, current_user_id),
        })
    existing = db.query(GroupBudget).filter(GroupBudget.group_id == group_id).first()
    if existing:
        existing.amount = req.amount
        existing.period = req.period
        db.commit()
        db.refresh(existing)
        budget = existing
    else:
        budget = GroupBudget(
            group_id=group_id, amount=req.amount,
            period=req.period, created_by_id=current_user_id,
        )
        db.add(budget)
        db.commit()
        db.refresh(budget)
    spent = _compute_spent(db, group_id, req.period)
    return GroupBudgetResponse(
        id=budget.id, group_id=budget.group_id,
        amount=float(budget.amount), period=budget.period, spent=spent,
    )


@router.get("/groups/{group_id}/budget", response_model=GroupBudgetResponse)
def get_group_budget(
    group_id: int,
    current_user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    budget = db.query(GroupBudget).filter(GroupBudget.group_id == group_id).first()
    if not budget:
        raise HTTPException(status_code=404, detail="No budget set for this group")
    spent = _compute_spent(db, group_id, budget.period)
    return GroupBudgetResponse(
        id=budget.id, group_id=budget.group_id,
        amount=float(budget.amount), period=budget.period, spent=spent,
    )


@router.delete("/groups/{group_id}/budget")
def delete_group_budget(
    group_id: int,
    current_user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    budget = db.query(GroupBudget).filter(GroupBudget.group_id == group_id).first()
    if budget:
        db.delete(budget)
        db.commit()
    return {"message": "Budget removed"}


def _compute_spent(db: Session, group_id: int, period: str) -> float:
    from datetime import datetime, timedelta
    from sqlalchemy import func
    q = db.query(func.sum(Expense.amount)).filter(
        Expense.group_id == group_id,
        Expense.status == "active",
    )
    if period == "monthly":
        now = datetime.utcnow()
        start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        q = q.filter(Expense.date >= start)
    elif period == "yearly":
        now = datetime.utcnow()
        start = now.replace(month=1, day=1, hour=0, minute=0, second=0, microsecond=0)
        q = q.filter(Expense.date >= start)
    return float(q.scalar() or 0)
