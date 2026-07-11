from sqlalchemy import create_engine, Column, Integer, String, Numeric, ForeignKey, Table, DateTime, Boolean, Text
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
    engine = create_engine(
        SQLALCHEMY_DATABASE_URL,
        pool_size=5,
        max_overflow=10,
        pool_pre_ping=True,
        pool_recycle=300,
    )

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()

# Association table for Group members (includes role + active status)
group_members = Table(
    "group_members",
    Base.metadata,
    Column("user_id", Integer, ForeignKey("users.id"), index=True),
    Column("group_id", Integer, ForeignKey("groups.id"), index=True),
    Column("role", String(20), default="member"),      # 'super_admin' | 'admin' | 'member'
    Column("is_active", Boolean, default=True),
)

class AppSettings(Base):
    __tablename__ = "app_settings"

    id                          = Column(Integer, primary_key=True, index=True)
    # Personal trial config
    personal_trial_active       = Column(Boolean, default=True)
    personal_trial_days         = Column(Integer, default=30)
    # Work / org trial config
    work_trial_active           = Column(Boolean, default=True)
    work_trial_days             = Column(Integer, default=14)
    updated_at                  = Column(DateTime, default=datetime.utcnow)
    # Integration settings
    totp_enforcement            = Column(String(20), default='disabled')   # disabled|optional|required
    email_provider              = Column(String(20), default='smtp')        # smtp|sendgrid|mailgun|ses


class Organisation(Base):
    __tablename__ = "organisations"

    id                   = Column(Integer, primary_key=True, index=True)
    name                 = Column(String, nullable=False, index=True)
    domain               = Column(String, nullable=True)   # e.g. "acme.com"
    created_at           = Column(DateTime, default=datetime.utcnow)
    # Work trial
    work_trial_claimed_at = Column(DateTime, nullable=True)

    departments = relationship("Department", back_populates="organisation", cascade="all, delete-orphan")


class Department(Base):
    __tablename__ = "departments"

    id              = Column(Integer, primary_key=True, index=True)
    name            = Column(String, nullable=False)
    organisation_id = Column(Integer, ForeignKey("organisations.id", ondelete="CASCADE"), index=True)
    created_at      = Column(DateTime, default=datetime.utcnow)

    organisation = relationship("Organisation", back_populates="departments")


class User(Base):
    __tablename__ = "users"

    id              = Column(Integer, primary_key=True, index=True)
    name            = Column(String, index=True)
    email           = Column(String, unique=True, index=True)
    password        = Column(String)
    is_admin        = Column(Boolean, default=False)
    is_verified     = Column(Boolean, default=False)
    # ── Corporate fields (nullable — personal users stay null) ──
    organisation_id = Column(Integer, ForeignKey("organisations.id"), nullable=True, index=True)
    department_id   = Column(Integer, ForeignKey("departments.id"), nullable=True, index=True)
    manager_id      = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    employee_id     = Column(String, nullable=True)
    org_role        = Column(String(20), nullable=True)  # null | 'member' | 'admin'
    org_status      = Column(String(20), nullable=True)  # null | 'active' | 'inactive'
    job_title       = Column(String(100), nullable=True)
    title           = Column(String(10), nullable=True)  # Mr / Mrs / Ms / Dr / Prof / Rev
    # Linked secondary emails (each verified independently via OTP)
    personal_email          = Column(String, nullable=True, unique=True, index=True)
    personal_email_verified = Column(Boolean, default=False)
    work_email              = Column(String, nullable=True, unique=True, index=True)
    work_email_verified     = Column(Boolean, default=False)
    # Personal free-trial tracking
    trial_claimed_at        = Column(DateTime, nullable=True)

    groups        = relationship("Group", secondary=group_members, back_populates="members")
    expenses_paid = relationship("Expense", foreign_keys="[Expense.payer_id]", back_populates="payer")
    expenses_created = relationship("Expense", foreign_keys="[Expense.created_by_id]", back_populates="created_by")
    splits        = relationship("ExpenseSplit", back_populates="user")
    organisation  = relationship("Organisation", foreign_keys=[organisation_id])
    department    = relationship("Department", foreign_keys=[department_id])
    manager       = relationship("User", foreign_keys=[manager_id], remote_side="User.id")

    @property
    def organisation_domain(self):
        return self.organisation.domain if self.organisation else None

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
    created_at = Column(DateTime, default=datetime.utcnow, nullable=True)
    deletion_approved_at = Column(DateTime, nullable=True)
    group_id = Column(Integer, ForeignKey("groups.id"), nullable=True, index=True)
    payer_id = Column(Integer, ForeignKey("users.id"), index=True)
    created_by_id = Column(Integer, ForeignKey("users.id"), index=True)
    status = Column(String, default="active", index=True) # active, pending_deletion
    receipt_image = Column(Text, nullable=True)
    category = Column(String(50), nullable=True)
    recurrence = Column(String(10), nullable=True)
    next_due = Column(DateTime, nullable=True)
    # ── Corporate fields ──
    currency  = Column(String(10), nullable=True, default="GBP")
    report_id = Column(Integer, ForeignKey("expense_reports.id"), nullable=True, index=True)

    group      = relationship("Group", back_populates="expenses")
    payer      = relationship("User", foreign_keys=[payer_id], back_populates="expenses_paid")
    created_by = relationship("User", foreign_keys=[created_by_id])
    splits     = relationship("ExpenseSplit", back_populates="expense", cascade="all, delete-orphan")
    approvals  = relationship("ExpenseDeletionApproval", back_populates="expense", cascade="all, delete-orphan")
    messages   = relationship("ExpenseMessage", back_populates="expense", cascade="all, delete-orphan", order_by="ExpenseMessage.created_at")
    report     = relationship("ExpenseReport", back_populates="expenses", foreign_keys=[report_id])

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

class Settlement(Base):
    __tablename__ = "settlements"

    id = Column(Integer, primary_key=True, index=True)
    payer_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), index=True)
    payee_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), index=True)
    amount = Column(Numeric(10, 2))
    group_id = Column(Integer, ForeignKey("groups.id", ondelete="CASCADE"), nullable=True, index=True)
    expense_id = Column(Integer, ForeignKey("expenses.id", ondelete="CASCADE"), nullable=True, index=True)
    status = Column(String, default="pending", index=True) # pending, approved, rejected
    created_at = Column(DateTime, default=datetime.utcnow)

    payer = relationship("User", foreign_keys=[payer_id])
    payee = relationship("User", foreign_keys=[payee_id])
    group = relationship("Group")
    expense = relationship("Expense")

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

class EmailVerification(Base):
    __tablename__ = "email_verifications"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, index=True)
    otp = Column(String(6))
    expires_at = Column(DateTime)
    used = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)

class PasswordReset(Base):
    __tablename__ = "password_resets"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, index=True)
    otp = Column(String(6))
    expires_at = Column(DateTime)
    used = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)

class Subscription(Base):
    __tablename__ = "subscriptions"

    id         = Column(Integer, primary_key=True, index=True)
    user_id    = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), unique=True, index=True)
    plan       = Column(String(20), default="free")   # 'free' | 'pro' | 'business'
    started_at = Column(DateTime, default=datetime.utcnow)
    expires_at = Column(DateTime, nullable=True)
    is_active  = Column(Boolean, default=True)

    user = relationship("User")


class FeatureFlag(Base):
    __tablename__ = "feature_flags"

    id            = Column(Integer, primary_key=True, index=True)
    plan          = Column(String(20), nullable=False)
    feature_key   = Column(String(60), nullable=False)
    enabled       = Column(Boolean, default=True)
    limit_value   = Column(Integer, nullable=True)   # None / 0 = unlimited; positive = cap


class GroupBudget(Base):
    __tablename__ = "group_budgets"

    id             = Column(Integer, primary_key=True, index=True)
    group_id       = Column(Integer, ForeignKey("groups.id", ondelete="CASCADE"), unique=True, index=True)
    amount         = Column(Numeric(10, 2))
    period         = Column(String(20), default="monthly")   # 'monthly' | 'yearly' | 'total'
    created_by_id  = Column(Integer, ForeignKey("users.id"), index=True)
    created_at     = Column(DateTime, default=datetime.utcnow)

    group      = relationship("Group")
    created_by = relationship("User")


class ExpenseReport(Base):
    __tablename__ = "expense_reports"

    id              = Column(Integer, primary_key=True, index=True)
    title           = Column(String, nullable=False)
    description     = Column(Text, nullable=True)
    submitted_by_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), index=True)
    organisation_id = Column(Integer, ForeignKey("organisations.id", ondelete="CASCADE"), index=True)
    department_id   = Column(Integer, ForeignKey("departments.id"), nullable=True, index=True)
    manager_id      = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    # draft | submitted | approved | rejected | reimbursed
    status          = Column(String, default="draft", index=True)
    currency        = Column(String(10), default="GBP")
    total_amount    = Column(Numeric(10, 2), default=0)
    period_start    = Column(DateTime, nullable=True)
    period_end      = Column(DateTime, nullable=True)
    created_at      = Column(DateTime, default=datetime.utcnow)
    updated_at      = Column(DateTime, default=datetime.utcnow)
    reviewed_by_id  = Column(Integer, ForeignKey("users.id"), nullable=True)
    reviewed_at     = Column(DateTime, nullable=True)
    review_notes    = Column(Text, nullable=True)

    submitted_by = relationship("User", foreign_keys=[submitted_by_id])
    organisation = relationship("Organisation")
    department   = relationship("Department")
    manager      = relationship("User", foreign_keys=[manager_id])
    reviewed_by  = relationship("User", foreign_keys=[reviewed_by_id])
    expenses     = relationship("Expense", back_populates="report", foreign_keys="[Expense.report_id]")


# Create tables
Base.metadata.create_all(bind=engine)
