"""
app/api/admin_oem.py
====================
Admin CRUD endpoints for OEM maintenance schedules.

Routes (all under /api/admin prefix via main.py):
  GET    /oem-schedules                     — paginated list with optional filters
  POST   /oem-schedules                     — create a new row + embed
  PATCH  /oem-schedules/{id}               — update editable fields + re-embed
  DELETE /oem-schedules/{id}               — delete a row
  POST   /oem-schedules/{id}/embed         — (re-)generate embedding for one row

  ── AI-Generated OEM Review Workflow (new) ──────────────────────────────────
  GET    /oem-schedules/pending             — all pending rows grouped by make/model
  GET    /oem-schedules/pending/count       — count of pending rows (for nav badge)
  POST   /oem-schedules/{id}/approve        — approve one pending row → live
  POST   /oem-schedules/{id}/reject         — reject one pending row → excluded
  POST   /oem-schedules/approve-all/{make}  — bulk approve all pending rows for a make

Auth: all routes require a valid admin JWT (get_current_admin dependency).
Does NOT require super_admin — any admin role can manage OEM data.
"""

from typing import Optional, List
from datetime import datetime, timezone

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
        # AI-Generated OEM Workflow fields
        "source":           getattr(row, "source",        "admin_manual"),
        "review_status":    getattr(row, "review_status", "approved"),
        "reviewed_at":      (
            row.reviewed_at.isoformat()
            if getattr(row, "reviewed_at", None) else None
        ),
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

# ── AI-Generated OEM Review Endpoints ─────────────────────────────────────────

@router.get("/oem-schedules/pending/count")
def count_pending_oem_schedules(
    db:     Session = Depends(get_db),
    _admin          = Depends(get_current_admin),
):
    """
    Return count of pending AI-generated OEM rows grouped by make.
    Used by the admin nav badge to show the review indicator.
    """
    from sqlalchemy import func as sqlfunc
    rows = (
        db.query(OEMSchedule.make, sqlfunc.count(OEMSchedule.id))
        .filter(OEMSchedule.review_status == "pending")
        .group_by(OEMSchedule.make)
        .all()
    )
    total = sum(count for _, count in rows)
    by_make = {make: count for make, count in rows}
    return {"total": total, "by_make": by_make}


@router.get("/oem-schedules/pending")
def list_pending_oem_schedules(
    db:     Session = Depends(get_db),
    _admin          = Depends(get_current_admin),
):
    """
    Return all pending AI-generated OEM rows grouped by make + model.
    Used by the Pending Review sub-tab in the admin UI.

    Response shape:
      {
        "total": int,
        "groups": [
          {
            "make": "BMW",
            "model": "3 Series",
            "year": 2023,
            "count": 15,
            "items": [ ...OEMScheduleRow... ]
          },
          ...
        ]
      }
    """
    rows = (
        db.query(OEMSchedule)
        .filter(OEMSchedule.review_status == "pending")
        .order_by(OEMSchedule.make, OEMSchedule.model,
                  OEMSchedule.year, OEMSchedule.service_type)
        .all()
    )

    # Group by make + model + year
    groups: dict[tuple, list] = {}
    for row in rows:
        key = (row.make, row.model, row.year)
        if key not in groups:
            groups[key] = []
        groups[key].append(_row_to_dict(row))

    return {
        "total": len(rows),
        "groups": [
            {
                "make":  make,
                "model": model,
                "year":  year,
                "count": len(items),
                "items": items,
            }
            for (make, model, year), items in groups.items()
        ],
    }


@router.post("/oem-schedules/{schedule_id}/approve", status_code=status.HTTP_200_OK)
def approve_oem_schedule(
    schedule_id: int,
    db:   Session = Depends(get_db),
    admin         = Depends(get_current_admin),
):
    """
    Approve a pending AI-generated OEM schedule row.

    Sets review_status='approved' — the row immediately becomes live in the
    upsell engine and recommendations. Records which admin approved and when.
    """
    row = db.query(OEMSchedule).filter(OEMSchedule.id == schedule_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="OEM schedule not found")

    if getattr(row, "review_status", "approved") == "approved":
        return {"message": "Already approved", "id": schedule_id}

    if getattr(row, "review_status", "approved") == "rejected":
        raise HTTPException(
            status_code=400,
            detail="Cannot approve a rejected row. Delete it and regenerate if needed."
        )

    row.review_status        = "approved"
    row.reviewed_by_admin_id = admin.id
    row.reviewed_at          = datetime.now(timezone.utc).replace(tzinfo=None)
    db.commit()
    db.refresh(row)

    return {
        "message":     f"OEM schedule {schedule_id} approved — now live",
        "id":          schedule_id,
        "review_status": "approved",
        "reviewed_by": admin.email,
    }


@router.post("/oem-schedules/{schedule_id}/reject", status_code=status.HTTP_200_OK)
def reject_oem_schedule(
    schedule_id: int,
    db:   Session = Depends(get_db),
    admin         = Depends(get_current_admin),
):
    """
    Reject a pending AI-generated OEM schedule row.

    Sets review_status='rejected' — the row is permanently excluded from
    the engine. The admin should delete and regenerate if the data is salvageable.
    """
    row = db.query(OEMSchedule).filter(OEMSchedule.id == schedule_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="OEM schedule not found")

    if getattr(row, "review_status", "approved") == "approved":
        raise HTTPException(
            status_code=400,
            detail="Cannot reject an already-approved row."
        )

    row.review_status        = "rejected"
    row.reviewed_by_admin_id = admin.id
    row.reviewed_at          = datetime.now(timezone.utc).replace(tzinfo=None)
    db.commit()

    return {
        "message":     f"OEM schedule {schedule_id} rejected",
        "id":          schedule_id,
        "review_status": "rejected",
        "reviewed_by": admin.email,
    }


@router.post("/oem-schedules/approve-all/{make}", status_code=status.HTTP_200_OK)
def approve_all_oem_for_make(
    make: str,
    db:   Session = Depends(get_db),
    admin         = Depends(get_current_admin),
):
    """
    Bulk approve all pending AI-generated OEM rows for a make (e.g. "BMW").

    Most common admin workflow: review the grouped set for a make, then
    approve all at once. Rows that are already approved or rejected are skipped.
    """
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    rows = (
        db.query(OEMSchedule)
        .filter(
            OEMSchedule.make == make,
            OEMSchedule.review_status == "pending",
        )
        .all()
    )

    if not rows:
        return {
            "message": f"No pending rows found for make '{make}'",
            "approved": 0,
        }

    for row in rows:
        row.review_status        = "approved"
        row.reviewed_by_admin_id = admin.id
        row.reviewed_at          = now

    db.commit()

    return {
        "message":  (
            f"Approved {len(rows)} OEM schedule rows for {make} — "
            f"all now live in the upsell engine"
        ),
        "make":     make,
        "approved": len(rows),
    }

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
