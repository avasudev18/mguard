-- ============================================================
-- DELETE SCRIPT: Remove invoices 127 AND 128 and all related records
--
-- Both are duplicate confirmed invoices for vehicle 29, Feb 7 2026,
-- 68,384 mi — created before migration 008 was run.
--
-- Tables affected (in FK-safe order):
--   1. dispute_line_items    — child of dispute_resolutions
--   2. dispute_resolutions   — references invoice_id
--   3. service_records       — references invoice_id
--   4. invoice_line_items    — references invoice_id
--   5. invoices              — parent rows
-- ============================================================

BEGIN;

-- ── Preview rows to be deleted ────────────────────────────────────────────────
SELECT 'dispute_line_items' AS table_name, COUNT(*) AS rows_to_delete
FROM   dispute_line_items
WHERE  dispute_resolution_id IN (
           SELECT id FROM dispute_resolutions WHERE invoice_id IN (127, 128)
       )
UNION ALL
SELECT 'dispute_resolutions', COUNT(*)
FROM   dispute_resolutions WHERE invoice_id IN (127, 128)
UNION ALL
SELECT 'service_records', COUNT(*)
FROM   service_records WHERE invoice_id IN (127, 128)
UNION ALL
SELECT 'invoice_line_items', COUNT(*)
FROM   invoice_line_items WHERE invoice_id IN (127, 128)
UNION ALL
SELECT 'invoices', COUNT(*)
FROM   invoices WHERE id IN (127, 128);

-- ── Delete in FK-safe order ───────────────────────────────────────────────────

DELETE FROM dispute_line_items
WHERE  dispute_resolution_id IN (
           SELECT id FROM dispute_resolutions WHERE invoice_id IN (127, 128)
       );

DELETE FROM dispute_resolutions WHERE invoice_id IN (127, 128);
DELETE FROM service_records     WHERE invoice_id IN (127, 128);
DELETE FROM invoice_line_items  WHERE invoice_id IN (127, 128);
DELETE FROM invoices            WHERE id IN (127, 128);

-- ── Verify all gone ───────────────────────────────────────────────────────────
SELECT 'dispute_line_items' AS table_name, COUNT(*) AS remaining
FROM   dispute_line_items
WHERE  dispute_resolution_id IN (
           SELECT id FROM dispute_resolutions WHERE invoice_id IN (127, 128)
       )
UNION ALL
SELECT 'dispute_resolutions', COUNT(*)
FROM   dispute_resolutions WHERE invoice_id IN (127, 128)
UNION ALL
SELECT 'service_records', COUNT(*)
FROM   service_records WHERE invoice_id IN (127, 128)
UNION ALL
SELECT 'invoice_line_items', COUNT(*)
FROM   invoice_line_items WHERE invoice_id IN (127, 128)
UNION ALL
SELECT 'invoices', COUNT(*)
FROM   invoices WHERE id IN (127, 128);

-- All remaining counts should be 0 before committing.
COMMIT;
