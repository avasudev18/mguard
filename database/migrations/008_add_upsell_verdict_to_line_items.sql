-- ============================================================
-- MIGRATION 008: Add upsell_verdict to invoice_line_items
--
-- Persists the result of evaluate_upsell() on the line item row
-- so the invoice history view (VehicleDetail) can display the
-- correct badge (Genuine / Potential Upsell / Exempt) without
-- re-running the evaluation engine on every GET.
--
-- Values: 'genuine' | 'upsell' | 'exempt' | NULL
--   NULL  = invoice confirmed before this migration (no verdict stored)
--
-- Deploy order: run BEFORE deploying the updated backend.
-- ============================================================

BEGIN;

ALTER TABLE invoice_line_items
    ADD COLUMN IF NOT EXISTS upsell_verdict VARCHAR(20) NULL;

COMMENT ON COLUMN invoice_line_items.upsell_verdict IS
    'Result of evaluate_upsell() at confirmation time. '
    'genuine = service is within OEM interval or no prior history. '
    'upsell  = service performed too soon per OEM schedule. '
    'exempt  = zero-dollar, recall, or courtesy service — not evaluated. '
    'NULL    = invoice confirmed before verdict persistence was introduced.';

-- No backfill — existing rows get NULL which the frontend treats as
-- "no verdict available" and falls back to is_complimentary for display.

COMMIT;

-- ── Verification ──────────────────────────────────────────────────────────────
SELECT column_name, data_type, is_nullable, column_default
FROM   information_schema.columns
WHERE  table_name = 'invoice_line_items'
  AND  column_name = 'upsell_verdict';
