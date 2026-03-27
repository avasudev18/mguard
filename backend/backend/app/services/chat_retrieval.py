"""
app/services/chat_retrieval.py
================================
Phase 1 — Semantic retrieval pipeline for ARIA chat.

Retrieves top-k relevant chunks from pgvector for a user query,
then fetches the exact SQL interval values via direct SQL.

CRITICAL ARCHITECTURE RULE (enforced here):
    interval_miles and interval_months are ALWAYS fetched via direct SQL
    on oem_schedules (Step 4). They are NEVER taken from vector similarity
    results. The upsell detection engine has a strict dependency on exact
    integers — approximate vector results must never feed calculations.

Public API:
    await chat_retrieval.retrieve(
        query: str,
        vehicle_id: int,
        vehicle: Vehicle,
        db: Session,
        top_k: int = 5,
    ) -> RetrievalResult
"""

import logging
import time
from dataclasses import dataclass, field
from typing import Optional

from sqlalchemy.orm import Session
from sqlalchemy import text

from app.services.embedding_service import embedding_service

log = logging.getLogger(__name__)

# Minimum cosine similarity score before a chunk is considered relevant.
# Below this threshold the chunk is excluded and escalation is triggered.
SIMILARITY_THRESHOLD = 0.25   # cosine distance ≤ 0.75 → similarity ≥ 0.25

# How many chunks to retrieve per source table
TOP_K_OEM      = 5
TOP_K_SERVICE  = 5


@dataclass
class OEMChunk:
    id: int
    year: int
    make: str
    model: str
    service_type: str
    interval_miles: Optional[int]    # fetched via SQL — authoritative
    interval_months: Optional[int]   # fetched via SQL — authoritative
    driving_condition: str
    citation: Optional[str]
    notes: Optional[str]
    similarity: float                # cosine similarity score (0–1)


@dataclass
class ServiceChunk:
    id: int
    service_type: str
    service_description: Optional[str]
    service_date: Optional[str]
    mileage_at_service: Optional[int]
    shop_name: Optional[str]
    similarity: float


@dataclass
class RetrievalResult:
    query: str
    oem_chunks: list = field(default_factory=list)
    service_chunks: list = field(default_factory=list)
    # Always-included recent service history — fetched by date, no similarity filter.
    # Guarantees ARIA always sees the latest services regardless of query wording.
    recent_history_chunks: list = field(default_factory=list)
    # Chunk IDs for audit log (chat_interactions.retrieved_chunk_ids)
    chunk_ids: list = field(default_factory=list)
    retrieval_latency_ms: int = 0
    below_threshold: bool = False    # True → trigger escalation


class ChatRetrieval:

    def retrieve(
        self,
        query: str,
        vehicle_id: int,
        vehicle,           # Vehicle ORM object
        db: Session,
        top_k: int = TOP_K_OEM,
    ) -> RetrievalResult:
        """
        Retrieve semantically relevant chunks for a user query.

        Steps:
          1. Embed the query with the same model used for corpus embeddings.
          2. pgvector cosine search on oem_schedules (filtered by make+model).
          3. pgvector cosine search on service_records (filtered by vehicle_id).
          4. Fetch exact interval_miles / interval_months via direct SQL.
             (NEVER from the vector result — architecture rule.)
          5. Return RetrievalResult with all chunks and audit metadata.
        """
        t_start = time.time()
        result = RetrievalResult(query=query)

        # ── Step 1: Embed query ───────────────────────────────────────────────
        q_vec = embedding_service.embed(query)
        if q_vec is None:
            log.error("[ChatRetrieval] Query embedding failed — model unavailable")
            result.below_threshold = True
            return result

        # pgvector expects the vector as a Python list of floats
        q_vec_str = "[" + ",".join(str(v) for v in q_vec) + "]"

        # ── Step 2: OEM schedule retrieval (filtered by make + model) ─────────
        # The WHERE clause on make/model is critical — without it the cosine
        # search can return OEM rows for a different vehicle.
        oem_rows = db.execute(text("""
            SELECT
                id,
                year, make, model,
                service_type,
                interval_miles,
                interval_months,
                driving_condition,
                citation,
                notes,
                1 - (content_embedding <=> CAST(:q AS vector)) AS similarity
            FROM oem_schedules
            WHERE
                content_embedding IS NOT NULL
                AND make  = :make
                AND model = :model
                AND driving_condition = :dc
            ORDER BY content_embedding <=> CAST(:q AS vector)
            LIMIT :k
        """), {
            "q":    q_vec_str,
            "make": vehicle.make,
            "model": vehicle.model,
            "dc":   vehicle.driving_condition or "normal",
            "k":    top_k,
        }).fetchall()

        for row in oem_rows:
            if row.similarity < SIMILARITY_THRESHOLD:
                continue
            result.oem_chunks.append(OEMChunk(
                id=row.id,
                year=row.year,
                make=row.make,
                model=row.model,
                service_type=row.service_type,
                interval_miles=row.interval_miles,       # from SQL — authoritative
                interval_months=row.interval_months,     # from SQL — authoritative
                driving_condition=row.driving_condition,
                citation=row.citation,
                notes=row.notes,
                similarity=round(float(row.similarity), 4),
            ))
            result.chunk_ids.append({"table": "oem_schedules", "id": row.id})

        # ── Step 3: Service history retrieval (filtered by vehicle_id) ─────────
        svc_rows = db.execute(text("""
            SELECT
                id,
                service_type,
                service_description,
                service_date,
                mileage_at_service,
                shop_name,
                1 - (description_embedding <=> CAST(:q AS vector)) AS similarity
            FROM service_records
            WHERE
                description_embedding IS NOT NULL
                AND vehicle_id = :vid
                AND excluded_from_timeline = FALSE
                AND service_date IS NOT NULL
            ORDER BY service_date DESC, description_embedding <=> CAST(:q AS vector)
            LIMIT :k
        """), {
            "q":   q_vec_str,
            "vid": vehicle_id,
            "k":   top_k,
        }).fetchall()

        for row in svc_rows:
            if row.similarity < SIMILARITY_THRESHOLD:
                continue
            result.service_chunks.append(ServiceChunk(
                id=row.id,
                service_type=row.service_type,
                service_description=row.service_description,
                service_date=row.service_date.isoformat() if row.service_date else None,
                mileage_at_service=row.mileage_at_service,
                shop_name=row.shop_name,
                similarity=round(float(row.similarity), 4),
            ))
            result.chunk_ids.append({"table": "service_records", "id": row.id})

        # ── Step 3b: Recent service history (unconditional — no similarity filter) ──
        # The semantic search in Step 3 can miss recent services if the query
        # wording does not score above SIMILARITY_THRESHOLD against that record's
        # embedding. This causes ARIA to cite stale history (e.g. reporting the
        # last oil change as 65,373 miles when it was actually done at 70,746).
        #
        # Fix: always fetch the N most recent service records by date, regardless
        # of embedding or similarity. These are deduplicated against service_chunks
        # so nothing is double-counted in the context.
        RECENT_HISTORY_LIMIT = 10
        recent_rows = db.execute(text("""
            SELECT
                id,
                service_type,
                service_description,
                service_date,
                mileage_at_service,
                shop_name
            FROM service_records
            WHERE
                vehicle_id = :vid
                AND excluded_from_timeline = FALSE
                AND service_date IS NOT NULL
            ORDER BY service_date DESC, mileage_at_service DESC NULLS LAST
            LIMIT :k
        """), {
            "vid": vehicle_id,
            "k":   RECENT_HISTORY_LIMIT,
        }).fetchall()

        existing_svc_ids = {c.id for c in result.service_chunks}
        for row in recent_rows:
            if row.id in existing_svc_ids:
                continue  # already included via semantic search — skip
            result.recent_history_chunks.append(ServiceChunk(
                id=row.id,
                service_type=row.service_type,
                service_description=row.service_description,
                service_date=row.service_date.isoformat() if row.service_date else None,
                mileage_at_service=row.mileage_at_service,
                shop_name=row.shop_name,
                similarity=0.0,  # not similarity-ranked — date-ranked
            ))
            result.chunk_ids.append({"table": "service_records", "id": row.id})

        # ── Step 4: Fetch exact SQL interval values ────────────────────────────
        # ARCHITECTURE RULE: interval_miles and interval_months in oem_chunks
        # were already fetched via SQL in Step 2 — they are NOT derived from
        # the cosine similarity score. This step is a redundancy check:
        # if any oem_chunk has NULL intervals (should not happen), re-fetch.
        for chunk in result.oem_chunks:
            if chunk.interval_miles is None and chunk.interval_months is None:
                row = db.execute(text(
                    "SELECT interval_miles, interval_months FROM oem_schedules WHERE id = :id"
                ), {"id": chunk.id}).fetchone()
                if row:
                    chunk.interval_miles  = row.interval_miles
                    chunk.interval_months = row.interval_months

        # ── Escalation check ───────────────────────────────────────────────────
        if not result.oem_chunks and not result.service_chunks:
            result.below_threshold = True
            log.info(
                "[ChatRetrieval] No chunks above threshold for query=%r vehicle_id=%s",
                query[:80], vehicle_id
            )

        result.retrieval_latency_ms = int((time.time() - t_start) * 1000)
        return result


# Singleton
chat_retrieval = ChatRetrieval()
