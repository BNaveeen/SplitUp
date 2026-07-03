import os
import secrets
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from database import User, Group, PendingInvite, group_members
from routes.deps import get_db, get_current_user_id
from schemas import InviteRequest, InviteResponse
from services.helpers import _push_group_event
from services.subscription import require_feature

router = APIRouter()


@router.post("/invite/", response_model=InviteResponse)
def send_invite(
    req: InviteRequest,
    current_user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    if req.invited_by_id != current_user_id:
        raise HTTPException(status_code=403, detail="Forbidden")
    group = db.query(Group).filter(Group.id == req.group_id).first()
    if not group:
        raise HTTPException(status_code=404, detail="Group not found")
    require_feature(db, current_user_id, 'invite_link', upgrade_to='pro')
    inviter = db.query(User).filter(User.id == req.invited_by_id).first()
    if not inviter:
        raise HTTPException(status_code=404, detail="Inviting user not found")

    existing = db.query(PendingInvite).filter(
        PendingInvite.email == req.email,
        PendingInvite.group_id == req.group_id,
        PendingInvite.accepted == 0
    ).first()
    token = existing.token if existing else secrets.token_urlsafe(20)
    if not existing:
        invite = PendingInvite(
            email=req.email, phone=req.phone, group_id=req.group_id,
            invited_by_id=req.invited_by_id, token=token
        )
        db.add(invite)
        db.commit()
        db.refresh(invite)

    invite_link = f"http://localhost:5173/?invite={token}&email={req.email}"
    log_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), "invites.log")
    with open(log_path, "a", encoding="utf-8") as f:
        f.write("=" * 60 + "\n")
        f.write(f"INVITE SENT AT: {datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S UTC')}\n")
        f.write(f"TO EMAIL : {req.email}\n")
        if req.phone:
            f.write(f"TO PHONE : {req.phone}\n")
        f.write(f"FROM     : {inviter.name} ({inviter.email})\n")
        f.write(f"GROUP    : {group.name}\n")
        f.write(f"LINK     : {invite_link}\n\n")
        f.write("=" * 60 + "\n\n")

    return InviteResponse(
        id=0, email=req.email, phone=req.phone,
        group_name=group.name, invited_by_name=inviter.name,
        token=token,
        message=f"Invite sent to {req.email}" + (f" and {req.phone}" if req.phone else "")
    )


@router.get("/invite/{token}")
def get_invite(token: str, db: Session = Depends(get_db)):
    invite = db.query(PendingInvite).filter(PendingInvite.token == token).first()
    if not invite:
        raise HTTPException(status_code=404, detail="Invite not found or already used")
    return {
        "email": invite.email,
        "group_id": invite.group_id,
        "group_name": invite.group.name,
        "invited_by": invite.invited_by.name,
    }


@router.post("/invite/{token}/accept")
def accept_invite(
    token: str,
    user_id: int,
    current_user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    if user_id != current_user_id:
        raise HTTPException(status_code=403, detail="Forbidden")
    invite = db.query(PendingInvite).filter(
        PendingInvite.token == token, PendingInvite.accepted == 0
    ).first()
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
    _push_group_event(db, group.id)
    return {"message": f"Welcome to {group.name}!", "group_id": group.id}
