"""
app/api/vehicles.py

Handles vehicle CRUD for authenticated users.

── AI-Generated OEM Workflow (new) ──────────────────────────────────────────
After create_vehicle() returns, a FastAPI BackgroundTask fires:

  _seed_oem_for_vehicle(vehicle_id, year, make, model, db_factory)

  1. Opens a fresh DB session (the request session closes after response).
  2. Checks whether any APPROVED OEMSchedule rows exist for this make.
     If yes → skip (Toyota, BMW already seeded, etc.).
  3. Calls Claude API (claude-haiku-4-5) with a structured prompt requesting
     a JSON maintenance schedule for this vehicle.
  4. Parses and validates the response.
  5. Inserts OEMSchedule rows with:
       source        = 'ai_generated'
       review_status = 'pending'      ← NOT live until admin approves
  6. Triggers embedding_service.embed_oem_batch() for ARIA RAG.
  7. Logs outcome — no exception is ever raised to the user.

The user sees their vehicle immediately. The OEM seeding is invisible.
While rows are pending the upsell engine falls back to generic intervals
(Flaw 7 fix) — no blind spot during the review window.
─────────────────────────────────────────────────────────────────────────────
"""

import os
import json
import logging
from typing import List

from fastapi import APIRouter, Depends, HTTPException, Query, BackgroundTasks
from sqlalchemy.orm import Session
from sqlalchemy import func

from app.models.models import Vehicle, Invoice, DisputeResolution, User, OEMSchedule
from app.models.schemas import VehicleCreate, VehicleUpdate, VehicleResponse
from app.utils.database import get_db, SessionLocal
from app.utils.auth import get_current_active_user

router = APIRouter()
log = logging.getLogger(__name__)

# ── OEM seeding constants ─────────────────────────────────────────────────────
_OEM_SEED_MODEL  = "claude-haiku-4-5-20251001"
_OEM_SEED_SOURCE = "ai_generated"
_OEM_SEED_STATUS = "pending"

# ── AI-Generated OEM seeding prompt ───────────────────────────────────────────
_OEM_SEED_PROMPT = """\
You are an automotive maintenance expert. Generate a standard maintenance schedule
for a {year} {make} {model}.

Return ONLY a JSON array. No preamble, no explanation, no markdown.

Each element must have exactly these fields:
  service_type     : string  (e.g. "Oil Change", "Tire Rotation")
  interval_miles   : integer or null  (miles between services)
  interval_months  : integer or null  (months between services)
  driving_condition: "normal" or "severe"
  notes            : string  (brief rationale, max 100 chars)

Rules:
- Include both "normal" and "severe" rows for oil change and fluid services.
- Use conservative intervals (shorter than OEM maximums).
- Include: Oil Change, Tire Rotation, Brake Fluid, Transmission Fluid,
  Coolant Flush, Spark Plugs, Cabin Air Filter, Engine Air Filter,
  Brake Inspection.
- Do NOT include: recalls, warranties, or services specific to one trim.
- Respond with valid JSON only. No trailing commas. No comments.

Example element:
{{"service_type": "Oil Change", "interval_miles": 5000, "interval_months": 6,
  "driving_condition": "normal", "notes": "Standard conventional oil interval."}}
"""


# ── Background task ────────────────────────────────────────────────────────────

def _seed_oem_for_vehicle(vehicle_id: int, year: int, make: str, model: str) -> None:
    """
    BackgroundTask: generate and insert AI OEM schedule rows for a new vehicle
    whose make has no existing approved OEM data in the database.

    Runs AFTER the HTTP response is sent — user never waits for this.
    All exceptions are caught and logged — never surfaces to the user.

    Steps:
      1. Open fresh DB session.
      2. Check for existing approved rows for this make → skip if found.
      3. Call Claude claude-haiku-4-5 with structured JSON prompt.
      4. Parse + validate response.
      5. Insert rows: source='ai_generated', review_status='pending'.
      6. Trigger embed_oem_batch() for ARIA RAG readiness.
      7. Log outcome.
    """
    db: Session = SessionLocal()
    try:
        # ── Step 2: Check if approved OEM data already exists for this make ──
        existing = db.query(OEMSchedule).filter(
            OEMSchedule.make == make,
            OEMSchedule.review_status == "approved",
        ).first()

        if existing:
            log.info(
                "[OEM_SEED] vehicle_id=%s make=%r — approved OEM data exists, skipping",
                vehicle_id, make,
            )
            return

        # Also skip if pending rows already exist (avoid duplicate generation
        # when the same make is added by multiple users simultaneously)
        pending_exists = db.query(OEMSchedule).filter(
            OEMSchedule.make == make,
            OEMSchedule.review_status == "pending",
        ).first()

        if pending_exists:
            log.info(
                "[OEM_SEED] vehicle_id=%s make=%r — pending OEM rows already exist, skipping",
                vehicle_id, make,
            )
            return

        # ── Step 3: Call Claude API ──────────────────────────────────────────
        api_key = os.getenv("ANTHROPIC_API_KEY")
        if not api_key:
            log.error("[OEM_SEED] ANTHROPIC_API_KEY not set — cannot seed OEM data")
            return

        from anthropic import Anthropic
        client = Anthropic(api_key=api_key)

        prompt = _OEM_SEED_PROMPT.format(year=year, make=make, model=model)

        log.info(
            "[OEM_SEED] Calling Claude for vehicle_id=%s %s %s %s",
            vehicle_id, year, make, model,
        )

        response = client.messages.create(
            model=_OEM_SEED_MODEL,
            max_tokens=2048,
            messages=[{"role": "user", "content": prompt}],
        )

        raw = response.content[0].text.strip()

        # ── Step 4: Parse and validate ───────────────────────────────────────
        # Strip markdown fences if model wrapped the response
        if raw.startswith("```"):
            raw = "\n".join(
                line for line in raw.splitlines()
                if not line.startswith("```")
            ).strip()

        try:
            rows_data = json.loads(raw)
        except json.JSONDecodeError as e:
            log.error(
                "[OEM_SEED] vehicle_id=%s — JSON parse failed: %s\nRaw: %s",
                vehicle_id, e, raw[:500],
            )
            return

        if not isinstance(rows_data, list):
            log.error(
                "[OEM_SEED] vehicle_id=%s — expected JSON array, got %s",
                vehicle_id, type(rows_data).__name__,
            )
            return

        # ── Step 5: Insert OEMSchedule rows ─────────────────────────────────
        inserted = 0
        skipped  = 0
        for item in rows_data:
            # Validate required fields
            if not isinstance(item, dict):
                skipped += 1
                continue
            service_type = item.get("service_type", "").strip()
            if not service_type:
                skipped += 1
                continue
            driving_condition = item.get("driving_condition", "normal")
            if driving_condition not in ("normal", "severe"):
                driving_condition = "normal"
            interval_miles  = item.get("interval_miles")
            interval_months = item.get("interval_months")
            notes = (item.get("notes") or "")[:500]

            # Validate numeric fields
            if interval_miles is not None:
                try:
                    interval_miles = int(interval_miles)
                    if interval_miles <= 0:
                        interval_miles = None
                except (TypeError, ValueError):
                    interval_miles = None
            if interval_months is not None:
                try:
                    interval_months = int(interval_months)
                    if interval_months <= 0:
                        interval_months = None
                except (TypeError, ValueError):
                    interval_months = None

            # Both None → no interval to evaluate, skip
            if interval_miles is None and interval_months is None:
                skipped += 1
                continue

            row = OEMSchedule(
                year              = year,
                make              = make,
                model             = model,
                trim              = None,
                service_type      = service_type,
                interval_miles    = interval_miles,
                interval_months   = interval_months,
                driving_condition = driving_condition,
                citation          = (
                    f"AI-generated for {year} {make} {model} — "
                    f"pending admin review"
                ),
                notes             = notes or None,
                source            = _OEM_SEED_SOURCE,   # 'ai_generated'
                review_status     = _OEM_SEED_STATUS,   # 'pending'
            )
            db.add(row)
            inserted += 1

        db.commit()
        log.info(
            "[OEM_SEED] vehicle_id=%s %s %s %s — inserted=%s skipped=%s",
            vehicle_id, year, make, model, inserted, skipped,
        )

        # ── Step 6: Generate embeddings for ARIA RAG ─────────────────────────
        # embed_oem_batch() processes all rows with NULL content_embedding,
        # including the new pending rows. Embeddings are ready for ARIA as soon
        # as the admin approves the rows.
        if inserted > 0:
            try:
                from app.services.embedding_service import embedding_service
                embedded = embedding_service.embed_oem_batch(db)
                log.info("[OEM_SEED] Embedded %s new OEM rows for ARIA", embedded)
            except Exception as embed_err:
                log.warning(
                    "[OEM_SEED] Embedding failed (non-fatal): %s", embed_err
                )

    except Exception as e:
        log.exception(
            "[OEM_SEED] Unexpected error for vehicle_id=%s make=%r: %s",
            vehicle_id, make, e,
        )
    finally:
        db.close()


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("/", response_model=VehicleResponse, status_code=201)
async def create_vehicle(
    vehicle: VehicleCreate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """
    Create a new vehicle profile owned by the current user.

    ── AI-Generated OEM Workflow ─────────────────────────────────────────────
    After the vehicle row is committed and the response is sent, a BackgroundTask
    fires to seed AI-generated OEM maintenance intervals if no approved data
    exists for this vehicle's make. The seeded rows start as 'pending' and are
    NOT used by the upsell engine until an admin approves them.
    ─────────────────────────────────────────────────────────────────────────
    """
    # VIN uniqueness check — only block if the same user already has this VIN
    if vehicle.vin:
        existing = db.query(Vehicle).filter(
            Vehicle.vin == vehicle.vin,
            Vehicle.owner_id == current_user.id
        ).first()
        if existing:
            raise HTTPException(
                status_code=409,
                detail={
                    "code": "VIN_ALREADY_REGISTERED",
                    "message": (
                        f"VIN {vehicle.vin} is already registered to a vehicle "
                        f"on your account."
                    ),
                }
            )

    db_vehicle = Vehicle(
        owner_id          = current_user.id,
        year              = vehicle.year,
        make              = vehicle.make,
        model             = vehicle.model,
        trim              = vehicle.trim,
        vin               = vehicle.vin,
        nickname          = vehicle.nickname,
        current_mileage   = vehicle.current_mileage,
        driving_condition = vehicle.driving_condition,
    )

    db.add(db_vehicle)
    db.commit()
    db.refresh(db_vehicle)

    # ── Fire-and-forget OEM seeding ───────────────────────────────────────────
    # Runs AFTER the response is returned — user sees their vehicle immediately.
    # _seed_oem_for_vehicle opens its own DB session so the request session can
    # close cleanly. All errors are caught inside the task.
    background_tasks.add_task(
        _seed_oem_for_vehicle,
        vehicle_id = db_vehicle.id,
        year       = db_vehicle.year,
        make       = db_vehicle.make,
        model      = db_vehicle.model,
    )
    log.info(
        "[VEHICLE_CREATE] vehicle_id=%s %s %s %s — OEM seed task queued",
        db_vehicle.id, db_vehicle.year, db_vehicle.make, db_vehicle.model,
    )

    return db_vehicle


@router.get("/", response_model=List[VehicleResponse])
async def get_vehicles(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Get all vehicles belonging to the current user"""
    return db.query(Vehicle).filter(Vehicle.owner_id == current_user.id).all()


@router.get("/fleet-summary")
async def get_fleet_summary(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """
    Returns fleet-wide stats for the dashboard:
    - proven_savings: sum of refund_amount from resolved (proven) disputes
    - open_disputes:  count of invoices currently in 'disputed' status
    """
    vehicle_ids = [
        row.id for row in
        db.query(Vehicle.id).filter(Vehicle.owner_id == current_user.id).all()
    ]

    if not vehicle_ids:
        return {"proven_savings": 0.0, "open_disputes": 0}

    proven_savings = db.query(
        func.coalesce(func.sum(DisputeResolution.refund_amount), 0)
    ).filter(
        DisputeResolution.vehicle_id.in_(vehicle_ids),
        DisputeResolution.resolution_status == "proven"
    ).scalar()

    open_disputes = db.query(func.count(Invoice.id)).filter(
        Invoice.vehicle_id.in_(vehicle_ids),
        Invoice.dispute_status == "disputed"
    ).scalar()

    upsell_rows = (
        db.query(DisputeResolution.vehicle_id, func.count(DisputeResolution.id))
        .filter(
            DisputeResolution.vehicle_id.in_(vehicle_ids),
            DisputeResolution.dispute_type == "upsell",
            DisputeResolution.resolution_status == "proven",
        )
        .group_by(DisputeResolution.vehicle_id)
        .all()
    )
    upsells_per_vehicle = {str(vid): count for vid, count in upsell_rows}

    return {
        "proven_savings":      float(proven_savings or 0),
        "open_disputes":       int(open_disputes or 0),
        "upsells_per_vehicle": upsells_per_vehicle,
    }


@router.get("/{vehicle_id}", response_model=VehicleResponse)
async def get_vehicle(
    vehicle_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Get a specific vehicle by ID — only if owned by the current user"""
    vehicle = db.query(Vehicle).filter(
        Vehicle.id == vehicle_id,
        Vehicle.owner_id == current_user.id
    ).first()
    if not vehicle:
        raise HTTPException(status_code=404, detail="Vehicle not found")
    return vehicle


@router.put("/{vehicle_id}", response_model=VehicleResponse)
async def update_vehicle(
    vehicle_id: int,
    vehicle_update: VehicleUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Update vehicle information — only if owned by the current user"""
    vehicle = db.query(Vehicle).filter(
        Vehicle.id == vehicle_id,
        Vehicle.owner_id == current_user.id
    ).first()
    if not vehicle:
        raise HTTPException(status_code=404, detail="Vehicle not found")

    if vehicle_update.current_mileage is not None:
        vehicle.current_mileage = vehicle_update.current_mileage
    if vehicle_update.nickname is not None:
        vehicle.nickname = vehicle_update.nickname
    if vehicle_update.vin is not None:
        if vehicle_update.vin != vehicle.vin:
            existing = db.query(Vehicle).filter(
                Vehicle.vin == vehicle_update.vin,
                Vehicle.owner_id == current_user.id,
                Vehicle.id != vehicle_id
            ).first()
            if existing:
                raise HTTPException(
                    status_code=409,
                    detail={
                        "code": "VIN_ALREADY_REGISTERED",
                        "message": (
                            f"VIN {vehicle_update.vin} is already registered to "
                            f"another vehicle on your account."
                        ),
                    }
                )
        vehicle.vin = vehicle_update.vin

    if vehicle_update.driving_condition is not None:
        vehicle.driving_condition = vehicle_update.driving_condition

    db.commit()
    db.refresh(vehicle)
    return vehicle


@router.get("/{vehicle_id}/invoice-search")
async def search_invoices(
    vehicle_id: int,
    service_type: str = None,
    q: str = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Search/filter invoices by service type or shop name keyword."""
    from sqlalchemy import or_
    from app.models.models import InvoiceLineItem

    vehicle = db.query(Vehicle).filter(
        Vehicle.id == vehicle_id,
        Vehicle.owner_id == current_user.id
    ).first()
    if not vehicle:
        raise HTTPException(status_code=404, detail="Vehicle not found")

    invoice_query = db.query(Invoice).filter(
        Invoice.vehicle_id == vehicle_id,
        Invoice.is_archived == False,
    )

    if q:
        matching_ids = [
            row.invoice_id for row in
            db.query(InvoiceLineItem.invoice_id).filter(
                InvoiceLineItem.service_type.ilike(f"%{q}%")
            ).distinct().all()
        ]
        invoice_query = invoice_query.filter(
            or_(
                Invoice.shop_name.ilike(f"%{q}%"),
                Invoice.id.in_(matching_ids)
            )
        )

    if service_type:
        matching_ids = [
            row.invoice_id for row in
            db.query(InvoiceLineItem.invoice_id).filter(
                InvoiceLineItem.service_type == service_type
            ).distinct().all()
        ]
        invoice_query = invoice_query.filter(Invoice.id.in_(matching_ids))

    invoices = invoice_query.order_by(Invoice.service_date.desc()).all()

    return [
        {
            "id":              inv.id,
            "shop_name":       inv.shop_name,
            "service_date":    inv.service_date,
            "mileage_at_service": inv.mileage_at_service,
            "total_amount":    inv.total_amount,
            "dispute_status":  inv.dispute_status,
            "has_active_dispute": inv.dispute_status == "disputed",
            "service_tags": list({
                li.service_type for li in inv.line_items if li.service_type
            }),
        }
        for inv in invoices
    ]


@router.delete("/{vehicle_id}", status_code=204)
async def delete_vehicle(
    vehicle_id: int,
    force: bool = Query(
        default=False,
        description="Set to true to confirm deletion even when dispute audit records exist"
    ),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Delete a vehicle and all associated data."""
    vehicle = db.query(Vehicle).filter(
        Vehicle.id == vehicle_id,
        Vehicle.owner_id == current_user.id
    ).first()
    if not vehicle:
        raise HTTPException(status_code=404, detail="Vehicle not found")

    invoice_ids = [
        row.id for row in
        db.query(Invoice.id).filter(Invoice.vehicle_id == vehicle_id).all()
    ]

    audit_count = 0
    if invoice_ids:
        audit_count = db.query(DisputeResolution)\
            .filter(DisputeResolution.invoice_id.in_(invoice_ids))\
            .count()

    if audit_count > 0 and not force:
        raise HTTPException(
            status_code=409,
            detail={
                "type": "dispute_audit_records_exist",
                "audit_record_count": audit_count,
                "message": (
                    f"This vehicle has {audit_count} dispute audit record(s) that will be "
                    f"permanently deleted along with the vehicle. These records exist because "
                    f"you previously raised and resolved disputes on invoices for this vehicle. "
                    f"Deleting them removes your evidence trail permanently. "
                    f"Are you sure you want to proceed?"
                )
            }
        )

    if invoice_ids and audit_count > 0:
        db.query(DisputeResolution)\
            .filter(DisputeResolution.invoice_id.in_(invoice_ids))\
            .delete(synchronize_session=False)

    db.delete(vehicle)
    db.commit()
    return None
