#!/usr/bin/env python3
"""
scripts/eval_ragas.py
======================
RAGAs-style evaluation of ARIA chat response quality.

Metrics computed (per interaction, averaged per run):
  - faithfulness      : does the response stay grounded in retrieved context?
  - answer_relevance  : does the response actually address the user's question?
  - context_precision : fraction of retrieved chunks that were actually needed
  - context_recall    : fraction of needed information present in the context

How it works:
  1. Sample recent chat_interactions from the DB (non-escalated, non-empty responses)
  2. For each sampled interaction, reconstruct the context that ARIA had access to
  3. Send (query, context, response) to Claude as an LLM judge
  4. Parse the structured scores from Claude's response
  5. Write one evaluation_log row per interaction, plus a summary batch row

Usage:
  # Run inside the backend container:
  python scripts/eval_ragas.py

  # Dry run (no DB writes, shows what would be evaluated):
  python scripts/eval_ragas.py --dry-run

  # Evaluate the last N interactions:
  python scripts/eval_ragas.py --sample-size 20

  # Evaluate interactions from the last N days only:
  python scripts/eval_ragas.py --days 7

Cron (nightly at 2 AM):
  0 2 * * * cd /app && python scripts/eval_ragas.py --sample-size 50 >> /var/log/eval_ragas.log 2>&1

Environment variables required:
  DATABASE_URL        — PostgreSQL connection string
  ANTHROPIC_API_KEY   — Anthropic API key (same as the main app)
"""

import argparse
import json
import logging
import os
import sys
import time
from datetime import datetime, timedelta
from typing import Optional

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger(__name__)

DATABASE_URL     = os.getenv("DATABASE_URL")
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY")

JUDGE_MODEL      = "claude-3-haiku-20240307"   # fast + cheap for evaluation
EMBEDDING_MODEL  = "sentence-transformers/all-MiniLM-L6-v2"
GOLDEN_VERSION   = "v1"
RUN_TYPE         = "ragas_nightly"

# ── Judge prompt ──────────────────────────────────────────────────────────────
JUDGE_SYSTEM = """You are an expert evaluator of AI assistant responses for a vehicle maintenance application.

You will be given:
1. A user question about vehicle maintenance
2. The context that was retrieved and provided to the AI assistant
3. The AI assistant's response

Score the response on the following metrics, each on a scale of 0.0 to 1.0:

FAITHFULNESS (0.0-1.0):
  Does the response ONLY use information from the provided context?
  1.0 = Every claim is directly supported by the context
  0.5 = Some claims are supported, some appear to be from general knowledge
  0.0 = Response contradicts context or fabricates information not in context

ANSWER_RELEVANCE (0.0-1.0):
  Does the response directly address the user's question?
  1.0 = Fully answers the specific question asked
  0.5 = Partially answers or answers a related but different question
  0.0 = Does not address the question at all

CONTEXT_PRECISION (0.0-1.0):
  Of the context provided, how much of it was actually needed to answer the question?
  1.0 = All context was relevant and necessary
  0.5 = About half the context was relevant
  0.0 = None of the context was relevant to answering this question

CONTEXT_RECALL (0.0-1.0):
  Did the provided context contain enough information to answer the question completely?
  1.0 = Context had everything needed for a complete answer
  0.5 = Context had some but not all information needed
  0.0 = Context was missing critical information needed to answer the question

Return ONLY a JSON object with these exact keys (no markdown, no explanation):
{"faithfulness": 0.0, "answer_relevance": 0.0, "context_precision": 0.0, "context_recall": 0.0}"""


def judge_prompt(query: str, context: str, response: str) -> str:
    return f"""USER QUESTION:
{query}

RETRIEVED CONTEXT PROVIDED TO AI:
{context}

AI ASSISTANT RESPONSE:
{response}

Evaluate and return the JSON scores."""


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


def sample_interactions(conn, sample_size: int, days: Optional[int]) -> list:
    """
    Sample recent non-escalated chat interactions with non-empty responses.
    Returns list of dicts with: id, query, response, retrieved_chunk_ids, vehicle_id
    """
    with conn.cursor() as cur:
        where_clauses = [
            "escalation_triggered = FALSE",
            "response IS NOT NULL",
            "LENGTH(response) > 50",
            "query IS NOT NULL",
            "LENGTH(query) > 5",
        ]
        params = []

        if days:
            where_clauses.append("created_at >= %s")
            params.append(datetime.utcnow() - timedelta(days=days))

        where_sql = " AND ".join(where_clauses)
        params.append(sample_size)

        cur.execute(f"""
            SELECT id, query, response, retrieved_chunk_ids, vehicle_id
            FROM chat_interactions
            WHERE {where_sql}
            ORDER BY created_at DESC
            LIMIT %s
        """, params)

        rows = cur.fetchall()
        return [
            {
                "id":                  r[0],
                "query":               r[1],
                "response":            r[2],
                "retrieved_chunk_ids": r[3] or [],
                "vehicle_id":          r[4],
            }
            for r in rows
        ]


def reconstruct_context(conn, retrieved_chunk_ids: list) -> str:
    """
    Reconstruct the context string from chunk IDs stored in the interaction.
    Fetches text from oem_schedules and service_records matching the IDs.
    """
    if not retrieved_chunk_ids:
        return "(no context retrieved)"

    oem_ids      = [c["id"] for c in retrieved_chunk_ids if c.get("table") == "oem_schedules"]
    svc_ids      = [c["id"] for c in retrieved_chunk_ids if c.get("table") == "service_records"]
    context_parts = []

    with conn.cursor() as cur:
        if oem_ids:
            cur.execute("""
                SELECT year, make, model, service_type, interval_miles,
                       interval_months, driving_condition, notes, citation
                FROM oem_schedules
                WHERE id = ANY(%s)
            """, (oem_ids,))
            for row in cur.fetchall():
                year, make, model, stype, miles, months, dc, notes, cite = row
                line = f"OEM: {year} {make} {model} — {stype}"
                if miles:
                    line += f" every {miles:,} miles"
                if months:
                    line += f" or {months} months"
                if dc:
                    line += f" ({dc} driving)"
                if notes:
                    line += f". {notes[:200]}"
                if cite:
                    line += f" [{cite[:100]}]"
                context_parts.append(line)

        if svc_ids:
            cur.execute("""
                SELECT service_type, service_description, service_date,
                       mileage_at_service, shop_name
                FROM service_records
                WHERE id = ANY(%s)
            """, (svc_ids,))
            for row in cur.fetchall():
                stype, desc, sdate, mileage, shop = row
                line = f"Service: {stype}"
                if sdate:
                    line += f" on {sdate.date()}"
                if mileage:
                    line += f" at {mileage:,} miles"
                if shop:
                    line += f" ({shop})"
                if desc:
                    line += f". {desc[:150]}"
                context_parts.append(line)

    return "\n".join(context_parts) if context_parts else "(context chunks not found in DB)"


def call_judge(client, query: str, context: str, response: str) -> Optional[dict]:
    """Call Claude as LLM judge. Returns dict of scores or None on failure."""
    try:
        msg = client.messages.create(
            model=JUDGE_MODEL,
            max_tokens=200,
            temperature=0,
            system=JUDGE_SYSTEM,
            messages=[{
                "role": "user",
                "content": judge_prompt(
                    query[:800],
                    context[:2000],
                    response[:1500],
                )
            }]
        )
        raw = msg.content[0].text.strip()
        # Strip markdown fences if present
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
        scores = json.loads(raw)
        # Validate and clamp all scores to [0, 1]
        result = {}
        for key in ("faithfulness", "answer_relevance", "context_precision", "context_recall"):
            val = scores.get(key)
            if val is not None:
                result[key] = round(max(0.0, min(1.0, float(val))), 4)
            else:
                result[key] = None
        return result
    except Exception as e:
        log.warning("Judge call failed: %s", e)
        return None


def write_interaction_result(conn, interaction_id: int, scores: dict, query: str,
                              response: str, chunk_ids: list):
    """Write one evaluation_log row for a single interaction."""
    with conn.cursor() as cur:
        cur.execute("""
            INSERT INTO evaluation_log (
                run_type, embedding_model, query, retrieved_chunk_ids,
                response_text, faithfulness, answer_relevance,
                context_precision, context_recall,
                golden_dataset_version, notes
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        """, (
            RUN_TYPE,
            EMBEDDING_MODEL,
            query[:1000],
            json.dumps(chunk_ids),
            response[:4000],
            scores.get("faithfulness"),
            scores.get("answer_relevance"),
            scores.get("context_precision"),
            scores.get("context_recall"),
            GOLDEN_VERSION,
            f"interaction_id={interaction_id}",
        ))
    conn.commit()


def write_batch_summary(conn, results: list, batch_size: int):
    """Write a summary batch row with averages across all evaluated interactions."""
    def avg(key):
        vals = [r[key] for r in results if r.get(key) is not None]
        return round(sum(vals) / len(vals), 4) if vals else None

    with conn.cursor() as cur:
        cur.execute("""
            INSERT INTO evaluation_log (
                run_type, embedding_model,
                batch_avg_faithfulness, batch_avg_relevance,
                batch_size, golden_dataset_version, notes
            ) VALUES (%s, %s, %s, %s, %s, %s, %s)
        """, (
            RUN_TYPE,
            EMBEDDING_MODEL,
            avg("faithfulness"),
            avg("answer_relevance"),
            batch_size,
            GOLDEN_VERSION,
            f"batch_summary: {batch_size} interactions evaluated",
        ))
    conn.commit()
    log.info(
        "Batch summary: faithfulness=%.3f answer_relevance=%.3f (n=%d)",
        avg("faithfulness") or 0, avg("answer_relevance") or 0, batch_size
    )


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="ARIA RAGAs evaluation script")
    parser.add_argument("--dry-run",     action="store_true", help="Show what would run, no DB writes")
    parser.add_argument("--sample-size", type=int, default=30, help="Number of interactions to evaluate (default: 30)")
    parser.add_argument("--days",        type=int, default=None, help="Only evaluate interactions from last N days")
    args = parser.parse_args()

    if not DATABASE_URL:
        log.error("DATABASE_URL environment variable not set")
        sys.exit(1)
    if not ANTHROPIC_API_KEY:
        log.error("ANTHROPIC_API_KEY environment variable not set")
        sys.exit(1)

    from anthropic import Anthropic
    client = Anthropic(api_key=ANTHROPIC_API_KEY)

    log.info("=== ARIA RAGAs Evaluation ===")
    log.info("Mode:        %s", "DRY RUN" if args.dry_run else "LIVE")
    log.info("Sample size: %d", args.sample_size)
    log.info("Days filter: %s", args.days or "none (all time)")
    log.info("Judge model: %s", JUDGE_MODEL)

    conn = get_conn()
    if not args.dry_run:
        ensure_evaluation_log(conn)

    interactions = sample_interactions(conn, args.sample_size, args.days)
    log.info("Sampled %d interactions from chat_interactions", len(interactions))

    if not interactions:
        log.warning("No eligible interactions found — nothing to evaluate")
        log.warning("Ensure ARIA has been used at least once and interactions are in the DB")
        conn.close()
        sys.exit(0)

    if args.dry_run:
        log.info("--- DRY RUN: would evaluate these interactions ---")
        for ix in interactions:
            log.info("  id=%-6d  query=%r", ix["id"], ix["query"][:80])
        conn.close()
        sys.exit(0)

    results = []
    success = 0
    failed  = 0

    for i, ix in enumerate(interactions, 1):
        log.info("[%d/%d] Evaluating interaction id=%d ...", i, len(interactions), ix["id"])

        context = reconstruct_context(conn, ix["retrieved_chunk_ids"])
        scores  = call_judge(client, ix["query"], context, ix["response"])

        if scores is None:
            log.warning("  ❌ Judge failed for id=%d — skipping", ix["id"])
            failed += 1
            time.sleep(1)
            continue

        log.info(
            "  ✅ faithfulness=%.2f  relevance=%.2f  precision=%.2f  recall=%.2f",
            scores.get("faithfulness") or 0,
            scores.get("answer_relevance") or 0,
            scores.get("context_precision") or 0,
            scores.get("context_recall") or 0,
        )

        write_interaction_result(
            conn,
            interaction_id=ix["id"],
            scores=scores,
            query=ix["query"],
            response=ix["response"],
            chunk_ids=ix["retrieved_chunk_ids"],
        )
        results.append(scores)
        success += 1
        time.sleep(0.5)   # rate-limit courtesy pause between judge calls

    if results:
        write_batch_summary(conn, results, batch_size=success)

    conn.close()

    log.info("=== Complete ===")
    log.info("  Evaluated: %d", success)
    log.info("  Failed:    %d", failed)

    sys.exit(0 if failed == 0 else 1)


if __name__ == "__main__":
    main()
