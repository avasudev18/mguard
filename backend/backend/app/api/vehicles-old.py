from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import func
from typing import List

from app.models.models import Vehicle, Invoice, DisputeResolution, User
from app.models.schemas import VehicleCreate, VehicleUpdate, VehicleResponse
from app.utils.database import get_db
from app.utils.auth import get_current_active_user

router = APIRouter()

@router.post("/", response_model=VehicleResponse, status_code=201)
async def create_vehicle(
    vehicle: VehicleCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Create a new vehicle profile owned by the current user"""

    # VIN uniqueness check — only block if the same user already has this VIN
    # Different accounts can register the same VIN (ownership transfers, family vehicles)
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
                    "message": f"VIN {vehicle.vin} is already registered to a vehicle on your account.",
                }
            )

    db_vehicle = Vehicle(
        owner_id=current_user.id,
        year=vehicle.year,
        make=vehicle.make,
        model=vehicle.model,
        trim=vehicle.trim,
        vin=vehicle.vin,
        nickname=vehicle.nickname,
        current_mileage=vehicle.current_mileage,
        driving_condition=vehicle.driving_condition,  # persisted from creation
    )

    db.add(db_vehicle)
    db.commit()
    db.refresh(db_vehicle)

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
    # All vehicle IDs owned by this user
    vehicle_ids = [
        row.id for row in
        db.query(Vehicle.id).filter(Vehicle.owner_id == current_user.id).all()
    ]

    if not vehicle_ids:
        return {"proven_savings": 0.0, "open_disputes": 0}

    # Sum refund_amount across all proven dispute resolutions for this user's vehicles
    proven_savings = db.query(func.coalesce(func.sum(DisputeResolution.refund_amount), 0))        .filter(
            DisputeResolution.vehicle_id.in_(vehicle_ids),
            DisputeResolution.resolution_status == "proven"
        )        .scalar()

    # Count invoices currently in disputed state
    open_disputes = db.query(func.count(Invoice.id))        .filter(
            Invoice.vehicle_id.in_(vehicle_ids),
            Invoice.dispute_status == "disputed"
        )        .scalar()

    # Count proven upsells per vehicle from dispute_resolutions
    # vehicle_id is denormalised on the table so no join needed
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
        "proven_savings": float(proven_savings or 0),
        "open_disputes": int(open_disputes or 0),
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
        # VIN uniqueness check — only block if this user already has this VIN
        # on a different vehicle. Cross-account duplicates are allowed.
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
                        "message": f"VIN {vehicle_update.vin} is already registered to another vehicle on your account.",
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
    """
    Search/filter invoices by service type or shop name keyword.
    Powers the search bar and filter dropdown in the redesigned History page.
    - q: free-text search against shop_name and service_type
    - service_type: exact match filter (from dropdown)
    """
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
            "id": inv.id,
            "shop_name": inv.shop_name,
            "service_date": inv.service_date,
            "mileage_at_service": inv.mileage_at_service,
            "total_amount": inv.total_amount,
            "dispute_status": inv.dispute_status,
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
    """
    Delete a vehicle and all associated data.

    If the vehicle has dispute resolution audit records, a 409 warning is returned
    unless force=true is explicitly passed by the user confirming they understand
    the audit trail will be permanently deleted.
    """

    vehicle = db.query(Vehicle).filter(
        Vehicle.id == vehicle_id,
        Vehicle.owner_id == current_user.id
    ).first()
    if not vehicle:
        raise HTTPException(status_code=404, detail="Vehicle not found")

    # Find all invoice IDs for this vehicle
    invoice_ids = [
        row.id for row in
        db.query(Invoice.id).filter(Invoice.vehicle_id == vehicle_id).all()
    ]

    # Count dispute audit records linked to those invoices
    audit_count = 0
    if invoice_ids:
        audit_count = db.query(DisputeResolution)\
            .filter(DisputeResolution.invoice_id.in_(invoice_ids))\
            .count()

    # If audit records exist and user has NOT confirmed force-delete, warn them
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

    # Delete dispute_resolutions first (ON DELETE RESTRICT blocks cascade otherwise)
    if invoice_ids and audit_count > 0:
        db.query(DisputeResolution)\
            .filter(DisputeResolution.invoice_id.in_(invoice_ids))\
            .delete(synchronize_session=False)

    # Delete the vehicle — SQLAlchemy cascade handles invoices,
    # invoice_line_items, and service_records automatically
    db.delete(vehicle)
    db.commit()

    return None
