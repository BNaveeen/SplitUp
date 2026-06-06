from sqlalchemy import create_engine, Column, Integer, String, Numeric, ForeignKey, Table, DateTime, Boolean
from sqlalchemy.orm import declarative_base, relationship, sessionmaker
from datetime import datetime

import os
from dotenv import load_dotenv

load_dotenv()

# Easily switch between local SQLite and Supabase PostgreSQL
# Render sets DATABASE_URL; locally we use USE_SUPABASE + SUPABASE_URL
USE_SUPABASE = os.environ.get("USE_SUPABASE", "false").lower() == "true"
SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
DATABASE_URL = os.environ.get("DATABASE_URL", "")

if DATABASE_URL:
    SQLALCHEMY_DATABASE_URL = DATABASE_URL
elif USE_SUPABASE and SUPABASE_URL:
    SQLALCHEMY_DATABASE_URL = SUPABASE_URL
else:
    SQLALCHEMY_DATABASE_URL = "sqlite:///./splitwise_v2.db"

# Detect if we are using SQLite vs Postgres based on the URL
if SQLALCHEMY_DATABASE_URL.startswith("sqlite"):
    engine = create_engine(
        SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False}
    )
else:
    engine = create_engine(SQLALCHEMY_DATABASE_URL)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()

# Association table for Group members
group_members = Table(
    "group_members",
    Base.metadata,
    Column("user_id", Integer, ForeignKey("users.id"), index=True),
    Column("group_id", Integer, ForeignKey("groups.id"), index=True),
)

class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, index=True)
    email = Column(String, unique=True, index=True)
    password = Column(String)
    is_admin = Column(Boolean, default=False)

    groups = relationship("Group", secondary=group_members, back_populates="members")
    expenses_paid = relationship("Expense", foreign_keys="[Expense.payer_id]", back_populates="payer")
    expenses_created = relationship("Expense", foreign_keys="[Expense.created_by_id]", back_populates="created_by")
    splits = relationship("ExpenseSplit", back_populates="user")

class Group(Base):
    __tablename__ = "groups"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, index=True)

    members = relationship("User", secondary=group_members, back_populates="groups")
    expenses = relationship("Expense", back_populates="group")

class Expense(Base):
    __tablename__ = "expenses"

    id = Column(Integer, primary_key=True, index=True)
    description = Column(String, index=True)
    amount = Column(Numeric(10, 2))
    date = Column(DateTime, default=datetime.utcnow, nullable=False)
    group_id = Column(Integer, ForeignKey("groups.id"), nullable=True, index=True)
    payer_id = Column(Integer, ForeignKey("users.id"), index=True)
    created_by_id = Column(Integer, ForeignKey("users.id"), index=True)
    status = Column(String, default="active", index=True) # active, pending_deletion

    group = relationship("Group", back_populates="expenses")
    payer = relationship("User", foreign_keys=[payer_id], back_populates="expenses_paid")
    created_by = relationship("User", foreign_keys=[created_by_id])
    splits = relationship("ExpenseSplit", back_populates="expense", cascade="all, delete-orphan")
    approvals = relationship("ExpenseDeletionApproval", back_populates="expense", cascade="all, delete-orphan")
    messages = relationship("ExpenseMessage", back_populates="expense", cascade="all, delete-orphan", order_by="ExpenseMessage.created_at")

class ExpenseSplit(Base):
    __tablename__ = "expense_splits"

    id = Column(Integer, primary_key=True, index=True)
    expense_id = Column(Integer, ForeignKey("expenses.id"), index=True)
    user_id = Column(Integer, ForeignKey("users.id"), index=True)
    amount = Column(Numeric(10, 2))

    expense = relationship("Expense", back_populates="splits")
    user = relationship("User", back_populates="splits")

class PendingInvite(Base):
    __tablename__ = "pending_invites"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, index=True)
    phone = Column(String, nullable=True)
    group_id = Column(Integer, ForeignKey("groups.id"), index=True)
    invited_by_id = Column(Integer, ForeignKey("users.id"), index=True)
    token = Column(String, unique=True, index=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    accepted = Column(Integer, default=0)  # 0=pending, 1=accepted

    group = relationship("Group")
    invited_by = relationship("User")

class ExpenseDeletionApproval(Base):
    __tablename__ = "expense_deletion_approvals"

    id = Column(Integer, primary_key=True, index=True)
    expense_id = Column(Integer, ForeignKey("expenses.id", ondelete="CASCADE"), index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), index=True)
    approved = Column(Integer, default=0) # 0=pending, 1=approved, -1=rejected

    expense = relationship("Expense")
    user = relationship("User")

class ExpenseMessage(Base):
    __tablename__ = "expense_messages"

    id = Column(Integer, primary_key=True, index=True)
    expense_id = Column(Integer, ForeignKey("expenses.id", ondelete="CASCADE"), index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), index=True)
    text = Column(String)
    is_system = Column(Integer, default=0) # 0 = normal, 1 = system
    created_at = Column(DateTime, default=datetime.utcnow)

    expense = relationship("Expense", back_populates="messages")
    user = relationship("User")

class Notification(Base):
    __tablename__ = "notifications"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), index=True)
    message = Column(String)
    group_id = Column(Integer, nullable=True)
    expense_id = Column(Integer, nullable=True)
    is_read = Column(Integer, default=0) # 0=unread, 1=read
    created_at = Column(DateTime, default=datetime.utcnow)

    user = relationship("User")

# Create tables
Base.metadata.create_all(bind=engine)
