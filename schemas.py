from typing import List, Optional
from pydantic import BaseModel, field_validator


class UserRegister(BaseModel):
    name: str
    email: str
    password: str

    @field_validator("password")
    @classmethod
    def password_strength(cls, v: str) -> str:
        if len(v) < 8:
            raise ValueError("Password must be at least 8 characters")
        return v

    @field_validator("name")
    @classmethod
    def name_not_empty(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("Name cannot be empty")
        return v.strip()


class UserLogin(BaseModel):
    email: str
    password: str


class UserResponse(BaseModel):
    id: int
    name: str
    email: str
    is_admin: bool = False

    class Config:
        from_attributes = True


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserResponse


class UserUpdate(BaseModel):
    name: str


class VerifyEmailRequest(BaseModel):
    email: str
    otp: str


class ForgotPasswordRequest(BaseModel):
    email: str


class ResetPasswordRequest(BaseModel):
    email: str
    otp: str
    new_password: str


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str


class GroupCreate(BaseModel):
    name: str
    creator_id: int


class GroupRenameRequest(BaseModel):
    name: str
    requester_id: int


class GroupResponse(BaseModel):
    id: int
    name: str

    class Config:
        from_attributes = True


class GroupDetailResponse(BaseModel):
    id: int
    name: str
    members: List[UserResponse]

    class Config:
        from_attributes = True


class AddMemberRequest(BaseModel):
    email: str


class AddMemberByIdRequest(BaseModel):
    user_id: int
    admin_user_id: int


class MembershipResponse(BaseModel):
    user_id: int
    user_name: str
    user_email: str
    role: str
    is_active: bool
    has_transactions: bool = False


class UpdateRoleRequest(BaseModel):
    role: str
    admin_user_id: int


class SplitCreate(BaseModel):
    user_id: int
    amount: float


class ExpenseCreate(BaseModel):
    description: str
    amount: float
    payer_id: int
    created_by_id: int
    group_id: Optional[int] = None
    date: Optional[str] = None
    splits: List[SplitCreate]
    receipt_image: Optional[str] = None
    category: Optional[str] = None
    recurrence: Optional[str] = None   # null | 'weekly' | 'monthly' | 'yearly'


class SplitResponse(BaseModel):
    user_id: int
    amount: float
    user_name: str

    class Config:
        from_attributes = True


class ApprovalResponse(BaseModel):
    user_id: int
    user_name: str
    approved: int


class SettlementStatusEntry(BaseModel):
    user_id: int
    user_name: str
    amount: float
    status: str


class ExpenseResponse(BaseModel):
    id: int
    description: str
    amount: float
    payer_id: int
    payer_name: str
    created_by_id: int
    created_by_name: str
    status: str
    group_id: Optional[int]
    date: Optional[str]
    splits: List[SplitResponse]
    approvals: List[ApprovalResponse] = []
    last_message_at: Optional[str] = None
    last_message_text: Optional[str] = None
    created_at: Optional[str] = None
    settlement_statuses: List[SettlementStatusEntry] = []
    receipt_image: Optional[str] = None
    category: Optional[str] = None
    recurrence: Optional[str] = None
    next_due: Optional[str] = None

    class Config:
        from_attributes = True


class ExpenseMessageCreate(BaseModel):
    user_id: int
    text: str
    mentions: Optional[List[int]] = []


class ExpenseMessageResponse(BaseModel):
    id: int
    user_id: int
    user_name: str
    text: str
    is_system: int
    created_at: str

    class Config:
        from_attributes = True


class SettlementCreate(BaseModel):
    payer_id: int
    payee_id: int
    amount: float
    group_id: Optional[int] = None
    expense_id: Optional[int] = None


class SettlementResponse(BaseModel):
    id: int
    payer_id: int
    payer_name: Optional[str] = None
    payee_id: int
    payee_name: Optional[str] = None
    amount: float
    group_id: Optional[int]
    expense_id: Optional[int]
    status: str
    created_at: str

    class Config:
        from_attributes = True


class BalanceEntry(BaseModel):
    from_user_id: int
    from_user_name: str
    to_user_id: int
    to_user_name: str
    amount: float


class NotificationResponse(BaseModel):
    id: int
    user_id: int
    message: str
    group_id: Optional[int] = None
    expense_id: Optional[int] = None
    is_read: int
    created_at: str

    class Config:
        from_attributes = True


class InviteRequest(BaseModel):
    email: str
    phone: Optional[str] = None
    group_id: int
    invited_by_id: int


class InviteResponse(BaseModel):
    id: int
    email: str
    phone: Optional[str]
    group_name: str
    invited_by_name: str
    token: str
    message: str
