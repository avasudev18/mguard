from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import or_, func
from typing import List, Optional
from datetime import datetime
from pydantic import BaseModel

from app.models.models import Vehicle, ServiceRecord, Invoice, User
from app.utils.database import get_db
from app.utils.auth import get_current_active_user

router = APIRouter()


class ServiceHistoryMatch(BaseModel):
    service_type: str
    service_description: Optional[str] = None
    service_date: Optional[datetime] = None
    mileage_at_service: int
    shop_name: Optional[str] = None
    days_ago: Optional[int] = None
    miles_ago: Optional[int] = None
    invoice_id: Optional[int] = None
    is_manual_entry: bool = False


class ServiceHistorySearchResponse(BaseModel):
    vehicle_id: int
    keyword: str
    total_matches: int
    current_mileage: Optional[int] = None
    results: List[ServiceHistoryMatch]
    summary: str


@router.get("/{vehicle_id}/search", response_model=ServiceHistorySearchResponse)
async def search_service_history(
    vehicle_id: int,
    keyword: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """
    Search a vehicle's service history by keyword — only if owned by the current user.
    Matches against service_type, service_description, and shop_name.
    Returns all matching records sorted by most recent first,
    along with a plain-English summary of when the service was last performed.
    """

    vehicle = db.query(Vehicle).filter(
        Vehicle.id == vehicle_id,
        Vehicle.owner_id == current_user.id
    ).first()
    if not vehicle:
        raise HTTPException(status_code=404, detail="Vehicle not found")

    # Search across service_type, service_description, and shop_name (case-insensitive)
    # Exclude records that have been excluded due to proven disputes
    search_term = f"%{keyword.lower()}%"
    records = db.query(ServiceRecord).filter(
        ServiceRecord.vehicle_id == vehicle_id,
        ServiceRecord.excluded_from_timeline == False,  # skip archived/proven-dispute records
        or_(
            func.lower(ServiceRecord.service_type).like(search_term),
            func.lower(ServiceRecord.service_description).like(search_term),
            func.lower(ServiceRecord.shop_name).like(search_term),
        )
    ).order_by(ServiceRecord.service_date.desc()).all()

    today = datetime.utcnow()
    current_mileage = vehicle.current_mileage

    results = []
    for record in records:
        days_ago = (today - record.service_date).days if record.service_date else None
        miles_ago = (current_mileage - record.mileage_at_service) if current_mileage and record.mileage_at_service else None

        results.append(ServiceHistoryMatch(
            service_type=record.service_type,
            service_description=record.service_description,
            service_date=record.service_date,
            mileage_at_service=record.mileage_at_service,
            shop_name=record.shop_name,
            days_ago=days_ago,
            miles_ago=miles_ago,
            invoice_id=record.invoice_id,
            is_manual_entry=record.is_manual_entry,
        ))

    # Build a plain-English summary
    summary = _build_summary(keyword, results, current_mileage)

    return ServiceHistorySearchResponse(
        vehicle_id=vehicle_id,
        keyword=keyword,
        total_matches=len(results),
        current_mileage=current_mileage,
        results=results,
        summary=summary,
    )


def _build_summary(keyword: str, results: list, current_mileage: Optional[int]) -> str:
    if not results:
        return f"No records found matching \"{keyword}\" in this vehicle's service history."

    latest = results[0]  # already sorted most recent first
    parts = []

    # When
    if latest.days_ago is not None:
        if latest.days_ago == 0:
            when = "today"
        elif latest.days_ago == 1:
            when = "yesterday"
        elif latest.days_ago < 30:
            when = f"{latest.days_ago} days ago"
        elif latest.days_ago < 365:
            months = latest.days_ago // 30
            when = f"approximately {months} month{'s' if months > 1 else ''} ago"
        else:
            years = latest.days_ago // 365
            months = (latest.days_ago % 365) // 30
            when = f"approximately {years} year{'s' if years > 1 else ''}"
            if months > 0:
                when += f" and {months} month{'s' if months > 1 else ''} ago"
            else:
                when += " ago"
        parts.append(f"Last performed {when}")
    elif latest.service_date:
        parts.append(f"Last performed on {latest.service_date.strftime('%B %d, %Y')}")
    else:
        parts.append("Last performed on an unknown date")

    # Mileage
    if latest.mileage_at_service:
        parts[0] += f" at {latest.mileage_at_service:,} miles"

    # Miles since
    if latest.miles_ago is not None and latest.miles_ago >= 0:
        parts.append(f"{latest.miles_ago:,} miles since last service")
    elif latest.miles_ago is not None and latest.miles_ago < 0:
        parts.append("mileage data may be inconsistent")

    # Shop
    if latest.shop_name:
        parts.append(f"performed at {latest.shop_name}")

    # Total occurrences
    if len(results) > 1:
        parts.append(f"{len(results)} total records found in history")

    return ". ".join(parts) + "."
