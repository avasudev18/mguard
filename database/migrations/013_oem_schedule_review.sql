-- migrations/013_oem_schedule_review.sql
-- ─────────────────────────────────────────────────────────────────────────────
-- Adds two columns to oem_schedules to support the AI-generated OEM record
-- workflow:
--
--   source        — tracks how each row was created:
--                   'admin_manual'    → entered by admin via the OEM Schedules UI
--                   'ai_generated'    → inserted by the BackgroundTask Claude call
--                                       after a new vehicle is added with no OEM data
--                   'generic_standard'→ fallback generic intervals (Flaw 7 fix)
--
--   review_status — controls whether the row is live in the upsell engine:
--                   'approved' → live, used by engine + recommendations
--                   'pending'  → AI-generated, awaiting admin review — NOT live yet
--                   'rejected' → admin rejected, permanently excluded
--
-- All existing rows default to source='admin_manual', review_status='approved'
-- so they remain live immediately. Zero downtime. Zero regression.
--
-- After running:
--   1. All existing Toyota rows remain fully live (approved)
--   2. New AI-generated rows start as pending (not live until admin approves)
--   3. invoices.py and recommendations.py add review_status='approved' filter
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE oem_schedules
    ADD COLUMN IF NOT EXISTS source        VARCHAR(30) NOT NULL DEFAULT 'admin_manual',
    ADD COLUMN IF NOT EXISTS review_status VARCHAR(20) NOT NULL DEFAULT 'approved';

-- Backfill: all existing rows are admin-created → mark as approved
UPDATE oem_schedules
    SET source        = 'admin_manual',
        review_status = 'approved'
    WHERE source IS NULL OR source = '';

-- Constraints
ALTER TABLE oem_schedules
    DROP CONSTRAINT IF EXISTS ck_oem_source;
ALTER TABLE oem_schedules
    ADD CONSTRAINT ck_oem_source
        CHECK (source IN ('admin_manual', 'ai_generated', 'generic_standard'));

ALTER TABLE oem_schedules
    DROP CONSTRAINT IF EXISTS ck_oem_review_status;
ALTER TABLE oem_schedules
    ADD CONSTRAINT ck_oem_review_status
        CHECK (review_status IN ('approved', 'pending', 'rejected'));

-- Indexes — review_status is queried on every OEM lookup
CREATE INDEX IF NOT EXISTS idx_oem_review_status ON oem_schedules (review_status);
CREATE INDEX IF NOT EXISTS idx_oem_source        ON oem_schedules (source);
CREATE INDEX IF NOT EXISTS idx_oem_pending       ON oem_schedules (make, model)
    WHERE review_status = 'pending';
