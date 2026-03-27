"""
app/api/admin_aria_quality.py
==============================
Admin endpoint that serves ARIA RAGAs quality metrics for the
AriaQuality.jsx dashboard panel.

Route (registered in main.py):
    GET /api/admin/metrics/aria-quality

Query parameters:
    period  7d | 30d | 90d  (default 30d)

Response shape — see AriaQualityResponse below.

Architecture note:
    This endpoint reads from evaluation_log (migration 011).
    It does NOT call the Anthropic API — it surfaces pre-computed
    scores written by scripts/eval_ragas.py and scripts/eval_retrieval.py.
    Zero LLM cost per dashboard load.
"""

from datetime import datetime, timedelta
from typing import List, Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import func, text
from sqlalchemy.orm import Session

from app.models.admin_models import Admin
from app.utils.admin_auth import get_current_admin
from app.utils.database import get_db

router = APIRouter()


# ── Response schemas ──────────────────────────────────────────────────────────

class DailyQualityPoint(BaseModel):
    date: str                           # YYYY-MM-DD
    faithfulness: Optional[float]
    answer_relevance: Optional[float]
    context_precision: Optional[float]
    precision_at_5: Optional[float]
    recall_at_5: Optional[float]


class AlertItem(BaseModel):
    metric: str                         # e.g. "faithfulness"
    current_value: float
    rolling_avg: float
    drop: float                         # current_value - rolling_avg (negative = degradation)
    message: str


class EmbeddingModelPoint(BaseModel):
    embedding_model: str
    avg_precision_at_5: Optional[float]
    avg_recall_at_5: Optional[float]
    avg_faithfulness: Optional[float]
    run_count: int


class AriaQualityResponse(BaseModel):
    period_days: int
    embedding_model: str                # most recently used model in this period

    # ── 7-day rolling averages (KPI cards) ───────────────────────────────────
    avg_faithfulness: Optional[float]
    avg_answer_relevance: Optional[float]
    avg_context_precision: Optional[float]
    avg_context_recall: Optional[float]
    avg_precision_at_5: Optional[float]
    avg_recall_at_5: Optional[float]

    # ── Targets (for progress bars / colour-coding in the UI) ─────────────────
    target_faithfulness: float = 0.85
    target_answer_relevance: float = 0.80
    target_context_precision: float = 0.70
    target_context_recall: float = 0.75
    target_precision_at_5: float = 0.70
    target_recall_at_5: float = 0.80

    # ── Time series (daily averages for charts) ───────────────────────────────
    by_day: List[DailyQualityPoint]

    # ── Alerts (metrics that have dropped > 0.05 below 7-day rolling avg) ────
    alerts: List[AlertItem]

    # ── Total evaluation runs in this period ─────────────────────────────────
    ragas_run_count: int
    retrieval_run_count: int

    # ── Embedding model comparison (for migration gate visibility) ────────────
    by_embedding_model: List[EmbeddingModelPoint]

    # ── Golden dataset version in use ─────────────────────────────────────────
    golden_dataset_version: Optional[str]

    # ── Seed data flag — true when no real eval data exists yet ──────────────
    is_seeded: bool = False


# ── Helper ────────────────────────────────────────────────────────────────────

def _round(v) -> Optional[float]:
    """Round to 4dp, return None if value is None. Handles Decimal from psycopg2."""
    return round(float(v), 4) if v is not None else None  # float() handles Decimal


def _safe_avg(values: list) -> Optional[float]:
    vals = [float(v) for v in values if v is not None]
    if not vals:
        return None
    return round(sum(vals) / len(vals), 4)


# ── Seeded fallback data ──────────────────────────────────────────────────────
# Returned when no real evaluation runs exist yet.
# Gives the dashboard a useful shape to display before Phase 1 eval jobs start.

def _seeded_response(period_days: int) -> AriaQualityResponse:
    from datetime import date, timedelta
    today = date.today()
    by_day = []
    for i in range(period_days - 1, -1, -1):
        d = today - timedelta(days=i)
        by_day.append(DailyQualityPoint(
            date=str(d),
            faithfulness=None,
            answer_relevance=None,
            context_precision=None,
            precision_at_5=None,
            recall_at_5=None,
        ))
    return AriaQualityResponse(
        period_days=period_days,
        embedding_model="all-MiniLM-L6-v2",
        avg_faithfulness=None,
        avg_answer_relevance=None,
        avg_context_precision=None,
        avg_context_recall=None,
        avg_precision_at_5=None,
        avg_recall_at_5=None,
        by_day=by_day,
        alerts=[],
        ragas_run_count=0,
        retrieval_run_count=0,
        by_embedding_model=[],
        golden_dataset_version=None,
        is_seeded=True,
    )


# ── Endpoint ──────────────────────────────────────────────────────────────────

@router.get("/metrics/aria-quality", response_model=AriaQualityResponse)
def get_aria_quality_metrics(
    period: str = Query("30d", pattern="^(7d|30d|90d)$"),
    _admin: Admin = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    """
    Returns ARIA RAGAs and retrieval precision/recall metrics for the
    admin quality dashboard panel.

    Reads from evaluation_log (migration 011).
    Returns seeded placeholder response if no evaluation data exists yet.
    """
    days = {"7d": 7, "30d": 30, "90d": 90}[period]
    cutoff = datetime.utcnow() - timedelta(days=days)

    # ── Check if evaluation_log table exists ──────────────────────────────────
    # Graceful degradation: if the migration hasn't run yet, return seeded data
    try:
        db.execute(text("SELECT 1 FROM evaluation_log LIMIT 1"))
    except Exception:
        return _seeded_response(days)

    # ── Fetch all rows in the period ─────────────────────────────────────────
    rows = db.execute(
        text("""
            SELECT
                DATE(created_at AT TIME ZONE 'UTC')  AS day,
                run_type,
                embedding_model,
                faithfulness,
                answer_relevance,
                context_precision,
                context_recall,
                precision_at_5,
                recall_at_5,
                golden_dataset_version
            FROM evaluation_log
            WHERE created_at >= :cutoff
            ORDER BY created_at ASC
        """),
        {"cutoff": cutoff},
    ).fetchall()

    if not rows:
        return _seeded_response(days)

    # ── Separate RAGAs vs retrieval rows ──────────────────────────────────────
    ragas_rows      = [r for r in rows if r.run_type == "ragas_nightly"]
    retrieval_rows  = [r for r in rows if r.run_type in ("retrieval_golden", "migration_gate")]

    # ── KPI averages across entire period ────────────────────────────────────
    avg_faithfulness      = _safe_avg([r.faithfulness      for r in ragas_rows])
    avg_answer_relevance  = _safe_avg([r.answer_relevance  for r in ragas_rows])
    avg_context_precision = _safe_avg([r.context_precision for r in ragas_rows])
    avg_context_recall    = _safe_avg([r.context_recall    for r in ragas_rows])
    avg_precision_at_5    = _safe_avg([r.precision_at_5    for r in rows])
    avg_recall_at_5       = _safe_avg([r.recall_at_5       for r in rows])

    # ── Most recent embedding model ───────────────────────────────────────────
    latest_model = rows[-1].embedding_model if rows else "all-MiniLM-L6-v2"

    # ── Golden dataset version ────────────────────────────────────────────────
    versions = [r.golden_dataset_version for r in rows if r.golden_dataset_version]
    golden_version = versions[-1] if versions else None

    # ── Daily time series ─────────────────────────────────────────────────────
    from collections import defaultdict
    daily: dict = defaultdict(lambda: {
        "faithfulness": [], "answer_relevance": [], "context_precision": [],
        "precision_at_5": [], "recall_at_5": [],
    })
    def _to_date(val):
        """Coerce r.day to datetime.date — psycopg2 may return date, datetime, or str."""
        from datetime import date as _date
        import datetime as _dt
        if val is None:
            return None
        if isinstance(val, _date) and not isinstance(val, _dt.datetime):
            return val
        if isinstance(val, _dt.datetime):
            return val.date()
        # string fallback e.g. "2026-03-23"
        try:
            return _date.fromisoformat(str(val)[:10])
        except Exception:
            return None

    for r in rows:
        day_val = _to_date(r.day)
        day_str = str(day_val) if day_val else "unknown"
        if r.faithfulness      is not None: daily[day_str]["faithfulness"].append(float(r.faithfulness))
        if r.answer_relevance  is not None: daily[day_str]["answer_relevance"].append(float(r.answer_relevance))
        if r.context_precision is not None: daily[day_str]["context_precision"].append(float(r.context_precision))
        if r.precision_at_5    is not None: daily[day_str]["precision_at_5"].append(float(r.precision_at_5))
        if r.recall_at_5       is not None: daily[day_str]["recall_at_5"].append(float(r.recall_at_5))

    by_day = []
    # Fill every day in the period, including days with no runs
    today = datetime.utcnow().date()
    for i in range(days - 1, -1, -1):
        d = str(today - timedelta(days=i))
        bucket = daily.get(d, {})
        by_day.append(DailyQualityPoint(
            date=d,
            faithfulness      = _safe_avg(bucket.get("faithfulness", [])),
            answer_relevance  = _safe_avg(bucket.get("answer_relevance", [])),
            context_precision = _safe_avg(bucket.get("context_precision", [])),
            precision_at_5    = _safe_avg(bucket.get("precision_at_5", [])),
            recall_at_5       = _safe_avg(bucket.get("recall_at_5", [])),
        ))

    # ── Alerts (drop > 0.05 below 7-day rolling avg) ─────────────────────────
    alerts: List[AlertItem] = []
    THRESHOLD = 0.05
    TARGETS = {
        "faithfulness":      0.85,
        "answer_relevance":  0.80,
        "context_precision": 0.70,
        "precision_at_5":    0.70,
        "recall_at_5":       0.80,
    }
    LABELS = {
        "faithfulness":      "RAGAs Faithfulness",
        "answer_relevance":  "RAGAs Answer Relevance",
        "context_precision": "Context Precision",
        "precision_at_5":    "Retrieval Precision@5",
        "recall_at_5":       "Retrieval Recall@5",
    }

    # Compute 7-day rolling values for comparison
    # Use _to_date() to safely coerce r.day regardless of psycopg2 return type
    _today = datetime.utcnow().date()
    seven_day_rows = [
        r for r in rows
        if _to_date(r.day) is not None
        and (_today - _to_date(r.day)).days <= 7
    ]

    def _alert_check(metric_key: str, current_avg: Optional[float]):
        if current_avg is None:
            return
        rolling = _safe_avg([
            float(getattr(r, metric_key))
            for r in seven_day_rows
            if getattr(r, metric_key) is not None
        ])
        if rolling is None:
            return
        drop = current_avg - rolling
        target = TARGETS.get(metric_key, 0.70)
        if current_avg < target - THRESHOLD or drop < -THRESHOLD:
            alerts.append(AlertItem(
                metric=metric_key,
                current_value=round(current_avg, 4),
                rolling_avg=round(rolling, 4),
                drop=round(drop, 4),
                message=(
                    f"{LABELS[metric_key]} dropped to {current_avg:.2f} "
                    f"(target ≥ {target:.2f}, 7-day avg {rolling:.2f})"
                ),
            ))

    _alert_check("faithfulness",      avg_faithfulness)
    _alert_check("answer_relevance",  avg_answer_relevance)
    _alert_check("context_precision", avg_context_precision)
    _alert_check("precision_at_5",    avg_precision_at_5)
    _alert_check("recall_at_5",       avg_recall_at_5)

    # ── Embedding model comparison ────────────────────────────────────────────
    model_buckets: dict = defaultdict(lambda: {
        "precision": [], "recall": [], "faithfulness": [], "count": 0
    })
    for r in rows:
        b = model_buckets[r.embedding_model]
        b["count"] += 1
        if r.precision_at_5 is not None: b["precision"].append(float(r.precision_at_5))
        if r.recall_at_5    is not None: b["recall"].append(float(r.recall_at_5))
        if r.faithfulness   is not None: b["faithfulness"].append(float(r.faithfulness))

    by_embedding_model = [
        EmbeddingModelPoint(
            embedding_model=model,
            avg_precision_at_5=_safe_avg(b["precision"]),
            avg_recall_at_5=_safe_avg(b["recall"]),
            avg_faithfulness=_safe_avg(b["faithfulness"]),
            run_count=b["count"],
        )
        for model, b in model_buckets.items()
    ]

    return AriaQualityResponse(
        period_days=days,
        embedding_model=latest_model,
        avg_faithfulness=avg_faithfulness,
        avg_answer_relevance=avg_answer_relevance,
        avg_context_precision=avg_context_precision,
        avg_context_recall=avg_context_recall,
        avg_precision_at_5=avg_precision_at_5,
        avg_recall_at_5=avg_recall_at_5,
        by_day=by_day,
        alerts=alerts,
        ragas_run_count=len(ragas_rows),
        retrieval_run_count=len(retrieval_rows),
        by_embedding_model=by_embedding_model,
        golden_dataset_version=golden_version,
        is_seeded=False,
    )
