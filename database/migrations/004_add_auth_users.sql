-- MaintenanceGuard Database Migration
-- File: 004_add_auth_users.sql
-- Run order: 4 (after 003_dispute_resolution.sql)
-- Adds app_users table for email/password auth and owner_id FK to vehicles

CREATE TABLE IF NOT EXISTS app_users (
    id                SERIAL PRIMARY KEY,
    email             VARCHAR(255) UNIQUE NOT NULL,
    full_name         VARCHAR(255),
    hashed_password   VARCHAR(255) NOT NULL,
    subscription_tier VARCHAR(50)  DEFAULT 'free',
    status            VARCHAR(20)  DEFAULT 'active',
    created_at        TIMESTAMP    DEFAULT NOW(),
    updated_at        TIMESTAMP    DEFAULT NOW(),
    last_active_at    TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_app_users_email  ON app_users(email);
CREATE INDEX IF NOT EXISTS idx_app_users_status ON app_users(status);

-- Add optional owner FK to vehicles (nullable – preserves all existing rows)
ALTER TABLE vehicles
    ADD COLUMN IF NOT EXISTS owner_id INTEGER REFERENCES app_users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_vehicles_owner ON vehicles(owner_id);
