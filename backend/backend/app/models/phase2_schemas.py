"""
backend/app/models/phase2_schemas.py

Pydantic v2 schemas for Phase 2 admin API endpoints.
No cross-imports with admin_schemas.py or schemas.py.
"""

from datetime import date, datetime
from decimal import Decimal
from typing import List, Optional
from pydantic import BaseModel, Field


# ── Token metrics ─────────────────────────────────────────────────────────────

class AgentBreakdown(BaseModel):
    agent_name:    str
    input_tokens:  int
    output_tokens: int
    cost_usd:      float
    call_count:    int
    pct_of_total:  float


class DailyTokenPoint(BaseModel):
    date:         str
    cost_usd:     float
    total_tokens: int


class TokenMetricsResponse(BaseModel):
    period_days:       int
    total_input_tokens:  int
    total_output_tokens: int
    total_cost_usd:    float
    by_agent:          List[AgentBreakdown]
    by_day:            List[DailyTokenPoint]


class TopConsumerItem(BaseModel):
    user_id:       int
    email:         str
    full_name:     Optional[str] = None
    total_tokens:  int
    total_cost_usd: float
    call_count:    int


class TopConsumersResponse(BaseModel):
    consumers: List[TopConsumerItem]
    period_days: int


# ── Activity metrics ──────────────────────────────────────────────────────────

class DailyActivityPoint(BaseModel):
    date:                       str
    active_users:               int
    new_signups:                int
    total_invoices_uploaded:    int
    total_recommendations:      int


class ActivityMetricsResponse(BaseModel):
    period_days: int
    data:        List[DailyActivityPoint]


# ── Anomaly alerts ────────────────────────────────────────────────────────────

class AnomalyAlertResponse(BaseModel):
    id:                   int
    alert_type:           str
    metric_date:          str
    actual_value:         float
    threshold_value:      float
    is_resolved:          bool
    resolved_by_admin_id: Optional[int]  = None
    resolved_at:          Optional[datetime] = None
    created_at:           datetime

    class Config:
        from_attributes = True


# ── Conversion tracking ───────────────────────────────────────────────────────

class ConversionEventItem(BaseModel):
    id:           int
    user_id:      int
    email:        str
    full_name:    Optional[str] = None
    event_type:   str
    from_tier:    str
    to_tier:      str
    triggered_by: Optional[str] = None
    created_at:   datetime

    class Config:
        from_attributes = True


class ConversionMetricsResponse(BaseModel):
    total_upgrades:       int
    total_downgrades:     int
    total_cancellations:  int
    conversion_rate_pct:  float
    events:               List[ConversionEventItem]


class CreateConversionRequest(BaseModel):
    user_id:      int
    event_type:   str = Field(..., pattern="^(upgraded|downgraded|cancelled)$")
    from_tier:    str
    to_tier:      str
    triggered_by: str = "admin_manual"


# ── User notes ────────────────────────────────────────────────────────────────

class UserNoteItem(BaseModel):
    id:          int
    user_id:     int
    admin_id:    Optional[int] = None
    admin_email: Optional[str] = None
    note:        str
    created_at:  datetime

    class Config:
        from_attributes = True


class UserNotesResponse(BaseModel):
    notes: List[UserNoteItem]
    total: int


class CreateNoteRequest(BaseModel):
    note: str = Field(..., min_length=5, description="Minimum 5 characters")


# ── Impersonation ─────────────────────────────────────────────────────────────

class ImpersonationResponse(BaseModel):
    impersonation_token: str
    user_id:             int
    user_email:          str
    expires_at:          datetime
