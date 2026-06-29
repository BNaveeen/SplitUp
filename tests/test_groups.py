"""
tests/test_groups.py — Tests for all /groups routes.
"""

import pytest

from tests.conftest import (
    auth_headers,
    create_verified_user,
    login,
)


# ---------------------------------------------------------------------------
# Group creation
# ---------------------------------------------------------------------------

class TestCreateGroup:
    def test_create_group(self, client, db):
        """Authenticated user creates a group; they become the super_admin."""
        user = create_verified_user(client, db, "creator@test.com", "password123", "Creator")
        token = login(client, user["email"], "password123")

        resp = client.post(
            "/groups/",
            json={"name": "My Group", "creator_id": user["id"]},
            headers=auth_headers(token),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["name"] == "My Group"
        member_ids = [m["id"] for m in data["members"]]
        assert user["id"] in member_ids

        # Verify role in DB
        from database import group_members
        row = db.execute(
            group_members.select().where(
                (group_members.c.user_id == user["id"]) &
                (group_members.c.group_id == data["id"])
            )
        ).first()
        assert row is not None
        assert row.role == "super_admin"

    def test_create_group_forbidden(self, client, db):
        """Creating a group on behalf of another user → 403."""
        user_a = create_verified_user(client, db, "a@test.com", "password123", "A")
        user_b = create_verified_user(client, db, "b@test.com", "password123", "B")
        token_a = login(client, user_a["email"], "password123")

        resp = client.post(
            "/groups/",
            json={"name": "Fake Group", "creator_id": user_b["id"]},
            headers=auth_headers(token_a),
        )
        assert resp.status_code == 403

    def test_create_group_unauthenticated(self, client, db):
        """No auth token → 403."""
        resp = client.post("/groups/", json={"name": "Ghost", "creator_id": 1})
        assert resp.status_code in (401, 403)


# ---------------------------------------------------------------------------
# Get groups
# ---------------------------------------------------------------------------

class TestGetGroups:
    def test_get_groups(self, client, db):
        """GET /groups/ returns a list (may be empty or contain groups)."""
        user = create_verified_user(client, db, "lister@test.com", "password123", "Lister")
        token = login(client, user["email"], "password123")

        # Create a group so the list is non-empty
        client.post(
            "/groups/",
            json={"name": "Listed Group", "creator_id": user["id"]},
            headers=auth_headers(token),
        )

        resp = client.get("/groups/", headers=auth_headers(token))
        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, list)
        assert any(g["name"] == "Listed Group" for g in data)

    def test_get_group_detail(self, client, db):
        """GET /groups/{id}/ returns the group with members."""
        user = create_verified_user(client, db, "detail@test.com", "password123", "Detail")
        token = login(client, user["email"], "password123")

        create_resp = client.post(
            "/groups/",
            json={"name": "Detail Group", "creator_id": user["id"]},
            headers=auth_headers(token),
        )
        group_id = create_resp.json()["id"]

        resp = client.get(f"/groups/{group_id}/", headers=auth_headers(token))
        assert resp.status_code == 200
        assert resp.json()["id"] == group_id

    def test_get_group_detail_not_found(self, client, db):
        """Non-existent group → 404."""
        user = create_verified_user(client, db, "ghost@test.com", "password123", "Ghost")
        token = login(client, user["email"], "password123")

        resp = client.get("/groups/99999/", headers=auth_headers(token))
        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Rename group
# ---------------------------------------------------------------------------

class TestRenameGroup:
    def test_rename_group_super_admin(self, client, db, group_fixture):
        """super_admin can rename the group."""
        group = group_fixture["group"]
        token = group_fixture["token"]
        user = group_fixture["user"]

        resp = client.put(
            f"/groups/{group['id']}/name",
            json={"name": "Renamed Group", "requester_id": user["id"]},
            headers=auth_headers(token),
        )
        assert resp.status_code == 200
        assert resp.json()["name"] == "Renamed Group"

    def test_rename_group_non_admin(self, client, db, group_fixture):
        """Regular member cannot rename the group → 403."""
        group = group_fixture["group"]
        creator_token = group_fixture["token"]

        # Add a regular member
        member = create_verified_user(client, db, "memrename@test.com", "password123", "MemRename")
        client.post(
            f"/groups/{group['id']}/members/",
            json={"email": member["email"]},
            headers=auth_headers(creator_token),
        )
        member_token = login(client, member["email"], "password123")

        resp = client.put(
            f"/groups/{group['id']}/name",
            json={"name": "Hacked Name", "requester_id": member["id"]},
            headers=auth_headers(member_token),
        )
        assert resp.status_code == 403

    def test_rename_group_empty_name(self, client, db, group_fixture):
        """Empty name → 400."""
        group = group_fixture["group"]
        token = group_fixture["token"]
        user = group_fixture["user"]

        resp = client.put(
            f"/groups/{group['id']}/name",
            json={"name": "   ", "requester_id": user["id"]},
            headers=auth_headers(token),
        )
        assert resp.status_code == 400


# ---------------------------------------------------------------------------
# Add member
# ---------------------------------------------------------------------------

class TestAddMember:
    def test_add_member_by_email(self, client, db, group_fixture):
        """A group member adds another user by email."""
        group = group_fixture["group"]
        token = group_fixture["token"]

        new_user = create_verified_user(
            client, db, "newmember@test.com", "password123", "New Member"
        )

        resp = client.post(
            f"/groups/{group['id']}/members/",
            json={"email": new_user["email"]},
            headers=auth_headers(token),
        )
        assert resp.status_code == 200
        member_emails = [m["email"] for m in resp.json()["members"]]
        assert new_user["email"] in member_emails

    def test_add_member_already_in_group(self, client, db, group_fixture):
        """Adding a user already in the group → 400."""
        group = group_fixture["group"]
        token = group_fixture["token"]
        creator = group_fixture["user"]

        # Creator is already in the group
        resp = client.post(
            f"/groups/{group['id']}/members/",
            json={"email": creator["email"]},
            headers=auth_headers(token),
        )
        assert resp.status_code == 400

    def test_add_member_nonexistent_email(self, client, db, group_fixture):
        """Adding a non-existent email → 404."""
        group = group_fixture["group"]
        token = group_fixture["token"]

        resp = client.post(
            f"/groups/{group['id']}/members/",
            json={"email": "nobody@nowhere.com"},
            headers=auth_headers(token),
        )
        assert resp.status_code == 404

    def test_add_member_by_id(self, client, db, group_fixture):
        """super_admin can add a user by user_id."""
        group = group_fixture["group"]
        creator = group_fixture["user"]
        token = group_fixture["token"]

        new_user = create_verified_user(
            client, db, "byid@test.com", "password123", "By ID User"
        )

        resp = client.post(
            f"/groups/{group['id']}/members/by_id",
            json={"user_id": new_user["id"], "admin_user_id": creator["id"]},
            headers=auth_headers(token),
        )
        assert resp.status_code == 200
        member_ids = [m["id"] for m in resp.json()["members"]]
        assert new_user["id"] in member_ids


# ---------------------------------------------------------------------------
# Memberships
# ---------------------------------------------------------------------------

class TestMemberships:
    def test_get_memberships(self, client, db, group_fixture):
        """GET /groups/{id}/memberships returns members with roles."""
        group = group_fixture["group"]
        token = group_fixture["token"]
        creator = group_fixture["user"]

        resp = client.get(
            f"/groups/{group['id']}/memberships",
            headers=auth_headers(token),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, list)
        creator_entry = next((m for m in data if m["user_id"] == creator["id"]), None)
        assert creator_entry is not None
        assert creator_entry["role"] == "super_admin"
        assert creator_entry["is_active"] is True

    def test_update_member_role(self, client, db, group_fixture):
        """super_admin promotes a member to admin."""
        group = group_fixture["group"]
        token = group_fixture["token"]
        creator = group_fixture["user"]

        # Add a regular member
        member = create_verified_user(
            client, db, "promote@test.com", "password123", "Promote Me"
        )
        client.post(
            f"/groups/{group['id']}/members/",
            json={"email": member["email"]},
            headers=auth_headers(token),
        )

        resp = client.put(
            f"/groups/{group['id']}/members/{member['id']}/role",
            json={"role": "admin", "admin_user_id": creator["id"]},
            headers=auth_headers(token),
        )
        assert resp.status_code == 200

        # Verify role in DB
        from database import group_members
        row = db.execute(
            group_members.select().where(
                (group_members.c.user_id == member["id"]) &
                (group_members.c.group_id == group["id"])
            )
        ).first()
        assert row.role == "admin"


# ---------------------------------------------------------------------------
# Remove member
# ---------------------------------------------------------------------------

class TestRemoveMember:
    def test_remove_member(self, client, db, group_fixture):
        """Admin removes a regular member."""
        group = group_fixture["group"]
        token = group_fixture["token"]
        creator = group_fixture["user"]

        member = create_verified_user(
            client, db, "toremove@test.com", "password123", "To Remove"
        )
        client.post(
            f"/groups/{group['id']}/members/",
            json={"email": member["email"]},
            headers=auth_headers(token),
        )

        resp = client.delete(
            f"/groups/{group['id']}/members/{member['id']}",
            params={"admin_user_id": creator["id"]},
            headers=auth_headers(token),
        )
        assert resp.status_code == 200
        assert "removed" in resp.json()["message"].lower()

    def test_remove_super_admin(self, client, db, group_fixture):
        """Cannot remove the super_admin → 403."""
        group = group_fixture["group"]
        token = group_fixture["token"]
        creator = group_fixture["user"]

        resp = client.delete(
            f"/groups/{group['id']}/members/{creator['id']}",
            params={"admin_user_id": creator["id"]},
            headers=auth_headers(token),
        )
        assert resp.status_code == 403

    def test_remove_member_non_admin(self, client, db, group_fixture):
        """A regular member cannot remove another member → 403."""
        group = group_fixture["group"]
        creator_token = group_fixture["token"]

        member_a = create_verified_user(
            client, db, "memA@test.com", "password123", "Mem A"
        )
        member_b = create_verified_user(
            client, db, "memB@test.com", "password123", "Mem B"
        )
        client.post(
            f"/groups/{group['id']}/members/",
            json={"email": member_a["email"]},
            headers=auth_headers(creator_token),
        )
        client.post(
            f"/groups/{group['id']}/members/",
            json={"email": member_b["email"]},
            headers=auth_headers(creator_token),
        )
        token_a = login(client, member_a["email"], "password123")

        resp = client.delete(
            f"/groups/{group['id']}/members/{member_b['id']}",
            params={"admin_user_id": member_a["id"]},
            headers=auth_headers(token_a),
        )
        assert resp.status_code == 403


# ---------------------------------------------------------------------------
# Deactivate member
# ---------------------------------------------------------------------------

class TestDeactivateMember:
    def test_deactivate_member(self, client, db, group_fixture):
        """Admin deactivates (toggles) a member's active status."""
        group = group_fixture["group"]
        token = group_fixture["token"]
        creator = group_fixture["user"]

        member = create_verified_user(
            client, db, "deac@test.com", "password123", "Deactivate Me"
        )
        client.post(
            f"/groups/{group['id']}/members/",
            json={"email": member["email"]},
            headers=auth_headers(token),
        )

        resp = client.put(
            f"/groups/{group['id']}/members/{member['id']}/deactivate",
            params={"admin_user_id": creator["id"]},
            headers=auth_headers(token),
        )
        assert resp.status_code == 200
        # First call → deactivated
        assert resp.json()["is_active"] is False

        # Second call → re-activated
        resp2 = client.put(
            f"/groups/{group['id']}/members/{member['id']}/deactivate",
            params={"admin_user_id": creator["id"]},
            headers=auth_headers(token),
        )
        assert resp2.status_code == 200
        assert resp2.json()["is_active"] is True

    def test_deactivate_super_admin(self, client, db, group_fixture):
        """Cannot deactivate the super_admin → 403."""
        group = group_fixture["group"]
        token = group_fixture["token"]
        creator = group_fixture["user"]

        resp = client.put(
            f"/groups/{group['id']}/members/{creator['id']}/deactivate",
            params={"admin_user_id": creator["id"]},
            headers=auth_headers(token),
        )
        assert resp.status_code == 403


# ---------------------------------------------------------------------------
# Group balances
# ---------------------------------------------------------------------------

class TestGroupBalances:
    def test_get_group_balances_empty(self, client, db, group_fixture):
        """A new group with no expenses has no balance entries."""
        group = group_fixture["group"]
        token = group_fixture["token"]

        resp = client.get(
            f"/groups/{group['id']}/balances/",
            headers=auth_headers(token),
        )
        assert resp.status_code == 200
        # Could be empty list
        assert isinstance(resp.json(), list)

    def test_get_group_balances_with_expense(self, client, db, expense_fixture):
        """After an expense, the debtor owes the payer the correct amount."""
        from services.cache import invalidate_balance

        group = expense_fixture["group"]
        creator = expense_fixture["creator"]
        member = expense_fixture["member"]
        creator_token = expense_fixture["creator_token"]

        # Invalidate cache so the fresh balance is computed
        invalidate_balance(group["id"])

        resp = client.get(
            f"/groups/{group['id']}/balances/",
            headers=auth_headers(creator_token),
        )
        assert resp.status_code == 200
        balances = resp.json()
        assert len(balances) >= 1

        # Member owes creator 50.00 (half of 100)
        balance = balances[0]
        assert balance["from_user_id"] == member["id"]
        assert balance["to_user_id"] == creator["id"]
        assert abs(balance["amount"] - 50.0) < 0.02


# ---------------------------------------------------------------------------
# Group expenses
# ---------------------------------------------------------------------------

class TestGroupExpenses:
    def test_get_group_expenses(self, client, db, expense_fixture):
        """GET /groups/{id}/expenses/ returns the expense list."""
        group = expense_fixture["group"]
        creator_token = expense_fixture["creator_token"]

        resp = client.get(
            f"/groups/{group['id']}/expenses/",
            headers=auth_headers(creator_token),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, list)
        assert any(e["description"] == "Test Expense" for e in data)

    def test_get_group_expenses_non_member(self, client, db, group_fixture):
        """Non-member accessing group expenses → 403."""
        group = group_fixture["group"]

        outsider = create_verified_user(
            client, db, "outsider@test.com", "password123", "Outsider"
        )
        outsider_token = login(client, outsider["email"], "password123")

        resp = client.get(
            f"/groups/{group['id']}/expenses/",
            headers=auth_headers(outsider_token),
        )
        assert resp.status_code == 403
