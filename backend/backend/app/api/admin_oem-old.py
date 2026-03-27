"""
app/api/admin_oem.py
====================
Admin CRUD endpoints for OEM maintenance schedules.

Routes (all under /api/admin prefix via main.py):
  GET    /oem-schedules          — paginated list with optional filters
  POST   /oem-schedules          — create a new row + embed
  PATCH  /oem-schedules/{id}     — update editable fields + re-embed
  DELETE /oem-schedules/{id}     — delete a row
  POST   /oem-schedules/{id}/embed — (re-)generate embedding for one row

Auth: all routes require a valid admin JWT (get_current_admin dependency).
Does NOT require super_admin — any admin role can manage OEM data.
"""

from typing import Optional
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.models.models import OEMSchedule
from app.utils.admin_auth import get_current_admin
from app.utils.database import get_db
from app.services.embedding_service import embedding_service

router = APIRouter()

VALID_DRIVING_CONDITIONS = {"normal", "severe"}


# ── Pydantic schemas (local to this module — no changes to existing schemas) ──

class OEMScheduleRow(BaseModel):
    """Response shape for a single OEM schedule row."""
    id: int
    year: int
    make: str
    model: str
    trim: Optional[str]
    service_type: str
    interval_miles: Optional[int]
    interval_months: Optional[int]
    driving_condition: Optional[str]
    citation: Optional[str]
    notes: Optional[str]
    has_embedding: bool
    created_at: Optional[datetime]

    class Config:
        from_attributes = True


class OEMScheduleCreate(BaseModel):
    """Fields required to create a new OEM schedule row."""
    year: int = Field(..., ge=1900, le=2100)
    make: str = Field(..., min_length=1, max_length=100)
    model: str = Field(..., min_length=1, max_length=100)
    trim: Optional[str] = Field(None, max_length=100)
    service_type: str = Field(..., min_length=1, max_length=200)
    interval_miles: Optional[int] = Field(None, ge=0)
    interval_months: Optional[int] = Field(None, ge=0)
    driving_condition: str = Field("normal", max_length=50)
    citation: Optional[str] = Field(None, max_length=500)
    notes: Optional[str] = None


class OEMScheduleUpdate(BaseModel):
    """Editable fields — year/make/model are intentionally excluded."""
    trim: Optional[str] = Field(None, max_length=100)
    service_type: Optional[str] = Field(None, min_length=1, max_length=200)
    interval_miles: Optional[int] = Field(None, ge=0)
    interval_months: Optional[int] = Field(None, ge=0)
    driving_condition: Optional[str] = Field(None, max_length=50)
    citation: Optional[str] = Field(None, max_length=500)
    notes: Optional[str] = None


# ── Helper ────────────────────────────────────────────────────────────────────

def _row_to_dict(row: OEMSchedule) -> dict:
    return {
        "id":               row.id,
        "year":             row.year,
        "make":             row.make,
        "model":            row.model,
        "trim":             row.trim,
        "service_type":     row.service_type,
        "interval_miles":   row.interval_miles,
        "interval_months":  row.interval_months,
        "driving_condition": row.driving_condition,
        "citation":         row.citation,
        "notes":            row.notes,
        "has_embedding":    row.content_embedding is not None,
        "created_at":       row.created_at.isoformat() if row.created_at else None,
    }


def _embed_row(row: OEMSchedule, db: Session) -> bool:
    """Generate and persist embedding for one OEM row. Returns True on success."""
    chunk = embedding_service.build_oem_chunk(row)
    vec   = embedding_service.embed(chunk)
    if vec is None:
        return False
    row.content_embedding = vec
    db.add(row)
    db.commit()
    return True


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/oem-schedules")
def list_oem_schedules(
    make:   Optional[str] = Query(None, description="Filter by make (case-insensitive)"),
    model:  Optional[str] = Query(None, description="Filter by model (case-insensitive)"),
    year:   Optional[int] = Query(None, description="Filter by year"),
    page:   int           = Query(1,  ge=1),
    per_page: int         = Query(50, ge=1, le=200),
    db:     Session       = Depends(get_db),
    _admin              = Depends(get_current_admin),
):
    """Return paginated OEM schedule rows with optional make/model/year filters."""
    q = db.query(OEMSchedule)
    if make:
        q = q.filter(OEMSchedule.make.ilike(f"%{make}%"))
    if model:
        q = q.filter(OEMSchedule.model.ilike(f"%{model}%"))
    if year:
        q = q.filter(OEMSchedule.year == year)

    total   = q.count()
    rows    = q.order_by(OEMSchedule.make, OEMSchedule.model,
                         OEMSchedule.year, OEMSchedule.service_type)\
               .offset((page - 1) * per_page).limit(per_page).all()

    return {
        "total":    total,
        "page":     page,
        "per_page": per_page,
        "items":    [_row_to_dict(r) for r in rows],
    }


@router.post("/oem-schedules", status_code=status.HTTP_201_CREATED)
def create_oem_schedule(
    body: OEMScheduleCreate,
    db:   Session = Depends(get_db),
    _admin        = Depends(get_current_admin),
):
    """Create a new OEM schedule row and generate its embedding."""
    if body.driving_condition not in VALID_DRIVING_CONDITIONS:
        raise HTTPException(
            status_code=400,
            detail=f"driving_condition must be one of: {sorted(VALID_DRIVING_CONDITIONS)}"
        )

    row = OEMSchedule(
        year              = body.year,
        make              = body.make,
        model             = body.model,
        trim              = body.trim,
        service_type      = body.service_type,
        interval_miles    = body.interval_miles,
        interval_months   = body.interval_months,
        driving_condition = body.driving_condition,
        citation          = body.citation,
        notes             = body.notes,
    )
    db.add(row)
    db.commit()
    db.refresh(row)

    # Generate embedding immediately — non-fatal if model unavailable
    embedded = _embed_row(row, db)

    result = _row_to_dict(row)
    result["_embedded"] = embedded
    return result


@router.patch("/oem-schedules/{schedule_id}")
def update_oem_schedule(
    schedule_id: int,
    body: OEMScheduleUpdate,
    db:   Session = Depends(get_db),
    _admin        = Depends(get_current_admin),
):
    """Update editable fields on an OEM schedule row and re-generate embedding."""
    row = db.query(OEMSchedule).filter(OEMSchedule.id == schedule_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="OEM schedule not found")

    # Apply only supplied fields (exclude_unset so partial updates work)
    updates = body.model_dump(exclude_unset=True)

    if "driving_condition" in updates and updates["driving_condition"] not in VALID_DRIVING_CONDITIONS:
        raise HTTPException(
            status_code=400,
            detail=f"driving_condition must be one of: {sorted(VALID_DRIVING_CONDITIONS)}"
        )

    for field, value in updates.items():
        setattr(row, field, value)

    # Invalidate old embedding — will be regenerated below
    row.content_embedding = None
    db.commit()
    db.refresh(row)

    embedded = _embed_row(row, db)

    result = _row_to_dict(row)
    result["_embedded"] = embedded
    return result


@router.delete("/oem-schedules/{schedule_id}", status_code=status.HTTP_200_OK)
def delete_oem_schedule(
    schedule_id: int,
    db:   Session = Depends(get_db),
    _admin        = Depends(get_current_admin),
):
    """Delete an OEM schedule row."""
    row = db.query(OEMSchedule).filter(OEMSchedule.id == schedule_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="OEM schedule not found")

    db.delete(row)
    db.commit()
    return {"message": f"OEM schedule {schedule_id} deleted successfully", "id": schedule_id}


@router.post("/oem-schedules/{schedule_id}/embed", status_code=status.HTTP_200_OK)
def embed_oem_schedule(
    schedule_id: int,
    db:   Session = Depends(get_db),
    _admin        = Depends(get_current_admin),
):
    """(Re-)generate the content_embedding for a single OEM schedule row."""
    row = db.query(OEMSchedule).filter(OEMSchedule.id == schedule_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="OEM schedule not found")

    embedded = _embed_row(row, db)
    if not embedded:
        raise HTTPException(
            status_code=503,
            detail="Embedding model unavailable — embedding was not generated"
        )

    return {"message": "Embedding generated successfully", "id": schedule_id}
