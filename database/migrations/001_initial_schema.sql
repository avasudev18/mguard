-- MaintenanceGuard Database Migration
-- File: 001_initial_schema.sql
-- Run order: 1 (initial schema)
-- PKs use "id" throughout to match SQLAlchemy ORM models

-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- ============================================================
-- APP_USERS TABLE  (auth users — created first, referenced by vehicles)
-- ============================================================
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

-- ============================================================
-- VEHICLES TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS vehicles (
    id               SERIAL PRIMARY KEY,
    owner_id         INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
    year             INTEGER NOT NULL,
    make             VARCHAR(100) NOT NULL,
    model            VARCHAR(100) NOT NULL,
    trim             VARCHAR(100),
    vin              VARCHAR(17) UNIQUE,
    nickname         VARCHAR(100),
    current_mileage  INTEGER,
    created_at       TIMESTAMP DEFAULT NOW(),
    updated_at       TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vehicles_owner_id ON vehicles(owner_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_vehicles_vin ON vehicles(vin) WHERE vin IS NOT NULL;

ALTER TABLE vehicles
    ADD CONSTRAINT IF NOT EXISTS chk_vehicles_vin_format
    CHECK (
        vin IS NULL OR (
            LENGTH(vin) = 17
            AND vin ~ '^[A-HJ-NPR-Z0-9]{17}$'
        )
    );

-- ============================================================
-- SERVICE TAXONOMY TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS service_taxonomy (
    id                      SERIAL PRIMARY KEY,
    canonical_name          VARCHAR(100) NOT NULL,
    synonyms                TEXT[],
    category                VARCHAR(50),
    typical_interval_miles  INTEGER,
    typical_interval_months INTEGER
);

-- ============================================================
-- INVOICES TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS invoices (
    id                  SERIAL PRIMARY KEY,
    vehicle_id          INTEGER NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
    service_date        DATE,
    mileage_at_service  INTEGER,
    shop_name           VARCHAR(255),
    shop_address        TEXT,
    total_amount        NUMERIC(10,2),
    currency            VARCHAR(3)   DEFAULT 'USD',
    s3_file_path        TEXT,
    ocr_text            TEXT,
    raw_text            TEXT,
    is_confirmed        BOOLEAN      DEFAULT FALSE,
    -- Dispute fields (pre-created to avoid ALTER dependency issues)
    dispute_status      VARCHAR(50)  DEFAULT NULL,
    is_archived         BOOLEAN      DEFAULT FALSE,
    dispute_raised_at   TIMESTAMPTZ  DEFAULT NULL,
    dispute_resolved_at TIMESTAMPTZ  DEFAULT NULL,
    dispute_confirmed_by VARCHAR(100) DEFAULT NULL,
    dispute_notes       TEXT         DEFAULT NULL,
    created_at          TIMESTAMP    DEFAULT NOW(),
    updated_at          TIMESTAMP    DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_invoices_vehicle_id    ON invoices(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_invoices_is_archived   ON invoices(is_archived) WHERE is_archived = FALSE;
CREATE INDEX IF NOT EXISTS idx_invoices_dispute_status ON invoices(dispute_status) WHERE dispute_status IS NOT NULL;

-- ============================================================
-- INVOICE LINE ITEMS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS invoice_line_items (
    id                  SERIAL PRIMARY KEY,
    invoice_id          INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    service_type        VARCHAR(255),
    service_description TEXT,
    quantity            FLOAT    DEFAULT 1.0,
    unit_price          FLOAT,
    line_total          FLOAT,
    is_labor            BOOLEAN  DEFAULT FALSE,
    is_parts            BOOLEAN  DEFAULT FALSE,
    created_at          TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_line_items_invoice_id ON invoice_line_items(invoice_id);

-- ============================================================
-- SERVICE RECORDS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS service_records (
    id                      SERIAL       PRIMARY KEY,
    vehicle_id              INTEGER      NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
    invoice_id              INTEGER      REFERENCES invoices(id) ON DELETE SET NULL,
    service_date            TIMESTAMPTZ  NOT NULL,
    mileage_at_service      INTEGER      NOT NULL,
    service_type            VARCHAR(255) NOT NULL,
    service_description     TEXT,
    shop_name               VARCHAR(255),
    is_manual_entry         BOOLEAN      DEFAULT FALSE,
    notes                   TEXT,
    excluded_from_timeline  BOOLEAN      NOT NULL DEFAULT FALSE,
    exclusion_reason        VARCHAR(100) DEFAULT NULL,
    created_at              TIMESTAMPTZ  DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_service_records_vehicle_id   ON service_records(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_service_records_invoice_id   ON service_records(invoice_id);
CREATE INDEX IF NOT EXISTS idx_service_records_service_date ON service_records(service_date DESC);
CREATE INDEX IF NOT EXISTS idx_service_records_excluded     ON service_records(excluded_from_timeline) WHERE excluded_from_timeline = FALSE;

-- ============================================================
-- DISPUTE RESOLUTIONS AUDIT TABLE (immutable)
-- ============================================================
CREATE TABLE IF NOT EXISTS dispute_resolutions (
    id                SERIAL        PRIMARY KEY,
    invoice_id        INTEGER       NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
    vehicle_id        INTEGER       NOT NULL,
    dispute_type      VARCHAR(50)   NOT NULL,
    resolution_status VARCHAR(50)   NOT NULL,
    confirmed_by      VARCHAR(100)  NOT NULL,
    dealer_name       VARCHAR(255)  DEFAULT NULL,
    original_amount   NUMERIC(10,2) DEFAULT NULL,
    refund_amount     NUMERIC(10,2) DEFAULT NULL,
    evidence_notes    TEXT          DEFAULT NULL,
    invoice_snapshot  JSONB         DEFAULT NULL,
    created_at        TIMESTAMPTZ   DEFAULT NOW(),
    resolved_at       TIMESTAMPTZ   DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dispute_resolutions_invoice_id  ON dispute_resolutions(invoice_id);
CREATE INDEX IF NOT EXISTS idx_dispute_resolutions_vehicle_id  ON dispute_resolutions(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_dispute_resolutions_created_at  ON dispute_resolutions(created_at DESC);

-- ============================================================
-- OEM SCHEDULES TABLE (for recommendation engine)
-- ============================================================
CREATE TABLE IF NOT EXISTS oem_schedules (
    id              SERIAL PRIMARY KEY,
    make            VARCHAR(100),
    model           VARCHAR(100),
    year_start      INTEGER,
    year_end        INTEGER,
    service_type    VARCHAR(255),
    interval_miles  INTEGER,
    interval_months INTEGER,
    notes           TEXT,
    created_at      TIMESTAMP DEFAULT NOW()
);
