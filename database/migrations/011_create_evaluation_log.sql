-- migrations/011_create_evaluation_log.sql
-- ─────────────────────────────────────────────────────────────────────────────
-- Creates the evaluation_log table used by the RAGAs nightly evaluation job
-- (scripts/eval_ragas.py) and the retrieval evaluation script
-- (scripts/eval_retrieval.py).
--
-- Each row represents one evaluation run — either a full golden-dataset
-- retrieval batch or a single RAGAs response evaluation.
--
-- Safe to run on a live PostgreSQL database — CREATE TABLE IF NOT EXISTS.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS evaluation_log (
    id                      SERIAL PRIMARY KEY,

    -- Which run produced this row
    run_type                VARCHAR(30)     NOT NULL,
    -- 'ragas_nightly'    — nightly RAGAs evaluation job (response quality)
    -- 'retrieval_golden' — golden dataset precision/recall run
    -- 'migration_gate'   — pre/post embedding model migration comparison

    -- Embedding model in use at the time of the run (from embedding_model_versions)
    embedding_model         VARCHAR(100)    NOT NULL DEFAULT 'all-MiniLM-L6-v2',

    -- The query / question evaluated (truncated to 1000 chars for storage)
    query                   TEXT            NULL,

    -- ── Retrieval layer metrics ───────────────────────────────────────────────
    -- IDs of chunks returned by pgvector (JSON array of integers)
    retrieved_chunk_ids     JSONB           NULL,
    -- IDs of chunks expected by the golden dataset (JSON array of integers)
    expected_chunk_ids      JSONB           NULL,

    precision_at_5          NUMERIC(5,4)    NULL,   -- 0.0000 – 1.0000
    recall_at_5             NUMERIC(5,4)    NULL,
    mrr                     NUMERIC(5,4)    NULL,   -- mean reciprocal rank

    -- ── Response layer metrics (RAGAs) ───────────────────────────────────────
    -- The full ARIA response text (truncated to 4000 chars)
    response_text           TEXT            NULL,

    faithfulness            NUMERIC(5,4)    NULL,   -- 0.0 = hallucinated, 1.0 = fully grounded
    answer_relevance        NUMERIC(5,4)    NULL,   -- how well response addresses the query
    context_precision       NUMERIC(5,4)    NULL,   -- fraction of retrieved chunks actually used
    context_recall          NUMERIC(5,4)    NULL,   -- fraction of needed info present in context

    -- ── Run-level aggregates (populated for batch/golden runs) ───────────────
    -- avg across all queries in this batch run
    batch_avg_precision     NUMERIC(5,4)    NULL,
    batch_avg_recall        NUMERIC(5,4)    NULL,
    batch_avg_faithfulness  NUMERIC(5,4)    NULL,
    batch_avg_relevance     NUMERIC(5,4)    NULL,

    -- Number of queries in the batch (for retrieval golden runs)
    batch_size              INTEGER         NULL,

    -- ── Metadata ─────────────────────────────────────────────────────────────
    golden_dataset_version  VARCHAR(20)     NULL,   -- e.g. 'v1', 'v2'
    notes                   TEXT            NULL,   -- e.g. 'post-Qwen3 migration'
    created_at              TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

-- Index for dashboard time-series queries
CREATE INDEX IF NOT EXISTS idx_eval_log_created_at
    ON evaluation_log (created_at DESC);

-- Index for filtering by run type
CREATE INDEX IF NOT EXISTS idx_eval_log_run_type
    ON evaluation_log (run_type, created_at DESC);

-- Index for filtering by embedding model (migration comparison queries)
CREATE INDEX IF NOT EXISTS idx_eval_log_embedding_model
    ON evaluation_log (embedding_model, run_type, created_at DESC);

COMMENT ON TABLE evaluation_log IS
    'RAGAs and retrieval precision/recall evaluation results. '
    'Written by scripts/eval_ragas.py and scripts/eval_retrieval.py. '
    'Read by the admin /api/admin/metrics/aria-quality endpoint. '
    'Never modified after insert — append-only audit trail.';
