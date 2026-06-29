"""
tests/test_admin.py — Tests for all /admin routes.
"""

import pytest

from tests.conftest import (
    auth_headers,
    create_admin_user,
    create_verified_user,
    login,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _setup_admin_and_regular(client, db):
    """
    Returns (admin_info, admin_token, user_info, user_token).
    The admin is the first verified user so is_admin=True is set directly.
    """
    admin = create_admin_user(client, db, "admin@test.com", "adminpass1", "Admin User")
    regular = create_verified_user(client, db, "regular@test.com", "password123", "Regular User")
    admin_token = login(client, admin["email"], "adminpass1")
    regular_token = login(client, regular["email"], "password123")
    return admin, admin_token, regular, regular_token


# ---------------------------------------------------------------------------
# Admin: users
# ---------------------------------------------------------------------------

class TestAdminUsers:
    def test_admin_get_users(self, client, db):
        """Admin can retrieve all users."""
        admin, admin_token, regular, _ = _setup_admin_and_regular(client, db)

        resp = client.get("/admin/users", headers=auth_headers(admin_token))
        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, list)
        ids = [u["id"] for u in data]
        assert admin["id"] in ids
        assert regular["id"] in ids

    def test_admin_get_users_non_admin(self, client, db):
        """Regular user accessing /admin/users → 403."""
        _, _, _, regular_token = _setup_admin_and_regular(client, db)

        resp = client.get("/admin/users", headers=auth_headers(regular_token))
        assert resp.status_code == 403

    def test_admin_get_users_unauthenticated(self, client, db):
        """No token → 401/403."""
        resp = client.get("/admin/users")
        assert resp.status_code in (401, 403)

    def test_admin_create_user(self, client, db):
        """Admin creates a new verified user directly."""
        admin, admin_token, _, _ = _setup_admin_and_regular(client, db)

        resp = client.post(
            "/admin/users",
            json={"name": "New User", "email": "newuser@test.com", "password": "newpass1"},
            headers=auth_headers(admin_token),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["email"] == "newuser@test.com"
        assert data["name"] == "New User"

        # The admin-created user should be able to log in immediately (is_verified=True)
        login_resp = client.post(
            "/login/", json={"email": "newuser@test.com", "password": "newpass1"}
        )
        assert login_resp.status_code == 200

    def test_admin_create_user_duplicate_email(self, client, db):
        """Duplicate email → 400."""
        admin, admin_token, regular, _ = _setup_admin_and_regular(client, db)

        resp = client.post(
            "/admin/users",
            json={"name": "Dup", "email": regular["email"], "password": "newpass1"},
            headers=auth_headers(admin_token),
        )
        assert resp.status_code == 400

    def test_admin_create_user_non_admin(self, client, db):
        """Regular user cannot create admin users → 403."""
        _, _, _, regular_token = _setup_admin_and_regular(client, db)

        resp = client.post(
            "/admin/users",
            json={"name": "Sneaky", "email": "sneaky@test.com", "password": "newpass1"},
            headers=auth_headers(regular_token),
        )
        assert resp.status_code == 403

    def test_admin_toggle_admin(self, client, db):
        """Admin promotes a regular user to admin."""
        admin, admin_token, regular, _ = _setup_admin_and_regular(client, db)

        resp = client.put(
            f"/admin/users/{regular['id']}/toggle_admin",
            headers=auth_headers(admin_token),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["is_admin"] is True

        # Toggle back
        resp2 = client.put(
            f"/admin/users/{regular['id']}/toggle_admin",
            headers=auth_headers(admin_token),
        )
        assert resp2.status_code == 200
        assert resp2.json()["is_admin"] is False

    def test_admin_toggle_self(self, client, db):
        """Admin cannot toggle their own admin status → 400."""
        admin, admin_token, _, _ = _setup_admin_and_regular(client, db)

        resp = client.put(
            f"/admin/users/{admin['id']}/toggle_admin",
            headers=auth_headers(admin_token),
        )
        assert resp.status_code == 400

    def test_admin_toggle_nonexistent_user(self, client, db):
        """Toggling a non-existent user → 404."""
        admin, admin_token, _, _ = _setup_admin_and_regular(client, db)

        resp = client.put(
            "/admin/users/99999/toggle_admin",
            headers=auth_headers(admin_token),
        )
        assert resp.status_code == 404

    def test_admin_delete_user(self, client, db):
        """Admin deletes another user."""
        admin, admin_token, regular, _ = _setup_admin_and_regular(client, db)

        resp = client.delete(
            f"/admin/users/{regular['id']}",
            headers=auth_headers(admin_token),
        )
        assert resp.status_code == 200
        assert "deleted" in resp.json()["message"].lower()

        # User should no longer exist
        from database import User
        assert db.query(User).filter(User.id == regular["id"]).first() is None

    def test_admin_delete_self(self, client, db):
        """Admin cannot delete themselves → 400."""
        admin, admin_token, _, _ = _setup_admin_and_regular(client, db)

        resp = client.delete(
            f"/admin/users/{admin['id']}",
            headers=auth_headers(admin_token),
        )
        assert resp.status_code == 400

    def test_admin_delete_user_non_admin(self, client, db):
        """Regular user cannot delete users → 403."""
        admin, _, regular, regular_token = _setup_admin_and_regular(client, db)

        resp = client.delete(
            f"/admin/users/{admin['id']}",
            headers=auth_headers(regular_token),
        )
        assert resp.status_code == 403

    def test_admin_delete_nonexistent_user(self, client, db):
        """Deleting a non-existent user → 404."""
        admin, admin_token, _, _ = _setup_admin_and_regular(client, db)

        resp = client.delete(
            "/admin/users/99999",
            headers=auth_headers(admin_token),
        )
        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Admin: stats
# ---------------------------------------------------------------------------

class TestAdminStats:
    def test_admin_stats(self, client, db):
        """Admin stats endpoint returns expected keys with numeric values."""
        admin, admin_token, _, _ = _setup_admin_and_regular(client, db)

        resp = client.get("/admin/stats", headers=auth_headers(admin_token))
        assert resp.status_code == 200
        data = resp.json()

        expected_keys = {
            "total_users", "total_groups", "active_expenses",
            "pending_deletions", "deleted_expenses",
            "total_expense_amount", "total_settlements",
            "pending_settlements", "approved_settlements",
            "total_notifications", "unread_notifications",
        }
        assert expected_keys.issubset(data.keys())
        assert data["total_users"] >= 2  # admin + regular

    def test_admin_stats_non_admin(self, client, db):
        """Regular user cannot access stats → 403."""
        _, _, _, regular_token = _setup_admin_and_regular(client, db)

        resp = client.get("/admin/stats", headers=auth_headers(regular_token))
        assert resp.status_code == 403

    def test_admin_stats_count_accuracy(self, client, db, expense_fixture):
        """Stats reflect actual data counts."""
        admin = create_admin_user(client, db, "statsadmin@test.com", "adminpass1", "Stats Admin")
        admin_token = login(client, admin["email"], "adminpass1")

        resp = client.get("/admin/stats", headers=auth_headers(admin_token))
        data = resp.json()

        # We have at least 1 active expense from expense_fixture
        assert data["active_expenses"] >= 1
        assert data["total_users"] >= 3  # creator, member, admin


# ---------------------------------------------------------------------------
# Admin: groups
# ---------------------------------------------------------------------------

class TestAdminGroups:
    def test_admin_list_groups(self, client, db, group_fixture):
        """Admin can list all groups with member counts."""
        admin = create_admin_user(client, db, "gadmin@test.com", "adminpass1", "Group Admin")
        admin_token = login(client, admin["email"], "adminpass1")

        resp = client.get("/admin/groups", headers=auth_headers(admin_token))
        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, list)
        assert any(g["name"] == "Test Group" for g in data)
        for g in data:
            assert "member_count" in g
            assert "expense_count" in g

    def test_admin_delete_group(self, client, db, group_fixture):
        """Admin can delete a group."""
        admin = create_admin_user(client, db, "deladmin@test.com", "adminpass1", "Del Admin")
        admin_token = login(client, admin["email"], "adminpass1")
        group = group_fixture["group"]

        resp = client.delete(
            f"/admin/groups/{group['id']}",
            headers=auth_headers(admin_token),
        )
        assert resp.status_code == 200
        assert "deleted" in resp.json()["message"].lower()

    def test_admin_delete_nonexistent_group(self, client, db):
        """Deleting a non-existent group → 404."""
        admin, admin_token, _, _ = _setup_admin_and_regular(client, db)

        resp = client.delete(
            "/admin/groups/99999",
            headers=auth_headers(admin_token),
        )
        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Admin: expenses
# ---------------------------------------------------------------------------

class TestAdminExpenses:
    def test_admin_list_expenses(self, client, db, expense_fixture):
        """Admin lists all expenses."""
        admin = create_admin_user(client, db, "expadmin@test.com", "adminpass1", "Exp Admin")
        admin_token = login(client, admin["email"], "adminpass1")

        resp = client.get("/admin/expenses", headers=auth_headers(admin_token))
        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, list)
        assert any(e["description"] == "Test Expense" for e in data)

    def test_admin_list_expenses_filter_status(self, client, db, expense_fixture):
        """Admin can filter expenses by status."""
        admin = create_admin_user(client, db, "filtadmin@test.com", "adminpass1", "Filt Admin")
        admin_token = login(client, admin["email"], "adminpass1")

        resp = client.get(
            "/admin/expenses",
            params={"status": "active"},
            headers=auth_headers(admin_token),
        )
        assert resp.status_code == 200
        data = resp.json()
        for e in data:
            assert e["status"] == "active"


# ---------------------------------------------------------------------------
# Admin: settlements & notifications
# ---------------------------------------------------------------------------

class TestAdminSettlements:
    def test_admin_list_settlements(self, client, db, expense_fixture):
        """Admin lists settlements (may be empty if none created)."""
        admin = create_admin_user(client, db, "setladmin@test.com", "adminpass1", "Setl Admin")
        admin_token = login(client, admin["email"], "adminpass1")

        resp = client.get("/admin/settlements", headers=auth_headers(admin_token))
        assert resp.status_code == 200
        assert isinstance(resp.json(), list)


class TestAdminNotifications:
    def test_admin_list_notifications(self, client, db, expense_fixture):
        """Admin lists notifications."""
        admin = create_admin_user(client, db, "notadmin@test.com", "adminpass1", "Not Admin")
        admin_token = login(client, admin["email"], "adminpass1")

        resp = client.get("/admin/notifications", headers=auth_headers(admin_token))
        assert resp.status_code == 200
        assert isinstance(resp.json(), list)

    def test_admin_list_notifications_filter_user(self, client, db, expense_fixture):
        """Admin filters notifications by user_id."""
        admin = create_admin_user(client, db, "notfiltadmin@test.com", "adminpass1", "NotFilt Admin")
        admin_token = login(client, admin["email"], "adminpass1")
        member = expense_fixture["member"]

        resp = client.get(
            "/admin/notifications",
            params={"user_id": member["id"]},
            headers=auth_headers(admin_token),
        )
        assert resp.status_code == 200
        data = resp.json()
        for n in data:
            assert n["user_id"] == member["id"]
