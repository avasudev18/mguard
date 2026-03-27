-- MaintenanceGuard Database Migration
-- File: 002_add_vin_to_vehicles.sql
-- Description: Ensures VIN field exists on vehicles (safe no-op if already created by 001)

ALTER TABLE vehicles
    ADD COLUMN IF NOT EXISTS vin VARCHAR(17);

CREATE INDEX IF NOT EXISTS idx_vehicles_vin ON vehicles(vin)
    WHERE vin IS NOT NULL;

-- Add constraint only if it doesn't already exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_vehicles_vin_format'
    ) THEN
        ALTER TABLE vehicles
            ADD CONSTRAINT chk_vehicles_vin_format
            CHECK (
                vin IS NULL OR (
                    LENGTH(vin) = 17
                    AND vin ~ '^[A-HJ-NPR-Z0-9]{17}$'
                )
            );
    END IF;
END$$;
