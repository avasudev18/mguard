-- ============================================================================
-- delete_invoice_88910.sql
-- ============================================================================
-- Deletes all data associated with invoices at mileage_at_service = 88910
-- for the vehicle returned by the query below.
--
-- Dependency order (must delete children before parents):
--
--   dispute_line_items        FK → dispute_resolutions.id  (CASCADE on delete)
--                             FK → invoice_line_items.id
--   dispute_resolutions       FK → invoices.id             (RESTRICT — delete first)
--   service_records           FK → invoices.id
--   invoice_line_items        FK → invoices.id
--   invoices                  root record
--
-- evaluation_log has NO invoice_id FK — not touched.
-- oem_schedules   has NO invoice_id FK — not touched.
-- vehicles / app_users        NOT touched.
--
-- Usage:
--   psql -U <user> -d <dbname> -f delete_invoice_88910.sql
--
-- Safe to run repeatedly — all deletes are scoped to the same invoice IDs.
-- Wrap in a transaction so nothing is committed until every step succeeds.
-- ============================================================================
 
BEGIN;
 
-- ── 0. Identify target invoice(s) ───────────────────────────────────────────
-- Run this SELECT first to confirm the correct rows before committing.
 
SELECT id, vehicle_id, mileage_at_service, service_date, shop_name, dispute_status
FROM   invoices
WHERE  mileage_at_service = 88910;
 
-- ── 1. dispute_line_items ────────────────────────────────────────────────────
-- Child of dispute_resolutions (CASCADE) AND invoice_line_items.
-- Must be deleted before both parents.
 
DELETE FROM dispute_line_items
WHERE  dispute_resolution_id IN (
    SELECT id
    FROM   dispute_resolutions
    WHERE  invoice_id IN (
        SELECT id FROM invoices WHERE mileage_at_service = 88910
    )
)
OR     line_item_id IN (
    SELECT id
    FROM   invoice_line_items
    WHERE  invoice_id IN (
        SELECT id FROM invoices WHERE mileage_at_service = 88910
    )
);
 
-- ── 2. dispute_resolutions ───────────────────────────────────────────────────
-- FK to invoices with ondelete=RESTRICT — must be removed before invoices.
 
DELETE FROM dispute_resolutions
WHERE  invoice_id IN (
    SELECT id FROM invoices WHERE mileage_at_service = 88910
);
 
-- ── 3. service_records ───────────────────────────────────────────────────────
-- FK to invoices (nullable). Deleting here removes both confirmed genuine
-- records AND any reinstated records written by the dismiss fix.
 
DELETE FROM service_records
WHERE  invoice_id IN (
    SELECT id FROM invoices WHERE mileage_at_service = 88910
);
 
-- ── 4. invoice_line_items ────────────────────────────────────────────────────
 
DELETE FROM invoice_line_items
WHERE  invoice_id IN (
    SELECT id FROM invoices WHERE mileage_at_service = 88910
);
 
-- ── 5. invoices ──────────────────────────────────────────────────────────────
 
DELETE FROM invoices
WHERE  mileage_at_service = 88910;
 
-- ── 6. Verification — all counts should be 0 ────────────────────────────────
 
DO $$
DECLARE
    v_invoices            INT;
    v_line_items          INT;
    v_service_records     INT;
    v_dispute_resolutions INT;
    v_dispute_line_items  INT;
BEGIN
    SELECT COUNT(*) INTO v_invoices
    FROM invoices WHERE mileage_at_service = 88910;
 
    SELECT COUNT(*) INTO v_line_items
    FROM invoice_line_items
    WHERE invoice_id NOT IN (SELECT id FROM invoices);
 
    SELECT COUNT(*) INTO v_service_records
    FROM service_records
    WHERE invoice_id IS NOT NULL
      AND invoice_id NOT IN (SELECT id FROM invoices);
 
    SELECT COUNT(*) INTO v_dispute_resolutions
    FROM dispute_resolutions
    WHERE invoice_id NOT IN (SELECT id FROM invoices);
 
    SELECT COUNT(*) INTO v_dispute_line_items
    FROM dispute_line_items
    WHERE dispute_resolution_id NOT IN (SELECT id FROM dispute_resolutions);
 
    RAISE NOTICE '── Post-delete verification ──────────────────────────';
    RAISE NOTICE 'invoices remaining at 88910       : %', v_invoices;
    RAISE NOTICE 'orphaned invoice_line_items        : %', v_line_items;
    RAISE NOTICE 'orphaned service_records           : %', v_service_records;
    RAISE NOTICE 'orphaned dispute_resolutions       : %', v_dispute_resolutions;
    RAISE NOTICE 'orphaned dispute_line_items        : %', v_dispute_line_items;
 
    IF v_invoices + v_line_items + v_service_records +
       v_dispute_resolutions + v_dispute_line_items > 0 THEN
        RAISE EXCEPTION 'Verification failed — orphaned rows detected. Transaction rolled back.';
    END IF;
 
    RAISE NOTICE 'All checks passed — committing.';
END $$;
 
COMMIT;