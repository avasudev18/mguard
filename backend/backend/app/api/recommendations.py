from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from datetime import datetime
from typing import List, Optional
from pydantic import BaseModel

from app.models.models import Vehicle, ServiceRecord, OEMSchedule, User
from app.models.schemas import RecommendationRequest, RecommendationResponse
from app.utils.database import get_db
from app.services.llm_service import llm_service
from app.services.upsell_rules import evaluate_upsell, build_upsell_hint
from app.utils.auth import get_current_active_user

router = APIRouter()


class SelectedRecommendation(BaseModel):
    service_type: str
    category: str
    reason: str
    interval_miles: Optional[int] = None
    interval_months: Optional[int] = None
    citation: Optional[str] = None
    confidence: Optional[str] = "medium"


class AddRecommendationsRequest(BaseModel):
    vehicle_id: int
    current_mileage: int
    service_date: Optional[str] = None  # ISO date string, defaults to today
    shop_name: Optional[str] = None
    selected_recommendations: List[SelectedRecommendation]

@router.get("/services-due")
async def get_services_due_count(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """
    Fast, deterministic count of services due or due-soon across all user vehicles.
    Uses OEM interval math only — no LLM call.
    A service is "due" when miles_since >= 95% of OEM interval OR days_since >= 95% of interval.
    Returns: { "due_count": int, "due_soon_count": int, "total": int }
    """
    from app.models.models import Invoice

    # Get all vehicles owned by current user
    vehicles = db.query(Vehicle).filter(Vehicle.owner_id == current_user.id).all()
    if not vehicles:
        return {"due_count": 0, "due_soon_count": 0, "total": 0}

    due_count = 0
    due_soon_count = 0
    now = datetime.utcnow()

    for vehicle in vehicles:
        if not vehicle.current_mileage:
            continue

        # Get OEM schedules for this vehicle (same 3-step fallback as recommendations.py)
        # AI-Generated OEM Workflow: only use APPROVED rows
        oem_schedules = db.query(OEMSchedule).filter(
            OEMSchedule.year == vehicle.year,
            OEMSchedule.make == vehicle.make,
            OEMSchedule.model == vehicle.model,
            OEMSchedule.driving_condition == vehicle.driving_condition,
            OEMSchedule.review_status == "approved",
        ).all()

        if not oem_schedules:
            all_years = db.query(OEMSchedule.year).filter(
                OEMSchedule.make == vehicle.make,
                OEMSchedule.model == vehicle.model,
                OEMSchedule.driving_condition == vehicle.driving_condition,
                OEMSchedule.review_status == "approved",
            ).distinct().all()
            if all_years:
                best = min([r[0] for r in all_years], key=lambda y: abs(y - vehicle.year))
                oem_schedules = db.query(OEMSchedule).filter(
                    OEMSchedule.year == best,
                    OEMSchedule.make == vehicle.make,
                    OEMSchedule.model == vehicle.model,
                    OEMSchedule.driving_condition == vehicle.driving_condition,
                    OEMSchedule.review_status == "approved",
                ).all()

        if not oem_schedules:
            all_make_years = db.query(OEMSchedule.year).filter(
                OEMSchedule.make == vehicle.make,
                OEMSchedule.driving_condition == vehicle.driving_condition,
                OEMSchedule.review_status == "approved",
            ).distinct().all()
            if all_make_years:
                best = min([r[0] for r in all_make_years], key=lambda y: abs(y - vehicle.year))
                oem_schedules = db.query(OEMSchedule).filter(
                    OEMSchedule.year == best,
                    OEMSchedule.make == vehicle.make,
                    OEMSchedule.driving_condition == vehicle.driving_condition,
                    OEMSchedule.review_status == "approved",
                ).all()

        if not oem_schedules:
            continue

        # Get service history for this vehicle (non-excluded)
        service_records = db.query(ServiceRecord).filter(
            ServiceRecord.vehicle_id == vehicle.id,
            ServiceRecord.excluded_from_timeline == False
        ).order_by(ServiceRecord.service_date.desc()).all()

        for schedule in oem_schedules:
            # Find most recent matching service record using best-score matching.
            # Best-score prevents "Differential Fluid Change" (score=1) from
            # matching when "Rear Differential Service" (score=3) is the correct entry.
            keywords = [w for w in schedule.service_type.lower().split() if len(w) > 3]
            if keywords:
                scored = [(r, sum(1 for kw in keywords if kw in r.service_type.lower()))
                          for r in service_records]
                max_score = max((s for _, s in scored), default=0)
                matching = [r for r, s in scored if s == max_score and s > 0]
            else:
                matching = []

            if matching:
                latest = matching[0]  # already sorted desc
                miles_since = (
                    vehicle.current_mileage - latest.mileage_at_service
                    if latest.mileage_at_service is not None else None
                )
                if latest.service_date:
                    _svc = latest.service_date.replace(tzinfo=None) if latest.service_date.tzinfo else latest.service_date
                    days_since = (now - _svc).days
                else:
                    days_since = None
            else:
                # Never serviced — treat as overdue if vehicle has mileage > interval
                miles_since = vehicle.current_mileage
                days_since = None

            # Check if due (>= 100% of interval) or due soon (>= 90%)
            is_due = False
            is_due_soon = False

            if schedule.interval_miles and miles_since is not None:
                ratio = miles_since / schedule.interval_miles
                if ratio >= 1.0:
                    is_due = True
                elif ratio >= 0.90:
                    is_due_soon = True

            if not is_due and schedule.interval_months and days_since is not None:
                ratio = (days_since / 30) / schedule.interval_months
                if ratio >= 1.0:
                    is_due = True
                elif ratio >= 0.90:
                    is_due_soon = True

            if is_due:
                due_count += 1
            elif is_due_soon:
                due_soon_count += 1

    return {
        "due_count": due_count,
        "due_soon_count": due_soon_count,
        "total": due_count + due_soon_count,
    }


@router.post("/", response_model=RecommendationResponse)
async def get_recommendations(
    request: RecommendationRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """
    Generate maintenance recommendations based on vehicle, mileage, and service history
    """
    
    # Get vehicle — only if owned by the current user
    vehicle = db.query(Vehicle).filter(
        Vehicle.id == request.vehicle_id,
        Vehicle.owner_id == current_user.id
    ).first()
    
    if not vehicle:
        raise HTTPException(status_code=404, detail="Vehicle not found")
    
    # Get service history — exclude records from proven disputes so they don't
    # pollute the OEM interval calculations or reset upsell detection baselines
    service_records = db.query(ServiceRecord)\
        .filter(
            ServiceRecord.vehicle_id == request.vehicle_id,
            ServiceRecord.excluded_from_timeline == False
        )\
        .order_by(ServiceRecord.service_date.desc())\
        .all()
    
    # Format service history for LLM
    service_history = []
    for record in service_records:
        miles_since = (request.current_mileage - record.mileage_at_service) if record.mileage_at_service is not None else None
        days_since = (datetime.utcnow() - record.service_date).days if record.service_date else None
        service_history.append({
            "service_type": record.service_type,
            "date": record.service_date.isoformat(),
            "mileage": record.mileage_at_service,
            "miles_since_service": miles_since,
            "days_since_service": days_since,
            "shop": record.shop_name,
            "description": record.service_description
        })

    # Get OEM schedule for this vehicle
    # AI-Generated OEM Workflow: only use APPROVED rows — pending rows are
    # excluded until an admin reviews and approves them in the admin UI.
    # Step 1: Try exact match (year + make + model)
    oem_schedules = db.query(OEMSchedule)\
        .filter(
            OEMSchedule.year == vehicle.year,
            OEMSchedule.make == vehicle.make,
            OEMSchedule.model == vehicle.model,
            OEMSchedule.driving_condition == request.driving_condition,
            OEMSchedule.review_status == "approved",
        )\
        .all()

    matched_year = vehicle.year

    # Step 2: If no exact match, find the closest year for same make+model
    if not oem_schedules:
        all_years = db.query(OEMSchedule.year)\
            .filter(
                OEMSchedule.make == vehicle.make,
                OEMSchedule.model == vehicle.model,
                OEMSchedule.driving_condition == request.driving_condition,
                OEMSchedule.review_status == "approved",
            )\
            .distinct()\
            .all()

        if all_years:
            available_years = [row[0] for row in all_years]
            matched_year = min(available_years, key=lambda y: abs(y - vehicle.year))
            oem_schedules = db.query(OEMSchedule)\
                .filter(
                    OEMSchedule.year == matched_year,
                    OEMSchedule.make == vehicle.make,
                    OEMSchedule.model == vehicle.model,
                    OEMSchedule.driving_condition == request.driving_condition,
                    OEMSchedule.review_status == "approved",
                )\
                .all()

    # Step 3: If still no match, fall back to same make only (closest year, any model)
    if not oem_schedules:
        all_make_years = db.query(OEMSchedule.year)\
            .filter(
                OEMSchedule.make == vehicle.make,
                OEMSchedule.driving_condition == request.driving_condition,
                OEMSchedule.review_status == "approved",
            )\
            .distinct()\
            .all()

        if all_make_years:
            available_years = [row[0] for row in all_make_years]
            matched_year = min(available_years, key=lambda y: abs(y - vehicle.year))
            oem_schedules = db.query(OEMSchedule)\
                .filter(
                    OEMSchedule.year == matched_year,
                    OEMSchedule.make == vehicle.make,
                    OEMSchedule.driving_condition == request.driving_condition,
                    OEMSchedule.review_status == "approved",
                )\
                .all()

    # Format OEM schedules
    year_note = f" (using {matched_year} {vehicle.make} schedule as closest available match)" \
        if matched_year != vehicle.year and oem_schedules else ""

    oem_schedule_data_raw = []
    for schedule in oem_schedules:
        oem_schedule_data_raw.append({
            "service_type": schedule.service_type,
            "interval_miles": schedule.interval_miles,
            "interval_months": schedule.interval_months,
            "citation": (schedule.citation or "") + year_note,
            "notes": schedule.notes or ""
        })

    # Deduplicate rows that share the same service_type (e.g. two 'Oil Change' rows —
    # one conventional at 5,000 mi, one synthetic at 10,000 mi).
    # Without deduplication the upsell loop would run evaluate_upsell() for both rows
    # and could flag the service using whichever row happens to iterate last.
    #
    # Tiebreaker for oil changes: when the vehicle has no known oil-type preference,
    # default to the LOWER interval (conventional / more conservative).  The synthetic
    # extended interval only applies when confirmed by service history description keywords.
    # For all other service types: keep the row with the lower interval (more conservative).
    from app.services.upsell_rules import _is_synthetic as _upsell_is_synthetic

    def _dedup_oem_schedules(rows: list[dict], service_history: list[dict]) -> list[dict]:
        """Collapse duplicate service_type rows to a single canonical row per type."""
        from collections import defaultdict
        grouped: dict[str, list[dict]] = defaultdict(list)
        for row in rows:
            grouped[row["service_type"].lower()].append(row)

        result = []
        for stype_lower, group in grouped.items():
            if len(group) == 1:
                result.append(group[0])
                continue

            # Multiple rows for this service type — pick one.
            # Check whether the most recent matching service history record indicates synthetic oil.
            recent_desc = ""
            history_keywords = [kw for kw in stype_lower.split() if len(kw) > 3]
            if history_keywords and service_history:
                scored = [
                    (r, sum(1 for kw in history_keywords if kw in r["service_type"].lower()))
                    for r in service_history
                ]
                max_score = max((s for _, s in scored), default=0)
                if max_score > 0:
                    best_record = min(
                        [r for r, s in scored if s == max_score],
                        key=lambda r: r.get("miles_since_service") or 999_999
                    )
                    recent_desc = best_record.get("description") or ""

            confirmed_synthetic = _upsell_is_synthetic(stype_lower, recent_desc)

            # Sort by interval_miles: pick highest for confirmed synthetic, lowest otherwise.
            sortable = [r for r in group if r.get("interval_miles") is not None]
            none_interval = [r for r in group if r.get("interval_miles") is None]

            if not sortable:
                result.append(group[0])
                continue

            sortable.sort(key=lambda r: r["interval_miles"])
            chosen = sortable[-1] if confirmed_synthetic else sortable[0]
            result.append(chosen)
            # Rows with no interval_miles are discarded when a better row exists.
            if not sortable:
                result.extend(none_interval)

        return result

    oem_schedule_data = _dedup_oem_schedules(oem_schedule_data_raw, service_history)

    # If no OEM schedule data at all, return generic message
    if not oem_schedule_data:
        return RecommendationResponse(
            vehicle_id=request.vehicle_id,
            vehicle_info=f"{vehicle.year} {vehicle.make} {vehicle.model}",
            current_mileage=request.current_mileage,
            recommendations=[
                {
                    "service_type": "OEM Schedule Not Available",
                    "category": "optional",
                    "reason": f"No OEM maintenance schedule data available for {vehicle.make} {vehicle.model}. Please consult your owner's manual or add OEM schedule data.",
                    "interval_miles": None,
                    "interval_months": None,
                    "last_performed_date": None,
                    "last_performed_mileage": None,
                    "citation": "Owner's Manual",
                    "confidence": "low",
                    "is_upsell_flag": False,
                    "upsell_reason": None
                }
            ],
            generated_at=datetime.utcnow()
        )
    
    # Pre-compute upsell flags deterministically BEFORE calling the LLM.
    # All business rules (synthetic oil, zero-dollar, recall exemptions, etc.)
    # are applied here via the upsell_rules module.
    upsell_hints = []
    for schedule in oem_schedule_data:
        s_type = schedule["service_type"]
        interval_miles = schedule.get("interval_miles")
        interval_months = schedule.get("interval_months")

        # Find most recent matching service record using best-score matching.
        keywords = [kw for kw in s_type.lower().split() if len(kw) > 3]
        if keywords:
            scored = [(r, sum(1 for kw in keywords if kw in r["service_type"].lower()))
                      for r in service_history]
            max_score = max((s for _, s in scored), default=0)
            matching_records = [r for r, s in scored if s == max_score and s > 0]
        else:
            matching_records = []
        if not matching_records:
            continue

        # Pick the most recently performed record (smallest miles_since_service)
        latest = min(
            matching_records,
            key=lambda r: r.get("miles_since_service") if r.get("miles_since_service") is not None else 999_999
        )
        miles_since = latest.get("miles_since_service")
        days_since  = latest.get("days_since_service")

        # Find the second-most-recent matching record to use as prior_service_description.
        # This detects oil-type switches: if the latest record is synthetic but the one
        # before it was conventional, Rule 3 in upsell_rules must not apply the synthetic
        # interval threshold (the latest service was itself the first synthetic fill).
        other_matching = [r for r in matching_records if r is not latest]
        prior_for_switch = min(
            other_matching,
            key=lambda r: r.get("miles_since_service") if r.get("miles_since_service") is not None else 999_999
        ) if other_matching else None
        prior_desc_for_switch = prior_for_switch.get("description") or "" if prior_for_switch else ""

        # Apply the upsell rules engine
        decision = evaluate_upsell(
            service_type=s_type,
            service_description=latest.get("description") or "",
            # Service history records don't carry pricing; pass None so the
            # zero-dollar exemption is skipped (it applies at confirm-time).
            line_total=None,
            unit_price=None,
            miles_since_last_service=miles_since,
            days_since_last_service=days_since,
            oem_interval_miles=interval_miles,
            oem_interval_months=interval_months,
            driving_condition=request.driving_condition,
            # Same value already used to select the correct OEM rows above.
            # Threading it here ensures upsell thresholds match the interval
            # set (normal vs severe) that was retrieved from oem_schedules.
            prior_service_description=prior_desc_for_switch,
            # ── Dynamic threshold: pass vehicle context so resolve_threshold()
            # can apply make/model/year-specific overrides when present.
            vehicle_make  = vehicle.make,
            vehicle_model = vehicle.model,
            vehicle_year  = vehicle.year,
            db            = db,
        )

        # skip_flag = exempt service (recall, courtesy) — never add as a hint
        if decision.skip_flag:
            continue

        if decision.is_upsell:
            upsell_hints.append(
                build_upsell_hint(
                    service_type=s_type,
                    decision=decision,
                    last_performed_mileage=latest["mileage"],
                    last_performed_date=latest["date"],
                    miles_since=miles_since,
                    days_since=days_since,
                    oem_interval_miles=interval_miles,
                    oem_interval_months=interval_months,
                )
            )

    # Generate recommendations using LLM
    vehicle_info = {
        "year": vehicle.year,
        "make": vehicle.make,
        "model": vehicle.model,
        "trim": vehicle.trim
    }

    result = await llm_service.generate_recommendations(
        vehicle_info=vehicle_info,
        current_mileage=request.current_mileage,
        service_history=service_history,
        oem_schedules=oem_schedule_data,
        driving_condition=request.driving_condition,
        upsell_hints=upsell_hints,
        db=db,
        user_id=current_user.id,
    )
    
    if not result.get("success"):
        raise HTTPException(
            status_code=500,
            detail=f"Failed to generate recommendations: {result.get('error')}"
        )

    # ── Deterministic post-processing ────────────────────────────────────────
    # The LLM is not reliable for two fields:
    #   1. last_performed_date  — it generates dates instead of copying from input
    #   2. last_performed_mileage — same risk
    # Both are overwritten here using the same keyword-matching logic that runs
    # in the upsell-hints loop above. The LLM's values are discarded entirely.
    #
    # We also clamp just-performed services regardless of what the LLM returned.

    # Build a lookup: service_type_lower → most recent matching history record
    # Uses best-score keyword matching identical to the upsell-hints loop.
    def _find_latest_record(service_type: str) -> dict | None:
        keywords = [kw for kw in service_type.lower().split() if len(kw) > 3]
        if not keywords or not service_history:
            return None
        scored = [
            (r, sum(1 for kw in keywords if kw in r["service_type"].lower()))
            for r in service_history
        ]
        max_score = max((s for _, s in scored), default=0)
        if max_score == 0:
            return None
        matching = [r for r, s in scored if s == max_score]
        # service_history is already sorted desc by date; return the first match
        return matching[0]

    # Build set of just-performed service types (0 miles or 0 days since service)
    just_performed_types: set = set()
    for record in service_history:
        if record.get("miles_since_service") == 0 or record.get("days_since_service") == 0:
            just_performed_types.add(record["service_type"].lower())

    corrected_recommendations = []
    for rec in result["recommendations"]:
        rec_type_lower = rec.get("service_type", "").lower()

        # ── Overwrite last_performed_date and last_performed_mileage ──────────
        # Find the most recent matching service record and use its values
        # directly, discarding whatever the LLM generated.
        latest = _find_latest_record(rec.get("service_type", ""))
        if latest:
            rec["last_performed_date"] = latest["date"]
            rec["last_performed_mileage"] = latest["mileage"]
        else:
            rec["last_performed_date"] = None
            rec["last_performed_mileage"] = None

        # ── Clamp just-performed services ─────────────────────────────────────
        is_just_performed = any(
            jp in rec_type_lower or rec_type_lower in jp
            for jp in just_performed_types
        )
        if is_just_performed and rec.get("category") in ("recommended_now", "due_soon", "overdue"):
            rec["category"] = "not_needed"
            rec["reason"] = "Just performed today — not due again until the next OEM interval."
            rec["is_upsell_flag"] = False
            rec["upsell_reason"] = None

        corrected_recommendations.append(rec)

    return RecommendationResponse(
        vehicle_id=request.vehicle_id,
        vehicle_info=f"{vehicle.year} {vehicle.make} {vehicle.model}",
        current_mileage=request.current_mileage,
        recommendations=corrected_recommendations,
        generated_at=datetime.utcnow()
    )


@router.post("/add-to-history")
async def add_recommendations_to_history(
    request: AddRecommendationsRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """
    Add user-selected recommendations as service records.
    Called when user checks recommendations and clicks 'Add to Service History'.
    """
    vehicle = db.query(Vehicle).filter(
        Vehicle.id == request.vehicle_id,
        Vehicle.owner_id == current_user.id
    ).first()
    if not vehicle:
        raise HTTPException(status_code=404, detail="Vehicle not found")

    # Parse service date (default to today)
    if request.service_date:
        try:
            service_date = datetime.fromisoformat(request.service_date)
        except ValueError:
            service_date = datetime.utcnow()
    else:
        service_date = datetime.utcnow()

    created_records = []
    for rec in request.selected_recommendations:
        service_record = ServiceRecord(
            vehicle_id=request.vehicle_id,
            invoice_id=None,
            service_date=service_date,
            mileage_at_service=request.current_mileage,
            service_type=rec.service_type,
            service_description=rec.reason,
            shop_name=request.shop_name or "Added from Recommendations",
            is_manual_entry=True,
            notes=f"Added from recommendations. Category: {rec.category}. Citation: {rec.citation or 'N/A'}. Confidence: {rec.confidence}."
        )
        db.add(service_record)
        created_records.append(rec.service_type)

    # Update vehicle current mileage if higher
    if vehicle.current_mileage is None or request.current_mileage > vehicle.current_mileage:
        vehicle.current_mileage = request.current_mileage

    db.commit()

    return {
        "message": f"Successfully added {len(created_records)} service record(s) to history",
        "added_services": created_records,
        "service_date": service_date.isoformat(),
        "mileage": request.current_mileage
    }
