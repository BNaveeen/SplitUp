"""
tests/test_auth.py — Tests for all /auth routes.
"""

from datetime import datetime, timedelta

import pytest

from tests.conftest import (
    auth_headers,
    create_verified_user,
    login,
)


# ---------------------------------------------------------------------------
# Registration
# ---------------------------------------------------------------------------

class TestRegister:
    def test_register_new_user(self, client):
        """A fresh registration returns verification_required."""
        resp = client.post(
            "/register/",
            json={"name": "Alice", "email": "alice@test.com", "password": "password123"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["message"] == "verification_required"
        assert data["email"] == "alice@test.com"

    def test_register_duplicate_verified(self, client, db):
        """Registering an already-verified email returns HTTP 400."""
        create_verified_user(client, db, "dup@test.com", "password123", "Dup User")
        resp = client.post(
            "/register/",
            json={"name": "Dup Again", "email": "dup@test.com", "password": "password123"},
        )
        assert resp.status_code == 400
        assert "already registered" in resp.json()["detail"].lower()

    def test_register_duplicate_unverified(self, client):
        """
        Registering the same email when the first registration is still
        unverified should succeed (resend OTP path) and return 200.
        """
        # First register (leaves user unverified)
        client.post(
            "/register/",
            json={"name": "Unverified", "email": "unver@test.com", "password": "password123"},
        )
        # Second register with same email
        resp = client.post(
            "/register/",
            json={"name": "Unverified", "email": "unver@test.com", "password": "password123"},
        )
        assert resp.status_code == 200
        assert resp.json()["message"] == "verification_required"

    def test_register_short_password(self, client):
        """Password shorter than 8 chars should be rejected by schema validation."""
        resp = client.post(
            "/register/",
            json={"name": "Short", "email": "short@test.com", "password": "abc"},
        )
        # Pydantic validator fires → 422
        assert resp.status_code == 422

    def test_register_blank_name(self, client):
        """A whitespace-only name should fail schema validation."""
        resp = client.post(
            "/register/",
            json={"name": "   ", "email": "blank@test.com", "password": "password123"},
        )
        assert resp.status_code == 422


# ---------------------------------------------------------------------------
# Email verification
# ---------------------------------------------------------------------------

class TestVerifyEmail:
    def test_verify_email_valid_otp(self, client, db):
        """After registration, injecting correct OTP → token returned."""
        from database import EmailVerification

        email = "verify@test.com"
        client.post(
            "/register/",
            json={"name": "Verify", "email": email, "password": "password123"},
        )

        # Read the OTP directly from the DB
        ev = db.query(EmailVerification).filter(
            EmailVerification.email == email,
            EmailVerification.used == False,  # noqa: E712
        ).first()
        assert ev is not None

        resp = client.post(
            "/verify-email/",
            json={"email": email, "otp": ev.otp},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "access_token" in data
        assert data["user"]["email"] == email

    def test_verify_email_wrong_otp(self, client):
        """Wrong OTP → 400."""
        email = "wrong_otp@test.com"
        client.post(
            "/register/",
            json={"name": "WrongOtp", "email": email, "password": "password123"},
        )
        resp = client.post("/verify-email/", json={"email": email, "otp": "000000"})
        assert resp.status_code == 400
        assert "invalid" in resp.json()["detail"].lower()

    def test_verify_email_expired_otp(self, client, db):
        """Expired OTP (past expires_at) → 400."""
        from database import EmailVerification

        email = "expired@test.com"
        client.post(
            "/register/",
            json={"name": "Expired", "email": email, "password": "password123"},
        )

        # Expire the OTP
        ev = db.query(EmailVerification).filter(
            EmailVerification.email == email,
            EmailVerification.used == False,  # noqa: E712
        ).first()
        otp_value = ev.otp
        ev.expires_at = datetime.utcnow() - timedelta(minutes=1)
        db.commit()

        resp = client.post("/verify-email/", json={"email": email, "otp": otp_value})
        assert resp.status_code == 400


# ---------------------------------------------------------------------------
# Login
# ---------------------------------------------------------------------------

class TestLogin:
    def test_login_success(self, client, db):
        """A verified user can log in and receive a token."""
        create_verified_user(client, db, "login@test.com", "password123", "Login User")
        resp = client.post(
            "/login/", json={"email": "login@test.com", "password": "password123"}
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "access_token" in data
        assert data["user"]["email"] == "login@test.com"

    def test_login_unverified(self, client):
        """An unverified user receives HTTP 403."""
        client.post(
            "/register/",
            json={"name": "Unver", "email": "unver2@test.com", "password": "password123"},
        )
        resp = client.post(
            "/login/", json={"email": "unver2@test.com", "password": "password123"}
        )
        assert resp.status_code == 403
        assert "not verified" in resp.json()["detail"].lower()

    def test_login_wrong_password(self, client, db):
        """Wrong password → 401."""
        create_verified_user(client, db, "wrongpw@test.com", "password123", "WrongPw")
        resp = client.post(
            "/login/", json={"email": "wrongpw@test.com", "password": "wrongpassword"}
        )
        assert resp.status_code == 401

    def test_login_nonexistent_user(self, client):
        """Unknown email → 401 (same response as wrong password)."""
        resp = client.post(
            "/login/", json={"email": "nobody@test.com", "password": "password123"}
        )
        assert resp.status_code == 401

    def test_login_case_insensitive_email(self, client, db):
        """Login should accept mixed-case version of the email."""
        create_verified_user(client, db, "case@test.com", "password123", "Case User")
        resp = client.post(
            "/login/", json={"email": "CASE@TEST.COM", "password": "password123"}
        )
        assert resp.status_code == 200


# ---------------------------------------------------------------------------
# Forgot / Reset password
# ---------------------------------------------------------------------------

class TestPasswordReset:
    def test_forgot_password_silent(self, client, db):
        """
        /forgot-password/ always returns 200 regardless of whether the
        email exists (security: no user enumeration).
        """
        create_verified_user(client, db, "forgot@test.com", "password123", "Forgot User")

        # Existing email
        resp1 = client.post("/forgot-password/", json={"email": "forgot@test.com"})
        assert resp1.status_code == 200
        assert resp1.json()["message"] == "ok"

        # Non-existent email
        resp2 = client.post("/forgot-password/", json={"email": "ghost@test.com"})
        assert resp2.status_code == 200
        assert resp2.json()["message"] == "ok"

    def test_reset_password_success(self, client, db):
        """Create a PasswordReset OTP in the DB → reset → login with new password."""
        from database import PasswordReset

        email = "reset@test.com"
        create_verified_user(client, db, email, "oldpass1", "Reset User")

        # Simulate forgot-password (creates the OTP row)
        client.post("/forgot-password/", json={"email": email})

        pr = db.query(PasswordReset).filter(
            PasswordReset.email == email,
            PasswordReset.used == False,  # noqa: E712
        ).first()
        assert pr is not None

        resp = client.post(
            "/reset-password/",
            json={"email": email, "otp": pr.otp, "new_password": "newpass1"},
        )
        assert resp.status_code == 200

        # Login with new password
        login_resp = client.post(
            "/login/", json={"email": email, "password": "newpass1"}
        )
        assert login_resp.status_code == 200

    def test_reset_password_wrong_otp(self, client, db):
        """Wrong OTP → 400."""
        email = "badotp@test.com"
        create_verified_user(client, db, email, "password123", "BadOtp")
        client.post("/forgot-password/", json={"email": email})

        resp = client.post(
            "/reset-password/",
            json={"email": email, "otp": "000000", "new_password": "newpass1"},
        )
        assert resp.status_code == 400

    def test_reset_password_too_short(self, client, db):
        """New password shorter than 6 chars → 400."""
        from database import PasswordReset

        email = "short_reset@test.com"
        create_verified_user(client, db, email, "password123", "ShortReset")
        client.post("/forgot-password/", json={"email": email})

        pr = db.query(PasswordReset).filter(
            PasswordReset.email == email,
            PasswordReset.used == False,  # noqa: E712
        ).first()
        assert pr is not None

        resp = client.post(
            "/reset-password/",
            json={"email": email, "otp": pr.otp, "new_password": "abc"},
        )
        assert resp.status_code == 400


# ---------------------------------------------------------------------------
# Change password
# ---------------------------------------------------------------------------

class TestChangePassword:
    def test_change_password_success(self, client, db):
        """Authenticated user changes their own password."""
        user = create_verified_user(client, db, "chpw@test.com", "oldpass1", "ChPw")
        token = login(client, user["email"], "oldpass1")

        resp = client.put(
            f"/users/{user['id']}/change-password",
            json={"current_password": "oldpass1", "new_password": "newpass1"},
            headers=auth_headers(token),
        )
        assert resp.status_code == 200

        # Old password should no longer work
        bad = client.post("/login/", json={"email": user["email"], "password": "oldpass1"})
        assert bad.status_code == 401

        # New password works
        good = client.post("/login/", json={"email": user["email"], "password": "newpass1"})
        assert good.status_code == 200

    def test_change_password_wrong_current(self, client, db):
        """Wrong current password → 401."""
        user = create_verified_user(client, db, "wrongcur@test.com", "password123", "WrongCur")
        token = login(client, user["email"], "password123")

        resp = client.put(
            f"/users/{user['id']}/change-password",
            json={"current_password": "notmypassword", "new_password": "newpass1"},
            headers=auth_headers(token),
        )
        assert resp.status_code == 401

    def test_change_password_wrong_user(self, client, db):
        """User A cannot change user B's password → 403."""
        user_a = create_verified_user(client, db, "usera@test.com", "password123", "User A")
        user_b = create_verified_user(client, db, "userb@test.com", "password123", "User B")
        token_a = login(client, user_a["email"], "password123")

        resp = client.put(
            f"/users/{user_b['id']}/change-password",
            json={"current_password": "password123", "new_password": "newpass1"},
            headers=auth_headers(token_a),
        )
        assert resp.status_code == 403

    def test_change_password_unauthenticated(self, client, db):
        """No token → 403 (HTTPBearer raises 403 when no credentials)."""
        user = create_verified_user(client, db, "noauth@test.com", "password123", "NoAuth")
        resp = client.put(
            f"/users/{user['id']}/change-password",
            json={"current_password": "password123", "new_password": "newpass1"},
        )
        assert resp.status_code in (401, 403)

    def test_change_password_new_too_short(self, client, db):
        """New password < 6 chars → 400."""
        user = create_verified_user(client, db, "short2@test.com", "password123", "Short2")
        token = login(client, user["email"], "password123")

        resp = client.put(
            f"/users/{user['id']}/change-password",
            json={"current_password": "password123", "new_password": "ab"},
            headers=auth_headers(token),
        )
        assert resp.status_code == 400
