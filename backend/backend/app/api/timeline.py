from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List

from app.models.models import Vehicle, ServiceRecord, Invoice, User
from app.models.schemas import TimelineResponse, TimelineEvent
from app.utils.database import get_db
from app.utils.auth import get_current_active_user

router = APIRouter()


@router.get("/{vehicle_id}", response_model=TimelineResponse)
async def get_timeline(
    vehicle_id: int,
    include_archived: bool = False,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """
    Get maintenance timeline for a vehicle — only if owned by the current user.
    By default, service records linked to archived (proven upsell/duplicate)
    invoices are excluded — they are retained in the DB but not shown.
    Pass ?include_archived=true to show them (e.g. for the dispute audit view).
    """

    vehicle = db.query(Vehicle).filter(
        Vehicle.id == vehicle_id,
        Vehicle.owner_id == current_user.id
    ).first()
    if not vehicle:
        raise HTTPException(status_code=404, detail="Vehicle not found")

    query = db.query(ServiceRecord).filter(ServiceRecord.vehicle_id == vehicle_id)

    if not include_archived:
        # Filter out records that have been excluded due to proven disputes
        query = query.filter(ServiceRecord.excluded_from_timeline == False)

    service_records = query.order_by(ServiceRecord.service_date.desc()).all()

    # Build timeline events
    events = []
    for record in service_records:
        amount         = None
        is_disputed    = False
        dispute_status = None

        if record.invoice_id:
            invoice = db.query(Invoice).filter(Invoice.id == record.invoice_id).first()
            if invoice:
                amount         = invoice.total_amount
                is_disputed    = invoice.dispute_status is not None
                dispute_status = invoice.dispute_status

        events.append(TimelineEvent(
            date=record.service_date,
            mileage=record.mileage_at_service,
            service_type=record.service_type,
            description=record.service_description,
            shop_name=record.shop_name,
            amount=amount,
            invoice_id=record.invoice_id,
            is_disputed=is_disputed,
            dispute_status=dispute_status,
        ))

    return TimelineResponse(vehicle_id=vehicle_id, events=events)
