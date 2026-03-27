"""
app/api/admin_thresholds.py
============================
Admin CRUD endpoints for the maintenance_thresholds table.

Routes (all under /api/admin prefix via main.py):
  GET    /thresholds              - list all rows
  POST   /thresholds              - create a new row
  PATCH  /thresholds/{id}         - update an existing row
  DELETE /thresholds/{id}         - delete an override (global defaults protected)
  POST   /thresholds/seed         - idempotent seed of global defaults

Auth: all routes require a valid admin JWT (get_current_admin).
"""

from __future__ import annotations

from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.orm import Session

from app.models.models import MaintenanceThreshold
from app.utils.admin_auth import get_current_admin
from app.utils.database import get_db

router = APIRouter()

VALID_SEVERITY_TIERS = {"critical", "high", "standard", "low"}

_SEED_DEFAULTS: list[dict] = [
    {"service_category": "brake_fluid",          "upsell_tolerance": 0.95, "annual_days_floor": 730, "severity_tier": "critical"},
    {"service_category": "transmission_fluid",   "upsell_tolerance": 0.95, "annual_days_floor": 730, "severity_tier": "critical"},
    {"service_category": "differential_fluid",   "upsell_tolerance": 0.95, "annual_days_floor": 730, "severity_tier": "critical"},
    {"service_category": "power_steering_fluid", "upsell_tolerance": 0.95, "annual_days_floor": 730, "severity_tier": "critical"},
    {"service_category": "coolant",              "upsell_tolerance": 0.90, "annual_days_floor": 548, "severity_tier": "high"},
    {"service_category": "timing_belt",          "upsell_tolerance": 0.92, "annual_days_floor": 730, "severity_tier": "high"},
    {"service_category": "spark_plugs",          "upsell_tolerance": 0.90, "annual_days_floor": 730, "severity_tier": "high"},
    {"service_category": "engine_oil",           "upsell_tolerance": 0.85, "annual_days_floor": 365, "severity_tier": "standard"},
    {"service_category": "tire_rotation",        "upsell_tolerance": 0.80, "annual_days_floor": None, "severity_tier": "low"},
    {"service_category": "cabin_air_filter",     "upsell_tolerance": 0.80, "annual_days_floor": 365,  "severity_tier": "low"},
    {"service_category": "engine_air_filter",    "upsell_tolerance": 0.80, "annual_days_floor": None, "severity_tier": "low"},
    {"service_category": "wiper_blades",         "upsell_tolerance": 0.75, "annual_days_floor": None, "severity_tier": "low"},
    {"service_category": "inspection",           "upsell_tolerance": 0.75, "annual_days_floor": None, "severity_tier": "low"},
]


# ── Pydantic schemas ──────────────────────────────────────────────────────────

class ThresholdCreate(BaseModel):
    make:              Optional[str]  = Field(None, max_length=50)
    model:             Optional[str]  = Field(None, max_length=100)
    year:              Optional[int]  = Field(None, ge=1900, le=2100)
    service_category:  str            = Field(..., min_length=1, max_length=50)
    upsell_tolerance:  float          = Field(..., gt=0, le=1.0)
    annual_days_floor: Optional[int]  = Field(None, gt=0)
    severity_tier:     str            = Field("standard", max_length=20)

    @field_validator("severity_tier")
    @classmethod
    def validate_tier(cls, v: str) -> str:
        if v not in VALID_SEVERITY_TIERS:
            raise ValueError(f"severity_tier must be one of: {sorted(VALID_SEVERITY_TIERS)}")
        return v

    @field_validator("upsell_tolerance")
    @classmethod
    def validate_tolerance(cls, v: float) -> float:
        if not (0 < v <= 1.0):
            raise ValueError("upsell_tolerance must be > 0 and <= 1.0")
        return round(v, 3)


class ThresholdUpdate(BaseModel):
    upsell_tolerance:  Optional[float] = Field(None, gt=0, le=1.0)
    annual_days_floor: Optional[int]   = Field(None, gt=0)
    severity_tier:     Optional[str]   = Field(None, max_length=20)
    clear_annual_floor: bool           = False

    @field_validator("severity_tier")
    @classmethod
    def validate_tier(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and v not in VALID_SEVERITY_TIERS:
            raise ValueError(f"severity_tier must be one of: {sorted(VALID_SEVERITY_TIERS)}")
        return v


# ── Helpers ───────────────────────────────────────────────────────────────────

def _window_description(row: MaintenanceThreshold) -> str:
    """Convert tolerance to human-readable % window for admin UI."""
    tol = float(row.upsell_tolerance)
    pct = round((1 - tol) * 100, 1)
    return f"Flag if performed in last {pct}% of OEM interval"


def _row_to_dict(row: MaintenanceThreshold) -> dict:
    return {
        "id":                 row.id,
        "make":               row.make,
        "model":              row.model,
        "year":               row.year,
        "service_category":   row.service_category,
        "upsell_tolerance":   float(row.upsell_tolerance),
        "annual_days_floor":  row.annual_days_floor,
        "severity_tier":      row.severity_tier,
        "window_description": _window_description(row),
        "is_global_default":  row.make is None and row.model is None and row.year is None,
        "created_at":         row.created_at.isoformat() if row.created_at else None,
        "updated_at":         row.updated_at.isoformat() if row.updated_at else None,
    }


def _is_global_default(row: MaintenanceThreshold) -> bool:
    return row.make is None and row.model is None and row.year is None


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/thresholds")
def list_thresholds(
    service_category: Optional[str] = Query(None),
    severity_tier:    Optional[str] = Query(None),
    make:             Optional[str] = Query(None),
    db:     Session  = Depends(get_db),
    _admin           = Depends(get_current_admin),
):
    """List all maintenance threshold rows. Global defaults first, then overrides."""
    q = db.query(MaintenanceThreshold)
    if service_category:
        q = q.filter(MaintenanceThreshold.service_category == service_category.lower())
    if severity_tier:
        q = q.filter(MaintenanceThreshold.severity_tier == severity_tier.lower())
    if make:
        q = q.filter(MaintenanceThreshold.make.ilike(f"%{make}%"))

    rows = q.order_by(
        MaintenanceThreshold.make.nullsfirst(),
        MaintenanceThreshold.service_category,
    ).all()

    return {"total": len(rows), "items": [_row_to_dict(r) for r in rows]}


@router.post("/thresholds", status_code=status.HTTP_201_CREATED)
def create_threshold(
    body:   ThresholdCreate,
    db:     Session = Depends(get_db),
    _admin          = Depends(get_current_admin),
):
    """Create a new threshold row. Returns 409 if scope+category already exists."""
    existing = db.query(MaintenanceThreshold).filter(
        MaintenanceThreshold.service_category == body.service_category,
        MaintenanceThreshold.make  == body.make,
        MaintenanceThreshold.model == body.model,
        MaintenanceThreshold.year  == body.year,
    ).first()
    if existing:
        raise HTTPException(
            status_code=409,
            detail=(
                f"Threshold for '{body.service_category}' at scope "
                f"make={body.make!r}/model={body.model!r}/year={body.year!r} "
                f"already exists (id={existing.id}). Use PATCH to update."
            ),
        )

    row = MaintenanceThreshold(
        make              = body.make,
        model             = body.model,
        year              = body.year,
        service_category  = body.service_category.lower(),
        upsell_tolerance  = body.upsell_tolerance,
        annual_days_floor = body.annual_days_floor,
        severity_tier     = body.severity_tier,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return _row_to_dict(row)


@router.patch("/thresholds/{threshold_id}")
def update_threshold(
    threshold_id: int,
    body:   ThresholdUpdate,
    db:     Session = Depends(get_db),
    _admin          = Depends(get_current_admin),
):
    """
    Update editable fields. service_category and scope are immutable.
    Set clear_annual_floor=true to remove an existing annual_days_floor.
    """
    row = db.query(MaintenanceThreshold).filter(
        MaintenanceThreshold.id == threshold_id
    ).first()
    if not row:
        raise HTTPException(status_code=404, detail="Threshold not found")

    updates = body.model_dump(exclude_unset=True, exclude={"clear_annual_floor"})
    for field, value in updates.items():
        setattr(row, field, value)

    if body.clear_annual_floor:
        row.annual_days_floor = None

    row.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(row)
    return _row_to_dict(row)


@router.delete("/thresholds/{threshold_id}", status_code=status.HTTP_200_OK)
def delete_threshold(
    threshold_id: int,
    db:     Session = Depends(get_db),
    _admin          = Depends(get_current_admin),
):
    """
    Delete a threshold override.
    Global defaults (make/model/year all NULL) cannot be deleted —
    they are the system fallback. Use PATCH to edit them instead.
    """
    row = db.query(MaintenanceThreshold).filter(
        MaintenanceThreshold.id == threshold_id
    ).first()
    if not row:
        raise HTTPException(status_code=404, detail="Threshold not found")

    if _is_global_default(row):
        raise HTTPException(
            status_code=400,
            detail=(
                f"Cannot delete global default for '{row.service_category}' "
                f"(id={row.id}). Use PATCH to edit it instead."
            ),
        )

    db.delete(row)
    db.commit()
    return {"message": f"Threshold {threshold_id} deleted", "id": threshold_id}


@router.post("/thresholds/seed", status_code=status.HTTP_200_OK)
def seed_thresholds(
    db:     Session = Depends(get_db),
    _admin          = Depends(get_current_admin),
):
    """
    Idempotent seed of global default threshold rows.
    Skips any category that already has a global default row so existing
    admin customisations are never overwritten. Safe to call multiple times.
    """
    inserted, skipped = [], []

    for seed in _SEED_DEFAULTS:
        existing = db.query(MaintenanceThreshold).filter(
            MaintenanceThreshold.service_category == seed["service_category"],
            MaintenanceThreshold.make  == None,
            MaintenanceThreshold.model == None,
            MaintenanceThreshold.year  == None,
        ).first()

        if existing:
            skipped.append(seed["service_category"])
            continue

        db.add(MaintenanceThreshold(
            make              = None,
            model             = None,
            year              = None,
            service_category  = seed["service_category"],
            upsell_tolerance  = seed["upsell_tolerance"],
            annual_days_floor = seed["annual_days_floor"],
            severity_tier     = seed["severity_tier"],
        ))
        inserted.append(seed["service_category"])

    db.commit()
    return {
        "message":  f"Seed complete: {len(inserted)} inserted, {len(skipped)} skipped.",
        "inserted": inserted,
        "skipped":  skipped,
    }
