"""
backend/app/api/admin_phase2.py

Phase 2 admin endpoints:

  GET  /api/admin/metrics/activity
  GET  /api/admin/metrics/tokens
  GET  /api/admin/metrics/top-consumers
  GET  /api/admin/metrics/anomalies
  POST /api/admin/metrics/anomalies/{alert_id}/resolve
  GET  /api/admin/metrics/conversions
  POST /api/admin/metrics/conversions          (super_admin only)
  GET  /api/admin/users/{user_id}/notes
  POST /api/admin/users/{user_id}/notes
  POST /api/admin/users/{user_id}/impersonate
  POST /api/admin/users/{user_id}/impersonate/end

All routes use get_current_admin() — never get_current_active_user().
Never imports from app.utils.auth.
"""

import os
import sys
from datetime import datetime, timedelta, date
from decimal import Decimal
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import func, text
from sqlalchemy.orm import Session

from app.models.admin_models import Admin, AdminAction
from app.models.models import Invoice, User, Vehicle
from app.models.phase2_models import (
    AnomalyAlert,
    SubscriptionEvent,
    TokenUsageLog,
    UserNote,
)
from app.models.phase2_schemas import (
    ActivityMetricsResponse,
    AnomalyAlertResponse,
    ConversionEventItem,
    ConversionMetricsResponse,
    CreateConversionRequest,
    CreateNoteRequest,
    DailyActivityPoint,
    DailyTokenPoint,
    ImpersonationResponse,
    TopConsumerItem,
    TopConsumersResponse,
    TokenMetricsResponse,
    AgentBreakdown,
    UserNoteItem,
    UserNotesResponse,
)
from app.utils.admin_auth import (
    ADMIN_SECRET_KEY,
    ALGORITHM,
    create_token,
    get_client_ip,
    get_current_admin,
    require_super_admin,
)
from app.utils.database import get_db

router = APIRouter()

# ── Helpers ───────────────────────────────────────────────────────────────────

COST_ANOMALY_THRESHOLD = float(os.getenv("COST_ANOMALY_THRESHOLD_USD", "10.00"))
IMPERSONATION_EXPIRE_MINUTES = 30


def _get_user_or_404(user_id: int, db: Session) -> User:
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    return user


def _parse_period(period: str) -> int:
    return {"7d": 7, "30d": 30, "90d": 90}.get(period, 30)


def _date_cutoff(days: int) -> datetime:
    return datetime.utcnow() - timedelta(days=days)


def _log_action(
    db: Session,
    admin: Admin,
    action_type: str,
    target_user_id: Optional[int],
    reason: Optional[str],
    ip: str,
) -> None:
    db.add(AdminAction(
        admin_id=admin.id,
        action_type=action_type,
        target_user_id=target_user_id,
        reason=reason,
        ip_address=ip,
    ))


# ── Activity metrics ──────────────────────────────────────────────────────────

@router.get("/metrics/activity", response_model=ActivityMetricsResponse)
def get_activity_metrics(
    period: str = Query("30d", regex="^(7d|30d|90d)$"),
    date_from: Optional[date] = Query(None),
    date_to:   Optional[date] = Query(None),
    _admin: Admin = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    """
    Daily activity breakdown: active users, new signups, invoice uploads,
    recommendation requests. Derives data from actual tables — not daily_metrics.
    """
    days = _parse_period(period)
    start_dt = datetime.combine(date_from, datetime.min.time()) if date_from \
        else datetime.utcnow() - timedelta(days=days)
    end_dt = datetime.combine(date_to, datetime.max.time()) if date_to \
        else datetime.utcnow()

    # Build date series in Python — avoids generate_series casting issues
    date_series = []
    cur = start_dt.date()
    end_date = end_dt.date()
    while cur <= end_date:
        date_series.append((cur,))
        cur += timedelta(days=1)

    # Active users per day (users with last_active_at on that day)
    active_q = db.execute(
        text("""
            SELECT DATE(last_active_at) AS day, COUNT(*) AS cnt
            FROM app_users
            WHERE last_active_at >= :start AND last_active_at <= :end
            GROUP BY DATE(last_active_at)
        """),
        {"start": start_dt, "end": end_dt},
    ).fetchall()
    active_map = {str(r.day): r.cnt for r in active_q}

    # New signups per day
    signup_q = db.execute(
        text("""
            SELECT DATE(created_at) AS day, COUNT(*) AS cnt
            FROM app_users
            WHERE created_at >= :start AND created_at <= :end
            GROUP BY DATE(created_at)
        """),
        {"start": start_dt, "end": end_dt},
    ).fetchall()
    signup_map = {str(r.day): r.cnt for r in signup_q}

    # Invoice uploads per day
    invoice_q = db.execute(
        text("""
            SELECT DATE(created_at) AS day, COUNT(*) AS cnt
            FROM invoices
            WHERE created_at >= :start AND created_at <= :end
            GROUP BY DATE(created_at)
        """),
        {"start": start_dt, "end": end_dt},
    ).fetchall()
    invoice_map = {str(r.day): r.cnt for r in invoice_q}

    # Recommendations per day (via token logs — recommendation agent)
    rec_q = db.execute(
        text("""
            SELECT DATE(created_at) AS day, COUNT(*) AS cnt
            FROM token_usage_logs
            WHERE agent_name = 'recommendation'
              AND created_at >= :start AND created_at <= :end
            GROUP BY DATE(created_at)
        """),
        {"start": start_dt, "end": end_dt},
    ).fetchall()
    rec_map = {str(r.day): r.cnt for r in rec_q}

    data = []
    for (day_dt,) in date_series:
        day_str = str(day_dt)
        data.append(DailyActivityPoint(
            date=day_str,
            active_users=active_map.get(day_str, 0),
            new_signups=signup_map.get(day_str, 0),
            total_invoices_uploaded=invoice_map.get(day_str, 0),
            total_recommendations=rec_map.get(day_str, 0),
        ))

    return ActivityMetricsResponse(period_days=days, data=data)


# ── Token metrics ─────────────────────────────────────────────────────────────

@router.get("/metrics/tokens", response_model=TokenMetricsResponse)
def get_token_metrics(
    period: str = Query("30d", regex="^(7d|30d|90d)$"),
    date_from: Optional[date] = Query(None),
    date_to:   Optional[date] = Query(None),
    _admin: Admin = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    days = _parse_period(period)
    start_dt = datetime.combine(date_from, datetime.min.time()) if date_from \
        else datetime.utcnow() - timedelta(days=days)
    end_dt = datetime.combine(date_to, datetime.max.time()) if date_to \
        else datetime.utcnow()

    # Totals
    totals = db.execute(
        text("""
            SELECT
                COALESCE(SUM(input_tokens), 0)  AS total_input,
                COALESCE(SUM(output_tokens), 0) AS total_output,
                COALESCE(SUM(cost_usd), 0)      AS total_cost
            FROM token_usage_logs
            WHERE created_at >= :start AND created_at <= :end
        """),
        {"start": start_dt, "end": end_dt},
    ).fetchone()

    total_input  = int(totals.total_input)
    total_output = int(totals.total_output)
    total_cost   = float(totals.total_cost)
    total_tokens = total_input + total_output

    # Per-agent breakdown — single GROUP BY query
    agent_rows = db.execute(
        text("""
            SELECT
                agent_name,
                SUM(input_tokens)  AS input_tokens,
                SUM(output_tokens) AS output_tokens,
                SUM(cost_usd)      AS cost_usd,
                COUNT(*)           AS call_count
            FROM token_usage_logs
            WHERE created_at >= :start AND created_at <= :end
            GROUP BY agent_name
            ORDER BY cost_usd DESC
        """),
        {"start": start_dt, "end": end_dt},
    ).fetchall()

    by_agent = [
        AgentBreakdown(
            agent_name=r.agent_name,
            input_tokens=int(r.input_tokens),
            output_tokens=int(r.output_tokens),
            cost_usd=round(float(r.cost_usd), 4),
            call_count=int(r.call_count),
            pct_of_total=round(float(r.cost_usd) / total_cost * 100, 1) if total_cost > 0 else 0.0,
        )
        for r in agent_rows
    ]

    # Daily breakdown
    daily_rows = db.execute(
        text("""
            SELECT
                DATE(created_at) AS day,
                SUM(cost_usd)    AS cost_usd,
                SUM(input_tokens + output_tokens) AS total_tokens
            FROM token_usage_logs
            WHERE created_at >= :start AND created_at <= :end
            GROUP BY DATE(created_at)
            ORDER BY day
        """),
        {"start": start_dt, "end": end_dt},
    ).fetchall()

    by_day = [
        DailyTokenPoint(
            date=str(r.day),
            cost_usd=round(float(r.cost_usd), 4),
            total_tokens=int(r.total_tokens),
        )
        for r in daily_rows
    ]

    return TokenMetricsResponse(
        period_days=days,
        total_input_tokens=total_input,
        total_output_tokens=total_output,
        total_cost_usd=round(total_cost, 4),
        by_agent=by_agent,
        by_day=by_day,
    )


@router.get("/metrics/top-consumers", response_model=TopConsumersResponse)
def get_top_consumers(
    period: str = Query("30d", regex="^(7d|30d|90d)$"),
    limit:  int = Query(20, ge=1, le=100),
    _admin: Admin = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    days = _parse_period(period)
    start_dt = _date_cutoff(days)

    rows = db.execute(
        text("""
            SELECT
                t.user_id,
                u.email,
                u.full_name,
                SUM(t.input_tokens + t.output_tokens) AS total_tokens,
                SUM(t.cost_usd)                       AS total_cost_usd,
                COUNT(*)                              AS call_count
            FROM token_usage_logs t
            JOIN app_users u ON u.id = t.user_id
            WHERE t.created_at >= :start
              AND t.user_id IS NOT NULL
            GROUP BY t.user_id, u.email, u.full_name
            ORDER BY total_cost_usd DESC
            LIMIT :lim
        """),
        {"start": start_dt, "lim": limit},
    ).fetchall()

    consumers = [
        TopConsumerItem(
            user_id=r.user_id,
            email=r.email,
            full_name=r.full_name,
            total_tokens=int(r.total_tokens),
            total_cost_usd=round(float(r.total_cost_usd), 4),
            call_count=int(r.call_count),
        )
        for r in rows
    ]

    return TopConsumersResponse(consumers=consumers, period_days=days)


# ── Anomaly alerts ────────────────────────────────────────────────────────────

@router.get("/metrics/anomalies", response_model=List[AnomalyAlertResponse])
def get_anomalies(
    admin: Admin = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    """
    Returns all unresolved anomaly alerts.
    Also checks today's spend — creates an alert if threshold exceeded
    and no alert exists for today yet.
    """
    today_str = datetime.utcnow().date().isoformat()

    # Check today's spend from token_usage_logs
    today_cost = db.execute(
        text("""
            SELECT COALESCE(SUM(cost_usd), 0) AS total
            FROM token_usage_logs
            WHERE DATE(created_at) = :today
        """),
        {"today": today_str},
    ).scalar() or 0.0

    threshold = COST_ANOMALY_THRESHOLD

    if float(today_cost) > threshold:
        # Create alert only if none exists for today (unresolved)
        existing = db.query(AnomalyAlert).filter(
            AnomalyAlert.metric_date == today_str,
            AnomalyAlert.alert_type == "cost_threshold_exceeded",
            AnomalyAlert.is_resolved == False,
        ).first()

        if not existing:
            alert = AnomalyAlert(
                alert_type="cost_threshold_exceeded",
                metric_date=today_str,
                actual_value=Decimal(str(round(float(today_cost), 2))),
                threshold_value=Decimal(str(threshold)),
            )
            db.add(alert)
            db.commit()

    alerts = (
        db.query(AnomalyAlert)
        .filter(AnomalyAlert.is_resolved == False)
        .order_by(AnomalyAlert.created_at.desc())
        .all()
    )

    return [
        AnomalyAlertResponse(
            id=a.id,
            alert_type=a.alert_type,
            metric_date=a.metric_date,
            actual_value=float(a.actual_value),
            threshold_value=float(a.threshold_value),
            is_resolved=a.is_resolved,
            resolved_by_admin_id=a.resolved_by_admin_id,
            resolved_at=a.resolved_at,
            created_at=a.created_at,
        )
        for a in alerts
    ]


@router.post("/metrics/anomalies/{alert_id}/resolve", response_model=AnomalyAlertResponse)
def resolve_anomaly(
    alert_id: int,
    request: Request,
    admin: Admin = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    alert = db.query(AnomalyAlert).filter(AnomalyAlert.id == alert_id).first()
    if not alert:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Alert not found")
    if alert.is_resolved:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Alert already resolved")

    alert.is_resolved = True
    alert.resolved_by_admin_id = admin.id
    alert.resolved_at = datetime.utcnow()

    _log_action(db, admin, "resolve_anomaly", None,
                f"Resolved anomaly alert #{alert_id}", get_client_ip(request))
    db.commit()
    db.refresh(alert)

    return AnomalyAlertResponse(
        id=alert.id,
        alert_type=alert.alert_type,
        metric_date=alert.metric_date,
        actual_value=float(alert.actual_value),
        threshold_value=float(alert.threshold_value),
        is_resolved=alert.is_resolved,
        resolved_by_admin_id=alert.resolved_by_admin_id,
        resolved_at=alert.resolved_at,
        created_at=alert.created_at,
    )


# ── Conversion tracking ───────────────────────────────────────────────────────

@router.get("/metrics/conversions", response_model=ConversionMetricsResponse)
def get_conversions(
    period:    str           = Query("30d", regex="^(7d|30d|90d)$"),
    date_from: Optional[date] = Query(None),
    date_to:   Optional[date] = Query(None),
    _admin: Admin = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    days = _parse_period(period)
    start_dt = datetime.combine(date_from, datetime.min.time()) if date_from \
        else datetime.utcnow() - timedelta(days=days)
    end_dt = datetime.combine(date_to, datetime.max.time()) if date_to \
        else datetime.utcnow()

    events_q = (
        db.query(SubscriptionEvent, User)
        .join(User, SubscriptionEvent.user_id == User.id)
        .filter(
            SubscriptionEvent.created_at >= start_dt,
            SubscriptionEvent.created_at <= end_dt,
        )
        .order_by(SubscriptionEvent.created_at.desc())
        .all()
    )

    upgrades    = sum(1 for e, _ in events_q if e.event_type == "upgraded")
    downgrades  = sum(1 for e, _ in events_q if e.event_type == "downgraded")
    cancels     = sum(1 for e, _ in events_q if e.event_type == "cancelled")
    free_users  = db.query(func.count(User.id)).filter(User.subscription_tier == "free").scalar() or 1
    rate        = round(upgrades / free_users * 100, 2)

    event_items = [
        ConversionEventItem(
            id=e.id,
            user_id=e.user_id,
            email=u.email,
            full_name=u.full_name,
            event_type=e.event_type,
            from_tier=e.from_tier,
            to_tier=e.to_tier,
            triggered_by=e.triggered_by,
            created_at=e.created_at,
        )
        for e, u in events_q
    ]

    return ConversionMetricsResponse(
        total_upgrades=upgrades,
        total_downgrades=downgrades,
        total_cancellations=cancels,
        conversion_rate_pct=rate,
        events=event_items,
    )


@router.post("/metrics/conversions", status_code=status.HTTP_201_CREATED)
def create_conversion(
    body: CreateConversionRequest,
    request: Request,
    admin: Admin = Depends(require_super_admin),
    db: Session = Depends(get_db),
):
    """Manually record a tier change and update the user's subscription_tier."""
    user = _get_user_or_404(body.user_id, db)

    event = SubscriptionEvent(
        user_id=body.user_id,
        event_type=body.event_type,
        from_tier=body.from_tier,
        to_tier=body.to_tier,
        triggered_by=body.triggered_by,
    )
    db.add(event)

    # Update the actual tier on the user
    user.subscription_tier = body.to_tier

    _log_action(
        db, admin, "manual_tier_change", body.user_id,
        f"{body.from_tier} -> {body.to_tier} ({body.event_type})",
        get_client_ip(request),
    )
    db.commit()
    db.refresh(event)

    return {"message": f"Conversion recorded for {user.email}", "event_id": event.id}


# ── User notes ────────────────────────────────────────────────────────────────

@router.get("/users/{user_id}/notes", response_model=UserNotesResponse)
def get_user_notes(
    user_id: int,
    _admin: Admin = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    _get_user_or_404(user_id, db)

    rows = (
        db.query(UserNote, Admin)
        .outerjoin(Admin, UserNote.admin_id == Admin.id)
        .filter(UserNote.user_id == user_id)
        .order_by(UserNote.created_at.desc())
        .all()
    )

    notes = [
        UserNoteItem(
            id=n.id,
            user_id=n.user_id,
            admin_id=n.admin_id,
            admin_email=adm.email if adm else None,
            note=n.note,
            created_at=n.created_at,
        )
        for n, adm in rows
    ]

    return UserNotesResponse(notes=notes, total=len(notes))


@router.post("/users/{user_id}/notes", response_model=UserNoteItem, status_code=status.HTTP_201_CREATED)
def add_user_note(
    user_id: int,
    body: CreateNoteRequest,
    admin: Admin = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    _get_user_or_404(user_id, db)

    note = UserNote(
        user_id=user_id,
        admin_id=admin.id,
        note=body.note,
    )
    db.add(note)
    db.commit()
    db.refresh(note)

    return UserNoteItem(
        id=note.id,
        user_id=note.user_id,
        admin_id=note.admin_id,
        admin_email=admin.email,
        note=note.note,
        created_at=note.created_at,
    )


# ── User impersonation ────────────────────────────────────────────────────────

@router.post("/users/{user_id}/impersonate", response_model=ImpersonationResponse)
def start_impersonation(
    user_id: int,
    request: Request,
    admin: Admin = Depends(get_current_admin),   # both roles can impersonate
    db: Session = Depends(get_db),
):
    """
    Creates a 30-minute impersonation JWT signed with ADMIN_SECRET_KEY.
    The main app's get_current_user() recognises type='impersonation' and
    loads the impersonated user transparently.
    """
    user = _get_user_or_404(user_id, db)

    expires_at = datetime.utcnow() + timedelta(minutes=IMPERSONATION_EXPIRE_MINUTES)
    token = create_token(
        {
            "sub": str(user_id),
            "type": "impersonation",
            "impersonated_by_admin_id": admin.id,
        },
        expires_minutes=IMPERSONATION_EXPIRE_MINUTES,
    )

    _log_action(
        db, admin, "start_impersonation", user_id,
        f"Started impersonation of {user.email}",
        get_client_ip(request),
    )
    db.commit()

    return ImpersonationResponse(
        impersonation_token=token,
        user_id=user_id,
        user_email=user.email,
        expires_at=expires_at,
    )


@router.post("/users/{user_id}/impersonate/end", status_code=status.HTTP_200_OK)
def end_impersonation(
    user_id: int,
    request: Request,
    admin: Admin = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    user = _get_user_or_404(user_id, db)

    _log_action(
        db, admin, "end_impersonation", user_id,
        f"Ended impersonation of {user.email}",
        get_client_ip(request),
    )
    db.commit()

    return {"message": "Impersonation session ended"}
