#!/usr/bin/env python3
"""
backfill_service_embeddings.py
================================
Backfill description_embedding for service_records rows that have
a NULL embedding. Targets a specific invoice_id by default, or
runs across ALL NULL-embedding service records if --all is passed.

Usage (inside the backend container):
    # Backfill only invoice 189 (the manually inserted oil change):
    python scripts/backfill_service_embeddings.py --invoice-id 189

    # Backfill ALL service records with NULL embeddings:
    python scripts/backfill_service_embeddings.py --all

Model: sentence-transformers/all-MiniLM-L6-v2 (384 dims)
Must match the model used by embedding_service.py.
"""

import os
import sys
import argparse
import logging
from datetime import datetime

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s"
)
log = logging.getLogger(__name__)

DATABASE_URL = os.getenv("DATABASE_URL")
MODEL_NAME   = "sentence-transformers/all-MiniLM-L6-v2"


def build_service_chunk(service_type: str, service_description: str, shop_name: str) -> str:
    """
    Mirrors EmbeddingService.build_service_chunk() exactly.
    Format: "<service_type>. <service_description>. at <shop_name>"
    """
    parts = [service_type]
    if service_description:
        parts.append(service_description)
    if shop_name:
        parts.append(f"at {shop_name}")
    return ". ".join(p.strip() for p in parts if p and p.strip())


def run(invoice_id=None, backfill_all=False):
    if not DATABASE_URL:
        log.error("DATABASE_URL environment variable not set")
        sys.exit(1)

    # ── Load model ────────────────────────────────────────────────────────────
    log.info("Loading embedding model: %s", MODEL_NAME)
    try:
        from sentence_transformers import SentenceTransformer
        model = SentenceTransformer(MODEL_NAME)
        log.info("Model loaded ✅")
    except Exception as e:
        log.error("Failed to load model: %s", e)
        sys.exit(1)

    # ── Connect to DB ─────────────────────────────────────────────────────────
    log.info("Connecting to database…")
    try:
        import psycopg2
        conn = psycopg2.connect(DATABASE_URL)
        cursor = conn.cursor()
        log.info("Connected ✅")
    except Exception as e:
        log.error("Failed to connect: %s", e)
        sys.exit(1)

    # ── Fetch target rows ─────────────────────────────────────────────────────
    if backfill_all:
        log.info("Mode: ALL service records with NULL description_embedding")
        cursor.execute("""
            SELECT id, service_type, service_description, shop_name
            FROM service_records
            WHERE description_embedding IS NULL
            ORDER BY id
        """)
    elif invoice_id is not None:
        log.info("Mode: invoice_id = %s only", invoice_id)
        cursor.execute("""
            SELECT id, service_type, service_description, shop_name
            FROM service_records
            WHERE invoice_id = %s
              AND description_embedding IS NULL
            ORDER BY id
        """, (invoice_id,))
    else:
        log.error("Provide --invoice-id <id> or --all")
        sys.exit(1)

    rows = cursor.fetchall()
    if not rows:
        log.info("No rows with NULL embeddings found — nothing to do ✅")
        conn.close()
        return

    log.info("Found %d row(s) to embed", len(rows))

    # ── Generate and store embeddings ─────────────────────────────────────────
    success = 0
    failed  = 0

    for row_id, service_type, service_description, shop_name in rows:
        chunk = build_service_chunk(
            service_type or "",
            service_description or "",
            shop_name or "",
        )
        log.info("  [%d] chunk: %r", row_id, chunk[:80])

        try:
            vec = model.encode(chunk, convert_to_numpy=True).tolist()
            vec_str = "[" + ",".join(str(v) for v in vec) + "]"

            cursor.execute("""
                UPDATE service_records
                SET description_embedding = %s::vector
                WHERE id = %s
            """, (vec_str, row_id))

            success += 1
            log.info("  [%d] ✅ embedded (%d dims)", row_id, len(vec))

        except Exception as e:
            failed += 1
            log.error("  [%d] ❌ failed: %s", row_id, e)

    conn.commit()
    cursor.close()
    conn.close()

    # ── Summary ───────────────────────────────────────────────────────────────
    log.info("")
    log.info("=" * 50)
    log.info("BACKFILL COMPLETE")
    log.info("  Embedded : %d", success)
    log.info("  Failed   : %d", failed)
    log.info("=" * 50)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Backfill service_record embeddings")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--invoice-id", type=int, help="Backfill only records for this invoice_id")
    group.add_argument("--all", action="store_true", help="Backfill ALL NULL-embedding service records")
    args = parser.parse_args()

    run(invoice_id=args.invoice_id, backfill_all=args.all)
