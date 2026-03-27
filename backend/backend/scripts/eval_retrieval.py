#!/usr/bin/env python3
"""
scripts/eval_retrieval.py
==========================
Retrieval quality evaluation — measures precision@5 and recall@5 of the
ARIA pgvector retrieval pipeline against a golden dataset auto-generated
from past chat_interactions.

Metrics computed:
  - precision@5  : fraction of retrieved chunks that are in the golden set
  - recall@5     : fraction of golden chunks that appear in top-5 results
  - mrr          : mean reciprocal rank of first relevant result

Golden dataset generation:
  Interactions are sampled from chat_interactions. The `retrieved_chunk_ids`
  field stored at query time is used as the ground truth (golden) set.
  Rationale: these are the chunks the system already judged relevant when it
  generated a successful (non-escalated) response. This gives us a realistic
  ground-truth without manual labelling.

  Each golden entry is:  { query, vehicle_id, expected_chunk_ids }

How it works:
  1. Sample recent non-escalated chat_interactions as the golden set
  2. For each entry, run the current retrieval pipeline fresh
  3. Compare retrieved_chunk_ids (new) vs expected_chunk_ids (golden)
  4. Compute precision@5, recall@5, MRR
  5. Write to evaluation_log with run_type='retrieval_golden'

Usage:
  # Run inside backend container:
  python scripts/eval_retrieval.py

  # Dry run:
  python scripts/eval_retrieval.py --dry-run

  # Custom sample size and days window:
  python scripts/eval_retrieval.py --sample-size 50 --days 30

  # Save the generated golden dataset to a JSON file for inspection:
  python scripts/eval_retrieval.py --export-golden golden_dataset.json

Cron (weekly, Sunday 3 AM):
  0 3 * * 0 cd /app && python scripts/eval_retrieval.py --sample-size 100 >> /var/log/eval_retrieval.log 2>&1

Environment variables required:
  DATABASE_URL       — PostgreSQL connection string
  ANTHROPIC_API_KEY  — Not required for retrieval eval (no LLM calls)
"""

import argparse
import json
import logging
import os
import sys
from datetime import datetime, timedelta
from typing import Optional

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger(__name__)

DATABASE_URL    = os.getenv("DATABASE_URL")
EMBEDDING_MODEL = "sentence-transformers/all-MiniLM-L6-v2"
GOLDEN_VERSION  = "v1"
RUN_TYPE        = "retrieval_golden"
TOP_K           = 5


# ── DB helpers ────────────────────────────────────────────────────────────────

def get_conn():
    import psycopg2
    return psycopg2.connect(DATABASE_URL)


def ensure_evaluation_log(conn):
    """Create evaluation_log if migration 011 hasn't run."""
    with conn.cursor() as cur:
        cur.execute("""
            CREATE TABLE IF NOT EXISTS evaluation_log (
                id                     SERIAL PRIMARY KEY,
                run_type               VARCHAR(30)  NOT NULL,
                embedding_model        VARCHAR(100) NOT NULL DEFAULT 'all-MiniLM-L6-v2',
                query                  TEXT         NULL,
                retrieved_chunk_ids    JSONB        NULL,
                expected_chunk_ids     JSONB        NULL,
                precision_at_5         NUMERIC(5,4) NULL,
                recall_at_5            NUMERIC(5,4) NULL,
                mrr                    NUMERIC(5,4) NULL,
                response_text          TEXT         NULL,
                faithfulness           NUMERIC(5,4) NULL,
                answer_relevance       NUMERIC(5,4) NULL,
                context_precision      NUMERIC(5,4) NULL,
                context_recall         NUMERIC(5,4) NULL,
                batch_avg_precision    NUMERIC(5,4) NULL,
                batch_avg_recall       NUMERIC(5,4) NULL,
                batch_avg_faithfulness NUMERIC(5,4) NULL,
                batch_avg_relevance    NUMERIC(5,4) NULL,
                batch_size             INTEGER      NULL,
                golden_dataset_version VARCHAR(20)  NULL,
                notes                  TEXT         NULL,
                created_at             TIMESTAMPTZ  NOT NULL DEFAULT NOW()
            )
        """)
        conn.commit()
        log.info("evaluation_log table ensured")


def build_golden_dataset(conn, sample_size: int, days: Optional[int]) -> list:
    """
    Auto-generate golden dataset from past chat_interactions.

    Filters:
      - Non-escalated interactions only (escalation_triggered = FALSE)
      - Non-empty responses (response length > 50)
      - Must have retrieved_chunk_ids (at least 1 chunk)
      - Must have a vehicle_id (needed to re-run retrieval)

    Returns list of dicts: { query, vehicle_id, expected_chunk_ids, interaction_id }
    """
    with conn.cursor() as cur:
        where_clauses = [
            "escalation_triggered = FALSE",
            "response IS NOT NULL",
            "LENGTH(response) > 50",
            "query IS NOT NULL",
            "LENGTH(query) > 5",
            "retrieved_chunk_ids IS NOT NULL",
            "jsonb_array_length(retrieved_chunk_ids) > 0",
            "vehicle_id IS NOT NULL",
        ]
        params = []

        if days:
            where_clauses.append("created_at >= %s")
            params.append(datetime.utcnow() - timedelta(days=days))

        where_sql = " AND ".join(where_clauses)
        params.append(sample_size)

        cur.execute(f"""
            SELECT id, query, vehicle_id, retrieved_chunk_ids
            FROM chat_interactions
            WHERE {where_sql}
            ORDER BY created_at DESC
            LIMIT %s
        """, params)

        rows = cur.fetchall()

    golden = []
    for row in rows:
        interaction_id, query, vehicle_id, chunk_ids = row
        # chunk_ids may be a list already (psycopg2 parses JSONB) or a string
        if isinstance(chunk_ids, str):
            chunk_ids = json.loads(chunk_ids)
        if not chunk_ids:
            continue
        golden.append({
            "interaction_id":    interaction_id,
            "query":             query,
            "vehicle_id":        vehicle_id,
            "expected_chunk_ids": chunk_ids,  # list of {"table": ..., "id": ...}
        })

    return golden


def get_vehicle(conn, vehicle_id: int) -> Optional[dict]:
    """Fetch vehicle make/model/driving_condition for retrieval."""
    with conn.cursor() as cur:
        cur.execute("""
            SELECT id, year, make, model, trim, driving_condition
            FROM vehicles WHERE id = %s
        """, (vehicle_id,))
        row = cur.fetchone()
        if not row:
            return None
        return {
            "id": row[0], "year": row[1], "make": row[2],
            "model": row[3], "trim": row[4],
            "driving_condition": row[5] or "normal",
        }


def run_retrieval(conn, model, query: str, vehicle: dict) -> list:
    """
    Run the current embedding + pgvector retrieval pipeline.
    Returns list of {"table": ..., "id": ...} dicts — same format as stored chunk_ids.
    """
    q_vec = model.encode(query, convert_to_numpy=True).tolist()
    q_vec_str = "[" + ",".join(str(v) for v in q_vec) + "]"

    results = []

    with conn.cursor() as cur:
        # OEM schedules — filtered by make/model/driving_condition
        cur.execute("""
            SELECT id
            FROM oem_schedules
            WHERE content_embedding IS NOT NULL
              AND make  = %s
              AND model = %s
              AND driving_condition = %s
            ORDER BY content_embedding <=> %s::vector
            LIMIT %s
        """, (
            vehicle["make"], vehicle["model"],
            vehicle["driving_condition"],
            q_vec_str, TOP_K,
        ))
        for row in cur.fetchall():
            results.append({"table": "oem_schedules", "id": row[0]})

        # Service records — filtered by vehicle_id
        cur.execute("""
            SELECT id
            FROM service_records
            WHERE description_embedding IS NOT NULL
              AND vehicle_id = %s
              AND excluded_from_timeline = FALSE
            ORDER BY description_embedding <=> %s::vector
            LIMIT %s
        """, (vehicle["id"], q_vec_str, TOP_K))
        for row in cur.fetchall():
            results.append({"table": "service_records", "id": row[0]})

    return results


def compute_metrics(retrieved: list, expected: list) -> dict:
    """
    Compute precision@5, recall@5, and MRR.

    retrieved: list of {"table": ..., "id": ...} — top-K results from retrieval
    expected:  list of {"table": ..., "id": ...} — golden ground truth
    """
    top_k = retrieved[:TOP_K]

    # Normalise to frozenset of (table, id) tuples for set operations
    ret_set  = {(c["table"], c["id"]) for c in top_k}
    exp_set  = {(c["table"], c["id"]) for c in expected}

    if not exp_set:
        return {"precision_at_5": None, "recall_at_5": None, "mrr": None}

    hits = ret_set & exp_set

    precision = len(hits) / len(top_k) if top_k else 0.0
    recall    = len(hits) / len(exp_set)

    # MRR — position of first relevant result
    mrr = 0.0
    for rank, chunk in enumerate(top_k, start=1):
        if (chunk["table"], chunk["id"]) in exp_set:
            mrr = 1.0 / rank
            break

    return {
        "precision_at_5": round(precision, 4),
        "recall_at_5":    round(recall,    4),
        "mrr":            round(mrr,       4),
    }


def write_result(conn, entry: dict, retrieved: list, metrics: dict):
    """Write one evaluation_log row for a single golden query."""
    with conn.cursor() as cur:
        cur.execute("""
            INSERT INTO evaluation_log (
                run_type, embedding_model, query,
                retrieved_chunk_ids, expected_chunk_ids,
                precision_at_5, recall_at_5, mrr,
                golden_dataset_version, notes
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        """, (
            RUN_TYPE,
            EMBEDDING_MODEL,
            entry["query"][:1000],
            json.dumps(retrieved),
            json.dumps(entry["expected_chunk_ids"]),
            metrics["precision_at_5"],
            metrics["recall_at_5"],
            metrics["mrr"],
            GOLDEN_VERSION,
            f"interaction_id={entry['interaction_id']} vehicle_id={entry['vehicle_id']}",
        ))
    conn.commit()


def write_batch_summary(conn, all_metrics: list, batch_size: int):
    """Write a summary row with averages across all golden queries."""
    def avg(key):
        vals = [m[key] for m in all_metrics if m.get(key) is not None]
        return round(sum(vals) / len(vals), 4) if vals else None

    p = avg("precision_at_5")
    r = avg("recall_at_5")

    with conn.cursor() as cur:
        cur.execute("""
            INSERT INTO evaluation_log (
                run_type, embedding_model,
                batch_avg_precision, batch_avg_recall,
                batch_size, golden_dataset_version, notes
            ) VALUES (%s, %s, %s, %s, %s, %s, %s)
        """, (
            RUN_TYPE, EMBEDDING_MODEL, p, r, batch_size,
            GOLDEN_VERSION,
            f"batch_summary: {batch_size} golden queries evaluated",
        ))
    conn.commit()
    log.info(
        "Batch summary: precision@5=%.3f  recall@5=%.3f  (n=%d)",
        p or 0, r or 0, batch_size
    )


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="ARIA retrieval evaluation script")
    parser.add_argument("--dry-run",      action="store_true", help="No DB writes — show golden dataset only")
    parser.add_argument("--sample-size",  type=int, default=50, help="Golden dataset size (default: 50)")
    parser.add_argument("--days",         type=int, default=None, help="Only use interactions from last N days")
    parser.add_argument("--export-golden", type=str, default=None, help="Export golden dataset to JSON file")
    args = parser.parse_args()

    if not DATABASE_URL:
        log.error("DATABASE_URL environment variable not set")
        sys.exit(1)

    log.info("=== ARIA Retrieval Evaluation ===")
    log.info("Mode:        %s", "DRY RUN" if args.dry_run else "LIVE")
    log.info("Sample size: %d", args.sample_size)
    log.info("Days filter: %s", args.days or "none (all time)")

    conn = get_conn()
    if not args.dry_run:
        ensure_evaluation_log(conn)

    # Build golden dataset from past interactions
    golden = build_golden_dataset(conn, args.sample_size, args.days)
    log.info("Golden dataset: %d entries generated from chat_interactions", len(golden))

    if not golden:
        log.warning("No eligible chat_interactions found — run ARIA first to build history")
        conn.close()
        sys.exit(0)

    if args.export_golden:
        with open(args.export_golden, "w") as f:
            json.dump(golden, f, indent=2, default=str)
        log.info("Golden dataset exported to: %s", args.export_golden)

    if args.dry_run:
        log.info("--- DRY RUN: golden dataset preview ---")
        for entry in golden[:5]:
            log.info(
                "  interaction_id=%-6d  vehicle_id=%-4d  chunks=%d  query=%r",
                entry["interaction_id"], entry["vehicle_id"],
                len(entry["expected_chunk_ids"]), entry["query"][:70]
            )
        if len(golden) > 5:
            log.info("  ... and %d more", len(golden) - 5)
        conn.close()
        sys.exit(0)

    # Load embedding model
    log.info("Loading embedding model: %s", EMBEDDING_MODEL)
    from sentence_transformers import SentenceTransformer
    model = SentenceTransformer(EMBEDDING_MODEL)
    log.info("Model loaded ✅")

    all_metrics = []
    success = 0
    failed  = 0

    for i, entry in enumerate(golden, 1):
        log.info(
            "[%d/%d] vehicle_id=%-4d  query=%r",
            i, len(golden), entry["vehicle_id"], entry["query"][:70]
        )

        vehicle = get_vehicle(conn, entry["vehicle_id"])
        if not vehicle:
            log.warning("  Vehicle %d not found — skipping", entry["vehicle_id"])
            failed += 1
            continue

        try:
            retrieved = run_retrieval(conn, model, entry["query"], vehicle)
            metrics   = compute_metrics(retrieved, entry["expected_chunk_ids"])

            log.info(
                "  precision@5=%.2f  recall@5=%.2f  mrr=%.2f  retrieved=%d  expected=%d",
                metrics["precision_at_5"] or 0,
                metrics["recall_at_5"]    or 0,
                metrics["mrr"]            or 0,
                len(retrieved),
                len(entry["expected_chunk_ids"]),
            )

            write_result(conn, entry, retrieved, metrics)
            all_metrics.append(metrics)
            success += 1

        except Exception as e:
            log.error("  Error evaluating interaction %d: %s", entry["interaction_id"], e)
            failed += 1

    if all_metrics:
        write_batch_summary(conn, all_metrics, batch_size=success)

    conn.close()

    log.info("=== Complete ===")
    log.info("  Evaluated: %d", success)
    log.info("  Failed:    %d", failed)

    sys.exit(0 if failed == 0 else 1)


if __name__ == "__main__":
    main()
