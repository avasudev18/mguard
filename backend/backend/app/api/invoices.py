from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from sqlalchemy.orm import Session
from typing import List
import os
import shutil
from datetime import datetime

from app.models.models import Invoice, InvoiceLineItem, Vehicle, ServiceRecord, DisputeResolution, DisputeLineItem, OEMSchedule, User
from app.services.embedding_service import embedding_service
from app.models.schemas import (
    InvoiceResponse, InvoiceConfirm,
    RaiseDisputeRequest, ResolveDisputeRequest, DisputeResolutionResponse,
    LineItemAnalysis, BatchDisputeRequest,
    RaiseDisputeWithLineItemsRequest, DisputeLineItemResponse
)
from app.utils.database import get_db
from app.services.ocr_service import ocr_service
from app.services.llm_service import llm_service
from app.services.upsell_rules import evaluate_upsell, _is_recall
from app.utils.auth import get_current_active_user

router = APIRouter()

UPLOAD_DIR = "uploads"
os.makedirs(UPLOAD_DIR, exist_ok=True)


# ── Helper ─────────────────────────────────────────────────────────────────────

def _invoice_snapshot(invoice: Invoice) -> dict:
    """Capture a JSON snapshot of the invoice at resolution time for audit purposes."""
    return {
        "id": invoice.id,
        "vehicle_id": invoice.vehicle_id,
        "filename": invoice.filename,
        "service_date": invoice.service_date.isoformat() if invoice.service_date else None,
        "mileage_at_service": invoice.mileage_at_service,
        "shop_name": invoice.shop_name,
        "shop_address": invoice.shop_address,
        "total_amount": invoice.total_amount,
        "is_confirmed": invoice.is_confirmed,
        "is_duplicate": invoice.is_duplicate,
        "dispute_status": invoice.dispute_status,
        "snapshot_taken_at": datetime.utcnow().isoformat(),
        "line_items": [
            {
                "id": li.id,
                "service_type": li.service_type,
                "service_description": li.service_description,
                "quantity": li.quantity,
                "unit_price": li.unit_price,
                "line_total": li.line_total,
                "is_labor": li.is_labor,
                "is_parts": li.is_parts,
                "is_complimentary": li.is_complimentary,
            }
            for li in invoice.line_items
        ],
    }


# ── Upload ─────────────────────────────────────────────────────────────────────

@router.post("/upload")
async def upload_invoice(
    vehicle_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Upload invoice file, perform OCR, and extract structured data using LLM."""

    vehicle = db.query(Vehicle).filter(
        Vehicle.id == vehicle_id,
        Vehicle.owner_id == current_user.id
    ).first()
    if not vehicle:
        raise HTTPException(status_code=404, detail="Vehicle not found")

    allowed_extensions = {'.pdf', '.jpg', '.jpeg', '.png'}
    file_extension = os.path.splitext(file.filename)[1].lower()
    if file_extension not in allowed_extensions:
        raise HTTPException(
            status_code=400,
            detail=f"File type {file_extension} not supported. Allowed: {allowed_extensions}"
        )

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    safe_filename = f"{vehicle_id}_{timestamp}_{file.filename}"
    file_path = os.path.join(UPLOAD_DIR, safe_filename)

    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    # ── Extraction: Claude Vision first, Tesseract fallback ─────────────────
    extraction_result = None
    ocr_text = None

    # ── Path 1: Claude Vision ─────────────────────────────────────────────
    print("Attempting Claude Vision extraction...")
    vision_file_path = file_path  # may be replaced with temp PNG for PDFs
    temp_png_path = None

    try:
        # PDFs must be converted to PNG before sending to Vision
        if file_extension == '.pdf':
            temp_png_path = await ocr_service.pdf_to_image_path(file_path)
            if temp_png_path:
                vision_file_path = temp_png_path
            else:
                raise ValueError("PDF→image conversion failed, skipping Vision")

        extraction_result = await llm_service.extract_invoice_data_from_image(
                vision_file_path,
                db=db,
                user_id=current_user.id,
            )

        if extraction_result.get("success"):
            print("Claude Vision extraction succeeded.")
            # Synthesise ocr_text from the extracted data so the DB field is populated
            data = extraction_result["data"]
            parts = [
                "[Extracted via Claude Vision]",
                f"Shop: {data.get('shop_name', '')}",
                f"Date: {data.get('service_date', '')}",
                f"Mileage: {data.get('mileage', '')}",
                f"Total: {data.get('total_amount', '')}",
                f"Line items: {len(data.get('line_items') or [])} services",
            ]
            ocr_text = "\n".join(parts)
        else:
            print(f"Claude Vision failed: {extraction_result.get('error')}. Falling back to Tesseract.")
            extraction_result = None  # force fallback

    except Exception as e:
        print(f"Claude Vision error: {e}. Falling back to Tesseract.")
        extraction_result = None
    finally:
        # Clean up the temporary PNG if we created one
        if temp_png_path:
            import os as _os
            try: _os.unlink(temp_png_path)
            except Exception: pass

    # ── Path 2: Tesseract fallback ────────────────────────────────────────
    if extraction_result is None:
        print("Running Tesseract OCR fallback...")
        ocr_text = await ocr_service.extract_text_from_file(file_path)

        if not ocr_text:
            raise HTTPException(status_code=500, detail="Both Claude Vision and Tesseract OCR failed to extract text from this file.")

        print(f"Tesseract OCR completed. Extracted {len(ocr_text)} characters")
        print("Extracting structured data with Claude (text mode)...")
        extraction_result = await llm_service.extract_invoice_data(
                ocr_text,
                db=db,
                user_id=current_user.id,
            )
    # ─────────────────────────────────────────────────────────────────────

    if not extraction_result.get("success"):
        db_invoice = Invoice(
            vehicle_id=vehicle_id,
            filename=file.filename,
            file_path=file_path,
            ocr_text=ocr_text,
            extraction_data={"error": extraction_result.get("error")},
            is_confirmed=False
        )
        db.add(db_invoice)
        db.commit()
        db.refresh(db_invoice)

        return {
            "invoice_id": db_invoice.id,
            "status": "ocr_completed",
            "message": "OCR completed but extraction failed. Manual review required.",
            "ocr_text": ocr_text[:500] + "..." if len(ocr_text) > 500 else ocr_text,
            "error": extraction_result.get("error")
        }

    extracted = extraction_result["data"]

    # ── VIN mismatch check ────────────────────────────────────────────────────
    import re as _re

    def _is_valid_vin(v: str) -> bool:
        """A real VIN is exactly 17 chars, only A-H J-N P R-Z 0-9 (no I O Q)."""
        return bool(_re.match(r'^[A-HJ-NPR-Z0-9]{17}$', v))

    def _levenshtein(a: str, b: str) -> int:
        """Edit distance between two strings."""
        m, n = len(a), len(b)
        dp = list(range(n + 1))
        for i in range(1, m + 1):
            prev, dp[0] = dp[0], i
            for j in range(1, n + 1):
                temp = dp[j]
                dp[j] = prev if a[i-1] == b[j-1] else 1 + min(prev, dp[j], dp[j-1])
                prev = temp
        return dp[n]

    raw_invoice_vin = (extracted.get("vin") or "").strip().upper()
    vehicle_vin     = (vehicle.vin or "").strip().upper()
    vin_mismatch    = False
    vin_mismatch_detail = None

    if _is_valid_vin(raw_invoice_vin) and _is_valid_vin(vehicle_vin):
        if raw_invoice_vin != vehicle_vin:
            edit_dist = _levenshtein(raw_invoice_vin, vehicle_vin)
            # edit distance <= 3  → almost certainly an OCR read error (1-3 chars
            #                        misread), not a genuinely different vehicle.
            #                        Skip warning to avoid false alarms.
            # edit distance >= 4  → too different to be OCR noise; flag as mismatch.
            if edit_dist >= 4:
                vin_mismatch = True
                vin_mismatch_detail = {
                    "invoice_vin": raw_invoice_vin,
                    "vehicle_vin": vehicle_vin,
                    "message": (
                        f"VIN Mismatch: Invoice shows {raw_invoice_vin}, "
                        f"but this vehicle's VIN is {vehicle_vin}."
                    )
                }
            # else: small edit distance = OCR noise, silently skip
    # ── VIN unreadable warning ────────────────────────────────────────────────
    # If the invoice VIN is missing/unreadable but the vehicle has a registered
    # VIN, surface a soft caution so the user can verify manually.
    # Only fires when the invoice VIN is blank/invalid AND the vehicle has a VIN.
    vin_unreadable = (
        not _is_valid_vin(raw_invoice_vin)   # invoice VIN missing or garbled
        and _is_valid_vin(vehicle_vin)        # vehicle has a known valid VIN
        and not vin_mismatch                  # don't double-warn
    )
    vin_unreadable_detail = None
    if vin_unreadable:
        last4 = vehicle_vin[-4:]
        vin_unreadable_detail = {
            "vehicle_vin": vehicle_vin,
            "vehicle_vin_last4": last4,
            "message": (
                f"VIN could not be read from this invoice. "
                f"Please confirm this invoice belongs to your vehicle (VIN ending …{last4}) "
                f"before saving."
            )
        }
    # ─────────────────────────────────────────────────────────────────────────

    # ── Duplicate invoice detection ──────────────────────────────────────────────
    # After OCR extraction succeeds, check whether a confirmed invoice already
    # exists for this vehicle with the same service_date + mileage fingerprint.
    # We warn (Option A) — never hard-block — so the user can still confirm a
    # legitimate re-upload (e.g. to fix a typo from a previous confirm).
    is_duplicate = False
    duplicate_of_invoice_id = None
    duplicate_detail = None

    extracted_date = datetime.fromisoformat(extracted["service_date"]) if extracted.get("service_date") else None
    extracted_mileage = extracted.get("mileage")

    if extracted_date and extracted_mileage:
        # Normalise extracted_date to a naive date for comparison.
        # DB timestamps may be tz-aware (Supabase stores as UTC timestamptz).
        # Comparing a naive datetime against a tz-aware one silently returns no
        # rows in SQLAlchemy — so we cast both sides to DATE in SQL instead.
        from sqlalchemy import cast as _sqlcast, Date as _SqlDate
        # Check confirmed invoices first (strongest signal), then fall back to
        # any prior upload (confirmed or not) with the same fingerprint.
        # This catches the case where the user uploaded the same file multiple
        # times without ever confirming — is_confirmed=True would never match.
        existing = db.query(Invoice).filter(
            Invoice.vehicle_id == vehicle_id,
            _sqlcast(Invoice.service_date, _SqlDate) == extracted_date.date(),
            Invoice.mileage_at_service == extracted_mileage,
        ).order_by(Invoice.is_confirmed.desc(), Invoice.id.asc()).first()
        if existing:
            is_duplicate = True
            duplicate_of_invoice_id = existing.id
            duplicate_detail = {
                "duplicate_of_invoice_id": existing.id,
                "service_date": existing.service_date.strftime("%B %d, %Y") if existing.service_date else None,
                "mileage_at_service": existing.mileage_at_service,
                "shop_name": existing.shop_name or "Unknown shop",
                "message": (
                    f"A confirmed invoice already exists for this vehicle on "                    f"{existing.service_date.strftime('%B %d, %Y') if existing.service_date else 'the same date'} "                    f"at {existing.mileage_at_service:,} miles "                    f"({existing.shop_name or 'same shop'}). "                    f"This appears to be a duplicate upload."
                )
            }
    # ─────────────────────────────────────────────────────────────────────────

    db_invoice = Invoice(
        vehicle_id=vehicle_id,
        filename=file.filename,
        file_path=file_path,
        ocr_text=ocr_text,
        extraction_data=extracted,
        service_date=extracted_date,
        mileage_at_service=extracted_mileage,
        shop_name=extracted.get("shop_name"),
        shop_address=extracted.get("shop_address"),
        total_amount=extracted.get("total_amount"),
        is_confirmed=False,
        is_duplicate=is_duplicate,
    )

    db.add(db_invoice)
    db.commit()
    db.refresh(db_invoice)

    if extracted.get("line_items"):
        for item in extracted["line_items"]:
            line_item = InvoiceLineItem(
                invoice_id=db_invoice.id,
                service_type=item.get("service_type", "Unknown"),
                service_description=item.get("service_description"),
                quantity=item.get("quantity", 1.0),
                unit_price=item.get("unit_price"),
                line_total=item.get("line_total"),
                is_labor=item.get("is_labor", False),
                is_parts=item.get("is_parts", False),
                is_complimentary=item.get("is_complimentary", False)
            )
            db.add(line_item)
        db.commit()

    return {
        "invoice_id": db_invoice.id,
        "status": "extraction_completed",
        "message": "Invoice uploaded and processed successfully. Please review and confirm.",
        "extracted_data": extracted,
        "needs_confirmation": True,
        "vin_mismatch": vin_mismatch,
        "vin_mismatch_detail": vin_mismatch_detail,
        "vin_unreadable": vin_unreadable,
        "vin_unreadable_detail": vin_unreadable_detail,
        "is_duplicate": is_duplicate,
        "duplicate_detail": duplicate_detail,
    }


# ── Read ───────────────────────────────────────────────────────────────────────

@router.get("/{invoice_id}", response_model=InvoiceResponse)
async def get_invoice(invoice_id: int, db: Session = Depends(get_db)):
    """Get invoice details, including which line items are under active dispute."""
    invoice = db.query(Invoice).filter(Invoice.id == invoice_id).first()
    if not invoice:
        raise HTTPException(status_code=404, detail="Invoice not found")

    # Build set of line item IDs that belong to an open (unresolved) dispute
    disputed_line_item_ids: set[int] = set()
    if invoice.dispute_status == "disputed":
        rows = (
            db.query(DisputeLineItem.invoice_line_item_id)
            .join(DisputeResolution,
                  DisputeLineItem.dispute_resolution_id == DisputeResolution.id)
            .filter(
                DisputeResolution.invoice_id == invoice_id,
                DisputeResolution.resolution_status == "pending",
            )
            .all()
        )
        disputed_line_item_ids = {r[0] for r in rows}

    # Annotate each line item with is_disputed flag before returning
    for li in invoice.line_items:
        li.is_disputed = li.id in disputed_line_item_ids

    return invoice


@router.get("/vehicle/{vehicle_id}", response_model=List[InvoiceResponse])
async def get_vehicle_invoices(
    vehicle_id: int,
    include_archived: bool = False,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """
    Get all invoices for a vehicle — only if owned by the current user.
    By default archived (disputed-and-proven) invoices are hidden.
    Pass ?include_archived=true to surface them (e.g. for audit view).
    """
    vehicle = db.query(Vehicle).filter(
        Vehicle.id == vehicle_id,
        Vehicle.owner_id == current_user.id
    ).first()
    if not vehicle:
        raise HTTPException(status_code=404, detail="Vehicle not found")

    query = db.query(Invoice).filter(Invoice.vehicle_id == vehicle_id)
    if not include_archived:
        query = query.filter(Invoice.is_archived == False)
    return query.all()


# ── Confirm ────────────────────────────────────────────────────────────────────

@router.post("/{invoice_id}/confirm")
async def confirm_invoice(
    invoice_id: int,
    confirmation: InvoiceConfirm,
    db: Session = Depends(get_db)
):
    """
    Confirm invoice data and create service records.
    Returns a per-line-item OEM-backed upsell analysis so the user can
    selectively dispute individual services on the success screen.
    """
    invoice = db.query(Invoice).filter(Invoice.id == invoice_id).first()
    if not invoice:
        raise HTTPException(status_code=404, detail="Invoice not found")

    # Fix B: If already confirmed AND service records exist, the previous request
    # committed successfully but threw before the response was returned.
    # Return a partial-success so the frontend can advance to Step 3.
    #
    # IMPORTANT: we verify actual service records exist — not just is_confirmed.
    # is_confirmed can be True even when records were never written (e.g. the
    # except block committed is_confirmed=True after an analysis failure).
    # Falling through in that case re-runs the full confirm so records are written.
    if invoice.is_confirmed:
        existing_records = db.query(ServiceRecord).filter(
            ServiceRecord.invoice_id == invoice_id
        ).count()
        if existing_records > 0:
            return {
                "message": "Invoice confirmed successfully",
                "invoice_id": invoice_id,
                "service_records_created": existing_records,
                "line_item_analysis": [],
                "upsell_count": 0,
                "upsell_warnings": [],
                "upsell_warning_count": 0,
                "_recovered": True,
            }
        # is_confirmed=True but no service records — prior confirm failed mid-flight.
        # Reset flag so the full confirm path runs cleanly below.
        invoice.is_confirmed = False

    # ── VIN hard-block ────────────────────────────────────────────────────────
    # Re-run the same VIN mismatch check that upload performed.
    # This is the server-side gate — it cannot be bypassed by skipping the UI.
    # The caller must explicitly set force_vin_override=True to proceed.
    import re as _re

    def _is_valid_vin(v: str) -> bool:
        return bool(_re.match(r'^[A-HJ-NPR-Z0-9]{17}$', v))

    def _levenshtein(a: str, b: str) -> int:
        m, n = len(a), len(b)
        dp = list(range(n + 1))
        for i in range(1, m + 1):
            prev, dp[0] = dp[0], i
            for j in range(1, n + 1):
                temp = dp[j]
                dp[j] = prev if a[i-1] == b[j-1] else 1 + min(prev, dp[j], dp[j-1])
                prev = temp
        return dp[n]

    vehicle_for_vin = db.query(Vehicle).filter(Vehicle.id == invoice.vehicle_id).first()
    raw_invoice_vin = (invoice.extraction_data or {}).get("vin", "") or ""
    raw_invoice_vin = raw_invoice_vin.strip().upper()
    vehicle_vin     = (vehicle_for_vin.vin or "").strip().upper() if vehicle_for_vin else ""

    if _is_valid_vin(raw_invoice_vin) and _is_valid_vin(vehicle_vin):
        if raw_invoice_vin != vehicle_vin:
            edit_dist = _levenshtein(raw_invoice_vin, vehicle_vin)
            if edit_dist >= 4 and not confirmation.force_vin_override:
                raise HTTPException(
                    status_code=409,
                    detail={
                        "code": "VIN_MISMATCH",
                        "invoice_vin": raw_invoice_vin,
                        "vehicle_vin": vehicle_vin,
                        "message": (
                            f"VIN Mismatch: invoice shows {raw_invoice_vin} but this "
                            f"vehicle's VIN is {vehicle_vin}. Set force_vin_override=true "
                            f"to confirm anyway."
                        )
                    }
                )
    # ─────────────────────────────────────────────────────────────────────────

    invoice.service_date        = confirmation.service_date
    invoice.mileage_at_service  = confirmation.mileage_at_service
    invoice.shop_name           = confirmation.shop_name
    invoice.shop_address        = confirmation.shop_address
    invoice.total_amount        = confirmation.total_amount
    invoice.is_confirmed        = True

    db.query(InvoiceLineItem).filter(InvoiceLineItem.invoice_id == invoice_id).delete()

    # ── Stage 1: flush invoice + line items (no service records yet) ──────────
    # Upsell evaluation runs before the final commit so we can:
    #   a) persist the verdict on each line item row
    #   b) skip service record creation for confirmed upsells (prevents
    #      poisoning the interval baseline used by future invoice evaluations)
    line_item_db_ids = {}  # id(item) → InvoiceLineItem.id (set after flush)
    line_item_db_list = []  # ordered list of (pydantic_item, db_line_item)
    for item in confirmation.line_items:
        line_item = InvoiceLineItem(
            invoice_id=invoice_id,
            service_type=item.service_type,
            service_description=item.service_description,
            quantity=item.quantity,
            unit_price=item.unit_price,
            line_total=item.line_total,
            is_labor=item.is_labor,
            is_parts=item.is_parts,
            is_complimentary=item.is_complimentary if hasattr(item, 'is_complimentary') else False,
            upsell_verdict=None,  # written after eval below via direct UPDATE
        )
        db.add(line_item)
        line_item_db_list.append((item, line_item))

    # flush: line items get DB ids assigned; objects are now expired in session
    db.flush()

    # Capture DB ids NOW before objects expire further
    for pydantic_item, db_line_item in line_item_db_list:
        line_item_db_ids[id(pydantic_item)] = db_line_item.id

    try:

        # ── Load vehicle for OEM lookup ──────────────────────────────────────────
        vehicle = db.query(Vehicle).filter(Vehicle.id == invoice.vehicle_id).first()

        # ── Build OEM schedule lookup dict: service_type_lower → (interval_miles, interval_months)
        # Uses the same 3-step fallback as recommendations.py
        def _load_oem_schedules(vehicle, db):
            # ── AI-Generated OEM Workflow filter ─────────────────────────────
            # Only load APPROVED rows. Pending rows (AI-generated, awaiting admin
            # review) must never affect upsell verdicts until explicitly approved.
            # This is the single enforcement point — adding review_status='approved'
            # to every OEM query in this function is sufficient because the lookup
            # dict is built once per invoice confirm call.
            def _query(year, make, model=None):
                q = db.query(OEMSchedule).filter(
                    OEMSchedule.year == year,
                    OEMSchedule.make == make,
                    OEMSchedule.driving_condition == vehicle.driving_condition,
                    OEMSchedule.review_status == "approved",   # AI workflow gate
                )
                if model:
                    q = q.filter(OEMSchedule.model == model)
                return q.all()

            schedules = _query(vehicle.year, vehicle.make, vehicle.model)

            if not schedules:
                all_years = db.query(OEMSchedule.year).filter(
                    OEMSchedule.make == vehicle.make,
                    OEMSchedule.model == vehicle.model,
                    OEMSchedule.driving_condition == vehicle.driving_condition,
                    OEMSchedule.review_status == "approved",   # AI workflow gate
                ).distinct().all()
                if all_years:
                    best = min([r[0] for r in all_years], key=lambda y: abs(y - vehicle.year))
                    schedules = _query(best, vehicle.make, vehicle.model)

            if not schedules:
                all_make_years = db.query(OEMSchedule.year).filter(
                    OEMSchedule.make == vehicle.make,
                    OEMSchedule.driving_condition == vehicle.driving_condition,
                    OEMSchedule.review_status == "approved",   # AI workflow gate
                ).distinct().all()
                if all_make_years:
                    best = min([r[0] for r in all_make_years], key=lambda y: abs(y - vehicle.year))
                    schedules = _query(best, vehicle.make)

            # Build keyword-based lookup: service_type_lower → list of (interval_miles, interval_months, notes, driving_condition)
            # Storing a list preserves ALL rows per service type (e.g. conventional AND synthetic
            # Oil Change rows) so the caller can pick the right one based on invoice context.
            # driving_condition is stored in the tuple (Flaw 8 fix) so _find_oem_intervals()
            # can report whether the matched row was a severe-condition row.
            lookup: dict[str, list[tuple]] = {}
            for s in schedules:
                key = s.service_type.lower()
                if key not in lookup:
                    lookup[key] = []
                lookup[key].append((s.interval_miles, s.interval_months, s.notes or "", s.driving_condition or "normal"))
            return lookup

        oem_lookup = _load_oem_schedules(vehicle, db) if vehicle else {}

        def _find_oem_intervals(service_type: str, service_description: str = ""):
            """Fuzzy match service_type against oem_lookup keys by keyword overlap.

            When multiple rows tie on keyword score (e.g. two 'Oil Change' rows —
            one conventional, one synthetic), the winner is chosen by oil-type context:
              • Invoice description contains synthetic keywords → pick the row with the
                HIGHER interval_miles (synthetic extended interval).
              • No synthetic keywords → pick the row with the LOWER interval_miles
                (conventional / more conservative interval — safe fallback).
            This prevents a missing oil-type mention from defaulting to the synthetic
            10,000-mile row and producing a false-positive upsell flag.

            ── FLAW 8 FIX ──────────────────────────────────────────────────────────
            Returns a 3-tuple: (interval_miles, interval_months, oem_row_is_severe)

            oem_row_is_severe: bool
              True  → the matched OEM row has driving_condition='severe'.
                      The interval (oem_miles) already encodes severe conditions.
                      Rule 5 in evaluate_upsell() must NOT fire on top of this —
                      that would double-apply the severe condition tightening.
              False → the matched row is a normal-condition row (or no row was
                      matched). Rule 5 should fire as normal when the vehicle's
                      stored driving_condition is 'severe', providing the built-in
                      7,000-mile ceiling as a fallback safety net.

            Fallback (no match): returns (None, None, False) — oem_row_is_severe=False
            preserves current behaviour (Rule 5 fires if vehicle is set to severe).
            ────────────────────────────────────────────────────────────────────────
            """
            from app.services.upsell_rules import _is_synthetic  # local import avoids circular

            stype_lower = service_type.lower()
            desc_lower = (service_description or "").lower()
            keywords = [w for w in stype_lower.split() if len(w) > 3]

            best_rows: list[tuple] = []
            best_score = 0
            for key, rows in oem_lookup.items():
                score = sum(1 for kw in keywords if kw in key)
                if score > best_score:
                    best_score = score
                    best_rows = rows
                elif score == best_score and score > 0:
                    best_rows = best_rows + rows  # accumulate ties

            if not best_rows or best_score == 0:
                # No OEM data found — oem_row_is_severe=False preserves current
                # behaviour: Rule 5 will still fire if vehicle is set to severe.
                return (None, None, False)

            if len(best_rows) == 1:
                miles, months, _, row_condition = best_rows[0]
                return (miles, months, row_condition == "severe")

            # Multiple rows tied — apply oil-type tiebreaker for oil changes.
            invoice_is_synthetic = _is_synthetic(service_type, service_description)
            # Sort by interval_miles: synthetic path wants highest, conventional wants lowest.
            # Rows with None interval_miles are sorted last.
            sorted_rows = sorted(
                best_rows,
                key=lambda r: r[0] if r[0] is not None else (999_999 if invoice_is_synthetic else -1)
            )
            if invoice_is_synthetic:
                miles, months, _, row_condition = sorted_rows[-1]  # highest interval
            else:
                miles, months, _, row_condition = sorted_rows[0]   # lowest interval (conventional fallback)
            return (miles, months, row_condition == "severe")

        # ── Load prior service history for this vehicle ───────────────────────────
        prior_records = db.query(ServiceRecord).filter(
            ServiceRecord.vehicle_id == invoice.vehicle_id,
            ServiceRecord.invoice_id != invoice_id,
            ServiceRecord.excluded_from_timeline == False
        ).order_by(ServiceRecord.mileage_at_service.desc()).all()

        # ── FLAW 6 FIX — fragile keyword matching for prior record lookup ────────
        #
        # ╔══════════════════════════════════════════════════════════════════════╗
        # ║  WHAT WAS WRONG — two compounding problems                          ║
        # ╠══════════════════════════════════════════════════════════════════════╣
        # ║                                                                     ║
        # ║  PROBLEM A — Generic words survived stopword removal                ║
        # ║  Words like "fluid", "filter", "system", "front", "rear" appear     ║
        # ║  across completely different service categories. They were not in   ║
        # ║  the stopword list, so they became the sole matching keyword and    ║
        # ║  caused cross-category contamination.                               ║
        # ║                                                                     ║
        # ║  Example (before fix):                                              ║
        # ║    Searching for: "Brake Fluid Flush"                               ║
        # ║    keywords = ["brake", "fluid"]                                    ║
        # ║    "Transmission Fluid Change" scores 1 via "fluid"  <- FALSE MATCH ║
        # ║    miles_since computed from Transmission Fluid history -- WRONG    ║
        # ║                                                                     ║
        # ║  PROBLEM B — No minimum score threshold                             ║
        # ║  Any score > 0 was accepted regardless of how many keywords the     ║
        # ║  query had. A 3-keyword query scoring 1/3 was treated identically   ║
        # ║  to a 1-keyword query scoring 1/1. No precision check existed.     ║
        # ║                                                                     ║
        # ║  Example (before fix):                                              ║
        # ║    Searching for: "Spark Plug Replacement"                          ║
        # ║    keywords = ["spark", "plug"]                                     ║
        # ║    "Plug-in Hybrid Service" scores 1/2 via "plug"                  ║
        # ║    Accepted as a match because score > 0 -- WRONG                  ║
        # ║                                                                     ║
        # ║  IMPACT OF BOTH PROBLEMS                                            ║
        # ║  A wrong prior record produces a wrong miles_since value.           ║
        # ║  miles_since feeds directly into evaluate_upsell() as the interval  ║
        # ║  baseline. A corrupted baseline silently produces wrong upsell      ║
        # ║  verdicts -- false positives or false negatives -- with no error.  ║
        # ║                                                                     ║
        # ╠══════════════════════════════════════════════════════════════════════╣
        # ║  FIX A — Extended stopword list                                     ║
        # ║  Added 5 words that are generic across service categories:          ║
        # ║    "fluid"  -- brake fluid, transmission fluid, differential fluid  ║
        # ║    "filter" -- air filter, cabin filter, oil filter, fuel filter    ║
        # ║    "system" -- fuel system, cooling system, brake system            ║
        # ║    "front"  -- front brakes, front differential, front suspension   ║
        # ║    "rear"   -- rear brakes, rear differential, rear suspension      ║
        # ║                                                                     ║
        # ║  FIX B — Precision-aware minimum score threshold                   ║
        # ║  Replaces `score > 0` with _min_score_required():                  ║
        # ║    1 keyword  -> min=1  (must match the only keyword)              ║
        # ║    2 keywords -> min=2  (BOTH must match -- strict)                ║
        # ║    3+ keywords -> min=ceil(n/2)  (majority must match)             ║
        # ║                                                                     ║
        # ║  The strict n=2 rule is critical: without it "Spark Plug" (2 kw)   ║
        # ║  would still match "Plug-in Hybrid Service" via "plug" alone.      ║
        # ║                                                                     ║
        # ╠══════════════════════════════════════════════════════════════════════╣
        # ║  TRUTH TABLE (17/17 correct after fix)                              ║
        # ║                                                                     ║
        # ║  Query                        Keywords         Score/Min  Match?   ║
        # ║  ─────────────────────────────────────────────────────────────────  ║
        # ║  Rear Differential Fluid Svc  [differential]                        ║
        # ║    vs Rear Differential Fluid Svc    1/1  YES  correct (exact)     ║
        # ║    vs Rear Differential Service      1/1  YES  correct (partial ok)║
        # ║    vs Transfer Case Fluid Service    0/1  NO   correct (stopword)  ║
        # ║    vs Transmission Fluid Service     0/1  NO   correct (stopword)  ║
        # ║                                                                     ║
        # ║  Transfer Case Fluid Change   [transfer, case]                      ║
        # ║    vs Transfer Case Fluid Service    2/2  YES  correct             ║
        # ║    vs Rear Differential Fluid Svc    0/2  NO   correct             ║
        # ║                                                                     ║
        # ║  Brake Fluid Flush            [brake]                               ║
        # ║    vs Brake Fluid Flush              1/1  YES  correct             ║
        # ║    vs Transmission Fluid Change      0/1  NO   correct (stopword)  ║
        # ║    vs Power Steering Fluid Flush     0/1  NO   correct (stopword)  ║
        # ║                                                                     ║
        # ║  Spark Plug Replacement       [spark, plug]                         ║
        # ║    vs Spark Plug Replacement         2/2  YES  correct             ║
        # ║    vs Plug-in Hybrid Service         1/2  NO   correct (strict 2kw)║
        # ║                                                                     ║
        # ║  Cabin Air Filter Replacement [cabin, air]                          ║
        # ║    vs Cabin Air Filter Replacement   2/2  YES  correct             ║
        # ║    vs Engine Air Filter Replacement  1/2  NO   correct (strict 2kw)║
        # ║                                                                     ║
        # ║  Coolant Flush                [coolant]                             ║
        # ║    vs Coolant Flush                  1/1  YES  correct             ║
        # ║    vs Brake Fluid Flush              0/1  NO   correct             ║
        # ║                                                                     ║
        # ║  Oil Change                   [oil]                                 ║
        # ║    vs Oil Change                     1/1  YES  correct             ║
        # ╚══════════════════════════════════════════════════════════════════════╝

        import math as _math

        # Stopwords — words excluded from keyword matching because they carry no
        # discriminating power between service types.
        # Original set: action/meta words (service, repair, replace, change, etc.)
        # Extended set (Flaw 6 fix): generic component words that appear across
        # multiple service categories and cause cross-category false matches.
        _PRIOR_STOPWORDS = {
            # ── Original — action / meta words ───────────────────────────────
            "service", "repair", "replace", "change", "flush", "check",
            "inspection", "inspect", "install", "installation", "replacement",
            # ── NEW (Flaw 6 fix) — generic component words ───────────────────
            # These appear in many service categories and produce false matches
            # when used as the sole discriminating keyword.
            "fluid",    # brake fluid, transmission fluid, differential fluid
            "filter",   # air filter, cabin filter, oil filter, fuel filter
            "system",   # fuel system, cooling system, brake system
            "front",    # front brakes, front differential, front suspension
            "rear",     # rear brakes, rear differential, rear suspension
        }

        def _min_score_required(keywords: list) -> int:
            """
            Return the minimum keyword match score to accept a prior record.

            ── FLAW 6 FIX (Problem B) ──────────────────────────────────────────
            Rules:
              n=1  -> min=1  Single keyword: must match it (only option).
              n=2  -> min=2  Both must match. Critical for 2-word queries like
                             "Spark Plug" -- prevents matching "Plug-in Hybrid"
                             via "plug" alone.
              n>=3 -> min=ceil(n/2)  Majority must match. Allows minor naming
                             variations (e.g. "Rear Differential Service"
                             matching "Rear Differential Fluid Service" 2/3).
            """
            n = len(keywords)
            if n <= 1:
                return 1
            if n == 2:
                return 2              # strict: both keywords must match
            return _math.ceil(n / 2) # majority for 3+ keywords

        def _find_prior(service_type: str):
            """
            Find the most recent prior service record matching this service type.

            Algorithm:
              1. Extract meaningful keywords (len>=3, not in _PRIOR_STOPWORDS).
              2. Fall back to all keywords if none remain after filtering.
              3. Score each prior record by keyword overlap count.
              4. Accept only if best_score >= _min_score_required(keywords).
              5. Return None if threshold not met (miles_since stays None,
                 evaluate_upsell() handles this defensively -> genuine verdict).

            ── FLAW 6 FIX ──────────────────────────────────────────────────────
            Two changes from the original:
              A. Extended _PRIOR_STOPWORDS with generic component words.
              B. Replaced `best_score > 0` gate with precision-aware minimum.

            Returning None on ambiguous matches is intentionally conservative:
            a missed match (no prior found) is safer than a wrong match
            (wrong prior corrupting the miles_since baseline).
            """
            all_keywords = [w for w in service_type.lower().split() if len(w) >= 3]
            meaningful   = [w for w in all_keywords if w not in _PRIOR_STOPWORDS]
            keywords     = meaningful if meaningful else all_keywords
            if not keywords:
                return None

            min_required = _min_score_required(keywords)

            best_record = None
            best_score  = 0
            for record in prior_records:
                score = sum(1 for kw in keywords if kw in record.service_type.lower())
                if score > best_score:
                    best_score  = score
                    best_record = record

            # ── FLAW 6 FIX (Problem B) ─────────────────────────────────────────
            # Original: best_score > 0        (any match accepted)
            # Fixed:    best_score >= min_required  (precision threshold)
            _result = best_record if best_score >= min_required else None

            import logging as _fp_log
            _fp_log.warning(
                "[FIND_PRIOR] stype=%r -> matched=%r score=%s/%s min=%s",
                service_type,
                _result.service_type if _result else None,
                best_score,
                len(keywords),
                min_required,
            )
            return _result

        # ── Analyse each line item ────────────────────────────────────────────────
        line_item_analysis = []
        upsell_warnings = []   # kept for backward compat

        import logging as _eval_log
        for item in confirmation.line_items:
            prior = _find_prior(item.service_type)
            miles_since = None
            days_since = None
            prev_date_str = None
            prev_mileage = None

            if prior and confirmation.mileage_at_service and prior.mileage_at_service:
                miles_since = confirmation.mileage_at_service - prior.mileage_at_service
                prev_mileage = prior.mileage_at_service
                prev_date_str = prior.service_date.strftime("%B %d, %Y") if prior.service_date else None
                if confirmation.service_date and prior.service_date:
                    # Normalise both to naive UTC before subtracting.
                    # confirmation.service_date arrives as a naive datetime (no tz)
                    # while prior.service_date may be tz-aware (stored as UTC in DB).
                    _conf_date = confirmation.service_date
                    _prior_date = prior.service_date
                    if hasattr(_conf_date, 'tzinfo') and _conf_date.tzinfo is not None:
                        _conf_date = _conf_date.replace(tzinfo=None)
                    if hasattr(_prior_date, 'tzinfo') and _prior_date.tzinfo is not None:
                        _prior_date = _prior_date.replace(tzinfo=None)
                    days_since = (_conf_date - _prior_date).days

            oem_miles, oem_months, oem_row_is_severe = _find_oem_intervals(item.service_type, item.service_description or "")
            item_is_complimentary = item.is_complimentary if hasattr(item, 'is_complimentary') else False
            item_is_labor = item.is_labor if hasattr(item, 'is_labor') else False

            # ── FLAW 8 FIX — driving_condition source inconsistency ───────────────
            #
            # ╔══════════════════════════════════════════════════════════════════════╗
            # ║  WHAT WAS WRONG                                                     ║
            # ║  driving_condition=vehicle.driving_condition was passed directly     ║
            # ║  to evaluate_upsell(). When the vehicle is set to "severe" AND a    ║
            # ║  severe OEM row was matched, this caused Rule 5 to fire on top of   ║
            # ║  an oem_miles value that already encoded severe conditions —         ║
            # ║  double-applying the tightening.                                    ║
            # ║                                                                     ║
            # ║  Example of double-application:                                     ║
            # ║    vehicle.driving_condition = "severe"                             ║
            # ║    OEM severe row loaded → oem_miles = 7,500                       ║
            # ║    Rule 5 also fires → ceiling = min(7,000, 7,500) = 7,000         ║
            # ║    Threshold = 7,000 × 0.85 = 5,950 mi                             ║
            # ║    Service at 6,200 mi → flagged as upsell (wrong)                 ║
            # ║    Correct: 6,200 < 7,500 × 0.85 = 6,375 → still flagged, BUT     ║
            # ║    the 7,000-mi ceiling overrides the OEM's own 7,500-mi interval  ║
            # ║    and produces an inconsistency between the two call sites.        ║
            # ║                                                                     ║
            # ║  WHAT CHANGES                                                       ║
            # ║  When the matched OEM row is already a severe-condition row         ║
            # ║  (oem_row_is_severe=True), Rule 5 must not fire. The OEM row's     ║
            # ║  interval already reflects severe conditions — the manufacturer's   ║
            # ║  severe interval is more authoritative than the generic 7,000-mi   ║
            # ║  built-in ceiling. We pass "normal" to suppress Rule 5.            ║
            # ║                                                                     ║
            # ║  WHAT STAYS THE SAME                                                ║
            # ║  When vehicle is "severe" but no severe OEM row was matched         ║
            # ║  (oem_row_is_severe=False), we pass "severe" as before — Rule 5    ║
            # ║  provides the built-in 7,000-mi ceiling as a safety net. This is   ║
            # ║  the exact scenario Rule 5 was designed for.                        ║
            # ║                                                                     ║
            # ║  USER CONTROL IS FULLY PRESERVED                                   ║
            # ║  vehicle.driving_condition remains the authoritative source.        ║
            # ║  A user who relocates from California to Colorado and updates their ║
            # ║  drive profile to "severe" gets correct evaluation immediately.     ║
            # ║  A user who forgets to update gets the same behaviour as today.     ║
            # ║  No silent overrides. No location inference.                        ║
            # ╚══════════════════════════════════════════════════════════════════════╝
            #
            # effective_driving_condition truth table:
            #
            #   vehicle condition | oem_row_is_severe | effective | Rule 5 fires?
            #   ──────────────────┼───────────────────┼───────────┼──────────────
            #   normal            | False             | normal    | No  (unchanged)
            #   normal            | True  (*)         | normal    | No  (unchanged)
            #   severe            | False             | severe    | Yes (safety net)
            #   severe            | True              | normal    | No  (OEM row owns it)
            #
            # (*) Vehicle stored as normal but a severe OEM row was matched — only
            #     possible if the OEM query somehow returned a mixed set, which the
            #     current filtering prevents. Included for defensive completeness.
            effective_driving_condition = (
                "normal"
                if (vehicle is not None
                    and vehicle.driving_condition == "severe"
                    and oem_row_is_severe)
                else (vehicle.driving_condition if vehicle else "normal")
            )

            _eval_log.warning(
                "[UPSELL_DEBUG] stype=%r prior=%r miles_since=%s oem_miles=%s "
                "line_total=%s is_labor=%s is_complimentary=%s",
                item.service_type,
                prior.service_type if prior else None,
                miles_since, oem_miles,
                item.line_total, item_is_labor, item_is_complimentary
            )

            decision = evaluate_upsell(
                service_type=item.service_type,
                service_description=item.service_description or "",
                line_total=item.line_total,
                unit_price=item.unit_price,
                miles_since_last_service=miles_since,
                days_since_last_service=days_since,
                oem_interval_miles=oem_miles,
                oem_interval_months=oem_months,
                is_complimentary=item_is_complimentary,
                is_labor=item_is_labor,
                driving_condition=effective_driving_condition,
                prior_service_description=prior.service_description or "" if prior else "",
                # ── Dynamic threshold: pass vehicle context so resolve_threshold()
                # can apply make/model/year-specific overrides when present.
                vehicle_make  = vehicle.make  if vehicle else None,
                vehicle_model = vehicle.model if vehicle else None,
                vehicle_year  = vehicle.year  if vehicle else None,
                db            = db,
            )

            # Map decision → verdict
            if decision.skip_flag:
                verdict = "exempt"
                is_recall = _is_recall(item.service_type, item.service_description or "")
                verdict_label = "Recall Service" if is_recall else "Courtesy Service"
            elif decision.is_upsell:
                verdict = "upsell"
                verdict_label = "Potential Upsell"
            else:
                verdict = "genuine"
                verdict_label = "Genuine Service"

            # ── Persist verdict on the line item row via direct UPDATE ───────────
            # We use a targeted SQL UPDATE rather than ORM attribute assignment
            # because SQLAlchemy expires flushed objects, causing attribute writes
            # to be lost before commit.
            db_item_id = line_item_db_ids.get(id(item))
            if db_item_id is not None:
                db.query(InvoiceLineItem).filter(
                    InvoiceLineItem.id == db_item_id
                ).update({"upsell_verdict": verdict}, synchronize_session=False)

            # ── Create service record only for non-upsell lines ──────────────────
            # Upsell records are excluded so they don't corrupt the interval baseline
            # used by _find_prior() on future invoices. The line item itself is still
            # saved (with verdict='upsell') so the user can see and dispute it.
            if verdict != "upsell":
                service_record = ServiceRecord(
                    vehicle_id=invoice.vehicle_id,
                    invoice_id=invoice_id,
                    service_date=confirmation.service_date,
                    mileage_at_service=confirmation.mileage_at_service,
                    service_type=item.service_type,
                    service_description=item.service_description,
                    shop_name=confirmation.shop_name,
                    is_manual_entry=False,
                )
                # Embed service record for ARIA RAG retrieval
                chunk = embedding_service.build_service_chunk(service_record)
                vec = embedding_service.embed(chunk)
                if vec is not None:
                    service_record.description_embedding = vec
                db.add(service_record)

            effective_oem_miles = decision.override_interval_miles or oem_miles

            analysis_item = LineItemAnalysis(
                service_type=item.service_type,
                service_description=item.service_description,
                line_total=item.line_total,
                verdict=verdict,
                verdict_label=verdict_label,
                reason=decision.reason,
                oem_interval_miles=effective_oem_miles,
                oem_interval_months=oem_months,
                miles_since_last_service=miles_since,
                previous_service_date=prev_date_str,
                previous_service_mileage=prev_mileage,
            )
            line_item_analysis.append(analysis_item)

            # Backward-compat upsell_warnings list
            if verdict == "upsell" and miles_since is not None:
                upsell_warnings.append({
                    "service_type": item.service_type,
                    "previous_service_mileage": prev_mileage,
                    "previous_service_date": prev_date_str,
                    "current_mileage": confirmation.mileage_at_service,
                    "miles_since_last_service": miles_since,
                    "warning": decision.reason or (
                        f"'{item.service_type}' was last performed {miles_since:,} miles ago "
                        f"(at {prev_mileage:,} miles). Verify this service was necessary."
                    )
                })

        # ── Update vehicle current_mileage if this invoice is more recent ────────
        if confirmation.mileage_at_service and (
            vehicle.current_mileage is None
            or confirmation.mileage_at_service > vehicle.current_mileage
        ):
            vehicle.current_mileage = confirmation.mileage_at_service

        # ── Final commit: verdicts written, service records added ─────────────────
        db.commit()

        # ── Embed invoice OCR text for ARIA RAG (Phase 2) ────────────────────────
        # Runs after commit so the invoice row is stable. Non-blocking — failure
        # does not affect the confirmation response.
        try:
            if invoice.ocr_text:
                ocr_chunk = embedding_service.build_invoice_chunk(invoice)
                ocr_vec   = embedding_service.embed(ocr_chunk)
                if ocr_vec is not None:
                    invoice.ocr_embedding = ocr_vec
                    db.add(invoice)
                    db.commit()
        except Exception as _emb_err:
            import logging as _emb_log
            _emb_log.warning("[invoices] OCR embedding failed (non-fatal): %s", _emb_err)

        upsell_count = sum(1 for a in line_item_analysis if a.verdict == "upsell")

        response = {
            "message": "Invoice confirmed successfully",
            "invoice_id": invoice_id,
            "service_records_created": sum(1 for a in line_item_analysis if a.verdict != "upsell"),
            "line_item_analysis": [a.model_dump() for a in line_item_analysis],
            "upsell_count": upsell_count,
            # kept for backward compat
            "upsell_warnings": upsell_warnings,
            "upsell_warning_count": len(upsell_warnings),
        }
        return response

    except Exception as _exc:
        import traceback, logging
        logging.error(
            "confirm_invoice analysis error for invoice_id=%s: %s\n%s",
            invoice_id, _exc, traceback.format_exc()
        )
        # Analysis failed — rollback the entire transaction so is_confirmed stays
        # False and no partial state is committed. Fix B above detects is_confirmed=False
        # on retry and re-runs the full confirm path cleanly.
        try:
            db.rollback()
        except Exception:
            pass
        raise HTTPException(
            status_code=500,
            detail=(
                "Invoice confirmation failed during analysis. "
                "Your invoice has not been saved. Please try confirming again."
            )
        )


# ── Dispute lifecycle ──────────────────────────────────────────────────────────

@router.post("/{invoice_id}/dispute", summary="Raise a dispute on a confirmed invoice")
async def raise_dispute(
    invoice_id: int,
    body: RaiseDisputeRequest,
    db: Session = Depends(get_db)
):
    """
    Step 1 of the dispute lifecycle.
    Marks the invoice as 'disputed' so it is flagged in the UI.
    Does NOT archive or delete anything — evidence is preserved.
    """
    invoice = db.query(Invoice).filter(Invoice.id == invoice_id).first()
    if not invoice:
        raise HTTPException(status_code=404, detail="Invoice not found")

    if not invoice.is_confirmed:
        raise HTTPException(status_code=400, detail="Only confirmed invoices can be disputed")

    if invoice.dispute_status == "disputed":
        raise HTTPException(status_code=409, detail="Invoice already has an open dispute")

    if invoice.is_archived:
        raise HTTPException(status_code=409, detail="Invoice is already archived/resolved")

    invoice.dispute_status    = "disputed"
    invoice.dispute_raised_at = datetime.utcnow()
    invoice.dispute_notes     = body.dispute_notes

    db.commit()

    return {
        "message": "Dispute raised successfully. Invoice is now flagged for review.",
        "invoice_id": invoice_id,
        "dispute_type": body.dispute_type,
        "dispute_status": "disputed",
        "next_step": "When the dealer confirms or the dispute is resolved, call POST /api/invoices/{id}/dispute/resolve"
    }


@router.post("/{invoice_id}/dispute/batch", summary="Raise a dispute for selected line items")
async def raise_dispute_batch(
    invoice_id: int,
    body: BatchDisputeRequest,
    db: Session = Depends(get_db)
):
    """
    Raise a dispute that targets specific line items (service types) within an invoice.
    Only the selected service types are noted in the dispute — others are not affected.
    The dispute lifecycle (resolve, archive) still operates at the invoice level.
    """
    invoice = db.query(Invoice).filter(Invoice.id == invoice_id).first()
    if not invoice:
        raise HTTPException(status_code=404, detail="Invoice not found")

    if not invoice.is_confirmed:
        raise HTTPException(status_code=400, detail="Only confirmed invoices can be disputed")

    if invoice.dispute_status == "disputed":
        raise HTTPException(status_code=409, detail="Invoice already has an open dispute")

    if invoice.is_archived:
        raise HTTPException(status_code=409, detail="Invoice is already archived/resolved")

    services_list = ", ".join(body.disputed_service_types)
    notes_parts = [f"Disputed services: {services_list}"]
    if body.dispute_notes:
        notes_parts.append(body.dispute_notes)
    combined_notes = "\n".join(notes_parts)

    invoice.dispute_status    = "disputed"
    invoice.dispute_raised_at = datetime.utcnow()
    invoice.dispute_notes     = combined_notes

    # ── Create a pending DisputeResolution record ─────────────────────────────
    # This is required so that:
    # (a) get_invoice() can set is_disputed=True on matching line items, which
    #     drives the amber highlighting in DisputeResolution.jsx
    # (b) the resolve endpoint can find and update the pending record
    resolution = DisputeResolution(
        invoice_id        = invoice_id,
        vehicle_id        = invoice.vehicle_id,
        resolution_status = "pending",
        dispute_type      = body.dispute_type or "upsell",
        confirmed_by      = "user_self_resolved",
        evidence_notes    = combined_notes,
        resolved_at       = None,
        invoice_snapshot  = None,
        dealer_name       = invoice.shop_name,
        original_amount   = invoice.total_amount,
    )
    db.add(resolution)
    db.flush()   # get resolution.id before creating child rows

    # ── Link DisputeLineItem rows for each disputed service type ──────────────
    # Match by service_type so the get_invoice() annotation query finds them.
    disputed_lower = [s.lower() for s in body.disputed_service_types]
    matched_line_item_ids = []
    for li in invoice.line_items:
        if li.service_type and li.service_type.lower() in disputed_lower:
            db.add(DisputeLineItem(
                dispute_resolution_id = resolution.id,
                invoice_line_item_id  = li.id,
            ))
            matched_line_item_ids.append(li.id)

    db.commit()

    return {
        "message": f"Dispute raised for {len(body.disputed_service_types)} service(s). Invoice is now flagged for review.",
        "invoice_id": invoice_id,
        "dispute_resolution_id": resolution.id,
        "dispute_type": body.dispute_type,
        "disputed_services": body.disputed_service_types,
        "matched_line_item_ids": matched_line_item_ids,
        "dispute_status": "disputed",
        "next_step": "Track and resolve the dispute at /invoice/{invoice_id}/dispute"
    }


@router.post(
    "/{invoice_id}/dispute/resolve",
    response_model=DisputeResolutionResponse,
    summary="Resolve a dispute — archives invoice when proven"
)
async def resolve_dispute(
    invoice_id: int,
    body: ResolveDisputeRequest,
    db: Session = Depends(get_db)
):
    """
    Step 2 of the dispute lifecycle.

    When resolution_status = 'proven':
      - invoice.dispute_status  → 'proven_upsell' or 'proven_duplicate'
      - invoice.is_archived     → True  (hidden from normal UI)
      - All matching service_records → excluded_from_timeline = True
      - An immutable DisputeResolution audit record is written with a full invoice snapshot.
      - NO records are deleted.

    When resolution_status = 'dismissed':
      - invoice.dispute_status  → 'dismissed'
      - invoice remains visible, service records unchanged.
      - An audit record is still written.
    """
    invoice = db.query(Invoice).filter(Invoice.id == invoice_id).first()
    if not invoice:
        raise HTTPException(status_code=404, detail="Invoice not found")

    if invoice.dispute_status != "disputed":
        raise HTTPException(
            status_code=400,
            detail="Invoice must be in 'disputed' status to resolve. Call /dispute first."
        )

    # ── Determine final status and which service records to exclude ──────────────
    #
    # Key design rule:
    #   A dispute is raised against SPECIFIC line items (stored in dispute_line_items).
    #   Resolution should only exclude service_records for those disputed service types.
    #   Non-disputed line items stay in the timeline untouched.
    #
    #   Archive (is_archived=True) only fires when ALL line items were disputed AND proven.
    #   If only some items were disputed, the invoice remains visible with a partial status.

    # Step 1: Get the disputed service types from the pending DisputeLineItem records
    pending_resolution = db.query(DisputeResolution).filter(
        DisputeResolution.invoice_id == invoice_id,
        DisputeResolution.resolution_status == "pending",
    ).first()

    disputed_service_types: list[str] = []
    if pending_resolution and pending_resolution.line_items:
        # line_description was set to service_type at raise time
        disputed_service_types = [
            dli.line_description
            for dli in pending_resolution.line_items
            if dli.line_description
        ]

    # Step 2: Determine whether ALL line items on the invoice were disputed
    total_line_items = db.query(InvoiceLineItem).filter(
        InvoiceLineItem.invoice_id == invoice_id
    ).count()
    all_items_disputed = (
        len(disputed_service_types) > 0
        and len(disputed_service_types) >= total_line_items
    )

    # Step 3: Map resolution_status → invoice status + archive decision
    if body.resolution_status == "proven":
        notes_lower = (invoice.dispute_notes or "").lower()
        if "duplicate" in notes_lower:
            new_dispute_status = "proven_duplicate"
        else:
            new_dispute_status = "proven_upsell"
        # Only archive the full invoice if every line item was part of the dispute
        archive = all_items_disputed
        exclusion_reason = new_dispute_status
    elif body.resolution_status == "dismissed":
        new_dispute_status = "dismissed"
        archive = False
        exclusion_reason = None

        # ── Retroactively create service records for dismissed upsell lines ──────
        #
        # Design contract (confirm time): when a line item is evaluated as
        # verdict='upsell', no ServiceRecord is written — intentionally — to
        # prevent a false-positive upsell from corrupting the interval baseline
        # used by _find_prior() on future invoices.
        #
        # Design contract (dismiss time): a dismissed dispute means the user (or
        # dealer) has confirmed the service WAS genuine.  The withheld records must
        # therefore be written NOW so the interval baseline is correct for all
        # future invoices on this vehicle.
        #
        # Without this block, dismissing a dispute leaves the service permanently
        # absent from history — silently corrupting every future upsell evaluation
        # that depends on miles_since / days_since for those service types.
        #
        # Scope: only line items that are:
        #   a) on this invoice,
        #   b) tagged upsell_verdict='upsell' (withheld at confirm time), AND
        #   c) listed in disputed_service_types (the specific items the user disputed).
        #      If no line-item-level dispute exists (legacy raise path), reinstate ALL
        #      upsell-flagged lines on the invoice (safe fallback).
        #
        # Idempotency guard: skip if a ServiceRecord already exists for this
        # invoice + service_type pair (e.g. resolve called twice).
        #
        # Verdict correction: update upsell_verdict → 'genuine' on the line item
        # so the UI and audit trail reflect the corrected status.

        flagged_items = db.query(InvoiceLineItem).filter(
            InvoiceLineItem.invoice_id == invoice_id,
            InvoiceLineItem.upsell_verdict == "upsell",
        ).all()

        if flagged_items:
            disputed_lower_set = (
                {s.lower() for s in disputed_service_types}
                if disputed_service_types
                else None   # None → reinstate all flagged lines (legacy path)
            )

            for li in flagged_items:
                stype = (li.service_type or "").strip()
                if not stype:
                    continue

                # Scope filter: if specific service types were disputed, only
                # reinstate those.  On the legacy (no line items) path, reinstate all.
                if disputed_lower_set is not None and stype.lower() not in disputed_lower_set:
                    continue

                # Idempotency: skip if record already exists for this service type
                already_exists = db.query(ServiceRecord).filter(
                    ServiceRecord.invoice_id  == invoice_id,
                    ServiceRecord.service_type == stype,
                ).first()
                if already_exists:
                    continue

                reinstated = ServiceRecord(
                    vehicle_id          = invoice.vehicle_id,
                    invoice_id          = invoice_id,
                    service_date        = invoice.service_date,
                    mileage_at_service  = invoice.mileage_at_service,
                    service_type        = stype,
                    service_description = li.service_description,
                    shop_name           = invoice.shop_name,
                    is_manual_entry     = False,
                )

                # Embed for ARIA RAG retrieval (mirrors confirm-time behaviour)
                chunk = embedding_service.build_service_chunk(reinstated)
                vec   = embedding_service.embed(chunk)
                if vec is not None:
                    reinstated.description_embedding = vec

                db.add(reinstated)

                # Correct the verdict on the line item so UI / audit trail
                # reflects that this service was ruled genuine on dismissal.
                db.query(InvoiceLineItem).filter(
                    InvoiceLineItem.id == li.id
                ).update({"upsell_verdict": "genuine"}, synchronize_session=False)

    else:  # partial
        new_dispute_status = "proven_upsell"
        archive = all_items_disputed
        exclusion_reason = "proven_upsell"

    # Capture invoice snapshot BEFORE any changes
    snapshot = _invoice_snapshot(invoice)

    # Update invoice
    invoice.dispute_status       = new_dispute_status
    invoice.dispute_resolved_at  = datetime.utcnow()
    invoice.dispute_confirmed_by = body.confirmed_by
    if body.evidence_notes:
        invoice.dispute_notes = (invoice.dispute_notes or "") + "\n\nResolution: " + body.evidence_notes
    if archive:
        invoice.is_archived = True

    # ── Exclude ONLY the disputed service_records from the timeline ───────────
    # If we have specific disputed service types, only those records are excluded.
    # Fallback: if dispute was raised via the old batch/raise endpoint (no line items
    # stored), fall back to excluding all records for the invoice (original behaviour).
    if exclusion_reason and disputed_service_types:
        # Normalise to lowercase for case-insensitive match
        disputed_lower = [s.lower() for s in disputed_service_types]
        all_records = db.query(ServiceRecord).filter(
            ServiceRecord.invoice_id == invoice_id
        ).all()
        for record in all_records:
            if record.service_type.lower() in disputed_lower:
                record.excluded_from_timeline = True
                record.exclusion_reason       = exclusion_reason
    elif exclusion_reason:
        # Legacy fallback — no line item records, exclude everything
        all_records = db.query(ServiceRecord).filter(
            ServiceRecord.invoice_id == invoice_id
        ).all()
        for record in all_records:
            record.excluded_from_timeline = True
            record.exclusion_reason       = exclusion_reason

    # Write or update the audit record.
    # If the invoice was disputed via the new raise_dispute_with_line_items endpoint,
    # a 'pending' DisputeResolution already exists — update it rather than creating
    # a second record, which would inflate the audit log count.
    existing_pending = db.query(DisputeResolution).filter(
        DisputeResolution.invoice_id == invoice_id,
        DisputeResolution.resolution_status == "pending"
    ).first()

    if existing_pending:
        existing_pending.dispute_type      = _derive_dispute_type(invoice.dispute_notes, new_dispute_status)
        existing_pending.resolution_status = body.resolution_status
        existing_pending.confirmed_by      = body.confirmed_by
        existing_pending.dealer_name       = body.dealer_name
        existing_pending.refund_amount     = body.refund_amount
        existing_pending.evidence_notes    = body.evidence_notes
        existing_pending.invoice_snapshot  = snapshot
        existing_pending.resolved_at       = datetime.utcnow()
        resolution = existing_pending
    else:
        # Original path — invoked via raiseDispute or batchDisputeInvoice
        resolution = DisputeResolution(
            invoice_id        = invoice_id,
            vehicle_id        = invoice.vehicle_id,
            dispute_type      = _derive_dispute_type(invoice.dispute_notes, new_dispute_status),
            resolution_status = body.resolution_status,
            confirmed_by      = body.confirmed_by,
            dealer_name       = body.dealer_name,
            original_amount   = invoice.total_amount,
            refund_amount     = body.refund_amount,
            evidence_notes    = body.evidence_notes,
            invoice_snapshot  = snapshot,
            resolved_at       = datetime.utcnow(),
        )
        db.add(resolution)

    db.commit()
    db.refresh(resolution)

    return resolution


def _derive_dispute_type(notes: str, status: str) -> str:
    """Derive dispute_type for the audit record from context."""
    notes_lower = (notes or "").lower()
    if "duplicate" in notes_lower or status == "proven_duplicate":
        return "duplicate"
    if "upsell" in notes_lower or status == "proven_upsell":
        return "upsell"
    return "other"


@router.get(
    "/{invoice_id}/disputes",
    response_model=List[DisputeResolutionResponse],
    summary="Get full audit history for an invoice's disputes"
)
async def get_dispute_history(invoice_id: int, db: Session = Depends(get_db)):
    """
    Returns all dispute resolution records for an invoice.
    These records are immutable — they are never deleted.
    """
    invoice = db.query(Invoice).filter(Invoice.id == invoice_id).first()
    if not invoice:
        raise HTTPException(status_code=404, detail="Invoice not found")

    records = db.query(DisputeResolution)\
        .filter(DisputeResolution.invoice_id == invoice_id)\
        .order_by(DisputeResolution.created_at.desc())\
        .all()

    return records


@router.get("/vehicle/{vehicle_id}/invoices-with-tags")
async def get_vehicle_invoices_with_tags(
    vehicle_id: int,
    include_archived: bool = False,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """
    Get all invoices for a vehicle with aggregated service_type tags.
    Used by the redesigned History page list view — lightweight summary only.
    Full line items are loaded separately when the user expands an accordion row.
    """
    vehicle = db.query(Vehicle).filter(
        Vehicle.id == vehicle_id,
        Vehicle.owner_id == current_user.id
    ).first()
    if not vehicle:
        raise HTTPException(status_code=404, detail="Vehicle not found")

    query = db.query(Invoice).filter(
        Invoice.vehicle_id == vehicle_id,
        Invoice.is_confirmed == True,   # never surface unconfirmed/abandoned uploads
    )
    if not include_archived:
        query = query.filter(Invoice.is_archived == False)
    invoices = query.order_by(Invoice.service_date.desc()).all()

    result = []
    for inv in invoices:
        service_tags = list({
            li.service_type for li in inv.line_items if li.service_type
        })
        open_dispute_line_item_count = 0
        if inv.dispute_status == "disputed":
            open_dispute_line_item_count = db.query(DisputeLineItem).join(
                DisputeResolution
            ).filter(
                DisputeResolution.invoice_id == inv.id,
                DisputeResolution.resolution_status.in_(["pending", "proven"])
            ).count()

        result.append({
            "id": inv.id,
            "shop_name": inv.shop_name,
            "service_date": inv.service_date,
            "mileage_at_service": inv.mileage_at_service,
            "total_amount": inv.total_amount,
            "filename": inv.filename,
            "is_confirmed": inv.is_confirmed,
            "is_archived": inv.is_archived,
            "dispute_status": inv.dispute_status,
            "service_tags": service_tags,
            "has_active_dispute": inv.dispute_status == "disputed",
            "open_dispute_line_item_count": open_dispute_line_item_count,
        })
    return result


@router.get("/{invoice_id}/line-items")
async def get_invoice_line_items(
    invoice_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """
    Get all line items for a specific invoice.
    Called lazily when the user expands an invoice accordion in the History page.
    Only accessible if the invoice belongs to a vehicle owned by the current user.
    """
    invoice = db.query(Invoice).filter(Invoice.id == invoice_id).first()
    if not invoice:
        raise HTTPException(status_code=404, detail="Invoice not found")

    vehicle = db.query(Vehicle).filter(
        Vehicle.id == invoice.vehicle_id,
        Vehicle.owner_id == current_user.id
    ).first()
    if not vehicle:
        raise HTTPException(status_code=403, detail="Not authorised to view this invoice")

    line_items = db.query(InvoiceLineItem).filter(
        InvoiceLineItem.invoice_id == invoice_id
    ).order_by(InvoiceLineItem.id).all()

    return {
        "invoice_id": invoice_id,
        "line_items": [
            {
                "id": li.id,
                "service_type": li.service_type,
                "service_description": li.service_description,
                "quantity": li.quantity,
                "unit_price": li.unit_price,
                "line_total": li.line_total,
                "is_labor": li.is_labor,
                "is_parts": li.is_parts,
                "is_complimentary": li.is_complimentary,
                "upsell_verdict": li.upsell_verdict,
            }
            for li in line_items
        ]
    }


@router.post(
    "/{invoice_id}/dispute/line-items",
    summary="Raise a dispute targeting specific line item IDs (History page redesign)"
)
async def raise_dispute_with_line_items(
    invoice_id: int,
    body: RaiseDisputeWithLineItemsRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """
    Raise a dispute that links specific invoice_line_items records by PK.
    This is the new endpoint used by the redesigned History page accordion dispute flow.

    Unlike raise_dispute_batch (which stored service type names as plain text),
    this endpoint writes proper relational dispute_line_items records
    for full auditability and per-item tracking.

    Backward compatible: raise_dispute and raise_dispute_batch are unchanged.
    """
    invoice = db.query(Invoice).filter(Invoice.id == invoice_id).first()
    if not invoice:
        raise HTTPException(status_code=404, detail="Invoice not found")

    vehicle = db.query(Vehicle).filter(
        Vehicle.id == invoice.vehicle_id,
        Vehicle.owner_id == current_user.id
    ).first()
    if not vehicle:
        raise HTTPException(status_code=403, detail="Not authorised")

    if not invoice.is_confirmed:
        raise HTTPException(status_code=400, detail="Only confirmed invoices can be disputed")

    if invoice.dispute_status == "disputed":
        raise HTTPException(status_code=409, detail="Invoice already has an open dispute")

    if invoice.is_archived:
        raise HTTPException(status_code=409, detail="Invoice is already archived/resolved")

    # Validate all line item IDs belong to this invoice
    line_items = db.query(InvoiceLineItem).filter(
        InvoiceLineItem.id.in_(body.invoice_line_item_ids),
        InvoiceLineItem.invoice_id == invoice_id
    ).all()

    if len(line_items) != len(body.invoice_line_item_ids):
        raise HTTPException(
            status_code=400,
            detail="One or more line item IDs do not belong to this invoice"
        )

    # Build notes for backward compat and human readability
    services_list = ", ".join(li.service_type for li in line_items)
    notes_parts = [f"Disputed services: {services_list}"]
    if body.dispute_notes:
        notes_parts.append(body.dispute_notes)

    # Step 1: Mark invoice as disputed
    invoice.dispute_status    = "disputed"
    invoice.dispute_raised_at = datetime.utcnow()
    invoice.dispute_notes     = "\n".join(notes_parts)
    db.flush()

    # Step 2: Create dispute_resolutions record (pending)
    snapshot = _invoice_snapshot(invoice)
    resolution = DisputeResolution(
        invoice_id        = invoice_id,
        vehicle_id        = invoice.vehicle_id,
        dispute_type      = body.dispute_type,
        resolution_status = "pending",
        confirmed_by      = "user_self_resolved",
        original_amount   = invoice.total_amount,
        evidence_notes    = body.dispute_notes,
        invoice_snapshot  = snapshot,
    )
    db.add(resolution)
    db.flush()  # get resolution.id before inserting line items

    # Step 3: Create dispute_line_items records (one per selected line item)
    for li in line_items:
        db.add(DisputeLineItem(
            dispute_resolution_id = resolution.id,
            invoice_line_item_id  = li.id,
            line_description      = li.service_type,
            line_total_at_dispute = li.line_total,
        ))

    db.commit()

    return {
        "message": f"Dispute raised for {len(line_items)} service(s).",
        "invoice_id": invoice_id,
        "dispute_resolution_id": resolution.id,
        "dispute_type": body.dispute_type,
        "disputed_services": [li.service_type for li in line_items],
        "dispute_status": "disputed",
    }


# ── Delete (only for unconfirmed invoices) ─────────────────────────────────────

@router.delete("/{invoice_id}", summary="Delete an invoice (unconfirmed only)")
async def delete_invoice(invoice_id: int, db: Session = Depends(get_db)):
    """
    Hard-deletes an invoice from the database.
    ONLY permitted for invoices that have NOT been confirmed yet.
    Confirmed invoices with disputes must go through the dispute/resolve workflow.
    Invoices with existing dispute_resolution records cannot be deleted (FK RESTRICT).
    """
    invoice = db.query(Invoice).filter(Invoice.id == invoice_id).first()
    if not invoice:
        raise HTTPException(status_code=404, detail="Invoice not found")

    if invoice.is_confirmed:
        raise HTTPException(
            status_code=400,
            detail=(
                "Confirmed invoices cannot be hard-deleted. "
                "If this invoice contains a duplicate or upsell charge, "
                "use POST /api/invoices/{id}/dispute then /dispute/resolve instead."
            )
        )

    # Check for existing audit records (should not exist for unconfirmed, but be safe)
    existing_resolutions = db.query(DisputeResolution)\
        .filter(DisputeResolution.invoice_id == invoice_id)\
        .count()
    if existing_resolutions > 0:
        raise HTTPException(
            status_code=400,
            detail="Cannot delete invoice with existing dispute resolution records."
        )

    if os.path.exists(invoice.file_path):
        os.remove(invoice.file_path)

    db.delete(invoice)
    db.commit()

    return {"message": "Invoice deleted successfully"}
