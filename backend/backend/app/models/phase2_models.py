"""
backend/app/models/phase2_models.py

SQLAlchemy ORM models for Phase 2 features:
  - TokenUsageLog      (token_usage_logs)
  - UserNote           (user_notes)
  - SubscriptionEvent  (subscription_events)
  - AnomalyAlert       (anomaly_alerts)
  - ChatInteraction    (chat_interactions)  ← NEW: ARIA chat audit log

MUST be imported in main.py before create_all():
    from app.models import phase2_models  # noqa: F401
"""

from datetime import datetime
from sqlalchemy import (
    Boolean, Column, DateTime, ForeignKey,
    Integer, String, Text, DECIMAL, Float,
)
from sqlalchemy.dialects.postgresql import JSONB
from app.utils.database import Base


class TokenUsageLog(Base):
    """
    One row per LLM API call.
    Populated by token_logger.py — never modified or deleted.
    user_id is NULL for system-initiated calls (e.g. scheduled jobs).
    """
    __tablename__ = "token_usage_logs"

    id                  = Column(Integer,        primary_key=True, index=True)
    user_id             = Column(Integer,        ForeignKey("app_users.id", ondelete="SET NULL"),
                                 nullable=True,  index=True)
    agent_name          = Column(String(50),     nullable=False, index=True)
    model_name          = Column(String(100),    nullable=False)
    input_tokens        = Column(Integer,        nullable=False)
    output_tokens       = Column(Integer,        nullable=False)
    cost_usd            = Column(DECIMAL(10, 6), nullable=False)
    request_duration_ms = Column(Integer,        nullable=True)
    created_at          = Column(DateTime,       default=datetime.utcnow, index=True)


class UserNote(Base):
    """Append-only support notes written by admins about users."""
    __tablename__ = "user_notes"

    id         = Column(Integer,  primary_key=True, index=True)
    user_id    = Column(Integer,  ForeignKey("app_users.id",  ondelete="CASCADE"),  nullable=False, index=True)
    admin_id   = Column(Integer,  ForeignKey("admins.id",     ondelete="SET NULL"), nullable=True)
    note       = Column(Text,     nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)


class SubscriptionEvent(Base):
    """Immutable log of subscription tier changes."""
    __tablename__ = "subscription_events"

    id           = Column(Integer,    primary_key=True, index=True)
    user_id      = Column(Integer,    ForeignKey("app_users.id", ondelete="CASCADE"), nullable=False, index=True)
    event_type   = Column(String(50), nullable=False)
    from_tier    = Column(String(50), nullable=False)
    to_tier      = Column(String(50), nullable=False)
    triggered_by = Column(String(50), nullable=True)
    created_at   = Column(DateTime,   default=datetime.utcnow, index=True)


class AnomalyAlert(Base):
    """One row per triggered cost anomaly."""
    __tablename__ = "anomaly_alerts"

    id                   = Column(Integer,        primary_key=True, index=True)
    alert_type           = Column(String(50),     nullable=False, default="cost_threshold_exceeded")
    metric_date          = Column(String(10),     nullable=False)
    actual_value         = Column(DECIMAL(10, 2), nullable=False)
    threshold_value      = Column(DECIMAL(10, 2), nullable=False)
    is_resolved          = Column(Boolean,        nullable=False, default=False)
    resolved_by_admin_id = Column(Integer,        ForeignKey("admins.id", ondelete="SET NULL"), nullable=True)
    resolved_at          = Column(DateTime,       nullable=True)
    created_at           = Column(DateTime,       default=datetime.utcnow)


class ChatInteraction(Base):
    """
    Immutable audit log — one row per ARIA chat turn.

    Written by app/api/chat.py after every successful LLM response.
    Never modified or deleted — provides:
      - Full audit trail for compliance
      - Source data for nightly RAGAs evaluation job (eval_ragas.py)
      - Usage analytics for the admin quality dashboard

    retrieved_chunk_ids: JSON array of pgvector row IDs returned by retrieval step.
    citations: JSON array of { source, text } objects included in the response.
    """
    __tablename__ = "chat_interactions"

    id                   = Column(Integer,    primary_key=True, index=True)
    user_id              = Column(Integer,    ForeignKey("app_users.id", ondelete="SET NULL"),
                                  nullable=True, index=True)
    vehicle_id           = Column(Integer,    ForeignKey("vehicles.id", ondelete="SET NULL"),
                                  nullable=True, index=True)

    # The user's raw query (stored for RAGAs evaluation sampling)
    query                = Column(Text,       nullable=False)

    # The full ARIA response text
    response             = Column(Text,       nullable=True)

    # JSON array of pgvector row IDs: [{"table": "oem_schedules", "id": 12}, ...]
    retrieved_chunk_ids  = Column(JSONB,      nullable=True)

    # JSON array of source citations included in the response
    citations            = Column(JSONB,      nullable=True)

    # Whether the guardrail escalation path was triggered
    escalation_triggered = Column(Boolean,    nullable=False, default=False)

    # Latency metrics
    retrieval_latency_ms = Column(Integer,    nullable=True)
    llm_latency_ms       = Column(Integer,    nullable=True)
    total_latency_ms     = Column(Integer,    nullable=True)

    # Retrieval quality scores (populated by eval_ragas.py — NULL at write time)
    faithfulness         = Column(Float,      nullable=True)
    answer_relevance     = Column(Float,      nullable=True)

    created_at           = Column(DateTime,   default=datetime.utcnow, index=True)
