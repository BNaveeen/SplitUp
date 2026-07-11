import csv
import io
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from database import User, Group, Expense, ExpenseSplit, ExpenseMessage, ExpenseDeletionApproval, Notification, Settlement, ExpenseReport
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
    # Delete in dependency order
    db.query(ExpenseSplit).delete(synchronize_session=False)
    db.query(ExpenseDeletionApproval).delete(synchronize_session=False)
    db.query(ExpenseMessage).delete(synchronize_session=False)
    db.query(Settlement).delete(synchronize_session=False)
    db.query(Notification).delete(synchronize_session=False)
    db.query(Expense).delete(synchronize_session=False)
    db.query(ExpenseReport).delete(synchronize_session=False)
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
            "id": u.id,
            "name": u.name,
            "email": u.email,
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


# ── Trial & Billing settings ───────────────────────────────────────────────────

from database import AppSettings as AppSettingsModel
from schemas import AppSettingsResponse, AppSettingsUpdate
from datetime import datetime as dt


def _get_or_create_settings(db: Session) -> AppSettingsModel:
    s = db.query(AppSettingsModel).first()
    if not s:
        s = AppSettingsModel()
        db.add(s)
        db.commit()
        db.refresh(s)
    return s


@router.get("/admin/app-settings", response_model=AppSettingsResponse)
def get_app_settings(
    current_user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    _require_admin(current_user_id, db)
    return _get_or_create_settings(db)


@router.put("/admin/app-settings", response_model=AppSettingsResponse)
def update_app_settings(
    req: AppSettingsUpdate,
    current_user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    _require_admin(current_user_id, db)
    s = _get_or_create_settings(db)
    if req.personal_trial_active is not None:
        s.personal_trial_active = req.personal_trial_active
    if req.personal_trial_days is not None:
        s.personal_trial_days = max(1, req.personal_trial_days)
    if req.work_trial_active is not None:
        s.work_trial_active = req.work_trial_active
    if req.work_trial_days is not None:
        s.work_trial_days = max(1, req.work_trial_days)
    if req.totp_enforcement is not None and req.totp_enforcement in ('disabled', 'optional', 'required'):
        s.totp_enforcement = req.totp_enforcement
    if req.email_provider is not None and req.email_provider in ('smtp', 'sendgrid', 'mailgun', 'ses'):
        s.email_provider = req.email_provider
    s.updated_at = dt.utcnow()
    db.commit()
    db.refresh(s)
    return s


@router.get("/admin/trial-stats")
def get_trial_stats(
    current_user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    from database import Organisation
    _require_admin(current_user_id, db)
    s = _get_or_create_settings(db)
    personal_claims = db.query(User).filter(User.trial_claimed_at.isnot(None)).count()
    work_claims = db.query(Organisation).filter(Organisation.work_trial_claimed_at.isnot(None)).count()
    return {
        "personal_trial_active": s.personal_trial_active,
        "personal_trial_days": s.personal_trial_days,
        "personal_claims_total": personal_claims,
        "work_trial_active": s.work_trial_active,
        "work_trial_days": s.work_trial_days,
        "work_claims_total": work_claims,
    }


# ── CSV Export endpoints ───────────────────────────────────────────────────────

def _csv_response(rows: list[list], headers: list[str], filename: str) -> StreamingResponse:
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(headers)
    w.writerows(rows)
    content = "﻿" + buf.getvalue()  # BOM for Excel UTF-8
    return StreamingResponse(
        io.BytesIO(content.encode("utf-8")),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/admin/export/users")
def export_users_csv(
    current_user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    _require_admin(current_user_id, db)
    users = db.query(User).all()
    rows = [
        [
            u.id, u.name, u.email,
            "Yes" if u.is_admin else "No",
            "Yes" if u.is_verified else "No",
            u.org_role or "",
            u.org_status or "",
            u.organisation.name if u.organisation else "",
            u.department.name if u.department else "",
            u.job_title or "",
            u.employee_id or "",
        ]
        for u in users
    ]
    return _csv_response(
        rows,
        ["id", "name", "email", "is_admin", "is_verified", "org_role", "org_status",
         "organisation", "department", "job_title", "employee_id"],
        "users.csv",
    )


@router.get("/admin/export/expenses")
def export_expenses_csv(
    current_user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    _require_admin(current_user_id, db)
    expenses = db.query(Expense).filter(Expense.status == "active").all()
    rows = [
        [
            e.id, e.description, float(e.amount or 0),
            e.currency or "GBP",
            e.category or "",
            e.date.strftime("%Y-%m-%d") if e.date else "",
            e.created_at.strftime("%Y-%m-%d %H:%M") if e.created_at else "",
            e.payer.name if e.payer else "",
            e.group.name if e.group else "",
            e.status,
        ]
        for e in expenses
    ]
    return _csv_response(
        rows,
        ["id", "description", "amount", "currency", "category", "date", "created_at",
         "paid_by", "group", "status"],
        "expenses.csv",
    )


@router.get("/admin/export/settlements")
def export_settlements_csv(
    current_user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    _require_admin(current_user_id, db)
    settlements = db.query(Settlement).all()
    rows = [
        [
            s.id, s.payer.name if s.payer else "", s.payee.name if s.payee else "",
            float(s.amount or 0), s.status,
            s.created_at.strftime("%Y-%m-%d %H:%M") if s.created_at else "",
            s.group.name if s.group else "",
        ]
        for s in settlements
    ]
    return _csv_response(
        rows,
        ["id", "from", "to", "amount", "status", "created_at", "group"],
        "settlements.csv",
    )


# ── Integration utilities ──────────────────────────────────────────────────────

class TestEmailRequest(BaseModel):
    address: str


@router.post("/admin/integrations/test-email")
def send_test_email(
    req: TestEmailRequest,
    current_user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    _require_admin(current_user_id, db)
    from services.email import send_email
    html = """
    <div style="font-family:sans-serif;max-width:480px;margin:auto;padding:32px;
                background:#0f172a;color:#e2e8f0;border-radius:16px">
      <h2 style="color:#f59e0b;margin:0 0 12px">SplitUp — Test Email</h2>
      <p style="margin:0 0 8px;color:#94a3b8">This is a test email from your SplitUp admin panel.</p>
      <p style="margin:0;color:#64748b;font-size:12px">SMTP is configured and working correctly.</p>
    </div>
    """
    ok = send_email(req.address, "SplitUp — Integration Test", html)
    if not ok:
        raise HTTPException(status_code=502, detail="SMTP send failed — check SMTP_USER and SMTP_PASS environment variables.")
    return {"status": "sent", "to": req.address}
