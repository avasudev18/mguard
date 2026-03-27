"""
app/api/chat.py
================
Phase 1 — ARIA chat endpoint.

Route: POST /api/chat/ask
Auth:  Bearer JWT (existing auth.py)

Request body:
    {
        "vehicle_id": int,
        "question":   str,
        "current_mileage": int | null,
        "conversation_history": [{"role": "user"|"assistant", "content": str}]  // optional, max 10 turns
    }

Response:
    {
        "response":    str,     // ARIA's answer
        "citations":   [...],   // source citations
        "escalate":    bool,    // true = show "Connect to Support" button
        "interaction_id": int,  // chat_interactions.id for frontend feedback
        "latency_ms":  int
    }

Pipeline:
    1. Validate vehicle ownership
    2. Sanitize user question (prompt injection defence)
    3. Retrieve top-k chunks via chat_retrieval.py
    4. Assemble prompt via chat_context_builder.py
    5. Call llm_service.answer_chat_question()
    6. Write ChatInteraction audit row
    7. Return response
"""

import logging
import re
import time
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.models.models import Vehicle
from app.models.phase2_models import ChatInteraction
from app.services.embedding_service import embedding_service
from app.services.chat_retrieval import chat_retrieval
from app.services.chat_context_builder import chat_context_builder
from app.services.llm_service import llm_service
from app.utils.auth import get_current_active_user
from app.utils.database import get_db

log = logging.getLogger(__name__)
router = APIRouter()

# Input constraints
_MAX_QUESTION_CHARS    = 1000
_MAX_HISTORY_TURNS     = 10
_MAX_HISTORY_MSG_CHARS = 500

# Injection pattern (same as llm_service.py)
_INJECTION_RE = re.compile(
    r'ignore\s+(all\s+)?(previous|prior|above)\s+instructions?'
    r'|disregard\s+(all\s+)?(previous|prior|above|your)'
    r'|you\s+are\s+now\s+(?!a\s+vehicle)'
    r'|act\s+as\s+(if\s+you\s+are|a\s+)'
    r'|system\s*:\s*(you|your|ignore|forget)'
    r'|output\s+(your\s+)?(full\s+)?(system\s+prompt|instructions)',
    re.IGNORECASE
)

ESCALATION_RESPONSE = (
    "I want to make sure you get the most accurate answer for this. "
    "I don't have enough information in my knowledge base to answer this "
    "confidently right now. A MaintenanceGuard support agent can investigate "
    "further and provide a verified response."
)


# ── Request / Response schemas ────────────────────────────────────────────────

class ConversationTurn(BaseModel):
    role: str     # "user" | "assistant"
    content: str  = Field(..., max_length=_MAX_HISTORY_MSG_CHARS)


class ChatRequest(BaseModel):
    vehicle_id:           Optional[int] = None   # null = fleet overview / no vehicle selected
    question:             str  = Field(..., min_length=1, max_length=_MAX_QUESTION_CHARS)
    current_mileage:      Optional[int] = None
    conversation_history: List[ConversationTurn] = Field(default_factory=list, max_length=_MAX_HISTORY_TURNS)


class CitationOut(BaseModel):
    source: str
    text:   str


class ChatResponse(BaseModel):
    response:       str
    citations:      List[CitationOut]
    escalate:       bool
    interaction_id: Optional[int]
    latency_ms:     int


# ── Endpoint ──────────────────────────────────────────────────────────────────

@router.post("/ask", response_model=ChatResponse)
async def ask_aria(
    request: ChatRequest,
    db:           Session = Depends(get_db),
    current_user  = Depends(get_current_active_user),
):
    """
    ARIA chat endpoint. Authenticated users only.
    Vehicle must be owned by the requesting user.
    """
    t_start = time.time()

    # ── 1. Validate vehicle ownership ─────────────────────────────────────────
    vehicle = None
    if request.vehicle_id is not None:
        vehicle = db.query(Vehicle).filter(
            Vehicle.id == request.vehicle_id,
            Vehicle.owner_id == current_user.id,
        ).first()
        if not vehicle:
            raise HTTPException(status_code=404, detail="Vehicle not found")

    # If no vehicle selected, return a helpful prompt instead of crashing
    if vehicle is None:
        return ChatResponse(
            response="Please select a vehicle from your dashboard first. ARIA answers are specific to your vehicle's OEM schedule and service history.",
            citations=[],
            escalate=False,
            interaction_id=None,
            latency_ms=0,
        )

    # ── 2. Sanitize question ───────────────────────────────────────────────────
    question = request.question.strip()
    if _INJECTION_RE.search(question):
        log.warning(
            "[chat] Injection pattern in question from user_id=%s: %r",
            current_user.id, question[:100]
        )
        question = "[question removed: policy violation]"

    # ── 3. Retrieve chunks ────────────────────────────────────────────────────
    retrieval = chat_retrieval.retrieve(
        query=question,
        vehicle_id=request.vehicle_id,
        vehicle=vehicle,
        db=db,
    )

    # ── 4. Assemble context ───────────────────────────────────────────────────
    context = chat_context_builder.build(
        query=question,
        retrieval=retrieval,
        vehicle=vehicle,
        current_mileage=request.current_mileage,
    )

    # ── 5. Escalate immediately if no context ─────────────────────────────────
    if context.escalate:
        interaction = _write_interaction(
            db=db,
            user_id=current_user.id,
            vehicle_id=request.vehicle_id,
            query=question,
            response=ESCALATION_RESPONSE,
            chunk_ids=[],
            citations=[],
            escalation_triggered=True,
            retrieval_latency_ms=retrieval.retrieval_latency_ms,
            llm_latency_ms=0,
            total_latency_ms=int((time.time() - t_start) * 1000),
        )
        return ChatResponse(
            response=ESCALATION_RESPONSE,
            citations=[],
            escalate=True,
            interaction_id=interaction.id if interaction else None,
            latency_ms=int((time.time() - t_start) * 1000),
        )

    # ── 6. Call LLM ───────────────────────────────────────────────────────────
    llm_result = await llm_service.answer_chat_question(
        question=question,
        system_prompt=context.system_prompt,
        user_message=context.user_message,
        db=db,
        user_id=current_user.id,
    )

    if not llm_result["success"]:
        # LLM call failed — escalate gracefully
        interaction = _write_interaction(
            db=db,
            user_id=current_user.id,
            vehicle_id=request.vehicle_id,
            query=question,
            response=ESCALATION_RESPONSE,
            chunk_ids=retrieval.chunk_ids,
            citations=[],
            escalation_triggered=True,
            retrieval_latency_ms=retrieval.retrieval_latency_ms,
            llm_latency_ms=0,
            total_latency_ms=int((time.time() - t_start) * 1000),
        )
        return ChatResponse(
            response=ESCALATION_RESPONSE,
            citations=[],
            escalate=True,
            interaction_id=interaction.id if interaction else None,
            latency_ms=int((time.time() - t_start) * 1000),
        )

    response_text = llm_result["response"]
    escalate      = llm_result["escalate"]
    if escalate:
        response_text = ESCALATION_RESPONSE

    # ── 7. Write audit row ────────────────────────────────────────────────────
    citations_out = [{"source": c.source, "text": c.text} for c in context.citations]
    total_ms      = int((time.time() - t_start) * 1000)

    interaction = _write_interaction(
        db=db,
        user_id=current_user.id,
        vehicle_id=request.vehicle_id,
        query=question,
        response=response_text,
        chunk_ids=retrieval.chunk_ids,
        citations=citations_out,
        escalation_triggered=escalate,
        retrieval_latency_ms=retrieval.retrieval_latency_ms,
        llm_latency_ms=llm_result["llm_latency_ms"],
        total_latency_ms=total_ms,
    )

    return ChatResponse(
        response=response_text,
        citations=[CitationOut(**c) for c in citations_out],
        escalate=escalate,
        interaction_id=interaction.id if interaction else None,
        latency_ms=total_ms,
    )


# ── Helper ────────────────────────────────────────────────────────────────────

def _write_interaction(
    db, user_id, vehicle_id, query, response,
    chunk_ids, citations, escalation_triggered,
    retrieval_latency_ms, llm_latency_ms, total_latency_ms,
) -> Optional[ChatInteraction]:
    """Write a ChatInteraction audit row. Never raises — failures are logged."""
    try:
        row = ChatInteraction(
            user_id=user_id,
            vehicle_id=vehicle_id,
            query=query[:2000],
            response=(response or "")[:4000],
            retrieved_chunk_ids=chunk_ids,
            citations=citations,
            escalation_triggered=escalation_triggered,
            retrieval_latency_ms=retrieval_latency_ms,
            llm_latency_ms=llm_latency_ms,
            total_latency_ms=total_latency_ms,
        )
        db.add(row)
        db.commit()
        db.refresh(row)
        return row
    except Exception as e:
        log.error("[chat] Failed to write ChatInteraction: %s", e)
        db.rollback()
        return None
