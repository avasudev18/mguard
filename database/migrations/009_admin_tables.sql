-- Migration: 009_admin_tables.sql
-- Run after: 008_add_upsell_verdict_to_line_items.sql
-- All DDL is idempotent (IF NOT EXISTS)

-- ── 1. admins ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS admins (
    id            SERIAL       PRIMARY KEY,
    email         VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role          VARCHAR(50)  NOT NULL DEFAULT 'super_admin',
    totp_secret   VARCHAR(255),
    created_at    TIMESTAMP    DEFAULT NOW(),
    last_login    TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_admins_email ON admins(email);

-- ── 2. admin_actions (immutable audit log) ────────────────────────────────────
CREATE TABLE IF NOT EXISTS admin_actions (
    id             SERIAL      PRIMARY KEY,
    admin_id       INT         NOT NULL REFERENCES admins(id),
    action_type    VARCHAR(50) NOT NULL,
    target_user_id INT         REFERENCES app_users(id) ON DELETE SET NULL,
    reason         TEXT,
    timestamp      TIMESTAMP   DEFAULT NOW(),
    ip_address     VARCHAR(45)
);
CREATE INDEX IF NOT EXISTS idx_admin_actions_ts     ON admin_actions(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_admin_actions_admin  ON admin_actions(admin_id);
CREATE INDEX IF NOT EXISTS idx_admin_actions_target ON admin_actions(target_user_id);

-- ── 3. daily_metrics ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS daily_metrics (
    metric_date           DATE         PRIMARY KEY,
    total_users           INT,
    active_users          INT,
    paid_users            INT,
    free_users            INT,
    disabled_users        INT,
    total_vehicles        INT,
    total_invoices        INT,
    total_recommendations INT,
    total_tokens_consumed BIGINT,
    total_ai_cost_usd     DECIMAL(10,2),
    created_at            TIMESTAMP    DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_daily_metrics_date ON daily_metrics(metric_date DESC);

-- ── 4. app_users additions ────────────────────────────────────────────────────
-- IMPORTANT: status column already exists from migration 004 — do NOT re-add
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS disabled_at          TIMESTAMP;
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS disabled_by_admin_id INT REFERENCES admins(id) ON DELETE SET NULL;
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS disabled_reason      TEXT;
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS enabled_at           TIMESTAMP;
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS enabled_by_admin_id  INT REFERENCES admins(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_app_users_last_active ON app_users(last_active_at DESC);
