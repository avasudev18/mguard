"""
backend/app/models/admin_models.py

SQLAlchemy ORM models for the admin subsystem.
Uses the same Base from app.utils.database so all tables live in one metadata.

MUST be imported in main.py before create_all():
    from app.models import admin_models  # noqa: F401
"""

from datetime import datetime
from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, Text, DECIMAL
from sqlalchemy.orm import relationship
from app.utils.database import Base


class Admin(Base):
    """
    Internal admin accounts — completely separate from app_users.
    Roles: super_admin | support_admin
    """
    __tablename__ = "admins"

    id            = Column(Integer,     primary_key=True, index=True)
    email         = Column(String(255), unique=True, nullable=False, index=True)
    password_hash = Column(String(255), nullable=False)
    role          = Column(String(50),  nullable=False, default="super_admin")
    totp_secret   = Column(String(255), nullable=True)   # base32 TOTP secret (pyotp)
    created_at    = Column(DateTime,    default=datetime.utcnow)
    last_login    = Column(DateTime,    nullable=True)

    actions = relationship(
        "AdminAction", back_populates="admin",
        foreign_keys="AdminAction.admin_id",
    )


class AdminAction(Base):
    """
    Immutable audit log — never deleted.
    target_user_id SET NULL on user delete so the trail is never broken.
    """
    __tablename__ = "admin_actions"

    id             = Column(Integer,    primary_key=True, index=True)
    admin_id       = Column(Integer,    ForeignKey("admins.id"), nullable=False)
    # disable_user | enable_user | delete_user | impersonate
    action_type    = Column(String(50), nullable=False)
    target_user_id = Column(Integer,    ForeignKey("app_users.id", ondelete="SET NULL"),
                            nullable=True)
    reason         = Column(Text,       nullable=True)
    timestamp      = Column(DateTime,   default=datetime.utcnow)
    ip_address     = Column(String(45), nullable=True)

    admin = relationship("Admin", back_populates="actions", foreign_keys=[admin_id])


class DailyMetrics(Base):
    """Nightly snapshot of platform metrics for the cost dashboard."""
    __tablename__ = "daily_metrics"

    metric_date           = Column(String(10),   primary_key=True)   # YYYY-MM-DD
    total_users           = Column(Integer,       nullable=True)
    active_users          = Column(Integer,       nullable=True)
    paid_users            = Column(Integer,       nullable=True)
    free_users            = Column(Integer,       nullable=True)
    disabled_users        = Column(Integer,       nullable=True)
    total_vehicles        = Column(Integer,       nullable=True)
    total_invoices        = Column(Integer,       nullable=True)
    total_recommendations = Column(Integer,       nullable=True)
    total_tokens_consumed = Column(Integer,       nullable=True)
    total_ai_cost_usd     = Column(DECIMAL(10,2), nullable=True)
    created_at            = Column(DateTime,      default=datetime.utcnow)
