"""
tests/test_expenses.py — Tests for all /expenses routes.
"""

import pytest

from tests.conftest import (
    auth_headers,
    create_verified_user,
    login,
)


def _make_expense_payload(creator_id, payer_id, group_id, amount=100.0,
                          description="Lunch", split_pairs=None):
    """Build an ExpenseCreate JSON dict."""
    if split_pairs is None:
        split_pairs = [(creator_id, amount)]
    return {
        "description": description,
        "amount": amount,
        "payer_id": payer_id,
        "created_by_id": creator_id,
        "group_id": group_id,
        "splits": [{"user_id": uid, "amount": amt} for uid, amt in split_pairs],
    }


# ---------------------------------------------------------------------------
# Create expense
# ---------------------------------------------------------------------------

class TestCreateExpense:
    def test_create_expense_equal_split(self, client, db, expense_fixture):
        """
        A pre-built fixture already tests this path; we also verify the response
        shape here explicitly.
        """
        expense = expense_fixture["expense"]

        assert expense["description"] == "Test Expense"
        assert abs(expense["amount"] - 100.0) < 0.01
        assert expense["status"] == "active"
        split_ids = {s["user_id"] for s in expense["splits"]}
        assert expense_fixture["creator"]["id"] in split_ids
        assert expense_fixture["member"]["id"] in split_ids

    def test_create_expense_split_mismatch(self, client, db, group_fixture):
        """Splits that don't sum to the amount → 400."""
        group = group_fixture["group"]
        creator = group_fixture["user"]
        token = group_fixture["token"]

        resp = client.post(
            "/expenses/",
            json=_make_expense_payload(
                creator["id"], creator["id"], group["id"],
                amount=100.0,
                split_pairs=[(creator["id"], 60.0)],  # 60 ≠ 100
            ),
            headers=auth_headers(token),
        )
        assert resp.status_code == 400
        assert "split" in resp.json()["detail"].lower()

    def test_create_expense_wrong_creator(self, client, db, group_fixture):
        """created_by_id doesn't match the authenticated user → 403."""
        group = group_fixture["group"]
        creator = group_fixture["user"]
        token = group_fixture["token"]

        other = create_verified_user(client, db, "other@test.com", "password123", "Other")

        resp = client.post(
            "/expenses/",
            json=_make_expense_payload(
                other["id"], creator["id"], group["id"],
                split_pairs=[(other["id"], 100.0)],
            ),
            headers=auth_headers(token),
        )
        assert resp.status_code == 403

    def test_create_expense_nonexistent_group(self, client, db, group_fixture):
        """Group doesn't exist → 404."""
        creator = group_fixture["user"]
        token = group_fixture["token"]

        resp = client.post(
            "/expenses/",
            json=_make_expense_payload(
                creator["id"], creator["id"], 99999,
                split_pairs=[(creator["id"], 100.0)],
            ),
            headers=auth_headers(token),
        )
        assert resp.status_code == 404

    def test_create_expense_nonexistent_payer(self, client, db, group_fixture):
        """Payer user doesn't exist → 404."""
        group = group_fixture["group"]
        creator = group_fixture["user"]
        token = group_fixture["token"]

        resp = client.post(
            "/expenses/",
            json={
                "description": "Bad",
                "amount": 100.0,
                "payer_id": 99999,
                "created_by_id": creator["id"],
                "group_id": group["id"],
                "splits": [{"user_id": creator["id"], "amount": 100.0}],
            },
            headers=auth_headers(token),
        )
        assert resp.status_code == 404

    def test_create_expense_within_tolerance(self, client, db, group_fixture):
        """Splits within 0.02 tolerance of total are accepted."""
        group = group_fixture["group"]
        creator = group_fixture["user"]
        token = group_fixture["token"]

        member = create_verified_user(
            client, db, "tolmem@test.com", "password123", "Tol Mem"
        )
        client.post(
            f"/groups/{group['id']}/members/",
            json={"email": member["email"]},
            headers=auth_headers(token),
        )

        # 50.01 + 50.00 = 100.01, within 0.02 of 100.00
        resp = client.post(
            "/expenses/",
            json=_make_expense_payload(
                creator["id"], creator["id"], group["id"],
                amount=100.0,
                split_pairs=[(creator["id"], 50.01), (member["id"], 50.00)],
            ),
            headers=auth_headers(token),
        )
        assert resp.status_code == 200


# ---------------------------------------------------------------------------
# Update expense
# ---------------------------------------------------------------------------

class TestUpdateExpense:
    def test_update_expense(self, client, db, expense_fixture):
        """Creator updates description and amount."""
        expense = expense_fixture["expense"]
        creator = expense_fixture["creator"]
        creator_token = expense_fixture["creator_token"]
        member = expense_fixture["member"]

        resp = client.put(
            f"/expenses/{expense['id']}",
            json={
                "description": "Updated Lunch",
                "amount": 80.0,
                "payer_id": creator["id"],
                "created_by_id": creator["id"],
                "group_id": expense_fixture["group"]["id"],
                "splits": [
                    {"user_id": creator["id"], "amount": 40.0},
                    {"user_id": member["id"], "amount": 40.0},
                ],
            },
            headers=auth_headers(creator_token),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["description"] == "Updated Lunch"
        assert abs(data["amount"] - 80.0) < 0.01

    def test_update_expense_non_creator(self, client, db, expense_fixture):
        """Non-creator tries to update → 403."""
        expense = expense_fixture["expense"]
        member_token = expense_fixture["member_token"]
        member = expense_fixture["member"]
        creator = expense_fixture["creator"]

        resp = client.put(
            f"/expenses/{expense['id']}",
            json={
                "description": "Hacked",
                "amount": 100.0,
                "payer_id": creator["id"],
                "created_by_id": member["id"],
                "group_id": expense_fixture["group"]["id"],
                "splits": [
                    {"user_id": creator["id"], "amount": 50.0},
                    {"user_id": member["id"], "amount": 50.0},
                ],
            },
            headers=auth_headers(member_token),
        )
        assert resp.status_code == 403

    def test_update_expense_not_found(self, client, db, group_fixture):
        """Updating a non-existent expense → 404."""
        creator = group_fixture["user"]
        token = group_fixture["token"]

        resp = client.put(
            "/expenses/99999",
            json=_make_expense_payload(
                creator["id"], creator["id"], group_fixture["group"]["id"],
                split_pairs=[(creator["id"], 100.0)],
            ),
            headers=auth_headers(token),
        )
        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Delete expense
# ---------------------------------------------------------------------------

class TestDeleteExpense:
    def test_delete_expense_immediate(self, client, db, group_fixture):
        """
        Only the creator is involved (payer == creator, split only has creator)
        → immediate deletion.
        """
        group = group_fixture["group"]
        creator = group_fixture["user"]
        token = group_fixture["token"]

        # Create expense with only creator involved
        resp = client.post(
            "/expenses/",
            json=_make_expense_payload(
                creator["id"], creator["id"], group["id"],
                split_pairs=[(creator["id"], 100.0)],
            ),
            headers=auth_headers(token),
        )
        assert resp.status_code == 200
        expense_id = resp.json()["id"]

        del_resp = client.delete(
            f"/expenses/{expense_id}",
            params={"requester_id": creator["id"]},
            headers=auth_headers(token),
        )
        assert del_resp.status_code == 200
        assert "immediately" in del_resp.json()["message"].lower()

    def test_delete_expense_pending(self, client, db, expense_fixture):
        """
        Multiple users involved → goes to pending_deletion status.
        """
        expense = expense_fixture["expense"]
        creator = expense_fixture["creator"]
        creator_token = expense_fixture["creator_token"]

        del_resp = client.delete(
            f"/expenses/{expense['id']}",
            params={"requester_id": creator["id"]},
            headers=auth_headers(creator_token),
        )
        assert del_resp.status_code == 200
        assert "pending" in del_resp.json()["message"].lower() or \
               "deletion" in del_resp.json()["message"].lower()

    def test_delete_expense_non_creator(self, client, db, expense_fixture):
        """Non-creator cannot initiate deletion → 403."""
        expense = expense_fixture["expense"]
        member = expense_fixture["member"]
        member_token = expense_fixture["member_token"]

        resp = client.delete(
            f"/expenses/{expense['id']}",
            params={"requester_id": member["id"]},
            headers=auth_headers(member_token),
        )
        assert resp.status_code == 403

    def test_delete_expense_forbidden_requester_mismatch(self, client, db, expense_fixture):
        """requester_id != authenticated user → 403."""
        expense = expense_fixture["expense"]
        creator = expense_fixture["creator"]
        member = expense_fixture["member"]
        creator_token = expense_fixture["creator_token"]

        resp = client.delete(
            f"/expenses/{expense['id']}",
            params={"requester_id": member["id"]},  # mismatch: token is creator
            headers=auth_headers(creator_token),
        )
        assert resp.status_code == 403


# ---------------------------------------------------------------------------
# Deletion approval workflow
# ---------------------------------------------------------------------------

class TestDeletionApproval:
    def _initiate_deletion(self, client, expense, creator, creator_token):
        """Helper: kick off a deletion request for expense_fixture."""
        return client.delete(
            f"/expenses/{expense['id']}",
            params={"requester_id": creator["id"]},
            headers=auth_headers(creator_token),
        )

    def test_approve_deletion_all_approve(self, client, db, expense_fixture):
        """
        When all parties approve, expense moves to approved_for_deletion.
        """
        expense = expense_fixture["expense"]
        creator = expense_fixture["creator"]
        creator_token = expense_fixture["creator_token"]
        member = expense_fixture["member"]
        member_token = expense_fixture["member_token"]

        # Creator initiates deletion
        self._initiate_deletion(client, expense, creator, creator_token)

        # Member approves
        resp = client.post(
            f"/expenses/{expense['id']}/approve_deletion",
            params={"user_id": member["id"]},
            headers=auth_headers(member_token),
        )
        assert resp.status_code == 200
        # Both creator (auto-approved) and member approved → approved_for_deletion
        msg = resp.json()["message"].lower()
        assert "approved" in msg or "all" in msg

    def test_reject_deletion(self, client, db, expense_fixture):
        """Member rejects → expense goes back to active."""
        expense = expense_fixture["expense"]
        creator = expense_fixture["creator"]
        creator_token = expense_fixture["creator_token"]
        member = expense_fixture["member"]
        member_token = expense_fixture["member_token"]

        self._initiate_deletion(client, expense, creator, creator_token)

        resp = client.post(
            f"/expenses/{expense['id']}/reject_deletion",
            params={"user_id": member["id"]},
            headers=auth_headers(member_token),
        )
        assert resp.status_code == 200

        # Verify expense is back to active in DB
        from database import Expense as ExpenseModel
        db.expire_all()
        exp = db.query(ExpenseModel).filter(ExpenseModel.id == expense["id"]).first()
        assert exp.status == "active"

    def test_cancel_deletion_by_creator(self, client, db, expense_fixture):
        """Creator cancels a pending deletion → expense back to active."""
        expense = expense_fixture["expense"]
        creator = expense_fixture["creator"]
        creator_token = expense_fixture["creator_token"]

        self._initiate_deletion(client, expense, creator, creator_token)

        resp = client.post(
            f"/expenses/{expense['id']}/cancel_deletion",
            params={"user_id": creator["id"]},
            headers=auth_headers(creator_token),
        )
        assert resp.status_code == 200

        from database import Expense as ExpenseModel
        db.expire_all()
        exp = db.query(ExpenseModel).filter(ExpenseModel.id == expense["id"]).first()
        assert exp.status == "active"

    def test_cancel_deletion_not_pending(self, client, db, expense_fixture):
        """Cancelling a non-pending expense → 400."""
        expense = expense_fixture["expense"]
        creator = expense_fixture["creator"]
        creator_token = expense_fixture["creator_token"]

        # Expense is still active — cancel should fail
        resp = client.post(
            f"/expenses/{expense['id']}/cancel_deletion",
            params={"user_id": creator["id"]},
            headers=auth_headers(creator_token),
        )
        assert resp.status_code == 400

    def test_approve_deletion_wrong_user(self, client, db, expense_fixture, group_fixture):
        """A user not involved in the expense cannot approve → 404 (no approval row)."""
        expense = expense_fixture["expense"]
        creator = expense_fixture["creator"]
        creator_token = expense_fixture["creator_token"]

        self._initiate_deletion(client, expense, creator, creator_token)

        outsider = create_verified_user(
            client, db, "outsider_appr@test.com", "password123", "Outsider Appr"
        )
        outsider_token = login(client, outsider["email"], "password123")

        resp = client.post(
            f"/expenses/{expense['id']}/approve_deletion",
            params={"user_id": outsider["id"]},
            headers=auth_headers(outsider_token),
        )
        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Expense chat
# ---------------------------------------------------------------------------

class TestExpenseChat:
    def test_get_expense_chat_empty(self, client, db, expense_fixture):
        """New expense may have system messages but no user messages."""
        expense = expense_fixture["expense"]
        creator_token = expense_fixture["creator_token"]

        resp = client.get(
            f"/expenses/{expense['id']}/chat",
            headers=auth_headers(creator_token),
        )
        assert resp.status_code == 200
        assert isinstance(resp.json(), list)

    def test_post_expense_chat(self, client, db, expense_fixture):
        """User posts a chat message on an expense."""
        expense = expense_fixture["expense"]
        creator = expense_fixture["creator"]
        creator_token = expense_fixture["creator_token"]

        resp = client.post(
            f"/expenses/{expense['id']}/chat",
            json={"user_id": creator["id"], "text": "Who paid for this?", "mentions": []},
            headers=auth_headers(creator_token),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["text"] == "Who paid for this?"
        assert data["user_id"] == creator["id"]
        assert data["is_system"] == 0

    def test_post_expense_chat_wrong_user(self, client, db, expense_fixture):
        """Sending a chat message as a different user → 403."""
        expense = expense_fixture["expense"]
        member = expense_fixture["member"]
        creator = expense_fixture["creator"]
        member_token = expense_fixture["member_token"]

        resp = client.post(
            f"/expenses/{expense['id']}/chat",
            json={"user_id": creator["id"], "text": "Impersonating creator", "mentions": []},
            headers=auth_headers(member_token),
        )
        assert resp.status_code == 403

    def test_get_expense_chat_with_message(self, client, db, expense_fixture):
        """After posting, the message appears in GET /chat."""
        expense = expense_fixture["expense"]
        creator = expense_fixture["creator"]
        creator_token = expense_fixture["creator_token"]

        client.post(
            f"/expenses/{expense['id']}/chat",
            json={"user_id": creator["id"], "text": "Hello!", "mentions": []},
            headers=auth_headers(creator_token),
        )

        resp = client.get(
            f"/expenses/{expense['id']}/chat",
            headers=auth_headers(creator_token),
        )
        assert resp.status_code == 200
        messages = resp.json()
        user_msgs = [m for m in messages if m["is_system"] == 0]
        assert any(m["text"] == "Hello!" for m in user_msgs)
