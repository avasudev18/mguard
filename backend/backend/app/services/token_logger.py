"""
backend/app/services/token_logger.py

Lightweight helper for logging LLM API token usage.
Called by llm_service.py after every messages.create() call.

CRITICAL: This function MUST NEVER raise an exception.
A DB outage or schema mismatch must never crash an invoice upload
or recommendation request. All errors are logged to stderr only.
"""

import os
import sys
from datetime import datetime
from decimal import Decimal
from typing import Optional

from sqlalchemy.orm import Session


# ── Pricing constants — configurable via .env ─────────────────────────────────
# Prices are per 1,000,000 tokens (per-million pricing)

def _price(env_key: str, default: float) -> float:
    try:
        return float(os.getenv(env_key, str(default)))
    except (TypeError, ValueError):
        return default


PRICING = {
    # Claude 3 Haiku — fast, cheap, used for invoice text + recommendations
    "claude-3-haiku-20240307": {
        "input":  _price("CLAUDE_HAIKU_INPUT_PRICE_PER_M",  0.25),
        "output": _price("CLAUDE_HAIKU_OUTPUT_PRICE_PER_M", 1.25),
    },
    # Claude Opus — vision model, used for invoice image extraction
    "claude-opus-4-6": {
        "input":  _price("CLAUDE_OPUS_INPUT_PRICE_PER_M",  15.00),
        "output": _price("CLAUDE_OPUS_OUTPUT_PRICE_PER_M", 75.00),
    },
    # Claude Sonnet — future use
    "claude-sonnet-4-6": {
        "input":  _price("CLAUDE_SONNET_INPUT_PRICE_PER_M",  3.00),
        "output": _price("CLAUDE_SONNET_OUTPUT_PRICE_PER_M", 15.00),
    },
}

# Fallback pricing (Haiku rates) for any unknown model
_FALLBACK = PRICING["claude-3-haiku-20240307"]


def _compute_cost(model_name: str, input_tokens: int, output_tokens: int) -> float:
    """Calculate cost in USD for a given model and token counts."""
    rates = PRICING.get(model_name, _FALLBACK)
    cost = (input_tokens / 1_000_000 * rates["input"]) + \
           (output_tokens / 1_000_000 * rates["output"])
    return round(cost, 6)


def log_token_usage(
    db: Session,
    user_id: Optional[int],
    agent_name: str,
    model_name: str,
    input_tokens: int,
    output_tokens: int,
    duration_ms: Optional[int] = None,
) -> None:
    """
    Write one TokenUsageLog row to the database.

    Parameters
    ----------
    db            : SQLAlchemy session — must be the same session as the caller
    user_id       : app_users.id of the user who triggered the call, or None
    agent_name    : 'invoice_parser' | 'invoice_vision' | 'recommendation'
    model_name    : exact Anthropic model string
    input_tokens  : message.usage.input_tokens from the API response
    output_tokens : message.usage.output_tokens from the API response
    duration_ms   : wall-clock time of the API call in milliseconds (optional)

    This function never raises. All exceptions are caught and printed to stderr.
    """
    try:
        # Import here to avoid circular import at module load time
        from app.models.phase2_models import TokenUsageLog

        cost = _compute_cost(model_name, input_tokens, output_tokens)

        log = TokenUsageLog(
            user_id=user_id,
            agent_name=agent_name,
            model_name=model_name,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            cost_usd=Decimal(str(cost)),
            request_duration_ms=duration_ms,
        )
        db.add(log)
        db.commit()

    except Exception as exc:  # noqa: BLE001
        # NEVER propagate — a failed token log must not crash the caller
        print(f"[token_logger] WARNING: failed to log token usage: {exc}", file=sys.stderr)
        try:
            db.rollback()
        except Exception:
            pass
