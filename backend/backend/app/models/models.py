from sqlalchemy import Column, Integer, String, Float, DateTime, ForeignKey, Text, Boolean, JSON, Numeric
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import relationship
from datetime import datetime
from app.utils.database import Base

# pgvector Vector type — used for ARIA RAG embedding columns
try:
    from pgvector.sqlalchemy import Vector
    _VECTOR_AVAILABLE = True
except ImportError:
    # Graceful degradation: if pgvector isn't installed (e.g. unit test env),
    # define a no-op placeholder so the ORM models still load.
    from sqlalchemy import LargeBinary as Vector
    _VECTOR_AVAILABLE = False


class User(Base):
    """Application users with email/password authentication."""
    __tablename__ = "app_users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String(255), unique=True, nullable=False, index=True)
    full_name = Column(String(255), nullable=True)
    hashed_password = Column(String(255), nullable=False)
    subscription_tier = Column(String(50), default="free")  # free | premium
    status = Column(String(20), default="active")           # active | disabled
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    last_active_at = Column(DateTime, nullable=True)

    # Relationships – no delete-orphan because owner_id is nullable
    vehicles = relationship("Vehicle", back_populates="owner", cascade="save-update, merge")


class Vehicle(Base):
    __tablename__ = "vehicles"

    id = Column(Integer, primary_key=True, index=True)
    owner_id = Column(Integer, ForeignKey("app_users.id", ondelete="SET NULL"), nullable=True, index=True)
    year = Column(Integer, nullable=False)
    make = Column(String, nullable=False)
    model = Column(String, nullable=False)
    trim = Column(String, nullable=True)
    vin = Column(String(17), nullable=True)
    nickname = Column(String, nullable=True)
    current_mileage = Column(Integer, nullable=True)
    driving_condition = Column(String(10), nullable=False, default='normal')
    # 'normal' | 'severe'  — enforced by CHECK constraint in migration 005.
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    owner = relationship("User", back_populates="vehicles")
    invoices = relationship("Invoice", back_populates="vehicle", cascade="all, delete-orphan")
    service_records = relationship("ServiceRecord", back_populates="vehicle", cascade="all, delete-orphan")


class Invoice(Base):
    __tablename__ = "invoices"

    id = Column(Integer, primary_key=True, index=True)
    vehicle_id = Column(Integer, ForeignKey("vehicles.id"), nullable=False)

    filename = Column(String, nullable=False)
    file_path = Column(String, nullable=False)

    service_date = Column(DateTime, nullable=True)
    mileage_at_service = Column(Integer, nullable=True)
    shop_name = Column(String, nullable=True)
    shop_address = Column(Text, nullable=True)
    total_amount = Column(Float, nullable=True)

    ocr_text = Column(Text, nullable=True)
    extraction_data = Column(JSON, nullable=True)

    is_confirmed = Column(Boolean, default=False)
    is_duplicate = Column(Boolean, default=False)

    dispute_status       = Column(String(50),  nullable=True,  default=None)
    is_archived          = Column(Boolean,     nullable=False, default=False)
    dispute_raised_at    = Column(DateTime,    nullable=True,  default=None)
    dispute_resolved_at  = Column(DateTime,    nullable=True,  default=None)
    dispute_confirmed_by = Column(String(100), nullable=True,  default=None)
    dispute_notes        = Column(Text,        nullable=True,  default=None)

    # ── ARIA RAG: Phase 2 — embedded at is_confirmed=True transition ──────────
    # Embedding of ocr_text via all-MiniLM-L6-v2 (Phase 1) or Qwen3-Embedding-8B (Phase 2+).
    # NULL for invoices confirmed before Phase 2. Backfill with eval_retrieval.py.
    ocr_embedding = Column(Vector(384), nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    vehicle = relationship("Vehicle", back_populates="invoices")
    line_items = relationship("InvoiceLineItem", back_populates="invoice", cascade="all, delete-orphan")
    dispute_resolutions = relationship("DisputeResolution", back_populates="invoice")


class InvoiceLineItem(Base):
    __tablename__ = "invoice_line_items"

    id = Column(Integer, primary_key=True, index=True)
    invoice_id = Column(Integer, ForeignKey("invoices.id"), nullable=False)

    service_type = Column(String, nullable=False)
    service_description = Column(Text, nullable=True)
    quantity = Column(Float, default=1.0)
    unit_price = Column(Float, nullable=True)
    line_total = Column(Float, nullable=True)
    is_labor = Column(Boolean, default=False)
    is_parts = Column(Boolean, default=False)
    is_complimentary = Column(Boolean, default=False)
    upsell_verdict = Column(String(20), nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow)

    invoice = relationship("Invoice", back_populates="line_items")
    dispute_line_items = relationship("DisputeLineItem", back_populates="invoice_line_item")


class ServiceRecord(Base):
    __tablename__ = "service_records"

    id = Column(Integer, primary_key=True, index=True)
    vehicle_id = Column(Integer, ForeignKey("vehicles.id"), nullable=False)
    invoice_id = Column(Integer, ForeignKey("invoices.id"), nullable=True)

    service_date = Column(DateTime, nullable=False)
    mileage_at_service = Column(Integer, nullable=False)
    service_type = Column(String, nullable=False)
    service_description = Column(Text, nullable=True)
    shop_name = Column(String, nullable=True)

    is_manual_entry = Column(Boolean, default=False)
    notes = Column(Text, nullable=True)

    excluded_from_timeline = Column(Boolean,    nullable=False, default=False)
    exclusion_reason       = Column(String(100), nullable=True,  default=None)

    # ── ARIA RAG: Phase 1 — embedded on ServiceRecord creation ───────────────
    # Embedding of (service_type + service_description) via all-MiniLM-L6-v2.
    # NULL for records created before Phase 1 — backfill with eval_retrieval.py.
    description_embedding = Column(Vector(384), nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow)

    vehicle = relationship("Vehicle", back_populates="service_records")


class DisputeResolution(Base):
    """
    Immutable audit log — one row per dispute resolution event.
    """
    __tablename__ = "dispute_resolutions"

    id                = Column(Integer,     primary_key=True, index=True)
    invoice_id        = Column(Integer,     ForeignKey("invoices.id", ondelete="RESTRICT"), nullable=False)
    vehicle_id        = Column(Integer,     nullable=False)

    dispute_type      = Column(String(50),  nullable=False)
    resolution_status = Column(String(50),  nullable=False)
    confirmed_by      = Column(String(100), nullable=False)

    dealer_name       = Column(String(255), nullable=True)
    original_amount   = Column(Numeric(10, 2), nullable=True)
    refund_amount     = Column(Numeric(10, 2), nullable=True)
    evidence_notes    = Column(Text,        nullable=True)

    invoice_snapshot  = Column(JSON,        nullable=True)

    created_at        = Column(DateTime,    default=datetime.utcnow)
    resolved_at       = Column(DateTime,    default=datetime.utcnow)

    invoice    = relationship("Invoice", back_populates="dispute_resolutions")
    line_items = relationship("DisputeLineItem", back_populates="dispute_resolution",
                              cascade="all, delete-orphan")


class DisputeLineItem(Base):
    __tablename__ = "dispute_line_items"

    id                    = Column(Integer, primary_key=True, index=True)
    dispute_resolution_id = Column(Integer,
                                   ForeignKey("dispute_resolutions.id", ondelete="CASCADE"),
                                   nullable=False)
    invoice_line_item_id  = Column(Integer,
                                   ForeignKey("invoice_line_items.id"),
                                   nullable=False)
    line_description      = Column(Text,           nullable=True)
    line_total_at_dispute = Column(Numeric(10, 2), nullable=True)
    created_at            = Column(DateTime,        default=datetime.utcnow)

    dispute_resolution = relationship("DisputeResolution", back_populates="line_items")
    invoice_line_item  = relationship("InvoiceLineItem",   back_populates="dispute_line_items")


class MaintenanceThreshold(Base):
    """
    Per-service-category upsell detection thresholds.

    Replaces the hardcoded OEM_INTERVAL_TOLERANCE = 0.85 constant with a
    per-category, optionally vehicle-scoped value that is configurable by
    admins at runtime.

    Resolution order (most specific wins):
      1. make + model + year  → vehicle-specific override
      2. make only            → brand-level override
      3. NULL / global        → system default (seed data)

    If no row is found, evaluate_upsell() falls back to ThresholdConfig
    with tolerance=0.85 and annual_days_floor=365 — identical to the
    previous hardcoded behaviour.

    Columns
    -------
    service_category    : Category key matching SERVICE_CATEGORY_MAP in upsell_rules.py.
                          e.g. 'brake_fluid', 'engine_oil', 'tire_rotation'.
    upsell_tolerance    : Fraction of OEM interval that must have elapsed before
                          a service is considered genuine.
                          0.95 → flag only if < 95% of interval elapsed (5% window).
                          0.85 → flag if < 85% elapsed (15% window — current default).
    annual_days_floor   : If days_since_last_service >= this value the service is
                          always genuine regardless of mileage. NULL = no floor.
                          Extends the oil-change-only floor (Flaw 3 fix) to all
                          categories that carry a time-based risk.
    severity_tier       : Drives UI colour and notification urgency.
                          'critical' | 'high' | 'standard' | 'low'
    make / model / year : Optional vehicle scope. NULL = applies to all vehicles.
    """
    __tablename__ = "maintenance_thresholds"

    id               = Column(Integer,      primary_key=True, index=True)

    # ── Vehicle scope (all NULL = global default) ─────────────────────────────
    make             = Column(String(50),   nullable=True,  index=True)
    model            = Column(String(100),  nullable=True)
    year             = Column(Integer,      nullable=True)

    # ── Threshold definition ──────────────────────────────────────────────────
    service_category = Column(String(50),   nullable=False, index=True)
    upsell_tolerance = Column(Numeric(4, 3), nullable=False, default=0.85)
    annual_days_floor = Column(Integer,     nullable=True)
    severity_tier    = Column(String(20),   nullable=False, default="standard")

    # ── Audit ─────────────────────────────────────────────────────────────────
    created_by       = Column(Integer, ForeignKey("app_users.id", ondelete="SET NULL"), nullable=True)
    updated_by       = Column(Integer, ForeignKey("app_users.id", ondelete="SET NULL"), nullable=True)
    created_at       = Column(DateTime, default=datetime.utcnow)
    updated_at       = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class OEMSchedule(Base):
    """
    OEM maintenance schedule data.

    Each row represents one service interval for a specific vehicle (year/make/model)
    and driving condition (normal / severe).

    ── AI-Generated OEM Workflow ─────────────────────────────────────────────
    source        : How this row was created.
                    'admin_manual'     — entered by admin via the OEM Schedules UI.
                    'ai_generated'     — inserted by the BackgroundTask Claude API
                                         call after a new vehicle is added with no
                                         existing OEM data for its make.
                    'generic_standard' — fallback generic interval (Flaw 7 fix).

    review_status : Controls whether this row is live in the upsell engine and
                    recommendations. Pending rows are EXCLUDED from all engine
                    queries until an admin approves them — AI hallucinations cannot
                    silently affect upsell verdicts.
                    'approved' — live, used by engine + recommendations.
                    'pending'  — AI-generated, awaiting admin review. NOT live.
                    'rejected' — admin rejected, permanently excluded.

    All existing rows default to source='admin_manual', review_status='approved'.
    No regression — existing Toyota data remains fully live.
    ─────────────────────────────────────────────────────────────────────────
    """
    __tablename__ = "oem_schedules"

    id = Column(Integer, primary_key=True, index=True)
    year = Column(Integer, nullable=False)
    make = Column(String, nullable=False)
    model = Column(String, nullable=False)
    trim = Column(String, nullable=True)

    service_type = Column(String, nullable=False)
    interval_miles = Column(Integer, nullable=True)
    interval_months = Column(Integer, nullable=True)
    driving_condition = Column(String, default="normal")

    citation = Column(Text, nullable=True)
    notes = Column(Text, nullable=True)

    # ── AI-Generated OEM Workflow columns ────────────────────────────────────
    source        = Column(String(30),  nullable=False, default="admin_manual",
                           index=True)
    review_status = Column(String(20),  nullable=False, default="approved",
                           index=True)
    # reviewed_by and reviewed_at — set when admin approves or rejects
    reviewed_by_admin_id = Column(Integer, nullable=True)
    reviewed_at          = Column(DateTime, nullable=True)

    # ── ARIA RAG: Phase 1 — embedded during batch job on startup ─────────────
    # Embedding of (service_type + notes + citation) via all-MiniLM-L6-v2.
    # NULL until the Phase 0 batch embed job runs (embedding_service.py).
    content_embedding = Column(Vector(384), nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow)
