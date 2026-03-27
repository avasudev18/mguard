from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
import os
import logging

from app.api import vehicles, invoices, recommendations, timeline, service_history, auth
from app.utils.database import engine, Base, SessionLocal

# Import all models so SQLAlchemy registers them before create_all
from app.models import models        # noqa: F401
from app.models import admin_models  # noqa: F401
from app.models import phase2_models # noqa: F401

# Create database tables
Base.metadata.create_all(bind=engine)

log = logging.getLogger(__name__)

app = FastAPI(
    title="MaintenanceGuard API",
    description="Vehicle maintenance tracking and upsell detection system",
    version="0.1.0"
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000", "http://localhost:5174"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount uploads directory
os.makedirs("uploads", exist_ok=True)
app.mount("/uploads", StaticFiles(directory="uploads"), name="uploads")

# Include existing routers — unchanged
app.include_router(auth.router,            prefix="/api/auth",            tags=["auth"])
app.include_router(vehicles.router,        prefix="/api/vehicles",        tags=["vehicles"])
app.include_router(invoices.router,        prefix="/api/invoices",        tags=["invoices"])
app.include_router(recommendations.router, prefix="/api/recommendations", tags=["recommendations"])
app.include_router(timeline.router,        prefix="/api/timeline",        tags=["timeline"])
app.include_router(service_history.router, prefix="/api/service-history", tags=["service-history"])

# Phase 1 admin routers — unchanged
from app.api import admin_auth, admin  # noqa: E402
app.include_router(admin_auth.router, prefix="/api/admin/auth", tags=["admin-auth"])
app.include_router(admin.router,      prefix="/api/admin",      tags=["admin"])

# Phase 2 admin router
from app.api import admin_phase2  # noqa: E402
app.include_router(admin_phase2.router, prefix="/api/admin", tags=["admin-phase2"])

# ── ARIA RAG routers (Phase 1) ────────────────────────────────────────────────
from app.api import chat as aria_chat          # noqa: E402
from app.api import admin_aria_quality         # noqa: E402
app.include_router(aria_chat.router,           prefix="/api/chat",  tags=["aria-chat"])
app.include_router(admin_aria_quality.router,  prefix="/api/admin", tags=["admin-aria-quality"])

# OEM maintenance admin CRUD
from app.api import admin_oem                  # noqa: E402
app.include_router(admin_oem.router,           prefix="/api/admin", tags=["admin-oem"])

# Dynamic Asset-Based Tolerance System — maintenance_thresholds CRUD (Flaws 1 + 3 fix)
from app.api import admin_thresholds           # noqa: E402
app.include_router(admin_thresholds.router,    prefix="/api/admin", tags=["admin-thresholds"])


# ── Phase 0 startup hook: batch-embed OEM rows ────────────────────────────────
@app.on_event("startup")
async def embed_oem_on_startup():
    """
    On every startup, embed any OEMSchedule rows that have a NULL
    content_embedding. This is idempotent — rows that already have
    embeddings are skipped.

    This runs synchronously on startup because the OEM corpus is small
    (48 rows at Phase 1). When OEM coverage grows beyond ~500 rows,
    move this to a background task queue (ARQ or Celery).
    """
    try:
        from app.services.embedding_service import embedding_service
        db = SessionLocal()
        try:
            n = embedding_service.embed_oem_batch(db)
            if n > 0:
                log.info("[startup] OEM batch embedding complete: %d rows embedded", n)
            else:
                log.info("[startup] OEM batch embedding: all rows already embedded")
        finally:
            db.close()
    except Exception as e:
        # Non-fatal — ARIA chat will degrade gracefully if embeddings are missing
        log.error("[startup] OEM batch embedding failed: %s", e)


@app.get("/")
async def root():
    return {
        "message": "MaintenanceGuard API",
        "version": "0.1.0",
        "docs": "/docs"
    }


@app.get("/health")
async def health_check():
    return {"status": "healthy"}
