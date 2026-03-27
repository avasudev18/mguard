#!/usr/bin/env python3
"""
scripts/eval_diagnostics.py
============================
Diagnostic script — run this first to understand why eval scripts
produce no output. Shows counts and sample rows from chat_interactions
and evaluation_log.

Usage:
  docker exec -it maintenanceguard-backend python scripts/eval_diagnostics.py
"""

import json
import os
import sys

DATABASE_URL = os.getenv("DATABASE_URL")

if not DATABASE_URL:
    print("❌ DATABASE_URL not set")
    sys.exit(1)

import psycopg2
conn = psycopg2.connect(DATABASE_URL)
cur = conn.cursor()

print("=" * 60)
print("EVAL DIAGNOSTICS")
print("=" * 60)

# 1. Total chat_interactions
cur.execute("SELECT COUNT(*) FROM chat_interactions")
total = cur.fetchone()[0]
print(f"\nchat_interactions total rows: {total}")

if total == 0:
    print("  ⚠️  Table is empty — use ARIA chat first to generate interactions")
    sys.exit(0)

# 2. Breakdown by escalation
cur.execute("""
    SELECT escalation_triggered, COUNT(*)
    FROM chat_interactions
    GROUP BY escalation_triggered
""")
for row in cur.fetchall():
    print(f"  escalation_triggered={row[0]}: {row[1]} rows")

# 3. Non-escalated with non-empty response
cur.execute("""
    SELECT COUNT(*) FROM chat_interactions
    WHERE escalation_triggered = FALSE
    AND response IS NOT NULL
    AND LENGTH(response) > 50
    AND query IS NOT NULL
    AND LENGTH(query) > 5
""")
eligible_ragas = cur.fetchone()[0]
print(f"\nEligible for eval_ragas.py: {eligible_ragas}")

# 4. Eligible for retrieval eval (also need vehicle_id and chunk_ids)
cur.execute("""
    SELECT COUNT(*) FROM chat_interactions
    WHERE escalation_triggered = FALSE
    AND response IS NOT NULL
    AND LENGTH(response) > 50
    AND query IS NOT NULL
    AND LENGTH(query) > 5
    AND retrieved_chunk_ids IS NOT NULL
    AND jsonb_array_length(retrieved_chunk_ids) > 0
    AND vehicle_id IS NOT NULL
""")
eligible_retrieval = cur.fetchone()[0]
print(f"Eligible for eval_retrieval.py: {eligible_retrieval}")

# 5. Sample of what's in there
cur.execute("""
    SELECT id, vehicle_id, escalation_triggered,
           LENGTH(response) as resp_len,
           jsonb_array_length(COALESCE(retrieved_chunk_ids, '[]'::jsonb)) as chunk_count,
           LEFT(query, 80) as query_preview
    FROM chat_interactions
    ORDER BY created_at DESC
    LIMIT 5
""")
print("\nMost recent 5 interactions:")
for row in cur.fetchall():
    print(f"  id={row[0]} vehicle_id={row[1]} escalated={row[2]} "
          f"resp_len={row[3]} chunks={row[4]}")
    print(f"    query: {row[5]!r}")

# 6. evaluation_log state
try:
    cur.execute("SELECT COUNT(*) FROM evaluation_log")
    eval_count = cur.fetchone()[0]
    print(f"\nevaluation_log rows: {eval_count}")
    if eval_count > 0:
        cur.execute("""
            SELECT run_type, COUNT(*), MAX(created_at)
            FROM evaluation_log
            GROUP BY run_type
        """)
        for row in cur.fetchall():
            print(f"  run_type={row[0]}: {row[1]} rows, last={row[2]}")
except Exception as e:
    print(f"\nevaluation_log: does not exist or error: {e}")

# 7. NULL chunk_ids breakdown
cur.execute("""
    SELECT
      COUNT(*) FILTER (WHERE retrieved_chunk_ids IS NULL) as null_chunks,
      COUNT(*) FILTER (WHERE retrieved_chunk_ids IS NOT NULL
        AND jsonb_array_length(retrieved_chunk_ids) = 0) as empty_chunks,
      COUNT(*) FILTER (WHERE retrieved_chunk_ids IS NOT NULL
        AND jsonb_array_length(retrieved_chunk_ids) > 0) as has_chunks
    FROM chat_interactions
    WHERE escalation_triggered = FALSE
""")
row = cur.fetchone()
print(f"\nNon-escalated interactions chunk breakdown:")
print(f"  NULL retrieved_chunk_ids:  {row[0]}")
print(f"  Empty array []:            {row[1]}")
print(f"  Has chunks (>0):           {row[2]}")

conn.close()
print("\n" + "=" * 60)
