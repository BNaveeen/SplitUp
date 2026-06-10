from fastapi import FastAPI, Depends, HTTPException, BackgroundTasks, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from typing import List, Optional, Dict
from pydantic import BaseModel
from datetime import datetime, timedelta
import asyncio
import secrets
import os
import json

from database import SessionLocal, engine, User, Group, Expense, ExpenseSplit, PendingInvite, Base, group_members

app = FastAPI(title="Splitwise Clone API")

# ── WebSocket Connection Manager ──────────────────────────────────────────────
class ConnectionManager:
    def __init__(self):
        self.active: Dict[int, List[WebSocket]] = {}  # user_id -> list of websockets

    async def connect(self, user_id: int, websocket: WebSocket):
        await websocket.accept()
        self.active.setdefault(user_id, []).append(websocket)

    def disconnect(self, user_id: int, websocket: WebSocket):
        conns = self.active.get(user_id, [])
        if websocket in conns:
            conns.remove(websocket)

    async def send_to_user(self, user_id: int, data: dict):
        for ws in list(self.active.get(user_id, [])):
            try:
                await ws.send_text(json.dumps(data))
            except Exception:
                pass

    async def broadcast_to_users(self, user_ids: List[int], data: dict):
        for uid in user_ids:
            await self.send_to_user(uid, data)

manager = ConnectionManager()

def _push_group_event(db: Session, group_id: int):
    """Broadcast a group_refresh event to all members of a group via WebSocket."""
    if not group_id:
        return
    group = db.query(Group).filter(Group.id == group_id).first()
    if not group:
        return
    member_ids = [m.id for m in group.members]
    if not member_ids:
        return
    async def _do():
        await manager.broadcast_to_users(member_ids, {"type": "group_refresh", "group_id": group_id})
    try:
        loop = asyncio.get_event_loop()
        if loop.is_running():
            loop.create_task(_do())
    except Exception:
        pass

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Dependency to get DB session
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# ── Pydantic Models ──────────────────────────────────────────────────────────

class UserRegister(BaseModel):
    name: str
    email: str
    password: str

class UserLogin(BaseModel):
    email: str
    password: str

class UserResponse(BaseModel):
    id: int
    name: str
    email: str
    is_admin: bool = False
    class Config:
        from_attributes = True

class UserUpdate(BaseModel):
    name: str

class GroupCreate(BaseModel):
    name: str
    creator_id: int

class GroupResponse(BaseModel):
    id: int
    name: str
    class Config:
        from_attributes = True

class GroupDetailResponse(BaseModel):
    id: int
    name: str
    members: List[UserResponse]
    class Config:
        from_attributes = True

class AddMemberRequest(BaseModel):
    email: str

class AddMemberByIdRequest(BaseModel):
    user_id: int
    admin_user_id: int

class MembershipResponse(BaseModel):
    user_id: int
    user_name: str
    user_email: str
    role: str          # 'super_admin' | 'admin' | 'member'
    is_active: bool

class UpdateRoleRequest(BaseModel):
    role: str          # 'super_admin' | 'admin' | 'member'
    admin_user_id: int

class SplitCreate(BaseModel):
    user_id: int
    amount: float

class ExpenseCreate(BaseModel):
    description: str
    amount: float
    payer_id: int
    created_by_id: int
    group_id: Optional[int] = None
    date: Optional[str] = None   # ISO date string e.g. "2026-05-31"
    splits: List[SplitCreate]

class SplitResponse(BaseModel):
    user_id: int
    amount: float
    user_name: str
    class Config:
        from_attributes = True

class ApprovalResponse(BaseModel):
    user_id: int
    user_name: str
    approved: int

class NotificationResponse(BaseModel):
    id: int
    user_id: int
    message: str
    group_id: Optional[int] = None
    expense_id: Optional[int] = None
    is_read: int
    created_at: str
    class Config:
        from_attributes = True

class ExpenseResponse(BaseModel):
    id: int
    description: str
    amount: float
    payer_id: int
    payer_name: str
    created_by_id: int
    created_by_name: str
    status: str
    group_id: Optional[int]
    date: Optional[str]
    splits: List[SplitResponse]
    approvals: List[ApprovalResponse] = []
    last_message_at: Optional[str] = None
    last_message_text: Optional[str] = None
    created_at: Optional[str] = None
    class Config:
        from_attributes = True

class ExpenseMessageCreate(BaseModel):
    user_id: int
    text: str
    mentions: Optional[List[int]] = []

class ExpenseMessageResponse(BaseModel):
    id: int
    user_id: int
    user_name: str
    text: str
    is_system: int
    created_at: str
    class Config:
        from_attributes = True

class SettlementCreate(BaseModel):
    payer_id: int
    payee_id: int
    amount: float
    group_id: Optional[int] = None
    expense_id: Optional[int] = None

class SettlementResponse(BaseModel):
    id: int
    payer_id: int
    payer_name: Optional[str] = None
    payee_id: int
    payee_name: Optional[str] = None
    amount: float
    group_id: Optional[int]
    expense_id: Optional[int]
    status: str
    created_at: str
    class Config:
        from_attributes = True

class BalanceEntry(BaseModel):
    from_user_id: int
    from_user_name: str
    to_user_id: int
    to_user_name: str
    amount: float

# ── Auth Routes ───────────────────────────────────────────────────────────────

@app.post("/register/", response_model=UserResponse)
def register_user(user: UserRegister, db: Session = Depends(get_db)):
    """Register a new user with password."""
    normalized_email = user.email.strip().lower()
    db_user = db.query(User).filter(User.email.ilike(normalized_email)).first()
    if db_user:
        raise HTTPException(status_code=400, detail="Email already registered")

    # First registered user is automatically an admin
    is_first = db.query(User).count() == 0
    new_user = User(name=user.name, email=normalized_email, password=user.password, is_admin=is_first)
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    return new_user

@app.post("/login/", response_model=UserResponse)
def login_user(user: UserLogin, db: Session = Depends(get_db)):
    """Login a user."""
    db_user = db.query(User).filter(
        User.email.ilike(user.email.strip()), User.password == user.password
    ).first()
    if not db_user:
        raise HTTPException(status_code=401, detail="Invalid email or password")
    return db_user

# ── User Routes ───────────────────────────────────────────────────────────

@app.get("/users/", response_model=List[UserResponse])
def get_users(current_user_id: Optional[int] = None, db: Session = Depends(get_db)):
    """Return connected users only (shared group or transaction). Falls back to all users if no ID given."""
    if not current_user_id:
        return db.query(User).all()

    connected = set([current_user_id])
    user = db.query(User).filter(User.id == current_user_id).first()
    if user:
        for g in user.groups:
            for m in g.members:
                connected.add(m.id)

    from database import ExpenseSplit as ES, Expense as Exp
    paid_ids = [r[0] for r in db.query(Exp.id).filter(Exp.payer_id == current_user_id).all()]
    split_ids = [r[0] for r in db.query(ES.expense_id).filter(ES.user_id == current_user_id).all()]
    all_exp_ids = list(set(paid_ids + split_ids))
    if all_exp_ids:
        connected.update([r[0] for r in db.query(Exp.payer_id).filter(Exp.id.in_(all_exp_ids)).all()])
        connected.update([r[0] for r in db.query(ES.user_id).filter(ES.expense_id.in_(all_exp_ids)).all()])

    return db.query(User).filter(User.id.in_(connected)).all()

# ── Admin Routes ───────────────────────────────────────────────────────────

@app.get("/admin/users", response_model=List[UserResponse])
def admin_get_users(admin_id: int, db: Session = Depends(get_db)):
    admin = db.query(User).filter(User.id == admin_id, User.is_admin == True).first()
    if not admin:
        raise HTTPException(status_code=403, detail="Admin privileges required")
    return db.query(User).all()

@app.post("/admin/users", response_model=UserResponse)
def admin_create_user(admin_id: int, user: UserRegister, is_admin_flag: bool = False, db: Session = Depends(get_db)):
    admin = db.query(User).filter(User.id == admin_id, User.is_admin == True).first()
    if not admin:
        raise HTTPException(status_code=403, detail="Admin privileges required")
    db_user = db.query(User).filter(User.email == user.email).first()
    if db_user:
        raise HTTPException(status_code=400, detail="Email already registered")
    new_user = User(name=user.name, email=user.email, password=user.password, is_admin=is_admin_flag)
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    return new_user

@app.put("/admin/users/{user_id}/toggle_admin", response_model=UserResponse)
def admin_toggle_admin(user_id: int, admin_id: int, db: Session = Depends(get_db)):
    admin = db.query(User).filter(User.id == admin_id, User.is_admin == True).first()
    if not admin:
        raise HTTPException(status_code=403, detail="Admin privileges required")
    if user_id == admin_id:
        raise HTTPException(status_code=400, detail="Cannot toggle your own admin status")
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    user.is_admin = not user.is_admin
    db.commit()
    db.refresh(user)
    return user

@app.delete("/admin/users/{user_id}")
def admin_delete_user(user_id: int, admin_id: int, db: Session = Depends(get_db)):
    admin = db.query(User).filter(User.id == admin_id, User.is_admin == True).first()
    if not admin:
        raise HTTPException(status_code=403, detail="Admin privileges required")
    if user_id == admin_id:
        raise HTTPException(status_code=400, detail="Cannot delete yourself")
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    db.delete(user)
    db.commit()
    return {"message": "User deleted"}

@app.delete("/admin/groups/{group_id}")
def admin_delete_group(group_id: int, admin_id: int, db: Session = Depends(get_db)):
    admin = db.query(User).filter(User.id == admin_id, User.is_admin == True).first()
    if not admin:
        raise HTTPException(status_code=403, detail="Admin privileges required")
    from database import Group as G
    group = db.query(G).filter(G.id == group_id).first()
    if not group:
        raise HTTPException(status_code=404, detail="Group not found")
    db.delete(group)
    db.commit()
    return {"message": "Group deleted"}

@app.get("/admin/stats")
def admin_get_stats(admin_id: int, db: Session = Depends(get_db)):
    admin = db.query(User).filter(User.id == admin_id, User.is_admin == True).first()
    if not admin:
        raise HTTPException(status_code=403, detail="Admin privileges required")
    from database import Settlement, Notification
    from sqlalchemy import func
    return {
        "total_users": db.query(User).count(),
        "total_groups": db.query(Group).count(),
        "active_expenses": db.query(Expense).filter(Expense.status == "active").count(),
        "pending_deletions": db.query(Expense).filter(Expense.status.in_(["pending_deletion", "approved_for_deletion"])).count(),
        "deleted_expenses": db.query(Expense).filter(Expense.status == "deleted").count(),
        "total_expense_amount": float(db.query(func.sum(Expense.amount)).filter(Expense.status == "active").scalar() or 0),
        "total_settlements": db.query(Settlement).count(),
        "pending_settlements": db.query(Settlement).filter(Settlement.status == "pending").count(),
        "approved_settlements": db.query(Settlement).filter(Settlement.status == "approved").count(),
        "total_notifications": db.query(Notification).count(),
        "unread_notifications": db.query(Notification).filter(Notification.is_read == 0).count(),
    }

@app.get("/admin/groups")
def admin_list_groups(admin_id: int, db: Session = Depends(get_db)):
    admin = db.query(User).filter(User.id == admin_id, User.is_admin == True).first()
    if not admin:
        raise HTTPException(status_code=403, detail="Admin privileges required")
    groups = db.query(Group).all()
    result = []
    for g in groups:
        active_count = db.query(Expense).filter(Expense.group_id == g.id, Expense.status == "active").count()
        result.append({
            "id": g.id,
            "name": g.name,
            "member_count": len(g.members),
            "expense_count": active_count,
            "members": [{"id": m.id, "name": m.name} for m in g.members],
        })
    return result

@app.get("/admin/expenses")
def admin_list_expenses(admin_id: int, status: Optional[str] = None, db: Session = Depends(get_db)):
    admin = db.query(User).filter(User.id == admin_id, User.is_admin == True).first()
    if not admin:
        raise HTTPException(status_code=403, detail="Admin privileges required")
    q = db.query(Expense)
    if status:
        q = q.filter(Expense.status == status)
    expenses = q.order_by(Expense.date.desc()).limit(200).all()
    return [_format_expense(e) for e in expenses]

@app.get("/admin/settlements")
def admin_list_settlements(admin_id: int, db: Session = Depends(get_db)):
    admin = db.query(User).filter(User.id == admin_id, User.is_admin == True).first()
    if not admin:
        raise HTTPException(status_code=403, detail="Admin privileges required")
    from database import Settlement
    settlements = db.query(Settlement).order_by(Settlement.created_at.desc()).limit(200).all()
    return [SettlementResponse(
        id=s.id,
        payer_id=s.payer_id,
        payer_name=s.payer.name if s.payer else "?",
        payee_id=s.payee_id,
        payee_name=s.payee.name if s.payee else "?",
        amount=float(s.amount),
        group_id=s.group_id,
        expense_id=s.expense_id,
        status=s.status,
        created_at=s.created_at.isoformat()
    ) for s in settlements]

@app.get("/admin/notifications")
def admin_list_notifications(admin_id: int, user_id: Optional[int] = None, db: Session = Depends(get_db)):
    admin = db.query(User).filter(User.id == admin_id, User.is_admin == True).first()
    if not admin:
        raise HTTPException(status_code=403, detail="Admin privileges required")
    from database import Notification
    q = db.query(Notification)
    if user_id:
        q = q.filter(Notification.user_id == user_id)
    notifs = q.order_by(Notification.created_at.desc()).limit(500).all()
    return [{
        "id": n.id,
        "user_id": n.user_id,
        "user_name": n.user.name if n.user else "?",
        "message": n.message,
        "group_id": n.group_id,
        "expense_id": n.expense_id,
        "is_read": n.is_read,
        "created_at": n.created_at.isoformat()
    } for n in notifs]

# ── WebSocket Endpoint ──────────────────────────────────────────────────────────

@app.websocket("/ws/{user_id}")
async def websocket_endpoint(websocket: WebSocket, user_id: int):
    await manager.connect(user_id, websocket)
    try:
        while True:
            # Keep connection alive; server pushes data proactively
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(user_id, websocket)

@app.put("/users/{user_id}", response_model=UserResponse)
def update_user(user_id: int, update_data: UserUpdate, db: Session = Depends(get_db)):
    """Update a user's profile."""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    user.name = update_data.name
    db.commit()
    db.refresh(user)
    return user

@app.get("/users/{user_id}/notifications", response_model=List[NotificationResponse])
def get_notifications(user_id: int, db: Session = Depends(get_db)):
    from database import Notification
    notifs = db.query(Notification).filter(Notification.user_id == user_id).order_by(Notification.created_at.desc()).all()
    return [
        {
            "id": n.id,
            "user_id": n.user_id,
            "message": n.message,
            "group_id": n.group_id,
            "expense_id": n.expense_id,
            "is_read": n.is_read,
            "created_at": n.created_at.isoformat()
        } for n in notifs
    ]

@app.post("/notifications/{notif_id}/mark_read")
def mark_notification_read(notif_id: int, db: Session = Depends(get_db)):
    from database import Notification
    n = db.query(Notification).filter(Notification.id == notif_id).first()
    if n:
        n.is_read = 1
        db.commit()
    return {"message": "marked read"}

@app.get("/users/{user_id}/groups/", response_model=List[GroupDetailResponse])
def get_user_groups(user_id: int, db: Session = Depends(get_db)):
    """Get all groups for a specific user (groups they are a member of)."""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return user.groups
@app.get("/users/{user_id}/all_balances")
def get_user_all_balances(user_id: int, db: Session = Depends(get_db)):
    """Get aggregated balances across all groups for a user."""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
        
    global_balances = {}
    
    for group in user.groups:
        group_bals = get_group_balances(group.id, db)
        for bal in group_bals:
            if bal.from_user_id == user_id:
                other_id = bal.to_user_id
                other_name = bal.to_user_name
                amount = -bal.amount
            elif bal.to_user_id == user_id:
                other_id = bal.from_user_id
                other_name = bal.from_user_name
                amount = bal.amount
            else:
                continue
                
            if other_id not in global_balances:
                global_balances[other_id] = {
                    "other_user_id": other_id,
                    "other_user_name": other_name,
                    "net_balance": 0.0,
                    "group_balances": []
                }
            
            global_balances[other_id]["net_balance"] += amount
            global_balances[other_id]["group_balances"].append({
                "group_id": group.id,
                "group_name": group.name,
                "amount": amount
            })
            
    for bal in global_balances.values():
        bal["net_balance"] = round(bal["net_balance"], 2)
        
    return list(global_balances.values())

@app.get("/users/{user_id}/expenses/", response_model=List[ExpenseResponse])
def get_user_expenses(user_id: int, db: Session = Depends(get_db)):
    """Get all expenses the user is involved in (as payer or splitee)."""
    # Get expense IDs from splits
    split_expense_ids = db.query(ExpenseSplit.expense_id).filter(ExpenseSplit.user_id == user_id).subquery()
    expenses = (
        db.query(Expense)
        .filter(Expense.id.in_(split_expense_ids))
        .order_by(Expense.date.desc())
        .all()
    )
    return [_format_expense(e) for e in expenses]

# ── Group Routes ──────────────────────────────────────────────────────────────

@app.post("/groups/", response_model=GroupDetailResponse)
def create_group(group: GroupCreate, db: Session = Depends(get_db)):
    """Create a new group and add the creator as super_admin."""
    creator = db.query(User).filter(User.id == group.creator_id).first()
    if not creator:
        raise HTTPException(status_code=404, detail="Creator user not found")

    new_group = Group(name=group.name)
    db.add(new_group)
    db.flush()  # get new_group.id
    db.execute(group_members.insert().values(
        user_id=creator.id, group_id=new_group.id, role="super_admin", is_active=True
    ))
    db.commit()
    db.refresh(new_group)
    return new_group

@app.get("/groups/", response_model=List[GroupDetailResponse])
def get_groups(db: Session = Depends(get_db)):
    """Get all groups."""
    return db.query(Group).all()

@app.get("/groups/{group_id}/", response_model=GroupDetailResponse)
def get_group(group_id: int, db: Session = Depends(get_db)):
    """Get a specific group with members."""
    group = db.query(Group).filter(Group.id == group_id).first()
    if not group:
        raise HTTPException(status_code=404, detail="Group not found")
    return group

class GroupRenameRequest(BaseModel):
    name: str
    requester_id: int

@app.put("/groups/{group_id}/name", response_model=GroupDetailResponse)
def rename_group(group_id: int, req: GroupRenameRequest, db: Session = Depends(get_db)):
    """Rename a group. Only the super_admin of the group can do this."""
    group = db.query(Group).filter(Group.id == group_id).first()
    if not group:
        raise HTTPException(status_code=404, detail="Group not found")

    row = db.execute(
        group_members.select().where(
            group_members.c.user_id == req.requester_id,
            group_members.c.group_id == group_id
        )
    ).first()
    if not row or row.role != "super_admin":
        raise HTTPException(status_code=403, detail="Only the group super admin can rename this group")

    new_name = req.name.strip()
    if not new_name:
        raise HTTPException(status_code=400, detail="Group name cannot be empty")

    group.name = new_name
    db.commit()
    db.refresh(group)
    _push_group_event(db, group_id)
    return group

@app.post("/groups/{group_id}/members/", response_model=GroupDetailResponse)
def add_group_member(group_id: int, req: AddMemberRequest, db: Session = Depends(get_db)):
    """Add a user to a group by email."""
    group = db.query(Group).filter(Group.id == group_id).first()
    if not group:
        raise HTTPException(status_code=404, detail="Group not found")

    user = db.query(User).filter(User.email.ilike(req.email.strip())).first()
    if not user:
        raise HTTPException(status_code=404, detail=f"No user found with email '{req.email}'")

    if user in group.members:
        raise HTTPException(status_code=400, detail="User is already a member of this group")

    db.execute(group_members.insert().values(
        user_id=user.id, group_id=group.id, role="member", is_active=True
    ))
    db.commit()
    db.refresh(group)
    return group

@app.post("/groups/{group_id}/members/by_id", response_model=GroupDetailResponse)
def add_group_member_by_id(group_id: int, req: AddMemberByIdRequest, db: Session = Depends(get_db)):
    """Add a user to a group by user_id (admin only)."""
    group = db.query(Group).filter(Group.id == group_id).first()
    if not group:
        raise HTTPException(status_code=404, detail="Group not found")

    # Verify requester is admin/super_admin in the group
    row = db.execute(
        group_members.select().where(
            (group_members.c.group_id == group_id) &
            (group_members.c.user_id == req.admin_user_id)
        )
    ).first()
    if not row or row.role not in ("admin", "super_admin"):
        raise HTTPException(status_code=403, detail="Admin privileges required")

    user = db.query(User).filter(User.id == req.user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    if user in group.members:
        raise HTTPException(status_code=400, detail="User is already a member of this group")

    db.execute(group_members.insert().values(
        user_id=user.id, group_id=group.id, role="member", is_active=True
    ))
    db.commit()
    db.refresh(group)
    return group

@app.get("/groups/{group_id}/expenses/", response_model=List[ExpenseResponse])
def get_group_expenses(group_id: int, db: Session = Depends(get_db)):
    """Get all expenses for a group, newest first."""
    group = db.query(Group).filter(Group.id == group_id).first()
    if not group:
        raise HTTPException(status_code=404, detail="Group not found")
    expenses = (
        db.query(Expense)
        .filter(Expense.group_id == group_id)
        .order_by(Expense.date.desc())
        .all()
    )
    return [_format_expense(e) for e in expenses]

@app.get("/groups/{group_id}/balances/", response_model=List[BalanceEntry])
def get_group_balances(group_id: int, db: Session = Depends(get_db)):
    """Compute simplified balances within a group."""
    group = db.query(Group).filter(Group.id == group_id).first()
    if not group:
        raise HTTPException(status_code=404, detail="Group not found")

    # net[user_id] = how much this user is owed (positive) or owes (negative)
    net = {m.id: 0.0 for m in group.members}
    member_names = {m.id: m.name for m in group.members}

    from sqlalchemy import func
    from database import ExpenseSplit

    paid_query = db.query(
        Expense.payer_id.label('user_id'),
        func.sum(Expense.amount).label('total_paid')
    ).filter(
        Expense.group_id == group_id,
        Expense.status != "deleted"
    ).group_by(Expense.payer_id).all()

    owed_query = db.query(
        ExpenseSplit.user_id.label('user_id'),
        func.sum(ExpenseSplit.amount).label('total_owed')
    ).join(Expense).filter(
        Expense.group_id == group_id,
        Expense.status != "deleted"
    ).group_by(ExpenseSplit.user_id).all()

    for user_id, total_paid in paid_query:
        if user_id in net and total_paid:
            net[user_id] += float(total_paid)

    for user_id, total_owed in owed_query:
        if user_id in net and total_owed:
            net[user_id] -= float(total_owed)

    # Include approved settlements — payer cleared their debt, payee received the money
    from database import Settlement
    approved = db.query(Settlement).filter(
        Settlement.group_id == group_id,
        Settlement.status == "approved"
    ).all()
    for s in approved:
        if s.payer_id in net:
            net[s.payer_id] += float(s.amount)
        if s.payee_id in net:
            net[s.payee_id] -= float(s.amount)

    # Simplify debts
    creditors = sorted([(uid, amt) for uid, amt in net.items() if amt > 0.005], key=lambda x: -x[1])
    debtors   = sorted([(uid, abs(amt)) for uid, amt in net.items() if amt < -0.005], key=lambda x: -x[1])

    balances = []
    ci, di = 0, 0
    creditors = list(creditors)
    debtors   = list(debtors)
    while ci < len(creditors) and di < len(debtors):
        cid, camp = creditors[ci]
        did, damt = debtors[di]
        settle = min(camp, damt)
        balances.append(BalanceEntry(
            from_user_id=did,
            from_user_name=member_names.get(did, "?"),
            to_user_id=cid,
            to_user_name=member_names.get(cid, "?"),
            amount=round(settle, 2)
        ))
        creditors[ci] = (cid, camp - settle)
        debtors[di]   = (did, damt - settle)
        if creditors[ci][1] < 0.005: ci += 1
        if debtors[di][1]   < 0.005: di += 1

    return balances

# ── User Search ───────────────────────────────────────────────────────────────

@app.get("/users/search")
def search_users(q: str, exclude_group_id: Optional[int] = None, db: Session = Depends(get_db)):
    """Search users by name or email. Optionally exclude members of a group."""
    query = db.query(User).filter(
        (User.name.ilike(f"%{q}%")) | (User.email.ilike(f"%{q}%"))
    )
    results = query.limit(20).all()
    if exclude_group_id:
        group = db.query(Group).filter(Group.id == exclude_group_id).first()
        existing_ids = {m.id for m in group.members} if group else set()
        results = [u for u in results if u.id not in existing_ids]
    return [{"id": u.id, "name": u.name, "email": u.email} for u in results]

# ── Group Membership Management ───────────────────────────────────────────────

@app.get("/groups/{group_id}/memberships", response_model=List[MembershipResponse])
def get_group_memberships(group_id: int, db: Session = Depends(get_db)):
    """Get all memberships for a group with roles and active status."""
    rows = db.execute(
        group_members.select().where(group_members.c.group_id == group_id)
    ).fetchall()
    result = []
    for row in rows:
        user = db.query(User).filter(User.id == row.user_id).first()
        if user:
            result.append(MembershipResponse(
                user_id=user.id,
                user_name=user.name,
                user_email=user.email,
                role=row.role or "member",
                is_active=bool(row.is_active),
            ))
    return result

@app.put("/groups/{group_id}/members/{user_id}/role")
def update_member_role(group_id: int, user_id: int, req: UpdateRoleRequest, db: Session = Depends(get_db)):
    """Change a member's role. Only super_admin can promote to super_admin/admin."""
    if req.role not in ("super_admin", "admin", "member"):
        raise HTTPException(status_code=400, detail="Invalid role")

    admin_row = db.execute(
        group_members.select().where(
            (group_members.c.group_id == group_id) &
            (group_members.c.user_id == req.admin_user_id)
        )
    ).first()
    if not admin_row or admin_row.role not in ("admin", "super_admin"):
        raise HTTPException(status_code=403, detail="Admin privileges required")
    if req.role in ("super_admin", "admin") and admin_row.role != "super_admin":
        raise HTTPException(status_code=403, detail="Only super admin can promote members")

    db.execute(
        group_members.update()
        .where((group_members.c.group_id == group_id) & (group_members.c.user_id == user_id))
        .values(role=req.role)
    )
    db.commit()
    return {"message": f"Role updated to {req.role}"}

@app.delete("/groups/{group_id}/members/{user_id}")
def remove_group_member(group_id: int, user_id: int, admin_user_id: int, db: Session = Depends(get_db)):
    """Remove a member from the group (admin only). Returns warning if they have unsettled splits."""
    admin_row = db.execute(
        group_members.select().where(
            (group_members.c.group_id == group_id) &
            (group_members.c.user_id == admin_user_id)
        )
    ).first()
    if not admin_row or admin_row.role not in ("admin", "super_admin"):
        raise HTTPException(status_code=403, detail="Admin privileges required")

    target_row = db.execute(
        group_members.select().where(
            (group_members.c.group_id == group_id) &
            (group_members.c.user_id == user_id)
        )
    ).first()
    if not target_row:
        raise HTTPException(status_code=404, detail="Member not found in group")
    if target_row.role == "super_admin":
        raise HTTPException(status_code=403, detail="Cannot remove the group super admin")

    # Check for active expense splits
    active_splits = (
        db.query(ExpenseSplit)
        .join(Expense, Expense.id == ExpenseSplit.expense_id)
        .filter(
            Expense.group_id == group_id,
            ExpenseSplit.user_id == user_id,
            Expense.status == "active",
        )
        .count()
    )

    db.execute(
        group_members.delete().where(
            (group_members.c.group_id == group_id) & (group_members.c.user_id == user_id)
        )
    )
    db.commit()

    warning = None
    if active_splits > 0:
        warning = f"Removed, but this user had {active_splits} active expense split(s) in the group."
    return {"message": "Member removed", "warning": warning}

@app.put("/groups/{group_id}/members/{user_id}/deactivate")
def toggle_member_active(group_id: int, user_id: int, admin_user_id: int, db: Session = Depends(get_db)):
    """Deactivate or reactivate a group member (admin only)."""
    admin_row = db.execute(
        group_members.select().where(
            (group_members.c.group_id == group_id) &
            (group_members.c.user_id == admin_user_id)
        )
    ).first()
    if not admin_row or admin_row.role not in ("admin", "super_admin"):
        raise HTTPException(status_code=403, detail="Admin privileges required")

    target_row = db.execute(
        group_members.select().where(
            (group_members.c.group_id == group_id) &
            (group_members.c.user_id == user_id)
        )
    ).first()
    if not target_row:
        raise HTTPException(status_code=404, detail="Member not found in group")
    if target_row.role == "super_admin":
        raise HTTPException(status_code=403, detail="Cannot deactivate the group super admin")

    new_status = not bool(target_row.is_active)
    db.execute(
        group_members.update()
        .where((group_members.c.group_id == group_id) & (group_members.c.user_id == user_id))
        .values(is_active=new_status)
    )
    db.commit()
    return {"message": "activated" if new_status else "deactivated", "is_active": new_status}

# ── Expense Routes ────────────────────────────────────────────────────────────

@app.post("/expenses/", response_model=ExpenseResponse)
def split_expense(expense: ExpenseCreate, db: Session = Depends(get_db)):
    """Create an expense and split it among users."""
    payer = db.query(User).filter(User.id == expense.payer_id).first()
    if not payer:
        raise HTTPException(status_code=404, detail="Payer user not found")

    if expense.group_id:
        group = db.query(Group).filter(Group.id == expense.group_id).first()
        if not group:
            raise HTTPException(status_code=404, detail="Group not found")

    total_split = sum(s.amount for s in expense.splits)
    if abs(total_split - expense.amount) > 0.02:
        raise HTTPException(status_code=400, detail=f"Split amounts ({total_split:.2f}) do not match expense ({expense.amount:.2f})")

    # Parse date
    expense_date = datetime.utcnow()
    if expense.date:
        try:
            expense_date = datetime.fromisoformat(expense.date)
        except ValueError:
            pass

    new_expense = Expense(
        description=expense.description,
        amount=expense.amount,
        payer_id=expense.payer_id,
        created_by_id=expense.created_by_id,
        group_id=expense.group_id,
        date=expense_date,
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
    
    # Notify users
    involved_users = {s.user_id for s in expense.splits}
    involved_users.add(expense.payer_id)
    for uid in involved_users:
        if uid != expense.created_by_id:
            _add_notification(db, uid, f"You were added to a new expense: {new_expense.description}", expense_id=new_expense.id, group_id=new_expense.group_id)

    split_users = {u.id: u.name for u in db.query(User).filter(User.id.in_([s.user_id for s in expense.splits])).all()}
    split_names = ", ".join(split_users.get(s.user_id, f"User {s.user_id}") for s in expense.splits)
    _add_system_message(db, new_expense.id, new_expense.created_by_id,
        f"created this expense — £{float(new_expense.amount):.2f} paid by {payer.name}, split between: {split_names}")
    db.commit()
    _push_group_event(db, new_expense.group_id)

    return _format_expense(new_expense)

@app.put("/expenses/{expense_id}", response_model=ExpenseResponse)
def update_expense(expense_id: int, expense_update: ExpenseCreate, db: Session = Depends(get_db)):
    """Update an existing expense. Only the creator can do this."""
    expense = db.query(Expense).filter(Expense.id == expense_id).first()
    if not expense:
        raise HTTPException(status_code=404, detail="Expense not found")

    if expense.created_by_id != expense_update.created_by_id:
         raise HTTPException(status_code=403, detail="Only the creator can edit this expense")

    total_split = sum(s.amount for s in expense_update.splits)
    if abs(total_split - expense_update.amount) > 0.02:
        raise HTTPException(status_code=400, detail=f"Split amounts ({total_split:.2f}) do not match expense ({expense_update.amount:.2f})")

    # Capture old values for the changelog before overwriting
    old_desc = expense.description
    old_amount = float(expense.amount)
    old_payer = db.query(User).filter(User.id == expense.payer_id).first()
    old_payer_name = old_payer.name if old_payer else "Unknown"

    expense.description = expense_update.description
    expense.amount = expense_update.amount
    expense.payer_id = expense_update.payer_id

    if expense_update.date:
        try:
            expense.date = datetime.fromisoformat(expense_update.date)
        except ValueError:
            pass

    # Update splits by clearing and re-adding
    db.query(ExpenseSplit).filter(ExpenseSplit.expense_id == expense.id).delete()
    for split in expense_update.splits:
        db.add(ExpenseSplit(expense_id=expense.id, user_id=split.user_id, amount=split.amount))

    db.commit()
    db.refresh(expense)

    # Build a human-readable changelog
    changes = []
    if old_desc != expense.description:
        changes.append(f'description: "{old_desc}" → "{expense.description}"')
    if abs(old_amount - float(expense.amount)) > 0.005:
        changes.append(f"amount: £{old_amount:.2f} → £{float(expense.amount):.2f}")
    new_payer = db.query(User).filter(User.id == expense.payer_id).first()
    new_payer_name = new_payer.name if new_payer else "Unknown"
    if old_payer_name != new_payer_name:
        changes.append(f"paid by: {old_payer_name} → {new_payer_name}")
    split_user_map = {u.id: u.name for u in db.query(User).filter(User.id.in_([s.user_id for s in expense.splits])).all()}
    new_split_names = ", ".join(split_user_map.get(s.user_id, f"User {s.user_id}") for s in expense.splits)
    change_summary = "; ".join(changes) if changes else f"£{float(expense.amount):.2f} paid by {new_payer_name}"
    _add_system_message(db, expense.id, expense.created_by_id,
        f"updated this expense — {change_summary}, split between: {new_split_names}")

    # Notify users
    involved_users = {s.user_id for s in expense.splits}
    involved_users.add(expense.payer_id)
    for uid in involved_users:
        if uid != expense_update.created_by_id:
            _add_notification(db, uid, f"Expense updated: {expense.description}", expense_id=expense.id, group_id=expense.group_id)
    db.commit()
    _push_group_event(db, expense.group_id)

    return _format_expense(expense)

@app.delete("/expenses/{expense_id}")
def delete_expense(expense_id: int, requester_id: int, db: Session = Depends(get_db)):
    """Initiate a deletion request for an expense."""
    expense = db.query(Expense).filter(Expense.id == expense_id).first()
    if not expense:
        raise HTTPException(status_code=404, detail="Expense not found")

    if expense.status in ("pending_deletion", "approved_for_deletion", "deleted"):
        raise HTTPException(status_code=400, detail=f"Expense cannot be deleted (status: {expense.status})")

    # Get all unique users involved in the expense (guard against null payer_id)
    involved_user_ids = {s.user_id for s in expense.splits if s.user_id is not None}
    if expense.payer_id is not None:
        involved_user_ids.add(expense.payer_id)
    if not involved_user_ids:
        involved_user_ids = {requester_id}

    # If the requester is the only one involved, soft-delete immediately
    if len(involved_user_ids) == 1 and requester_id in involved_user_ids:
        expense.status = "deleted"
        db.commit()
        _push_group_event(db, expense.group_id)
        return {"message": "Expense deleted immediately"}

    expense.status = "pending_deletion"

    # Delete existing approvals first, flush so DELETEs hit the DB before INSERTs
    from database import ExpenseDeletionApproval
    for appr in list(expense.approvals):
        db.delete(appr)
    db.flush()

    # Create fresh approval records for everyone involved
    for uid in involved_user_ids:
        db.add(ExpenseDeletionApproval(expense_id=expense.id, user_id=uid, approved=1 if uid == requester_id else 0))
        if uid != requester_id:
            _add_notification(db, uid, f"Deletion requested for expense: {expense.description}", expense_id=expense.id, group_id=expense.group_id)

    _add_system_message(db, expense.id, requester_id, "Requested deletion of this expense.")
    db.commit()
    _push_group_event(db, expense.group_id)
    return {"message": "Deletion request initiated"}

async def _deletion_scheduler():
    """Poll every 60 seconds and delete expenses whose 10-minute window has passed."""
    while True:
        await asyncio.sleep(60)
        db = SessionLocal()
        try:
            cutoff = datetime.utcnow() - timedelta(minutes=10)
            expired = db.query(Expense).filter(
                Expense.status == "approved_for_deletion",
                Expense.deletion_approved_at != None,
                Expense.deletion_approved_at <= cutoff
            ).all()
            group_ids = set()
            for expense in expired:
                expense.status = "deleted"
                _add_system_message(db, expense.id, expense.created_by_id, "Expense permanently deleted.")
                if expense.group_id:
                    group_ids.add(expense.group_id)
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
    asyncio.create_task(_deletion_scheduler())

@app.post("/expenses/{expense_id}/approve_deletion")
def approve_deletion(expense_id: int, user_id: int, db: Session = Depends(get_db)):
    """Approve the deletion of an expense."""
    from database import ExpenseDeletionApproval
    approval = db.query(ExpenseDeletionApproval).filter(
        ExpenseDeletionApproval.expense_id == expense_id,
        ExpenseDeletionApproval.user_id == user_id
    ).first()
    
    if not approval:
        raise HTTPException(status_code=404, detail="Approval request not found")
        
    approval.approved = 1
    db.commit()
    
    # Check if all users have voted
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
            _add_system_message(db, expense_id, user_id, "Deletion request was rejected and cancelled.")
            db.commit()
            _push_group_event(db, expense.group_id)
            return {"message": "Deletion was rejected by someone and cancelled"}
        else:
            expense.status = "approved_for_deletion"
            expense.deletion_approved_at = datetime.utcnow()
            _add_system_message(db, expense_id, user_id, "All users approved deletion. Deleting in 10 minutes.")
            db.commit()
            _push_group_event(db, expense.group_id)
            return {"message": "All approved. Expense will be deleted in 10 minutes."}

    exp = db.query(Expense).filter(Expense.id == expense_id).first()
    _add_system_message(db, expense_id, user_id, "Approved the deletion request.")
    db.commit()
    _push_group_event(db, exp.group_id if exp else None)
    return {"message": "Approval recorded"}

@app.post("/expenses/{expense_id}/reject_deletion")
def reject_deletion(expense_id: int, user_id: int, db: Session = Depends(get_db)):
    """Reject the deletion of an expense."""
    from database import ExpenseDeletionApproval
    expense = db.query(Expense).filter(Expense.id == expense_id).first()
    if not expense:
        raise HTTPException(status_code=404, detail="Expense not found")
        
    approval = db.query(ExpenseDeletionApproval).filter(
        ExpenseDeletionApproval.expense_id == expense_id,
        ExpenseDeletionApproval.user_id == user_id
    ).first()
    
    if not approval:
        raise HTTPException(status_code=404, detail="Approval request not found")
        
    approval.approved = -1
    db.commit()
    
    # Check if all users have voted
    pending_approvals = db.query(ExpenseDeletionApproval).filter(
        ExpenseDeletionApproval.expense_id == expense_id,
        ExpenseDeletionApproval.approved == 0
    ).count()
    
    if pending_approvals == 0:
        expense.status = "active"
        for appr in list(expense.approvals):
            db.delete(appr)
        db.flush()
        _add_system_message(db, expense_id, user_id, "Rejected the deletion request. Deletion cancelled.")
        db.commit()
        _push_group_event(db, expense.group_id)
        return {"message": "Deletion rejected by at least one user and cancelled"}

    _add_system_message(db, expense_id, user_id, "Rejected the deletion request.")
    db.commit()
    _push_group_event(db, expense.group_id)
    return {"message": "Rejection recorded"}

@app.post("/expenses/{expense_id}/cancel_deletion")
def cancel_deletion(expense_id: int, user_id: int, db: Session = Depends(get_db)):
    """Cancel a pending or approved deletion within the 10 minute window."""
    from database import ExpenseDeletionApproval
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
    _add_system_message(db, expense_id, user_id, "Cancelled the deletion.")
    db.commit()
    _push_group_event(db, expense.group_id)
    return {"message": "Deletion cancelled"}

@app.get("/expenses/{expense_id}/chat", response_model=List[ExpenseMessageResponse])
def get_expense_chat(expense_id: int, db: Session = Depends(get_db)):
    """Fetch chat messages for an expense."""
    from database import ExpenseMessage
    messages = db.query(ExpenseMessage).filter(ExpenseMessage.expense_id == expense_id).order_by(ExpenseMessage.created_at.asc()).all()
    return [
        {
            "id": m.id,
            "user_id": m.user_id,
            "user_name": m.user.name if m.user else "System",
            "text": m.text,
            "is_system": getattr(m, 'is_system', 0),
            "created_at": m.created_at.isoformat()
        } for m in messages
    ]

@app.post("/expenses/{expense_id}/chat", response_model=ExpenseMessageResponse)
async def post_expense_chat(expense_id: int, msg: ExpenseMessageCreate, db: Session = Depends(get_db)):
    """Post a chat message to an expense and push via WebSocket."""
    from database import ExpenseMessage
    new_msg = ExpenseMessage(expense_id=expense_id, user_id=msg.user_id, text=msg.text, is_system=0)
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
                    _add_notification(db, uid, f"{new_msg.user.name} mentioned you in {expense.description}: {msg.text}", expense_id=expense.id, group_id=expense.group_id)
                else:
                    _add_notification(db, uid, f"New comment on {expense.description}: {msg.text}", expense_id=expense.id, group_id=expense.group_id)
        db.commit()

    msg_payload = {
        "type": "new_message",
        "expense_id": expense_id,
        "id": new_msg.id,
        "user_id": new_msg.user_id,
        "user_name": new_msg.user.name if new_msg.user else "Unknown",
        "text": new_msg.text,
        "is_system": 0,
        "created_at": new_msg.created_at.isoformat()
    }
    # Push message instantly to all participants via WebSocket
    await manager.broadcast_to_users(list(involved_users), msg_payload)
        
    return {
        "id": new_msg.id,
        "user_id": new_msg.user_id,
        "user_name": new_msg.user.name if new_msg.user else "Unknown",
        "text": new_msg.text,
        "is_system": 0,
        "created_at": new_msg.created_at.isoformat()
    }

# ── Invite Routes ─────────────────────────────────────────────────────────────

class InviteRequest(BaseModel):
    email: str
    phone: Optional[str] = None
    group_id: int
    invited_by_id: int

class InviteResponse(BaseModel):
    id: int
    email: str
    phone: Optional[str]
    group_name: str
    invited_by_name: str
    token: str
    message: str

@app.post("/invite/", response_model=InviteResponse)
def send_invite(req: InviteRequest, db: Session = Depends(get_db)):
    """Send an invite to join the app and a specific group."""
    group = db.query(Group).filter(Group.id == req.group_id).first()
    if not group:
        raise HTTPException(status_code=404, detail="Group not found")

    inviter = db.query(User).filter(User.id == req.invited_by_id).first()
    if not inviter:
        raise HTTPException(status_code=404, detail="Inviting user not found")

    # Check if a pending invite already exists for this email+group
    existing = db.query(PendingInvite).filter(
        PendingInvite.email == req.email,
        PendingInvite.group_id == req.group_id,
        PendingInvite.accepted == 0
    ).first()
    if existing:
        token = existing.token
    else:
        token = secrets.token_urlsafe(20)
        invite = PendingInvite(
            email=req.email,
            phone=req.phone,
            group_id=req.group_id,
            invited_by_id=req.invited_by_id,
            token=token,
        )
        db.add(invite)
        db.commit()
        db.refresh(invite)

    # Build a registration link the invitee can use
    invite_link = f"http://localhost:5173/?invite={token}&email={req.email}"

    # Write invite to a log file (simulates email/SMS sending in development)
    log_path = os.path.join(os.path.dirname(__file__), "invites.log")
    with open(log_path, "a", encoding="utf-8") as f:
        f.write("=" * 60 + "\n")
        f.write(f"INVITE SENT AT: {datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S UTC')}\n")
        f.write(f"TO EMAIL : {req.email}\n")
        if req.phone:
            f.write(f"TO PHONE : {req.phone}\n")
        f.write(f"FROM     : {inviter.name} ({inviter.email})\n")
        f.write(f"GROUP    : {group.name}\n")
        f.write(f"LINK     : {invite_link}\n")
        f.write("\n")
        f.write(f"--- EMAIL BODY ---\n")
        f.write(f"Hi!\n\n")
        f.write(f"{inviter.name} has invited you to join the group \"{group.name}\" on SplitWise.\n\n")
        f.write(f"Click the link below to create your account and join:\n")
        f.write(f"{invite_link}\n\n")
        f.write(f"See you there!\n")
        f.write("=" * 60 + "\n\n")

    print(f"[INVITE] {inviter.name} -> {req.email} | Group: {group.name} | Link: {invite_link}")

    return InviteResponse(
        id=0,
        email=req.email,
        phone=req.phone,
        group_name=group.name,
        invited_by_name=inviter.name,
        token=token,
        message=f"Invite sent to {req.email}" + (f" and {req.phone}" if req.phone else "")
    )

@app.get("/invite/{token}")
def get_invite(token: str, db: Session = Depends(get_db)):
    """Validate an invite token (used when a new user registers via invite link)."""
    invite = db.query(PendingInvite).filter(PendingInvite.token == token).first()
    if not invite:
        raise HTTPException(status_code=404, detail="Invite not found or already used")
    return {
        "email": invite.email,
        "group_id": invite.group_id,
        "group_name": invite.group.name,
        "invited_by": invite.invited_by.name,
    }

@app.post("/invite/{token}/accept")
def accept_invite(token: str, user_id: int, db: Session = Depends(get_db)):
    """Mark an invite as accepted and add the user to the group."""
    invite = db.query(PendingInvite).filter(PendingInvite.token == token, PendingInvite.accepted == 0).first()
    if not invite:
        raise HTTPException(status_code=404, detail="Invite not found or already used")

    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    group = db.query(Group).filter(Group.id == invite.group_id).first()
    if user not in group.members:
        group.members.append(user)

    invite.accepted = 1
    db.commit()
    return {"message": f"Welcome to {group.name}!", "group_id": group.id}

# ── Settlements ───────────────────────────────────────────────────────────────

@app.post("/settlements/", response_model=SettlementResponse)
def create_settlement(req: SettlementCreate, db: Session = Depends(get_db)):
    """Request a settlement (payment) from payer to payee."""
    from database import Settlement
    payer = db.query(User).filter(User.id == req.payer_id).first()
    payee = db.query(User).filter(User.id == req.payee_id).first()
    if not payer or not payee:
        raise HTTPException(status_code=404, detail="User not found")

    # Prevent duplicate pending requests for the same expense
    if req.expense_id:
        existing = db.query(Settlement).filter(
            Settlement.payer_id == req.payer_id,
            Settlement.expense_id == req.expense_id,
            Settlement.status == "pending"
        ).first()
        if existing:
            raise HTTPException(status_code=400, detail="A pending payment request already exists for this expense")

    new_settlement = Settlement(
        payer_id=req.payer_id,
        payee_id=req.payee_id,
        amount=req.amount,
        group_id=req.group_id,
        expense_id=req.expense_id
    )
    db.add(new_settlement)
    db.commit()
    db.refresh(new_settlement)
    
    # Notify the payee
    group_name = "a group"
    if req.group_id:
        group = db.query(Group).filter(Group.id == req.group_id).first()
        if group: group_name = group.name
        
    _add_notification(db, req.payee_id, f"{payer.name} sent a payment of £{req.amount} in {group_name}. Please approve it.", group_id=req.group_id)
    
    res = SettlementResponse(
        id=new_settlement.id,
        payer_id=new_settlement.payer_id,
        payer_name=payer.name,
        payee_id=new_settlement.payee_id,
        payee_name=payee.name,
        amount=float(new_settlement.amount),
        group_id=new_settlement.group_id,
        expense_id=new_settlement.expense_id,
        status=new_settlement.status,
        created_at=new_settlement.created_at.isoformat()
    )
    return res

@app.post("/settlements/{settlement_id}/approve")
def approve_settlement(settlement_id: int, db: Session = Depends(get_db)):
    from database import Settlement
    settlement = db.query(Settlement).filter(Settlement.id == settlement_id).first()
    if not settlement:
        raise HTTPException(status_code=404, detail="Settlement not found")
    if settlement.status != "pending":
        raise HTTPException(status_code=400, detail="Settlement is not pending")

    settlement.status = "approved"

    # Add a system message to the original expense so payment shows inside it
    if settlement.expense_id:
        _add_system_message(
            db, settlement.expense_id, settlement.payee_id,
            f"{settlement.payer.name} paid £{settlement.amount:.2f} — confirmed by {settlement.payee.name}"
        )

    _add_notification(db, settlement.payer_id, f"Your payment of £{settlement.amount} was approved by {settlement.payee.name}!")
    db.commit()
    _push_group_event(db, settlement.group_id)
    return {"message": "Settlement approved."}

@app.post("/settlements/{settlement_id}/reject")
def reject_settlement(settlement_id: int, db: Session = Depends(get_db)):
    from database import Settlement
    settlement = db.query(Settlement).filter(Settlement.id == settlement_id).first()
    if not settlement:
        raise HTTPException(status_code=404, detail="Settlement not found")
    
    settlement.status = "rejected"
    _add_notification(db, settlement.payer_id, f"Your payment of £{settlement.amount} was rejected by {settlement.payee.name}.")
    db.commit()
    _push_group_event(db, settlement.group_id)
    return {"message": "Settlement rejected."}

@app.get("/users/{user_id}/pending_settlements", response_model=List[SettlementResponse])
def get_pending_settlements(user_id: int, db: Session = Depends(get_db)):
    from database import Settlement
    settlements = db.query(Settlement).filter(Settlement.payee_id == user_id, Settlement.status == "pending").all()
    res = []
    for s in settlements:
        res.append(SettlementResponse(
            id=s.id,
            payer_id=s.payer_id,
            payer_name=s.payer.name if s.payer else "?",
            payee_id=s.payee_id,
            payee_name=s.payee.name if s.payee else "?",
            amount=float(s.amount),
            group_id=s.group_id,
            expense_id=s.expense_id,
            status=s.status,
            created_at=s.created_at.isoformat()
        ))
    return res

@app.get("/users/{user_id}/initiated_settlements", response_model=List[SettlementResponse])
def get_initiated_settlements(user_id: int, db: Session = Depends(get_db)):
    from database import Settlement
    # Return pending + approved so frontend can show "Waiting…" vs "Paid ✓"
    settlements = db.query(Settlement).filter(
        Settlement.payer_id == user_id,
        Settlement.status.in_(["pending", "approved"])
    ).all()
    res = []
    for s in settlements:
        res.append(SettlementResponse(
            id=s.id,
            payer_id=s.payer_id,
            payer_name=s.payer.name if s.payer else "?",
            payee_id=s.payee_id,
            payee_name=s.payee.name if s.payee else "?",
            amount=float(s.amount),
            group_id=s.group_id,
            expense_id=s.expense_id,
            status=s.status,
            created_at=s.created_at.isoformat()
        ))
    return res

# ── Helper ────────────────────────────────────────────────────────────────────

def _add_notification(db: Session, user_id: int, message: str, expense_id: int = None, group_id: int = None):
    from database import Notification
    n = Notification(user_id=user_id, message=message, expense_id=expense_id, group_id=group_id, is_read=0)
    db.add(n)
    db.flush()  # get ID without full commit
    # Schedule non-blocking WS push (runs after current DB transaction commits)
    async def _push():
        await manager.send_to_user(user_id, {
            "type": "notification",
            "id": n.id,
            "message": message,
            "group_id": group_id,
            "expense_id": expense_id,
            "is_read": 0,
            "created_at": datetime.utcnow().isoformat()
        })
    import asyncio
    try:
        loop = asyncio.get_event_loop()
        if loop.is_running():
            loop.create_task(_push())
    except Exception:
        pass

def _add_system_message(db: Session, expense_id: int, user_id: int, text: str):
    from database import ExpenseMessage
    user = db.query(User).filter(User.id == user_id).first()
    user_name = user.name if user else "System"
    formatted_text = f"{user_name} {text}"
    msg = ExpenseMessage(expense_id=expense_id, user_id=user_id, text=formatted_text, is_system=1)
    db.add(msg)

def _format_expense(e: Expense) -> dict:
    from database import ExpenseDeletionApproval
    
    last_msg = getattr(e, "messages", [])
    last_message_at = last_msg[-1].created_at.isoformat() if last_msg else None
    last_message_text = last_msg[-1].text if last_msg else None
    
    return {
        "id": e.id,
        "description": e.description,
        "amount": float(e.amount),
        "payer_id": e.payer_id,
        "payer_name": e.payer.name if e.payer else "Unknown",
        "created_by_id": e.created_by_id,
        "created_by_name": e.created_by.name if e.created_by else "Unknown",
        "status": e.status,
        "group_id": e.group_id,
        "date": e.date.isoformat() if e.date else None,
        "splits": [
            {"user_id": s.user_id, "amount": float(s.amount), "user_name": s.user.name if s.user else "?"}
            for s in e.splits
        ],
        "approvals": [{"user_id": a.user_id, "user_name": a.user.name if a.user else "?", "approved": a.approved} for a in getattr(e, "approvals", [])],
        "last_message_at": last_message_at,
        "last_message_text": last_message_text,
        "created_at": e.created_at.isoformat() if getattr(e, "created_at", None) else e.date.isoformat() if e.date else None,
    }
