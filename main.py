import asyncio
import os
from datetime import datetime, timedelta

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from slowapi.errors import RateLimitExceeded
from slowapi import _rate_limit_exceeded_handler
from sqlalchemy import text
from sqlalchemy.orm import Session

from database import SessionLocal, Expense, ExpenseSplit, ExpenseMessage, Settlement
from routes.deps import limiter, get_db
from routes import auth, users, groups, expenses, settlements, admin, invites, websocket_routes
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


@app.get("/health")
def health_check():
    return {"status": "ok", "version": "2.0"}


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


async def _deletion_scheduler():
    while True:
        await asyncio.sleep(60)
        db = SessionLocal()
        try:
            cutoff = datetime.utcnow() - timedelta(minutes=10)
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
    # Column migration (idempotent — safe to run on every startup)
    mig_db = SessionLocal()
    try:
        mig_db.execute(text("ALTER TABLE expenses ADD COLUMN IF NOT EXISTS receipt_image TEXT"))
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
