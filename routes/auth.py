from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import or_, and_
from sqlalchemy.orm import Session

from database import User, EmailVerification, PasswordReset
from routes.deps import get_db, hash_password, verify_password, create_access_token, get_current_user_id, limiter
from services.email import generate_otp, send_email, otp_email_html
from schemas import (
    UserRegister, UserLogin, UserResponse, TokenResponse,
    VerifyEmailRequest, ForgotPasswordRequest, ResetPasswordRequest, ChangePasswordRequest,
)

router = APIRouter()


@router.post("/register/")
@limiter.limit("10/minute")
def register_user(request: Request, user: UserRegister, db: Session = Depends(get_db)):
    normalized_email = user.email.strip().lower()
    existing = db.query(User).filter(User.email.ilike(normalized_email)).first()
    if existing:
        if existing.is_verified:
            raise HTTPException(status_code=400, detail="Email already registered")
        db.query(EmailVerification).filter(EmailVerification.email == normalized_email).delete()
    else:
        is_first = db.query(User).filter(User.is_verified == True).count() == 0
        hashed = hash_password(user.password)
        existing = User(name=user.name.strip(), email=normalized_email, password=hashed,
                        is_admin=is_first, is_verified=False)
        db.add(existing)
        db.flush()

    otp = generate_otp()
    ev = EmailVerification(
        email=normalized_email, otp=otp,
        expires_at=datetime.utcnow() + timedelta(minutes=10),
    )
    db.add(ev)
    db.commit()

    sent = send_email(
        normalized_email,
        "Verify your SplitUp account",
        otp_email_html(otp, "Use this code to verify your email address and activate your account."),
    )
    return {"message": "verification_required", "email": normalized_email, "email_sent": sent}


@router.post("/verify-email/", response_model=TokenResponse)
@limiter.limit("20/minute")
def verify_email(request: Request, body: VerifyEmailRequest, db: Session = Depends(get_db)):
    email = body.email.strip().lower()
    ev = (db.query(EmailVerification)
          .filter(EmailVerification.email == email, EmailVerification.used == False)
          .order_by(EmailVerification.created_at.desc())
          .first())
    if not ev or ev.otp != body.otp.strip() or datetime.utcnow() > ev.expires_at:
        raise HTTPException(status_code=400, detail="Invalid or expired code")

    ev.used = True
    db_user = db.query(User).filter(User.email == email).first()
    if not db_user:
        raise HTTPException(status_code=404, detail="Account not found")
    db_user.is_verified = True
    db.commit()
    db.refresh(db_user)
    token = create_access_token(db_user.id)
    return TokenResponse(access_token=token, user=UserResponse.model_validate(db_user))


@router.post("/resend-verification/")
@limiter.limit("5/minute")
def resend_verification(request: Request, body: ForgotPasswordRequest, db: Session = Depends(get_db)):
    email = body.email.strip().lower()
    db_user = db.query(User).filter(User.email == email).first()
    if not db_user or db_user.is_verified:
        return {"message": "ok"}

    db.query(EmailVerification).filter(EmailVerification.email == email).delete()
    otp = generate_otp()
    db.add(EmailVerification(email=email, otp=otp,
                             expires_at=datetime.utcnow() + timedelta(minutes=10)))
    db.commit()
    send_email(email, "Your SplitUp verification code",
               otp_email_html(otp, "Use this code to verify your email address."))
    return {"message": "ok"}


@router.post("/login/", response_model=TokenResponse)
@limiter.limit("20/minute")
def login_user(request: Request, user: UserLogin, db: Session = Depends(get_db)):
    login_email = user.email.strip().lower()
    # Allow login with primary email OR any verified linked email
    db_user = db.query(User).filter(
        or_(
            User.email.ilike(login_email),
            and_(User.personal_email.isnot(None), User.personal_email.ilike(login_email), User.personal_email_verified == True),
            and_(User.work_email.isnot(None), User.work_email.ilike(login_email), User.work_email_verified == True),
        )
    ).first()
    if not db_user or not verify_password(user.password, db_user.password):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    if not db_user.is_verified:
        raise HTTPException(status_code=403,
                            detail="Email not verified. Check your inbox for the verification code.")
    token = create_access_token(db_user.id)
    return TokenResponse(access_token=token, user=UserResponse.model_validate(db_user))


@router.post("/forgot-password/")
@limiter.limit("5/minute")
def forgot_password(request: Request, body: ForgotPasswordRequest, db: Session = Depends(get_db)):
    email = body.email.strip().lower()
    db_user = db.query(User).filter(User.email == email).first()
    if db_user and db_user.is_verified:
        db.query(PasswordReset).filter(PasswordReset.email == email).delete()
        otp = generate_otp()
        db.add(PasswordReset(email=email, otp=otp,
                             expires_at=datetime.utcnow() + timedelta(minutes=10)))
        db.commit()
        send_email(email, "Reset your SplitUp password",
                   otp_email_html(otp, "Use this code to reset your password."))
    return {"message": "ok"}


@router.post("/reset-password/")
@limiter.limit("10/minute")
def reset_password(request: Request, body: ResetPasswordRequest, db: Session = Depends(get_db)):
    email = body.email.strip().lower()
    pr = (db.query(PasswordReset)
          .filter(PasswordReset.email == email, PasswordReset.used == False)
          .order_by(PasswordReset.created_at.desc())
          .first())
    if not pr or pr.otp != body.otp.strip() or datetime.utcnow() > pr.expires_at:
        raise HTTPException(status_code=400, detail="Invalid or expired code")
    if len(body.new_password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters")

    pr.used = True
    db_user = db.query(User).filter(User.email == email).first()
    if not db_user:
        raise HTTPException(status_code=404, detail="Account not found")
    db_user.password = hash_password(body.new_password)
    db.commit()
    return {"message": "Password reset successfully"}


@router.put("/users/{user_id}/change-password")
@limiter.limit("10/minute")
def change_password(
    request: Request,
    user_id: int,
    body: ChangePasswordRequest,
    current_user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    if current_user_id != user_id:
        raise HTTPException(status_code=403, detail="Cannot change another user's password")
    db_user = db.query(User).filter(User.id == user_id).first()
    if not db_user or not verify_password(body.current_password, db_user.password):
        raise HTTPException(status_code=401, detail="Current password is incorrect")
    if len(body.new_password) < 6:
        raise HTTPException(status_code=400, detail="New password must be at least 6 characters")
    db_user.password = hash_password(body.new_password)
    db.commit()
    return {"message": "Password changed successfully"}
