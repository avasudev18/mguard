-- migrations/005_add_vehicle_driving_condition.sql
-- ─────────────────────────────────────────────────────────────────────────────
-- Adds driving_condition to the vehicles table.
-- Safe to run on a live PostgreSQL 11+ database — ADD COLUMN with a DEFAULT
-- is a metadata-only operation and does not rewrite the table.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE vehicles
    ADD COLUMN IF NOT EXISTS driving_condition VARCHAR(10)
    NOT NULL DEFAULT 'normal'
    CHECK (driving_condition IN ('normal', 'severe'));

COMMENT ON COLUMN vehicles.driving_condition IS
    'OEM interval profile for this vehicle.
     normal  = standard OEM intervals (default).
     severe  = tighter intervals for stop-and-go traffic, towing,
               mountainous terrain, or extreme temperatures.
     Matches the driving_condition values in oem_schedules.';

-- ─────────────────────────────────────────────────────────────────────────────
-- Composite index to speed up the 3-step OEM fallback queries that filter by
-- (make, model, year, driving_condition).  The services-due endpoint loops
-- over every user vehicle so this index is hit on every dashboard load.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_oem_driving_condition
    ON oem_schedules (make, model, year, driving_condition);
