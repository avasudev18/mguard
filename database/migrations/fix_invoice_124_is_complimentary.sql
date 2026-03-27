-- ============================================================
-- DATA FIX: invoice 124 — correct is_complimentary for
--           Rear Differential and Fluid Service line items
--
-- Background:
--   Migration 007 backfilled is_complimentary=TRUE for all line
--   items where both unit_price and line_total are NULL.
--   This correctly captured genuinely-free lines (e.g. Complimentary
--   Vehicle Inspection) but also incorrectly captured bundled-but-
--   charged lines on dealer invoices where no per-line price is shown.
--
--   Invoice 124 (AutoNation Honda, vehicle 29, Feb 7 2026, 68,384 mi)
--   contains two wrongly-flagged lines:
--     - "Rear Differential Service"  → charged, bundled, NOT complimentary
--     - "Fluid Service"              → charged, bundled, NOT complimentary
--
--   The total invoice amount is non-zero, confirming these were paid services.
--
-- Fix:
--   Set is_complimentary=FALSE for the non-free line items on invoice 124.
--   Preserve is_complimentary=TRUE for the genuine courtesy lines
--   (Multi-Point Inspection, Complimentary Vehicle Inspection, etc.)
--
-- Safe to re-run: UPDATE with specific WHERE clause is idempotent.
-- ============================================================

BEGIN;

-- Step 1: Preview what we are about to change
SELECT
    id,
    service_type,
    unit_price,
    line_total,
    is_complimentary,
    is_labor,
    is_parts
FROM invoice_line_items
WHERE invoice_id = 124
ORDER BY id;

-- Step 2: Correct the bundled-charged lines
--   We target by service_type keywords, NOT blanket "all null-price lines",
--   so genuine courtesy items on the same invoice are untouched.
UPDATE invoice_line_items
SET    is_complimentary = FALSE
WHERE  invoice_id = 124
  AND  (
           service_type ILIKE '%differential%'
        OR service_type ILIKE '%fluid service%'
        OR service_type ILIKE '%fluid, rear%'
       );

-- Step 3: Verify result
SELECT
    id,
    service_type,
    unit_price,
    line_total,
    is_complimentary
FROM invoice_line_items
WHERE invoice_id = 124
ORDER BY id;

-- ── Review output above, then COMMIT or ROLLBACK ──────────────────────────────
-- Expected after update:
--   Rear Differential Service   → is_complimentary = FALSE
--   Fluid Service               → is_complimentary = FALSE
--   Multi-Point Inspection      → is_complimentary = TRUE  (unchanged)
--   Complimentary Inspection    → is_complimentary = TRUE  (unchanged)
--   Oil Change / Labor lines    → unchanged

COMMIT;
