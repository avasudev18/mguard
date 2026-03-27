"""
backend/app/models/admin_schemas.py

Pydantic v2 schemas for the admin API.
Completely separate from app.models.schemas — no cross-imports.
"""

from datetime import datetime
from typing import Optional, List
from pydantic import BaseModel, EmailStr, Field


# ── Auth ──────────────────────────────────────────────────────────────────────

class AdminLoginRequest(BaseModel):
    email: EmailStr
    password: str


class AdminTotpVerifyRequest(BaseModel):
    pre_auth_token: str   # short-lived token issued after password check
    totp_code: str = Field(..., min_length=6, max_length=6)


class AdminTokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    admin: "AdminResponse"


class AdminResponse(BaseModel):
    id: int
    email: str
    role: str
    created_at: datetime
    last_login: Optional[datetime] = None

    class Config:
        from_attributes = True


class TotpSetupResponse(BaseModel):
    totp_uri: str    # otpauth:// URI — pass to qrcode library or display as text
    secret: str      # base32 secret for manual entry in authenticator apps


# ── Metrics ───────────────────────────────────────────────────────────────────

class OverviewMetrics(BaseModel):
    total_users: int
    active_users: int
    premium_users: int
    free_users: int
    disabled_users: int
    total_vehicles: int
    total_invoices: int
    total_recommendations: int


class DailyCostPoint(BaseModel):
    date: str
    total_tokens: int
    estimated_cost_usd: float


class CostMetricsResponse(BaseModel):
    period_days: int
    total_cost_usd: float
    cost_per_active_user: float
    target_cost_per_user: float = 0.38
    daily_breakdown: List[DailyCostPoint]


# ── User management ───────────────────────────────────────────────────────────

class AdminUserListItem(BaseModel):
    id: int
    email: str
    full_name: Optional[str] = None
    subscription_tier: str
    status: str
    vehicle_count: int
    invoice_count: int
    last_active_at: Optional[datetime] = None
    created_at: datetime
    disabled_at: Optional[datetime] = None
    disabled_reason: Optional[str] = None

    class Config:
        from_attributes = True


class AdminUserListResponse(BaseModel):
    users: List[AdminUserListItem]
    total: int
    page: int
    per_page: int


class AdminUserDetail(AdminUserListItem):
    """Full user detail — same as list item but may grow independently."""
    pass


class DisableUserRequest(BaseModel):
    reason: str = Field(..., min_length=5, description="Reason is required (min 5 chars)")


class EnableUserRequest(BaseModel):
    reason: Optional[str] = None


class DeleteUserRequest(BaseModel):
    confirm_text: str = Field(..., description='Must equal the string "DELETE"')


# ── Audit log ────────────────────────────────────────────────────────────────

class AuditLogItem(BaseModel):
    id: int
    admin_id: int
    admin_email: str
    action_type: str
    target_user_id: Optional[int] = None
    target_user_email: Optional[str] = None
    reason: Optional[str] = None
    timestamp: datetime
    ip_address: Optional[str] = None

    class Config:
        from_attributes = True


class AuditLogResponse(BaseModel):
    actions: List[AuditLogItem]
    total: int


# ── Admin account management (super_admin only) ───────────────────────────────

class CreateAdminRequest(BaseModel):
    email: EmailStr
    password: str = Field(..., min_length=8, description="Minimum 8 characters")
    role: str = Field(default="support_admin", pattern="^(super_admin|support_admin)$")


class UpdateAdminRequest(BaseModel):
    """Partial update — only fields provided are changed."""
    role: Optional[str] = Field(default=None, pattern="^(super_admin|support_admin)$")
    password: Optional[str] = Field(default=None, min_length=8)


class AdminListItem(BaseModel):
    id: int
    email: str
    role: str
    created_at: datetime
    last_login: Optional[datetime] = None

    class Config:
        from_attributes = True


class AdminListResponse(BaseModel):
    admins: List[AdminListItem]
    total: int


class DeleteAdminRequest(BaseModel):
    confirm_text: str = Field(..., description='Must equal the string "DELETE"')
