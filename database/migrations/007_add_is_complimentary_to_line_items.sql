-- ============================================================
-- MIGRATION 007: Add is_complimentary to invoice_line_items
--
-- Adds an explicit is_complimentary boolean that the LLM sets
-- at extraction time based on what the invoice actually says
-- (e.g. "Complimentary Vehicle Inspection", "$0.00", "NO CHARGE").
--
-- Replaces the broken frontend heuristic:
--   isComplimentary = unit_price === null
-- which incorrectly labelled bundled-but-charged services
-- (Rear Differential, Fluid Service) as complimentary.
--
-- Backfill: existing rows default to false.
-- The upsell_rules._is_courtesy_type() and _is_zero_dollar()
-- functions continue to work as the authoritative backend source
-- of truth for upsell evaluation — this column is for display
-- and dispute-eligibility only.
-- ============================================================

BEGIN;

ALTER TABLE invoice_line_items
    ADD COLUMN IF NOT EXISTS is_complimentary BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN invoice_line_items.is_complimentary IS
    'True if the invoice explicitly marks this line as free/complimentary/courtesy. '
    'Set by LLM extraction. Used by frontend to show Complimentary badge and '
    'disable dispute checkbox. NOT used by upsell evaluation engine.';

-- Backfill: mark existing zero-dollar lines as complimentary
-- (line_total = 0 or both prices null = no charge recorded)
UPDATE invoice_line_items
SET    is_complimentary = TRUE
WHERE  (line_total IS NULL OR line_total = 0)
  AND  (unit_price IS NULL OR unit_price = 0);

-- Note: this backfill marks bundled services (Rear Differential etc.)
-- as complimentary too — because we cannot retroactively distinguish them.
-- Re-uploading those invoices will produce correct is_complimentary=false
-- values once the updated LLM prompts are deployed.

COMMIT;
