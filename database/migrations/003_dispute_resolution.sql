-- MaintenanceGuard Database Migration
-- File: 003_dispute_resolution.sql
-- Run order: 3
-- Purpose: Add dispute resolution & archival support to invoices,
--          invoice_line_items, and service_records tables.
--          Creates immutable dispute_resolutions audit table.

-- ============================================================
-- 1. EXTEND invoices TABLE
-- ============================================================

ALTER TABLE invoices
    ADD COLUMN IF NOT EXISTS dispute_status   VARCHAR(50)  DEFAULT NULL,
    -- NULL            = no dispute
    -- 'disputed'      = dispute raised, under review
    -- 'proven_upsell' = confirmed unnecessary upsell
    -- 'proven_duplicate' = confirmed duplicate charge
    -- 'dismissed'     = dispute reviewed but not upheld

    ADD COLUMN IF NOT EXISTS is_archived          BOOLEAN      DEFAULT FALSE,
    -- TRUE = hidden from normal UI / recommendation engine
    -- Record is NEVER deleted; archived for legal / audit purposes

    ADD COLUMN IF NOT EXISTS dispute_raised_at    TIMESTAMPTZ  DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS dispute_resolved_at  TIMESTAMPTZ  DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS dispute_confirmed_by VARCHAR(100) DEFAULT NULL,
    -- e.g. 'dealer', 'user_self', 'admin'

    ADD COLUMN IF NOT EXISTS dispute_notes        TEXT         DEFAULT NULL;

-- Index for fast filtering of archived / disputed invoices
CREATE INDEX IF NOT EXISTS idx_invoices_is_archived
    ON invoices(is_archived)
    WHERE is_archived = FALSE;

CREATE INDEX IF NOT EXISTS idx_invoices_dispute_status
    ON invoices(dispute_status)
    WHERE dispute_status IS NOT NULL;

-- ============================================================
-- 2. EXTEND service_records TABLE
-- ============================================================

ALTER TABLE service_records
    ADD COLUMN IF NOT EXISTS excluded_from_timeline  BOOLEAN     DEFAULT FALSE,
    -- When invoice is archived/proven fraud, matching service records
    -- are excluded from the timeline and recommendation engine
    -- WITHOUT being deleted.

    ADD COLUMN IF NOT EXISTS exclusion_reason        VARCHAR(100) DEFAULT NULL;
    -- e.g. 'proven_upsell', 'proven_duplicate', 'data_error'

CREATE INDEX IF NOT EXISTS idx_service_records_excluded
    ON service_records(excluded_from_timeline)
    WHERE excluded_from_timeline = FALSE;

-- ============================================================
-- 3. CREATE dispute_resolutions AUDIT TABLE (immutable log)
-- ============================================================

CREATE TABLE IF NOT EXISTS dispute_resolutions (
    id                  SERIAL       PRIMARY KEY,
    invoice_id          INT          NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
    -- ON DELETE RESTRICT: prevents deleting an invoice that has a resolution log

    vehicle_id          INT          NOT NULL,
    -- Denormalised for query convenience (no join needed for reports)

    dispute_type        VARCHAR(50)  NOT NULL,
    -- 'duplicate' | 'upsell' | 'unauthorized_charge' | 'other'

    resolution_status   VARCHAR(50)  NOT NULL,
    -- 'proven' | 'dismissed' | 'partial' | 'pending'

    confirmed_by        VARCHAR(100) NOT NULL,
    -- 'dealer_confirmed' | 'user_self_resolved' | 'admin_decision'

    dealer_name         VARCHAR(255) DEFAULT NULL,
    original_amount     NUMERIC(10,2) DEFAULT NULL,
    refund_amount       NUMERIC(10,2) DEFAULT NULL,
    evidence_notes      TEXT         DEFAULT NULL,

    -- Snapshot of key invoice data AT TIME OF RESOLUTION (legal safety net)
    invoice_snapshot    JSONB        DEFAULT NULL,

    created_at          TIMESTAMPTZ  DEFAULT NOW(),
    resolved_at         TIMESTAMPTZ  DEFAULT NOW()
);

-- Indexes for audit queries
CREATE INDEX IF NOT EXISTS idx_dispute_resolutions_invoice_id
    ON dispute_resolutions(invoice_id);

CREATE INDEX IF NOT EXISTS idx_dispute_resolutions_vehicle_id
    ON dispute_resolutions(vehicle_id);

CREATE INDEX IF NOT EXISTS idx_dispute_resolutions_created_at
    ON dispute_resolutions(created_at DESC);

-- ============================================================
-- 4. COMMENTS for documentation
-- ============================================================

COMMENT ON COLUMN invoices.is_archived IS
    'TRUE = hidden from UI and recommendation engine. NEVER deleted for legal retention.';

COMMENT ON COLUMN invoices.dispute_status IS
    'Lifecycle: NULL -> disputed -> proven_upsell | proven_duplicate | dismissed';

COMMENT ON COLUMN service_records.excluded_from_timeline IS
    'TRUE = record is suppressed from timeline and recommendations; set when parent invoice is archived.';

COMMENT ON TABLE dispute_resolutions IS
    'Immutable audit log. One row per dispute resolution event. Records are NEVER deleted.';
