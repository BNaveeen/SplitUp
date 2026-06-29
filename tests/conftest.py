"""
conftest.py — shared fixtures for all test modules.

Strategy:
  - Set DATABASE_URL to in-memory SQLite BEFORE importing anything from the app,
    so database.py picks it up at module load time.
  - Patch the rate-limiter so it never fires during tests.
  - Each test gets a fresh, empty database via the `client` fixture.
"""

import os
import sys
from datetime import datetime, timedelta

# ── Must be set BEFORE any app imports ────────────────────────────────────────
os.environ["DATABASE_URL"] = "sqlite://"          # in-memory
os.environ["JWT_SECRET"]   = "test-secret-key"

# Add the project root to sys.path so imports resolve.
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)

# ── Patch the rate limiter to be a no-op BEFORE importing the app ─────────────
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

# ---------------------------------------------------------------------------
# Build a fresh in-memory engine for each test session.  We use StaticPool so
# every connection shares the same in-memory database (required for SQLite
# "sqlite://").
# ---------------------------------------------------------------------------
TEST_DB_URL = "sqlite://"

engine = create_engine(
    TEST_DB_URL,
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)

# Enable WAL + FK enforcement
@event.listens_for(engine, "connect")
def _set_sqlite_pragma(conn, _):
    cursor = conn.cursor()
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.close()

TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


# ---------------------------------------------------------------------------
# Now that DATABASE_URL is set we can safely import application modules.
# We monkey-patch `database.engine` and `database.SessionLocal` to use our
# test engine BEFORE importing `main`, so that `Base.metadata.create_all`
# targets the in-memory DB.
# ---------------------------------------------------------------------------
import database as _db_module

_db_module.engine = engine
_db_module.SessionLocal = TestingSessionLocal

# Import Base and create all tables on the test engine
from database import Base  # noqa: E402  (must come after monkey-patch)

Base.metadata.create_all(bind=engine)

# Now import the FastAPI app (it will use the patched SessionLocal)
from routes.deps import get_db  # noqa: E402
from main import app            # noqa: E402


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture(autouse=True)
def _clean_tables():
    """
    Drop & recreate all tables before every test so tests are isolated.
    Also reset the rate-limiter's in-memory storage so hits don't accumulate
    across tests (the routes are already decorated; we can't remove the
    decorators, but we can flush the counter store).
    """
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)

    # Reset slowapi in-memory counters
    from routes.deps import limiter as _limiter
    try:
        _limiter._storage.reset()
    except Exception:
        pass

    yield

    Base.metadata.drop_all(bind=engine)


@pytest.fixture
def db():
    """Provide a SQLAlchemy Session that shares the test engine."""
    session = TestingSessionLocal()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture
def client(db):
    """TestClient with get_db overridden to use the test session."""
    def override_get_db():
        try:
            yield db
        finally:
            pass  # session lifecycle managed by the `db` fixture

    app.dependency_overrides[get_db] = override_get_db

    # Disable rate limiter for all tests
    with patch("routes.deps.limiter.limit", return_value=lambda f: f):
        # Also patch the limiter decorator on the already-defined routes
        with TestClient(app, raise_server_exceptions=True) as c:
            yield c

    app.dependency_overrides.clear()


# ---------------------------------------------------------------------------
# Helper functions (not fixtures — called directly from tests)
# ---------------------------------------------------------------------------

def create_verified_user(client: TestClient, db, email: str, password: str, name: str):
    """
    Register a user then directly flip is_verified in the DB (bypasses OTP
    flow so tests stay fast and hermetic).  Returns the dict with keys
    ``id``, ``email``, ``name``.
    """
    from database import User, EmailVerification
    from routes.deps import hash_password

    # Attempt registration (ignore errors if user already partially exists)
    client.post("/register/", json={"name": name, "email": email, "password": password})

    # Directly verify in DB
    user = db.query(User).filter(User.email == email.lower().strip()).first()
    if user is None:
        # Might not have been created via register if e.g. email validation failed;
        # create directly.
        user = User(
            name=name,
            email=email.lower().strip(),
            password=hash_password(password),
            is_verified=True,
            is_admin=False,
        )
        db.add(user)
        db.commit()
        db.refresh(user)
    else:
        user.is_verified = True
        db.commit()
        db.refresh(user)

    return {"id": user.id, "email": user.email, "name": user.name}


def create_admin_user(client: TestClient, db, email: str = "admin@test.com",
                      password: str = "adminpass1", name: str = "Admin"):
    """
    Create the first verified user; because `is_first` logic in /register/
    sets is_admin=True for the first verified user, we also set is_admin=True
    directly to be safe.
    """
    from database import User

    info = create_verified_user(client, db, email, password, name)
    user = db.query(User).filter(User.id == info["id"]).first()
    user.is_admin = True
    db.commit()
    return info


def auth_headers(token: str) -> dict:
    """Return the Authorization header dict for a Bearer token."""
    return {"Authorization": f"Bearer {token}"}


def login(client: TestClient, email: str, password: str) -> str:
    """Login and return the access token string."""
    resp = client.post("/login/", json={"email": email, "password": password})
    assert resp.status_code == 200, f"Login failed ({resp.status_code}): {resp.text}"
    return resp.json()["access_token"]


# ---------------------------------------------------------------------------
# Common fixture: a group with its creator
# ---------------------------------------------------------------------------

@pytest.fixture
def group_fixture(client, db):
    """
    Creates a verified user, logs in, creates a group.

    Returns a dict::

        {
          "user": {"id": .., "email": .., "name": ..},
          "token": str,
          "group": {"id": .., "name": .., "members": [...]},
        }
    """
    user = create_verified_user(client, db, "groupowner@test.com", "password123", "Group Owner")
    token = login(client, user["email"], "password123")
    headers = auth_headers(token)

    resp = client.post(
        "/groups/",
        json={"name": "Test Group", "creator_id": user["id"]},
        headers=headers,
    )
    assert resp.status_code == 200, resp.text
    return {"user": user, "token": token, "group": resp.json()}


# ---------------------------------------------------------------------------
# Common fixture: an expense inside a group
# ---------------------------------------------------------------------------

@pytest.fixture
def expense_fixture(client, db, group_fixture):
    """
    Creates a second member, adds them to the group, then creates an expense
    split equally between the two members.

    Returns a dict::

        {
          "creator": {"id": .., "email": .., "name": ..},
          "creator_token": str,
          "member": {"id": .., "email": .., "name": ..},
          "member_token": str,
          "group": {..},
          "expense": {..},
        }
    """
    creator = group_fixture["user"]
    creator_token = group_fixture["token"]
    group = group_fixture["group"]
    headers = auth_headers(creator_token)

    # Add a second member
    member = create_verified_user(client, db, "member@test.com", "password123", "Member User")
    client.post(
        f"/groups/{group['id']}/members/",
        json={"email": member["email"]},
        headers=headers,
    )

    # Create expense split equally
    resp = client.post(
        "/expenses/",
        json={
            "description": "Test Expense",
            "amount": 100.0,
            "payer_id": creator["id"],
            "created_by_id": creator["id"],
            "group_id": group["id"],
            "splits": [
                {"user_id": creator["id"], "amount": 50.0},
                {"user_id": member["id"], "amount": 50.0},
            ],
        },
        headers=headers,
    )
    assert resp.status_code == 200, resp.text
    member_token = login(client, member["email"], "password123")

    return {
        "creator": creator,
        "creator_token": creator_token,
        "member": member,
        "member_token": member_token,
        "group": group,
        "expense": resp.json(),
    }
