-- Migration: 010_phase2_tables.sql
-- Run after: 009_admin_tables.sql
-- All DDL is idempotent (IF NOT EXISTS)
-- Apply to Supabase via SQL editor or psql with DATABASE_URL

-- ── 1. token_usage_logs ───────────────────────────────────────────────────────
-- One row per LLM API call. Populated by token_logger.py. Never deleted.
CREATE TABLE IF NOT EXISTS token_usage_logs (
    id                  SERIAL          PRIMARY KEY,
    user_id             INT             REFERENCES app_users(id) ON DELETE SET NULL,
    agent_name          VARCHAR(50)     NOT NULL,  -- invoice_parser | invoice_vision | recommendation
    model_name          VARCHAR(100)    NOT NULL,  -- e.g. claude-3-haiku-20240307
    input_tokens        INT             NOT NULL,
    output_tokens       INT             NOT NULL,
    cost_usd            DECIMAL(10, 6)  NOT NULL,
    request_duration_ms INT,
    created_at          TIMESTAMP       DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_token_logs_user    ON token_usage_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_token_logs_agent   ON token_usage_logs(agent_name);
CREATE INDEX IF NOT EXISTS idx_token_logs_created ON token_usage_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_token_logs_date    ON token_usage_logs(DATE(created_at));

-- ── 2. user_notes ─────────────────────────────────────────────────────────────
-- Immutable append-only support notes. One row per note. Never edited or deleted.
CREATE TABLE IF NOT EXISTS user_notes (
    id         SERIAL    PRIMARY KEY,
    user_id    INT       NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
    admin_id   INT       NOT NULL REFERENCES admins(id)    ON DELETE SET NULL,
    note       TEXT      NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_notes_user ON user_notes(user_id, created_at DESC);

-- ── 3. subscription_events ────────────────────────────────────────────────────
-- Triggered when subscription_tier changes via a billing/payment flow.
-- Never deleted. Enables free->paid conversion tracking.
CREATE TABLE IF NOT EXISTS subscription_events (
    id           SERIAL       PRIMARY KEY,
    user_id      INT          NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
    event_type   VARCHAR(50)  NOT NULL,  -- upgraded | downgraded | cancelled
    from_tier    VARCHAR(50)  NOT NULL,
    to_tier      VARCHAR(50)  NOT NULL,
    triggered_by VARCHAR(50),            -- billing_webhook | admin_manual | system
    created_at   TIMESTAMP    DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sub_events_user    ON subscription_events(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sub_events_created ON subscription_events(created_at DESC);

-- ── 4. anomaly_alerts ─────────────────────────────────────────────────────────
-- One row per triggered cost anomaly. Cleared when admin dismisses.
CREATE TABLE IF NOT EXISTS anomaly_alerts (
    id                   SERIAL         PRIMARY KEY,
    alert_type           VARCHAR(50)    NOT NULL DEFAULT 'cost_threshold_exceeded',
    metric_date          DATE           NOT NULL,
    actual_value         DECIMAL(10, 2) NOT NULL,
    threshold_value      DECIMAL(10, 2) NOT NULL,
    is_resolved          BOOLEAN        DEFAULT FALSE,
    resolved_by_admin_id INT            REFERENCES admins(id) ON DELETE SET NULL,
    resolved_at          TIMESTAMP,
    created_at           TIMESTAMP      DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_anomaly_date_type
    ON anomaly_alerts(metric_date, alert_type)
    WHERE is_resolved = FALSE;
