import asyncio
import os
from datetime import datetime, timedelta

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from slowapi.errors import RateLimitExceeded
from slowapi import _rate_limit_exceeded_handler
from sqlalchemy import text
from sqlalchemy.orm import Session

from database import SessionLocal, Expense, ExpenseSplit, ExpenseMessage, Settlement, Notification, SQLALCHEMY_DATABASE_URL
from routes.deps import limiter, get_db
from routes import auth, users, groups, expenses, settlements, admin, invites, websocket_routes
from routes import subscriptions as subscriptions_router
from routes import corporate as corporate_router
from services.realtime import manager, set_event_loop
from services.helpers import _add_system_message, _push_group_event

try:
    import redis.asyncio as aioredis
    _redis_available = True
except ImportError:
    _redis_available = False

REDIS_URL = os.environ.get("REDIS_URL", "")

ALLOWED_ORIGINS = [
    "http://localhost:5173",
    "http://localhost:5174",
    "http://127.0.0.1:5173",
    "http://127.0.0.1:5174",
    "https://bnaveeen.github.io",
    "https://splitup-qttj.onrender.com",
]

app = FastAPI(title="SplitWise API")
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["Authorization", "Content-Type"],
)

app.include_router(auth.router)
app.include_router(users.router)
app.include_router(groups.router)
app.include_router(expenses.router)
app.include_router(settlements.router)
app.include_router(admin.router)
app.include_router(invites.router)
app.include_router(websocket_routes.router)
app.include_router(subscriptions_router.router)
app.include_router(corporate_router.router)


@app.get("/health")
def health_check():
    return {"status": "ok", "version": "2.3"}


@app.get("/lb-health")
def lb_health(db: Session = Depends(get_db)):
    import socket
    db.execute(text("SELECT 1"))
    return {
        "status": "ok",
        "instance": os.environ.get("RENDER_SERVICE_NAME", "local"),
        "host": socket.gethostname(),
        "workers": int(os.environ.get("WEB_CONCURRENCY", 1)),
        "db": "connected",
    }


def _next_due(current_due: datetime, recurrence: str) -> datetime:
    if recurrence == 'weekly':
        return current_due + timedelta(weeks=1)
    if recurrence == 'monthly':
        month = current_due.month + 1
        year = current_due.year + (month - 1) // 12
        month = (month - 1) % 12 + 1
        day = min(current_due.day, [31,28+int((year%4==0 and(year%100!=0 or year%400==0))),31,30,31,30,31,31,30,31,30,31][month-1])
        return current_due.replace(year=year, month=month, day=day)
    if recurrence == 'yearly':
        return current_due.replace(year=current_due.year + 1)
    return current_due + timedelta(days=1)


async def _deletion_scheduler():
    while True:
        await asyncio.sleep(60)
        now = datetime.utcnow()
        db = SessionLocal()
        try:
            # Permanently delete approved expenses past the grace period
            cutoff = now - timedelta(minutes=10)
            expired = db.query(Expense).filter(
                Expense.status == "approved_for_deletion",
                Expense.deletion_approved_at.isnot(None),
                Expense.deletion_approved_at <= cutoff
            ).all()
            group_ids = set()
            for exp in expired:
                exp.status = "deleted"
                _add_system_message(db, exp.id, exp.created_by_id, "Expense permanently deleted.")
                if exp.group_id:
                    group_ids.add(exp.group_id)
            if expired:
                db.commit()
                for gid in group_ids:
                    _push_group_event(db, gid)

            # Spawn due recurring expenses
            due = db.query(Expense).filter(
                Expense.recurrence.isnot(None),
                Expense.next_due.isnot(None),
                Expense.next_due <= now,
                Expense.status == "active",
            ).all()
            recurring_group_ids = set()
            for tmpl in due:
                new_exp = Expense(
                    description=tmpl.description,
                    amount=tmpl.amount,
                    payer_id=tmpl.payer_id,
                    created_by_id=tmpl.created_by_id,
                    group_id=tmpl.group_id,
                    date=tmpl.next_due,
                    category=tmpl.category,
                    recurrence=None,   # spawned copy is a plain expense
                )
                db.add(new_exp)
                db.flush()
                for split in tmpl.splits:
                    db.add(ExpenseSplit(expense_id=new_exp.id, user_id=split.user_id, amount=split.amount))
                _add_system_message(db, new_exp.id, tmpl.created_by_id, f"created automatically (recurring {tmpl.recurrence})")
                # Notify all split members
                split_uids = {s.user_id for s in tmpl.splits} | {tmpl.payer_id}
                for uid in split_uids:
                    if uid != tmpl.created_by_id:
                        db.add(Notification(user_id=uid, message=f"Recurring expense added: {tmpl.description}", expense_id=new_exp.id, group_id=tmpl.group_id, is_read=0))
                tmpl.next_due = _next_due(tmpl.next_due, tmpl.recurrence)
                if tmpl.group_id:
                    recurring_group_ids.add(tmpl.group_id)
            if due:
                db.commit()
                for gid in recurring_group_ids:
                    _push_group_event(db, gid)
        except Exception:
            pass
        finally:
            db.close()


@app.on_event("startup")
async def startup_event():
    set_event_loop(asyncio.get_running_loop())
    if REDIS_URL and _redis_available:
        try:
            await manager.setup_redis(REDIS_URL)
        except Exception:
            pass
    asyncio.create_task(_deletion_scheduler())
    # Column migration — each statement in its own transaction so one failure
    # doesn't roll back the others. TIMESTAMP works on both SQLite and PostgreSQL.
    is_pg = SQLALCHEMY_DATABASE_URL.startswith("postgresql") or SQLALCHEMY_DATABASE_URL.startswith("postgres")
    ts_type = "TIMESTAMP" if is_pg else "DATETIME"
    for col_sql in [
        "ALTER TABLE expenses ADD COLUMN receipt_image TEXT",
        "ALTER TABLE expenses ADD COLUMN category TEXT",
        "ALTER TABLE expenses ADD COLUMN recurrence TEXT",
        f"ALTER TABLE expenses ADD COLUMN next_due {ts_type}",
        # Corporate columns for users
        "ALTER TABLE users ADD COLUMN organisation_id INTEGER",
        "ALTER TABLE users ADD COLUMN department_id INTEGER",
        "ALTER TABLE users ADD COLUMN manager_id INTEGER",
        "ALTER TABLE users ADD COLUMN employee_id TEXT",
        # Corporate columns for expenses
        "ALTER TABLE expenses ADD COLUMN currency TEXT DEFAULT 'GBP'",
        "ALTER TABLE expenses ADD COLUMN report_id INTEGER",
        # org_role on users
        "ALTER TABLE users ADD COLUMN org_role TEXT",
        # job_title free-text field on users
        "ALTER TABLE users ADD COLUMN job_title TEXT",
        # salutation / title (Mr/Mrs/Ms/Dr/Prof/Rev)
        "ALTER TABLE users ADD COLUMN title TEXT",
        # Linked secondary emails
        "ALTER TABLE users ADD COLUMN personal_email TEXT",
        "ALTER TABLE users ADD COLUMN personal_email_verified BOOLEAN DEFAULT FALSE",
        "ALTER TABLE users ADD COLUMN work_email TEXT",
        "ALTER TABLE users ADD COLUMN work_email_verified BOOLEAN DEFAULT FALSE",
        # Org membership status + personal trial
        "ALTER TABLE users ADD COLUMN org_status TEXT DEFAULT 'active'",
        "ALTER TABLE users ADD COLUMN trial_claimed_at DATETIME",
        # Org work-trial
        "ALTER TABLE organisations ADD COLUMN work_trial_claimed_at DATETIME",
    ]:
        mig_db = SessionLocal()
        try:
            mig_db.execute(text(col_sql))
            mig_db.commit()
        except Exception:
            mig_db.rollback()
        finally:
            mig_db.close()
    # Clean up fake "Payment" expenses created by old settlement flow
    db = SessionLocal()
    try:
        fake = db.query(Expense).filter(
            Expense.description == "Payment",
            Expense.payer_id != Expense.created_by_id
        ).all()
        for exp in fake:
            db.query(ExpenseSplit).filter(ExpenseSplit.expense_id == exp.id).delete()
            db.query(ExpenseMessage).filter(ExpenseMessage.expense_id == exp.id).delete()
            db.query(Settlement).filter(Settlement.expense_id == exp.id).update({"expense_id": None})
            db.flush()
            db.delete(exp)
        if fake:
            db.commit()
    except Exception:
        db.rollback()
    finally:
        db.close()
    # Seed subscription feature flags if not present
    seed_db = SessionLocal()
    try:
        from services.subscription import seed_default_flags as _seed
        _seed(seed_db)
    except Exception:
        pass
    finally:
        seed_db.close()

    # Ensure AppSettings singleton exists
    settings_db = SessionLocal()
    try:
        from database import AppSettings
        if not settings_db.query(AppSettings).first():
            settings_db.add(AppSettings())
            settings_db.commit()
    except Exception:
        settings_db.rollback()
    finally:
        settings_db.close()
