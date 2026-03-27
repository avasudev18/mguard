from pydantic import BaseModel, Field, field_validator, EmailStr
from typing import Optional, List, Any, Literal
from datetime import datetime
import re


# ── Auth / User Schemas ────────────────────────────────────────────────────────

class UserSignup(BaseModel):
    email: EmailStr
    password: str = Field(..., min_length=8, description="Minimum 8 characters")
    full_name: str = Field(..., min_length=1, max_length=255, description="Full name is required")

    @field_validator("password")
    @classmethod
    def password_strength(cls, v: str) -> str:
        if not any(c.isdigit() for c in v):
            raise ValueError("Password must contain at least one number")
        return v


class UserLogin(BaseModel):
    email: EmailStr
    password: str


class UserResponse(BaseModel):
    id: int
    email: str
    full_name: Optional[str] = None
    subscription_tier: str
    status: str
    created_at: datetime

    class Config:
        from_attributes = True


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserResponse


# ── Vehicle Schemas ────────────────────────────────────────────────────────────

class VehicleBase(BaseModel):
    year: int = Field(..., ge=1900, le=2030)
    make: str
    model: str
    trim: Optional[str] = None
    vin: Optional[str] = Field(None, min_length=17, max_length=17)
    nickname: Optional[str] = Field(None, max_length=100)
    current_mileage: Optional[int] = Field(None, ge=0)
    driving_condition: str = 'normal'
    # Exposed in VehicleResponse so the frontend can initialise UI state
    # from the stored value without a separate API call.

    @field_validator('vin')
    @classmethod
    def validate_vin(cls, v):
        if v is None:
            return v
        v = v.upper().strip()
        if not re.match(r'^[A-HJ-NPR-Z0-9]{17}$', v):
            raise ValueError('VIN must be 17 characters and contain only valid characters (no I, O, or Q)')
        return v

class VehicleCreate(VehicleBase):
    pass

class VehicleUpdate(BaseModel):
    current_mileage: Optional[int] = Field(None, ge=0)
    nickname: Optional[str] = Field(None, max_length=100)
    vin: Optional[str] = Field(None, min_length=17, max_length=17)
    driving_condition: Optional[Literal['normal', 'severe']] = None
    # Optional — omitting it leaves the stored value unchanged.
    # Literal['normal','severe'] means FastAPI returns 422 for any other string,
    # preventing silent fallback to normal-condition OEM rows.

    @field_validator('vin')
    @classmethod
    def validate_vin(cls, v):
        if v is None:
            return v
        v = v.upper().strip()
        if not re.match(r'^[A-HJ-NPR-Z0-9]{17}$', v):
            raise ValueError('VIN must be 17 characters and contain only valid characters (no I, O, or Q)')
        return v

class VehicleResponse(VehicleBase):
    id: int
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


# ── Invoice Schemas ────────────────────────────────────────────────────────────

class InvoiceLineItemBase(BaseModel):
    service_type: str
    service_description: Optional[str] = Field(None, max_length=500)
    quantity: float = 1.0
    unit_price: Optional[float] = None
    line_total: Optional[float] = None
    is_labor: bool = False
    is_parts: bool = False
    is_complimentary: bool = False  # True = explicitly free/courtesy per invoice

class InvoiceLineItemResponse(InvoiceLineItemBase):
    id: int
    invoice_id: int
    created_at: datetime
    is_disputed: bool = False   # True if this line item is part of an open dispute

    class Config:
        from_attributes = True

class InvoiceBase(BaseModel):
    service_date: Optional[datetime] = None
    mileage_at_service: Optional[int] = None
    shop_name: Optional[str] = Field(None, max_length=200)
    shop_address: Optional[str] = Field(None, max_length=500)
    total_amount: Optional[float] = None

class InvoiceCreate(InvoiceBase):
    vehicle_id: int

class InvoiceConfirm(InvoiceBase):
    line_items: List[InvoiceLineItemBase]
    force_vin_override: bool = False  # allows bypassing VIN mismatch check on confirm

class InvoiceResponse(InvoiceBase):
    id: int
    vehicle_id: int
    filename: str
    is_confirmed: bool
    is_duplicate: bool
    dispute_status: Optional[str] = None
    is_archived: bool = False
    dispute_raised_at: Optional[datetime] = None
    dispute_resolved_at: Optional[datetime] = None
    dispute_confirmed_by: Optional[str] = None
    dispute_notes: Optional[str] = Field(None, max_length=2000)
    created_at: datetime
    line_items: List[InvoiceLineItemResponse] = []
    extraction_data: Optional[dict] = None

    class Config:
        from_attributes = True


# ── Dispute Resolution Schemas ─────────────────────────────────────────────────

VALID_DISPUTE_TYPES    = {"duplicate", "upsell", "unauthorized_charge", "other"}
VALID_CONFIRMED_BY     = {"dealer_confirmed", "user_self_resolved", "admin_decision"}
VALID_RESOLUTION_STATI = {"proven", "dismissed", "partial"}


class RaiseDisputeRequest(BaseModel):
    dispute_type: str = Field(..., description="One of: duplicate | upsell | unauthorized_charge | other")
    dispute_notes: Optional[str] = Field(None, max_length=2000, description="Free-text reason for dispute")

    @field_validator("dispute_type")
    @classmethod
    def validate_dispute_type(cls, v: str) -> str:
        if v not in VALID_DISPUTE_TYPES:
            raise ValueError(f"dispute_type must be one of {VALID_DISPUTE_TYPES}")
        return v


class ResolveDisputeRequest(BaseModel):
    resolution_status: str = Field(..., description="One of: proven | dismissed | partial")
    confirmed_by: str      = Field(..., description="One of: dealer_confirmed | user_self_resolved | admin_decision")
    dealer_name: Optional[str]     = None
    refund_amount: Optional[float] = Field(None, ge=0)
    evidence_notes: Optional[str]  = Field(None, max_length=2000)

    @field_validator("resolution_status")
    @classmethod
    def validate_resolution_status(cls, v: str) -> str:
        if v not in VALID_RESOLUTION_STATI:
            raise ValueError(f"resolution_status must be one of {VALID_RESOLUTION_STATI}")
        return v

    @field_validator("confirmed_by")
    @classmethod
    def validate_confirmed_by(cls, v: str) -> str:
        if v not in VALID_CONFIRMED_BY:
            raise ValueError(f"confirmed_by must be one of {VALID_CONFIRMED_BY}")
        return v


class DisputeResolutionResponse(BaseModel):
    id: int
    invoice_id: int
    vehicle_id: int
    dispute_type: str
    resolution_status: str
    confirmed_by: str
    dealer_name: Optional[str]       = None
    original_amount: Optional[float] = None
    refund_amount: Optional[float]   = None
    evidence_notes: Optional[str]    = Field(None, max_length=2000)
    invoice_snapshot: Optional[Any]  = None
    created_at: datetime
    resolved_at: datetime

    class Config:
        from_attributes = True


# ── Service Record Schemas ─────────────────────────────────────────────────────

class ServiceRecordBase(BaseModel):
    service_date: datetime
    mileage_at_service: int
    service_type: str
    service_description: Optional[str] = Field(None, max_length=500)
    shop_name: Optional[str] = Field(None, max_length=200)
    notes: Optional[str] = Field(None, max_length=1000)

class ServiceRecordCreate(ServiceRecordBase):
    vehicle_id: int

class ServiceRecordResponse(ServiceRecordBase):
    id: int
    vehicle_id: int
    is_manual_entry: bool
    excluded_from_timeline: bool = False
    exclusion_reason: Optional[str] = None
    created_at: datetime

    class Config:
        from_attributes = True


# ── Recommendation Schemas ─────────────────────────────────────────────────────

class RecommendationItem(BaseModel):
    service_type: str
    category: str
    reason: str
    interval_miles: Optional[int] = None
    interval_months: Optional[int] = None
    last_performed_date: Optional[datetime] = None
    last_performed_mileage: Optional[int] = None
    citation: Optional[str] = None
    confidence: str
    is_upsell_flag: bool = False
    upsell_reason: Optional[str] = None

class RecommendationRequest(BaseModel):
    vehicle_id: int
    current_mileage: int
    driving_condition: Literal['normal', 'severe'] = 'normal'
    # Literal prevents silent acceptance of typos like "Severe" or "heavy".
    # The frontend no longer sends this — it is read from the vehicle record.
    # Kept here for direct API clients and backward compatibility.

class RecommendationResponse(BaseModel):
    vehicle_id: int
    vehicle_info: str
    current_mileage: int
    recommendations: List[RecommendationItem]
    generated_at: datetime = Field(default_factory=datetime.utcnow)


# ── Invoice Confirm Analysis Schemas ──────────────────────────────────────────

class LineItemAnalysis(BaseModel):
    service_type: str
    service_description: Optional[str] = Field(None, max_length=500)
    line_total: Optional[float] = None
    verdict: str                        # "upsell" | "genuine" | "exempt"
    verdict_label: str                  # human-readable badge text
    reason: Optional[str] = None
    oem_interval_miles: Optional[int] = None
    oem_interval_months: Optional[int] = None
    miles_since_last_service: Optional[int] = None
    previous_service_date: Optional[str] = None
    previous_service_mileage: Optional[int] = None


class BatchDisputeRequest(BaseModel):
    disputed_service_types: List[str] = Field(..., min_length=1)
    dispute_type: str = Field(default="upsell")
    dispute_notes: Optional[str] = Field(None, max_length=2000)

    @field_validator("dispute_type")
    @classmethod
    def validate_dispute_type(cls, v: str) -> str:
        if v not in VALID_DISPUTE_TYPES:
            raise ValueError(f"dispute_type must be one of {VALID_DISPUTE_TYPES}")
        return v


# ── Dispute Line Item Schemas (History Page Redesign) ──────────────────────────

class DisputeLineItemResponse(BaseModel):
    id: int
    dispute_resolution_id: int
    invoice_line_item_id: int
    line_description: Optional[str] = None
    line_total_at_dispute: Optional[float] = None
    created_at: datetime

    class Config:
        from_attributes = True


class RaiseDisputeWithLineItemsRequest(BaseModel):
    """
    New dispute request that references specific line item IDs (by PK).
    Used by the redesigned History page accordion dispute flow.
    Replaces BatchDisputeRequest (which used service type name strings).
    BatchDisputeRequest is kept for backward compatibility.
    """
    invoice_line_item_ids: List[int] = Field(
        ..., min_length=1,
        description="PKs from invoice_line_items table to dispute"
    )
    dispute_type: str = Field(default="upsell")
    dispute_notes: Optional[str] = Field(None, max_length=2000)

    @field_validator("dispute_type")
    @classmethod
    def validate_dispute_type(cls, v: str) -> str:
        if v not in VALID_DISPUTE_TYPES:
            raise ValueError(f"dispute_type must be one of {VALID_DISPUTE_TYPES}")
        return v


# ── Timeline Schemas ───────────────────────────────────────────────────────────

class TimelineEvent(BaseModel):
    date: datetime
    mileage: int
    service_type: str
    description: Optional[str] = Field(None, max_length=500)
    shop_name: Optional[str] = Field(None, max_length=200)
    amount: Optional[float] = None
    invoice_id: Optional[int] = None
    is_disputed: bool = False
    dispute_status: Optional[str] = None

class TimelineResponse(BaseModel):
    vehicle_id: int
    events: List[TimelineEvent]
