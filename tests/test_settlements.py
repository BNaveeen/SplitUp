"""
tests/test_settlements.py — Tests for all /settlements routes.
"""

import pytest

from tests.conftest import (
    auth_headers,
    create_verified_user,
    login,
)


def _create_settlement(client, payer, payee, group_id, amount, payer_token,
                       expense_id=None):
    """Helper: POST /settlements/ and return the response."""
    payload = {
        "payer_id": payer["id"],
        "payee_id": payee["id"],
        "amount": amount,
        "group_id": group_id,
    }
    if expense_id is not None:
        payload["expense_id"] = expense_id
    return client.post(
        "/settlements/",
        json=payload,
        headers=auth_headers(payer_token),
    )


# ---------------------------------------------------------------------------
# Create settlement
# ---------------------------------------------------------------------------

class TestCreateSettlement:
    def test_create_settlement(self, client, db, expense_fixture):
        """Payer creates a settlement toward payee."""
        creator = expense_fixture["creator"]
        member = expense_fixture["member"]
        group = expense_fixture["group"]
        member_token = expense_fixture["member_token"]

        # Member (owes creator) initiates payment to creator
        resp = _create_settlement(
            client, member, creator, group["id"], 50.0, member_token
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["payer_id"] == member["id"]
        assert data["payee_id"] == creator["id"]
        assert abs(data["amount"] - 50.0) < 0.01
        assert data["status"] == "pending"

    def test_create_settlement_wrong_payer(self, client, db, expense_fixture):
        """payer_id doesn't match authenticated user → 403."""
        creator = expense_fixture["creator"]
        member = expense_fixture["member"]
        group = expense_fixture["group"]
        creator_token = expense_fixture["creator_token"]

        # creator token but payer_id is member → 403
        resp = client.post(
            "/settlements/",
            json={
                "payer_id": member["id"],
                "payee_id": creator["id"],
                "amount": 50.0,
                "group_id": group["id"],
            },
            headers=auth_headers(creator_token),
        )
        assert resp.status_code == 403

    def test_create_settlement_nonexistent_user(self, client, db, expense_fixture):
        """Payee doesn't exist → 404."""
        creator = expense_fixture["creator"]
        creator_token = expense_fixture["creator_token"]
        group = expense_fixture["group"]

        resp = client.post(
            "/settlements/",
            json={
                "payer_id": creator["id"],
                "payee_id": 99999,
                "amount": 50.0,
                "group_id": group["id"],
            },
            headers=auth_headers(creator_token),
        )
        assert resp.status_code == 404

    def test_create_duplicate_pending_settlement_for_expense(self, client, db, expense_fixture):
        """
        Creating a second pending settlement for the same expense → 400.
        """
        creator = expense_fixture["creator"]
        member = expense_fixture["member"]
        group = expense_fixture["group"]
        expense = expense_fixture["expense"]
        member_token = expense_fixture["member_token"]

        # First settlement
        _create_settlement(
            client, member, creator, group["id"], 50.0, member_token,
            expense_id=expense["id"]
        )

        # Second (duplicate) settlement for same expense
        resp = _create_settlement(
            client, member, creator, group["id"], 50.0, member_token,
            expense_id=expense["id"]
        )
        assert resp.status_code == 400


# ---------------------------------------------------------------------------
# Approve settlement
# ---------------------------------------------------------------------------

class TestApproveSettlement:
    def test_approve_settlement(self, client, db, expense_fixture):
        """Payee approves → status becomes 'approved'."""
        creator = expense_fixture["creator"]
        member = expense_fixture["member"]
        group = expense_fixture["group"]
        member_token = expense_fixture["member_token"]
        creator_token = expense_fixture["creator_token"]

        # Member pays creator
        s_resp = _create_settlement(
            client, member, creator, group["id"], 50.0, member_token
        )
        settlement_id = s_resp.json()["id"]

        # Creator (payee) approves
        resp = client.post(
            f"/settlements/{settlement_id}/approve",
            headers=auth_headers(creator_token),
        )
        assert resp.status_code == 200
        assert "approved" in resp.json()["message"].lower()

        # Verify in DB
        from database import Settlement
        db.expire_all()
        s = db.query(Settlement).filter(Settlement.id == settlement_id).first()
        assert s.status == "approved"

    def test_approve_settlement_wrong_user(self, client, db, expense_fixture):
        """Non-payee tries to approve → 403."""
        creator = expense_fixture["creator"]
        member = expense_fixture["member"]
        group = expense_fixture["group"]
        member_token = expense_fixture["member_token"]

        s_resp = _create_settlement(
            client, member, creator, group["id"], 50.0, member_token
        )
        settlement_id = s_resp.json()["id"]

        # Member is the payer, not payee — cannot approve own payment
        resp = client.post(
            f"/settlements/{settlement_id}/approve",
            headers=auth_headers(member_token),
        )
        assert resp.status_code == 403

    def test_approve_already_approved(self, client, db, expense_fixture):
        """Approving an already-approved settlement → 400."""
        creator = expense_fixture["creator"]
        member = expense_fixture["member"]
        group = expense_fixture["group"]
        member_token = expense_fixture["member_token"]
        creator_token = expense_fixture["creator_token"]

        s_resp = _create_settlement(
            client, member, creator, group["id"], 50.0, member_token
        )
        settlement_id = s_resp.json()["id"]

        client.post(
            f"/settlements/{settlement_id}/approve",
            headers=auth_headers(creator_token),
        )

        resp = client.post(
            f"/settlements/{settlement_id}/approve",
            headers=auth_headers(creator_token),
        )
        assert resp.status_code == 400


# ---------------------------------------------------------------------------
# Reject settlement
# ---------------------------------------------------------------------------

class TestRejectSettlement:
    def test_reject_settlement(self, client, db, expense_fixture):
        """Payee rejects → status becomes 'rejected'."""
        creator = expense_fixture["creator"]
        member = expense_fixture["member"]
        group = expense_fixture["group"]
        member_token = expense_fixture["member_token"]
        creator_token = expense_fixture["creator_token"]

        s_resp = _create_settlement(
            client, member, creator, group["id"], 50.0, member_token
        )
        settlement_id = s_resp.json()["id"]

        resp = client.post(
            f"/settlements/{settlement_id}/reject",
            headers=auth_headers(creator_token),
        )
        assert resp.status_code == 200
        assert "rejected" in resp.json()["message"].lower()

        from database import Settlement
        db.expire_all()
        s = db.query(Settlement).filter(Settlement.id == settlement_id).first()
        assert s.status == "rejected"

    def test_reject_settlement_wrong_user(self, client, db, expense_fixture):
        """Non-payee tries to reject → 403."""
        creator = expense_fixture["creator"]
        member = expense_fixture["member"]
        group = expense_fixture["group"]
        member_token = expense_fixture["member_token"]

        s_resp = _create_settlement(
            client, member, creator, group["id"], 50.0, member_token
        )
        settlement_id = s_resp.json()["id"]

        # Payer tries to reject own payment
        resp = client.post(
            f"/settlements/{settlement_id}/reject",
            headers=auth_headers(member_token),
        )
        assert resp.status_code == 403

    def test_reject_settlement_not_found(self, client, db, expense_fixture):
        """Non-existent settlement → 404."""
        creator_token = expense_fixture["creator_token"]
        resp = client.post(
            "/settlements/99999/reject",
            headers=auth_headers(creator_token),
        )
        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Pending / initiated settlements (user views)
# ---------------------------------------------------------------------------

class TestSettlementViews:
    def test_pending_settlements(self, client, db, expense_fixture):
        """Payee sees incoming pending settlements."""
        creator = expense_fixture["creator"]
        member = expense_fixture["member"]
        group = expense_fixture["group"]
        member_token = expense_fixture["member_token"]
        creator_token = expense_fixture["creator_token"]

        _create_settlement(
            client, member, creator, group["id"], 50.0, member_token
        )

        resp = client.get(
            f"/users/{creator['id']}/pending_settlements",
            headers=auth_headers(creator_token),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, list)
        assert any(s["payer_id"] == member["id"] for s in data)

    def test_initiated_settlements(self, client, db, expense_fixture):
        """Payer sees their sent settlements."""
        creator = expense_fixture["creator"]
        member = expense_fixture["member"]
        group = expense_fixture["group"]
        member_token = expense_fixture["member_token"]

        _create_settlement(
            client, member, creator, group["id"], 50.0, member_token
        )

        resp = client.get(
            f"/users/{member['id']}/initiated_settlements",
            headers=auth_headers(member_token),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert any(s["payee_id"] == creator["id"] for s in data)

    def test_pending_settlements_forbidden(self, client, db, expense_fixture):
        """User A cannot view user B's pending settlements → 403."""
        creator = expense_fixture["creator"]
        member_token = expense_fixture["member_token"]

        resp = client.get(
            f"/users/{creator['id']}/pending_settlements",
            headers=auth_headers(member_token),
        )
        assert resp.status_code == 403

    def test_initiated_settlements_forbidden(self, client, db, expense_fixture):
        """User A cannot view user B's initiated settlements → 403."""
        member = expense_fixture["member"]
        creator_token = expense_fixture["creator_token"]

        resp = client.get(
            f"/users/{member['id']}/initiated_settlements",
            headers=auth_headers(creator_token),
        )
        assert resp.status_code == 403

    def test_balance_updates_after_approval(self, client, db, expense_fixture):
        """
        After a settlement is approved the balance for the group reflects the
        change (member no longer owes as much).
        """
        from services.cache import invalidate_balance

        creator = expense_fixture["creator"]
        member = expense_fixture["member"]
        group = expense_fixture["group"]
        member_token = expense_fixture["member_token"]
        creator_token = expense_fixture["creator_token"]

        # Member pays full 50
        s_resp = _create_settlement(
            client, member, creator, group["id"], 50.0, member_token
        )
        settlement_id = s_resp.json()["id"]

        # Creator approves
        client.post(
            f"/settlements/{settlement_id}/approve",
            headers=auth_headers(creator_token),
        )

        # Invalidate cache so fresh calc happens
        invalidate_balance(group["id"])

        resp = client.get(
            f"/groups/{group['id']}/balances/",
            headers=auth_headers(creator_token),
        )
        assert resp.status_code == 200
        balances = resp.json()
        # After full settlement, no balance should remain (within floating-point tolerance)
        if balances:
            for b in balances:
                assert abs(b["amount"]) < 0.02
