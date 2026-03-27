"""
app/services/embedding_service.py
===================================
Phase 0 — Core embedding service for ARIA RAG.

Wraps all-MiniLM-L6-v2 (sentence-transformers) for Phase 1.
Upgrade path: swap model name to Qwen3-Embedding-8B in Phase 2.
The rest of the codebase is model-agnostic — it calls embed() only.

Public API:
    embedding_service.embed(text: str) -> list[float]
    embedding_service.embed_batch(texts: list[str]) -> list[list[float]]
    embedding_service.build_oem_chunk(schedule: OEMSchedule) -> str
    embedding_service.build_service_chunk(record: ServiceRecord) -> str
    embedding_service.build_invoice_chunk(invoice: Invoice) -> str
    embedding_service.embed_oem_batch(db: Session) -> int
    embedding_service.embed_service_record(record: ServiceRecord, db: Session)

Architecture note (critical):
    This service produces ONLY raw vectors for storage and retrieval.
    It NEVER retrieves interval_miles or interval_months from vector results.
    All numeric OEM schedule values used for calculations are always
    fetched via direct SQL. See chat_retrieval.py for the separation.
"""

import logging
from typing import Optional

from sqlalchemy.orm import Session

log = logging.getLogger(__name__)


class EmbeddingService:
    """
    Singleton wrapper around sentence-transformers.

    Lazy-loads the model on first use — avoids slowing app startup
    and allows the service to degrade gracefully if sentence-transformers
    is not installed (returns None vectors, logs warning).
    """

    MODEL_NAME = "sentence-transformers/all-MiniLM-L6-v2"
    DIMENSIONS = 384

    def __init__(self):
        self._model = None

    def _load(self):
        """Lazy-load the model. Called on first embed() call."""
        if self._model is not None:
            return
        try:
            from sentence_transformers import SentenceTransformer
            self._model = SentenceTransformer(self.MODEL_NAME)
            log.info("[EmbeddingService] Loaded model: %s (%d dims)", self.MODEL_NAME, self.DIMENSIONS)
        except ImportError:
            log.error(
                "[EmbeddingService] sentence-transformers not installed. "
                "Run: pip install sentence-transformers. "
                "ARIA RAG will not function until this is resolved."
            )

    # ── Core embedding API ────────────────────────────────────────────────────

    def embed(self, text: str) -> Optional[list]:
        """
        Embed a single text string.
        Returns a list of 384 floats, or None if the model is unavailable.
        """
        self._load()
        if self._model is None:
            return None
        if not text or not text.strip():
            return None
        try:
            vec = self._model.encode(text.strip(), normalize_embeddings=True)
            return vec.tolist()
        except Exception as e:
            log.error("[EmbeddingService] embed() failed: %s", e)
            return None

    def embed_batch(self, texts: list) -> list:
        """
        Embed a list of texts in a single forward pass (more efficient than
        calling embed() in a loop for large batches).
        Returns a list of vectors in the same order as the input.
        Missing/empty texts produce None in the output list.
        """
        self._load()
        if self._model is None:
            return [None] * len(texts)
        if not texts:
            return []
        try:
            clean = [t.strip() if t and t.strip() else "" for t in texts]
            vecs = self._model.encode(clean, normalize_embeddings=True, batch_size=32)
            return [
                vecs[i].tolist() if clean[i] else None
                for i in range(len(texts))
            ]
        except Exception as e:
            log.error("[EmbeddingService] embed_batch() failed: %s", e)
            return [None] * len(texts)

    # ── Chunk builders ────────────────────────────────────────────────────────
    # These produce the text string that gets embedded for each record type.
    # The format is designed to maximize semantic retrieval quality for
    # automotive maintenance queries.

    def build_oem_chunk(self, schedule) -> str:
        """
        Build the text chunk for an OEMSchedule row.
        Format: "<year> <make> <model> <service_type>. <notes>. <citation>"
        """
        parts = [
            f"{schedule.year} {schedule.make} {schedule.model}",
            schedule.service_type,
        ]
        if schedule.notes:
            parts.append(schedule.notes)
        if schedule.citation:
            parts.append(schedule.citation)
        return ". ".join(p.strip() for p in parts if p and p.strip())

    def build_service_chunk(self, record) -> str:
        """
        Build the text chunk for a ServiceRecord row.
        Format: "<service_type>. <service_description>"
        """
        parts = [record.service_type]
        if record.service_description:
            parts.append(record.service_description)
        if record.shop_name:
            parts.append(f"at {record.shop_name}")
        return ". ".join(p.strip() for p in parts if p and p.strip())

    def build_invoice_chunk(self, invoice) -> str:
        """
        Build the text chunk for an Invoice row (Phase 2).
        Uses the full OCR text, truncated to 2,000 chars to stay within
        the model's 256-token effective window (all-MiniLM-L6-v2).
        """
        text = (invoice.ocr_text or "").strip()
        if len(text) > 2000:
            text = text[:2000]
        return text

    # ── Batch embed jobs ──────────────────────────────────────────────────────

    def embed_oem_batch(self, db: Session) -> int:
        """
        Batch-embed all OEMSchedule rows that have a NULL content_embedding.
        Called on app startup (Phase 0) and after new OEM data is imported.
        Returns the number of rows updated.

        Architecture note: this is the only write path for OEM embeddings.
        It uses bulk batch encoding for efficiency.
        """
        from app.models.models import OEMSchedule

        rows = db.query(OEMSchedule).filter(OEMSchedule.content_embedding == None).all()  # noqa: E711
        if not rows:
            log.info("[EmbeddingService] embed_oem_batch: all OEM rows already embedded")
            return 0

        log.info("[EmbeddingService] embed_oem_batch: embedding %d OEM rows", len(rows))
        chunks = [self.build_oem_chunk(r) for r in rows]
        vectors = self.embed_batch(chunks)

        updated = 0
        for row, vec in zip(rows, vectors):
            if vec is not None:
                row.content_embedding = vec
                updated += 1

        db.commit()
        log.info("[EmbeddingService] embed_oem_batch: committed %d embeddings", updated)
        return updated

    def embed_service_record(self, record, db: Session) -> bool:
        """
        Embed a single ServiceRecord and persist the vector.
        Called by recommendations.py / service_history.py after record creation.
        Returns True if embedding was written, False if model unavailable.
        """
        chunk = self.build_service_chunk(record)
        vec = self.embed(chunk)
        if vec is None:
            return False
        record.description_embedding = vec
        db.add(record)
        db.commit()
        return True

    def embed_invoice(self, invoice, db: Session) -> bool:
        """
        Embed an Invoice row's ocr_text and persist the vector.
        Phase 2 — called at is_confirmed=True transition in invoices.py.
        Returns True if embedding was written, False if model unavailable.
        """
        chunk = self.build_invoice_chunk(invoice)
        if not chunk:
            return False
        vec = self.embed(chunk)
        if vec is None:
            return False
        invoice.ocr_embedding = vec
        db.add(invoice)
        db.commit()
        return True


# Singleton — import and use directly:
#   from app.services.embedding_service import embedding_service
#   vec = embedding_service.embed("Oil Change 2020 Toyota Camry")
embedding_service = EmbeddingService()
