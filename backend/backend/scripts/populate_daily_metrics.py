"""
scripts/populate_daily_metrics.py

Populates the daily_metrics table from live data.
Runs in two modes:

  python populate_daily_metrics.py           # backfill all days with token data
  python populate_daily_metrics.py --today   # today only (use for scheduled task)
  python populate_daily_metrics.py --days 7  # last N days

Safe to run multiple times — uses INSERT ... ON CONFLICT UPDATE (upsert).
Reads DATABASE_URL from environment (same as the app).

Usage inside Docker:
  docker exec maintenanceguard-backend python /app/scripts/populate_daily_metrics.py
  docker exec maintenanceguard-backend python /app/scripts/populate_daily_metrics.py --today

Windows Task Scheduler (daily at 00:05):
  Program: docker
  Arguments: exec maintenanceguard-backend python /app/scripts/populate_daily_metrics.py --today
"""

import os
import sys
import argparse
from datetime import date, datetime, timedelta
from decimal import Decimal

from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

# ── DB connection ─────────────────────────────────────────────────────────────
DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql://postgres:postgres@db:5432/maintenanceguard"
)
engine = create_engine(DATABASE_URL)
Session = sessionmaker(bind=engine)


# ── Compute one day's metrics ─────────────────────────────────────────────────

def compute_day(db, target_date: date) -> dict:
    """
    Compute all daily_metrics fields for a given date.
    Snapshots state AS OF end-of-day for user/vehicle/invoice counts,
    and sums token usage for that calendar day.
    """
    date_str = target_date.isoformat()
    next_day = target_date + timedelta(days=1)

    # ── User snapshot (current state — best we can do without history table) ──
    user_counts = db.execute(text("""
        SELECT
            COUNT(*)                                          AS total_users,
            COUNT(*) FILTER (WHERE status = 'active')         AS active_users,
            COUNT(*) FILTER (WHERE subscription_tier = 'premium') AS paid_users,
            COUNT(*) FILTER (WHERE subscription_tier = 'free')    AS free_users,
            COUNT(*) FILTER (WHERE status = 'disabled')       AS disabled_users
        FROM app_users
    """)).fetchone()

    # ── Users active on this specific day ─────────────────────────────────────
    active_on_day = db.execute(text("""
        SELECT COUNT(*) AS cnt
        FROM app_users
        WHERE DATE(last_active_at) = :d
    """), {"d": date_str}).scalar() or 0

    # ── Vehicle count (current total) ─────────────────────────────────────────
    total_vehicles = db.execute(text("""
        SELECT COUNT(*) FROM vehicles
    """)).scalar() or 0

    # ── Invoices uploaded on this day ─────────────────────────────────────────
    invoices_on_day = db.execute(text("""
        SELECT COUNT(*) FROM invoices
        WHERE created_at >= :start AND created_at < :end
    """), {"start": date_str, "end": next_day.isoformat()}).scalar() or 0

    # ── Total invoices ever ───────────────────────────────────────────────────
    total_invoices = db.execute(text("""
        SELECT COUNT(*) FROM invoices
    """)).scalar() or 0

    # ── Recommendations on this day (from token_usage_logs) ──────────────────
    recs_on_day = db.execute(text("""
        SELECT COUNT(*) FROM token_usage_logs
        WHERE agent_name = 'recommendation'
          AND DATE(created_at) = :d
    """), {"d": date_str}).scalar() or 0

    # ── Token usage on this day ───────────────────────────────────────────────
    token_row = db.execute(text("""
        SELECT
            COALESCE(SUM(input_tokens + output_tokens), 0) AS total_tokens,
            COALESCE(SUM(cost_usd), 0)                     AS total_cost
        FROM token_usage_logs
        WHERE DATE(created_at) = :d
    """), {"d": date_str}).fetchone()

    return {
        "metric_date":           date_str,
        "total_users":           user_counts.total_users,
        "active_users":          active_on_day,
        "paid_users":            user_counts.paid_users,
        "free_users":            user_counts.free_users,
        "disabled_users":        user_counts.disabled_users,
        "total_vehicles":        total_vehicles,
        "total_invoices":        total_invoices,
        "total_recommendations": recs_on_day,
        "total_tokens_consumed": int(token_row.total_tokens),
        "total_ai_cost_usd":     round(float(token_row.total_cost), 2),
    }


# ── Upsert one row ────────────────────────────────────────────────────────────

def upsert_day(db, metrics: dict):
    """
    INSERT ... ON CONFLICT (metric_date) DO UPDATE
    Safe to run multiple times — always updates to latest values.
    """
    db.execute(text("""
        INSERT INTO daily_metrics (
            metric_date, total_users, active_users, paid_users, free_users,
            disabled_users, total_vehicles, total_invoices, total_recommendations,
            total_tokens_consumed, total_ai_cost_usd, created_at
        ) VALUES (
            :metric_date, :total_users, :active_users, :paid_users, :free_users,
            :disabled_users, :total_vehicles, :total_invoices, :total_recommendations,
            :total_tokens_consumed, :total_ai_cost_usd, NOW()
        )
        ON CONFLICT (metric_date) DO UPDATE SET
            total_users           = EXCLUDED.total_users,
            active_users          = EXCLUDED.active_users,
            paid_users            = EXCLUDED.paid_users,
            free_users            = EXCLUDED.free_users,
            disabled_users        = EXCLUDED.disabled_users,
            total_vehicles        = EXCLUDED.total_vehicles,
            total_invoices        = EXCLUDED.total_invoices,
            total_recommendations = EXCLUDED.total_recommendations,
            total_tokens_consumed = EXCLUDED.total_tokens_consumed,
            total_ai_cost_usd     = EXCLUDED.total_ai_cost_usd
    """), metrics)
    db.commit()


# ── Determine date range to process ──────────────────────────────────────────

def get_date_range(args) -> list:
    today = date.today()

    if args.today:
        return [today]

    if args.days:
        return [today - timedelta(days=i) for i in range(args.days - 1, -1, -1)]

    # Default: backfill all days that have token_usage_logs data
    db = Session()
    try:
        rows = db.execute(text("""
            SELECT DISTINCT DATE(created_at) AS day
            FROM token_usage_logs
            ORDER BY day
        """)).fetchall()
        dates = [r.day for r in rows]

        # Always include today even if no token data yet
        if today not in dates:
            dates.append(today)

        return sorted(dates)
    finally:
        db.close()


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Populate daily_metrics table")
    parser.add_argument("--today", action="store_true",
                        help="Process today only (for scheduled task)")
    parser.add_argument("--days", type=int, default=None,
                        help="Process last N days")
    args = parser.parse_args()

    dates = get_date_range(args)

    if not dates:
        print("No dates to process.")
        return

    print(f"Processing {len(dates)} day(s): {dates[0]} → {dates[-1]}")

    db = Session()
    try:
        success = 0
        for target_date in dates:
            try:
                metrics = compute_day(db, target_date)
                upsert_day(db, metrics)
                print(
                    f"  ✓ {metrics['metric_date']}  "
                    f"users={metrics['total_users']}  "
                    f"active={metrics['active_users']}  "
                    f"tokens={metrics['total_tokens_consumed']:,}  "
                    f"cost=${metrics['total_ai_cost_usd']:.4f}"
                )
                success += 1
            except Exception as e:
                print(f"  ✗ {target_date}  ERROR: {e}")
                db.rollback()

        print(f"\nDone. {success}/{len(dates)} days written to daily_metrics.")

    finally:
        db.close()


if __name__ == "__main__":
    main()
