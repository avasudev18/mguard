-- database/migrations/004_add_embedding_columns.sql
-- ─────────────────────────────────────────────────────────────────────────────
-- Phase 0: Adds pgvector embedding columns to the three tables used by ARIA RAG.
--
-- Column sizes:
--   384 dimensions = all-MiniLM-L6-v2  (Phase 1)
--   Widened to vector(4096) in a future migration when Qwen3-Embedding-8B is adopted
--
-- IVFFlat index tuning:
--   lists=10  for oem_schedules  (48 rows at Phase 1 — very small corpus)
--   lists=100 for service_records and invoices  (high row counts expected)
--   Increase lists to sqrt(row_count) when any table exceeds 1,000 rows.
--
-- Safe to run on a live PostgreSQL database — all statements use IF NOT EXISTS.
-- No existing columns are modified or dropped.
-- ─────────────────────────────────────────────────────────────────────────────

-- Enable pgvector extension (idempotent — safe if already enabled)
CREATE EXTENSION IF NOT EXISTS vector;

-- ── oem_schedules ─────────────────────────────────────────────────────────────
-- Embedding of: service_type + notes + citation  (build_oem_chunk)
ALTER TABLE oem_schedules
    ADD COLUMN IF NOT EXISTS content_embedding vector(384);

CREATE INDEX IF NOT EXISTS idx_oem_content_embedding
    ON oem_schedules
    USING ivfflat (content_embedding vector_cosine_ops)
    WITH (lists = 10);

COMMENT ON COLUMN oem_schedules.content_embedding IS
    'all-MiniLM-L6-v2 384-dim embedding of (service_type + notes + citation). '
    'Populated by embedding_service.py batch job. '
    'Used by ARIA chat_retrieval.py for semantic OEM schedule lookup.';

-- ── service_records ───────────────────────────────────────────────────────────
-- Embedding of: service_type + service_description  (build_service_chunk)
ALTER TABLE service_records
    ADD COLUMN IF NOT EXISTS description_embedding vector(384);

CREATE INDEX IF NOT EXISTS idx_service_description_embedding
    ON service_records
    USING ivfflat (description_embedding vector_cosine_ops)
    WITH (lists = 100);

COMMENT ON COLUMN service_records.description_embedding IS
    'all-MiniLM-L6-v2 384-dim embedding of (service_type + service_description). '
    'Populated by embedding_service.py on ServiceRecord creation. '
    'Used by ARIA chat_retrieval.py for semantic service history lookup.';

-- ── invoices ──────────────────────────────────────────────────────────────────
-- Embedding of: ocr_text (full invoice OCR)  (build_invoice_chunk)
-- Note: Invoice embedding is a Phase 2 deliverable. Column is added now
-- so the schema is stable, but the embedding job runs in Phase 2.
ALTER TABLE invoices
    ADD COLUMN IF NOT EXISTS ocr_embedding vector(384);

CREATE INDEX IF NOT EXISTS idx_invoice_ocr_embedding
    ON invoices
    USING ivfflat (ocr_embedding vector_cosine_ops)
    WITH (lists = 100);

COMMENT ON COLUMN invoices.ocr_embedding IS
    'all-MiniLM-L6-v2 384-dim embedding of ocr_text. '
    'Populated at is_confirmed=True transition (Phase 2 async hook). '
    'NULL for invoices confirmed before Phase 2 — backfill with eval_retrieval.py.';

-- ── embedding_model_versions config table ─────────────────────────────────────
-- Tracks which embedding model produced the vectors in each table.
-- Used by migration gate evaluation (eval_retrieval.py) to compare models.
CREATE TABLE IF NOT EXISTS embedding_model_versions (
    id           SERIAL PRIMARY KEY,
    table_name   VARCHAR(100) NOT NULL,
    model_name   VARCHAR(100) NOT NULL DEFAULT 'all-MiniLM-L6-v2',
    dimensions   INTEGER      NOT NULL DEFAULT 384,
    applied_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    notes        TEXT         NULL
);

INSERT INTO embedding_model_versions (table_name, model_name, dimensions, notes)
VALUES
    ('oem_schedules',   'all-MiniLM-L6-v2', 384, 'Phase 1 initial embedding'),
    ('service_records', 'all-MiniLM-L6-v2', 384, 'Phase 1 initial embedding'),
    ('invoices',        'all-MiniLM-L6-v2', 384, 'Phase 2 — column added in Phase 1, embedding runs in Phase 2')
ON CONFLICT DO NOTHING;

COMMENT ON TABLE embedding_model_versions IS
    'Config table: tracks which embedding model version produced the vector columns '
    'in each table. Used by eval_retrieval.py migration gate comparison. '
    'Update this table BEFORE running a re-embedding migration.';
