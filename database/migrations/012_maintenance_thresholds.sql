-- migrations/012_maintenance_thresholds.sql
-- ─────────────────────────────────────────────────────────────────────────────
-- Creates the maintenance_thresholds table used by the Dynamic Asset-Based
-- Tolerance System (Flaws 1 & 3 fix).
--
-- Replaces the hardcoded OEM_INTERVAL_TOLERANCE = 0.85 constant in
-- upsell_rules.py with per-category, optionally vehicle-scoped values
-- configurable by admins at runtime via POST /api/admin/thresholds/seed.
--
-- Resolution order in resolve_threshold():
--   1. make + model + year  → vehicle-specific override
--   2. make only            → brand-level override
--   3. NULL / global        → system default (seed rows)
--
-- Falls back to tolerance=0.85 + annual_days_floor=365 when:
--   - This table is empty (before seed runs)
--   - Service category is unrecognised
--   - DB is unavailable
-- Zero regression risk — identical to previous hardcoded behaviour.
--
-- Safe to run on a live database — CREATE TABLE IF NOT EXISTS.
-- After running: POST /api/admin/thresholds/seed to populate defaults.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS maintenance_thresholds (
    id                SERIAL          PRIMARY KEY,

    -- ── Vehicle scope ──────────────────────────────────────────────────────
    -- All NULL = global default. make only = brand override.
    -- make + model + year = vehicle-specific override.
    make              VARCHAR(50)     NULL,
    model             VARCHAR(100)    NULL,
    year              INTEGER         NULL,

    -- ── Threshold definition ───────────────────────────────────────────────
    service_category  VARCHAR(50)     NOT NULL,
    upsell_tolerance  NUMERIC(4, 3)   NOT NULL DEFAULT 0.850,
    annual_days_floor INTEGER         NULL,
    severity_tier     VARCHAR(20)     NOT NULL DEFAULT 'standard',

    -- ── Audit ──────────────────────────────────────────────────────────────
    created_by        INTEGER         REFERENCES app_users(id) ON DELETE SET NULL,
    updated_by        INTEGER         REFERENCES app_users(id) ON DELETE SET NULL,
    created_at        TIMESTAMP       NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMP       NOT NULL DEFAULT NOW()
);

-- ── Constraints ────────────────────────────────────────────────────────────

ALTER TABLE maintenance_thresholds
    DROP CONSTRAINT IF EXISTS ck_mt_tolerance_range;
ALTER TABLE maintenance_thresholds
    ADD CONSTRAINT ck_mt_tolerance_range
        CHECK (upsell_tolerance > 0 AND upsell_tolerance <= 1.0);

ALTER TABLE maintenance_thresholds
    DROP CONSTRAINT IF EXISTS ck_mt_severity_tier;
ALTER TABLE maintenance_thresholds
    ADD CONSTRAINT ck_mt_severity_tier
        CHECK (severity_tier IN ('critical', 'high', 'standard', 'low'));

ALTER TABLE maintenance_thresholds
    DROP CONSTRAINT IF EXISTS ck_mt_annual_floor_positive;
ALTER TABLE maintenance_thresholds
    ADD CONSTRAINT ck_mt_annual_floor_positive
        CHECK (annual_days_floor IS NULL OR annual_days_floor > 0);

ALTER TABLE maintenance_thresholds
    DROP CONSTRAINT IF EXISTS uq_mt_scope_category;
ALTER TABLE maintenance_thresholds
    ADD CONSTRAINT uq_mt_scope_category
        UNIQUE (make, model, year, service_category);

-- ── Indexes ────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_mt_category ON maintenance_thresholds (service_category);
CREATE INDEX IF NOT EXISTS idx_mt_make     ON maintenance_thresholds (make);
