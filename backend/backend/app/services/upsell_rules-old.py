"""
upsell_rules.py
===============
Single source of truth for all upsell detection business logic.

Rules applied (in priority order):
  0. JUST PERFORMED — service done at 0 miles / 0 days ago is never flagged.

  1. ZERO-DOLLAR COURTESY EXEMPTION  — any line item with a $0 charge is a
     courtesy/complimentary service and must never be flagged as an upsell.

  1b. is_complimentary flag set by LLM extraction.

  2. RECALL EXEMPTION  — services whose name matches recall keywords are
     OEM/dealer responsibility and must never be flagged.

  3. SYNTHETIC OIL CHANGE INTERVAL OVERRIDE  — if a service is an oil change
     and the description indicates synthetic oil, the legitimate interval is
     7,000–10,000 miles (not the standard 5,000-mile OEM default).
     • Miles since last service < 4,000  → always flag as upsell.
     • 4,000 ≤ miles_since < 7,000       → flag as upsell (dealer recommending
                                            too early for synthetic).
     • 7,000 ≤ miles_since ≤ 10,000      → genuine service, not an upsell.
     • miles_since > 10,000              → genuine/overdue, not an upsell.
     ── NEW ──
     • ANNUAL TIME FLOOR: regardless of mileage, if days_since_last_service
       >= 365 the service is genuine/due. A low-mileage driver should never
       be told a once-a-year oil change is an upsell.

  4. OIL CHANGE STANDARD INTERVAL  — for non-synthetic oil changes the OEM
     interval applies. The threshold for flagging is miles_since < interval × 0.85.
     ── NEW ──
     • ANNUAL TIME FLOOR: same as Rule 3 — if days_since >= 365, the service
       is genuine regardless of mileage.

  5. SEVERE DRIVING CONDITION INTERVAL OVERRIDE  — NEW RULE.
     When the caller passes driving_condition="severe", oil changes become due
     at a tighter mileage band (SEVERE_OIL_MAX_GENUINE_MILES).  If the OEM
     severe interval is provided it takes precedence; otherwise the built-in
     constant is used.
     Applies to Rules 3 and 4 only (synthetic and standard oil changes).
     Non-oil-change services are governed entirely by their OEM severe interval
     rows, which are selected upstream in recommendations.py.

  6. GENERAL OEM INTERVAL RULE  — all other service types: flag if performed
     at less than 85% of the OEM-recommended interval (miles or months).
"""

from __future__ import annotations

import re
from typing import Optional

# ── Keyword sets ──────────────────────────────────────────────────────────────

_RECALL_KEYWORDS: set[str] = {
    "recall",
    "safety",
    "campaign",
    "nhtsa",
    "tsb",
    "field action",
}

_SYNTHETIC_KEYWORDS: set[str] = {
    "synthetic",
    "full synthetic",
    "full-synthetic",
    "synth",
    "0w-20",
    "0w20",
    "5w-30 syn",
    "5w30 syn",
    "0w-16",
    "0w16",
}

_OIL_CHANGE_KEYWORDS: set[str] = {
    "oil change",
    "oil & filter",
    "oil and filter",
    "lube oil",
    "lube, oil",
    "oil chng",
    "oil svc",
    "oil service",
}

_COURTESY_KEYWORDS: set[str] = {
    "complimentary",
    "courtesy",
    "free inspection",
    "multi-point",
    "multi point",
    "multipoint",
    "inspection",
    "recall check",
    "floor mat",
    "vehicle check",
    "safety check",
}

# ── Interval constants ────────────────────────────────────────────────────────

# Synthetic oil: flag if dealer recommends before this threshold (miles).
SYNTHETIC_OIL_UPSELL_THRESHOLD_MILES = 4_000

# Synthetic oil: genuine service range (miles).
SYNTHETIC_OIL_MIN_GENUINE_MILES = 7_000
SYNTHETIC_OIL_MAX_GENUINE_MILES = 10_000

# General OEM tolerance: flag if service performed before 85% of interval.
OEM_INTERVAL_TOLERANCE = 0.85

# Inspection services: only flag if they have a non-zero charge AND were
# performed at an obviously short interval.
INSPECTION_MIN_MILES_TO_FLAG = 5_000

# ── NEW: Annual time floor (Rules 3 & 4 — oil changes only) ──────────────────
# If an oil change has not been performed for 365+ days it is always genuine,
# regardless of mileage.  This protects low-mileage drivers (e.g. <7,500 mi/yr)
# from having a once-a-year oil change incorrectly flagged as an upsell.
# Source: Mile High Honda — "change oil at least once a year if you do not
# reach 7,500 miles within a year."
OIL_CHANGE_ANNUAL_DAYS_FLOOR = 365

# ── NEW: Severe driving condition oil change ceiling (Rule 5) ─────────────────
# Under severe driving conditions (stop-and-go traffic, mountainous terrain,
# extreme temperatures) oil degrades faster.  The accepted industry guidance
# places the genuine-service ceiling at 7,000 miles for severe use.
# If the caller supplies an explicit OEM severe interval it takes precedence.
# Source: general OEM severe-duty guidance; 5,000–7,000-mile range.
SEVERE_OIL_MAX_GENUINE_MILES = 7_000


# ── Helper predicates ─────────────────────────────────────────────────────────

def _normalise(text: str) -> str:
    """Lower-case, collapse whitespace."""
    return re.sub(r"\s+", " ", (text or "").lower().strip())


def _matches_any(text: str, keywords: set[str]) -> bool:
    norm = _normalise(text)
    return any(kw in norm for kw in keywords)


def _is_oil_change(service_type: str, service_description: str = "") -> bool:
    return _matches_any(service_type, _OIL_CHANGE_KEYWORDS) or \
           _matches_any(service_description, _OIL_CHANGE_KEYWORDS)


def _is_synthetic(service_type: str, service_description: str = "") -> bool:
    return _matches_any(service_type, _SYNTHETIC_KEYWORDS) or \
           _matches_any(service_description, _SYNTHETIC_KEYWORDS)


def _is_recall(service_type: str, service_description: str = "") -> bool:
    return _matches_any(service_type, _RECALL_KEYWORDS) or \
           _matches_any(service_description, _RECALL_KEYWORDS)


def _is_courtesy_type(service_type: str, service_description: str = "") -> bool:
    return _matches_any(service_type, _COURTESY_KEYWORDS) or \
           _matches_any(service_description, _COURTESY_KEYWORDS)


def _is_zero_dollar(line_total: Optional[float], unit_price: Optional[float]) -> bool:
    if line_total is not None:
        return abs(line_total) < 0.01
    if unit_price is not None:
        return abs(unit_price) < 0.01
    return False


# ── Public API ────────────────────────────────────────────────────────────────

class UpsellDecision:
    """
    Result of evaluate_upsell().

    Attributes
    ----------
    is_upsell : bool
        True → flag as upsell / not_needed.
    reason    : str | None
        Human-readable explanation for the flag (or None if not an upsell).
    skip_flag : bool
        True → this service is exempt from upsell detection entirely
        (e.g. recall, courtesy, zero-dollar).  The LLM should NOT receive
        this as an upsell hint and should NOT mark it is_upsell_flag=True.
    override_interval_miles : int | None
        When set, the caller should use this interval instead of the OEM
        default (e.g. synthetic oil override → 7,000 mi).
    condition_note : str | None
        Optional human-readable note explaining why a special condition
        (severe driving, annual floor) affected the decision.
    """

    __slots__ = ("is_upsell", "reason", "skip_flag", "override_interval_miles", "condition_note")

    def __init__(
        self,
        is_upsell: bool = False,
        reason: str | None = None,
        skip_flag: bool = False,
        override_interval_miles: int | None = None,
        condition_note: str | None = None,
    ):
        self.is_upsell = is_upsell
        self.reason = reason
        self.skip_flag = skip_flag
        self.override_interval_miles = override_interval_miles
        self.condition_note = condition_note

    def __repr__(self) -> str:
        return (
            f"UpsellDecision(is_upsell={self.is_upsell}, skip_flag={self.skip_flag}, "
            f"reason={self.reason!r}, override_interval={self.override_interval_miles}, "
            f"condition_note={self.condition_note!r})"
        )


def evaluate_upsell(
    service_type: str,
    service_description: str = "",
    line_total: Optional[float] = None,
    unit_price: Optional[float] = None,
    miles_since_last_service: Optional[int] = None,
    days_since_last_service: Optional[int] = None,
    oem_interval_miles: Optional[int] = None,
    oem_interval_months: Optional[int] = None,
    is_complimentary: bool = False,
    is_labor: bool = False,
    driving_condition: str = "normal",
    prior_service_description: str = "",
) -> UpsellDecision:
    """
    Evaluate whether a service line item is a likely upsell.

    Parameters
    ----------
    service_type              : Normalised service name from invoice/record.
    service_description       : Raw description text from the CURRENT invoice line item.
    line_total                : Dollar amount for this line item (None if unknown).
    unit_price                : Unit price (used if line_total is None).
    miles_since_last_service  : Miles driven since the same service was last done.
    days_since_last_service   : Calendar days since the same service was last done.
    oem_interval_miles        : OEM-recommended mileage interval.
    oem_interval_months       : OEM-recommended time interval (months).
    is_complimentary          : LLM-extracted flag — True when invoice says free/$0.
    is_labor                  : True for labour-only line items on dealer invoices.
    driving_condition         : "normal" (default) or "severe".  When "severe",
                                oil change intervals are tightened per Rule 5.
                                IMPORTANT: this parameter must always be sourced
                                from the OEM-row driving_condition that was
                                selected upstream in recommendations.py — it must
                                NEVER come from a vector-retrieval path.
    prior_service_description : Raw description text from the PREVIOUS service record
                                for this service type.  Used in Rule 3 to detect an
                                oil-type switch: if the current invoice is synthetic
                                but the prior service was conventional, the synthetic
                                interval threshold does not apply — the current service
                                is the first synthetic fill and must be treated as
                                genuine regardless of mileage since last service.

    Returns
    -------
    UpsellDecision
    """

    # ── Rule 0: JUST PERFORMED ────────────────────────────────────────────────
    just_performed = (
        (miles_since_last_service is not None and miles_since_last_service == 0) or
        (days_since_last_service is not None and days_since_last_service == 0)
    )
    if just_performed:
        return UpsellDecision(
            is_upsell=False,
            skip_flag=True,
            reason=None,
        )

    # ── Rule 1: Zero-dollar courtesy exemption ────────────────────────────────
    if _is_zero_dollar(line_total, unit_price) and not is_labor:
        return UpsellDecision(
            is_upsell=False,
            skip_flag=True,
            reason=None,
        )

    # ── Rule 1b: is_complimentary flag set by LLM extraction ─────────────────
    if is_complimentary and not is_labor and line_total is None and unit_price is None:
        return UpsellDecision(
            is_upsell=False,
            skip_flag=True,
            reason=None,
        )

    # ── Rule 2: Recall / safety service exemption ─────────────────────────────
    if _is_recall(service_type, service_description):
        return UpsellDecision(
            is_upsell=False,
            skip_flag=True,
            reason=None,
        )

    # ── Rules 3 & 4: Oil change path ─────────────────────────────────────────
    if _is_oil_change(service_type, service_description):

        # ── NEW: Annual time floor (applies to ALL oil change sub-rules) ──────
        # If the vehicle has gone 365+ days without an oil change it is always
        # a genuine service, regardless of mileage accumulated.  This protects
        # low-mileage drivers from false-positive upsell flags.
        if (
            days_since_last_service is not None
            and days_since_last_service >= OIL_CHANGE_ANNUAL_DAYS_FLOOR
        ):
            years = round(days_since_last_service / 365, 1)
            return UpsellDecision(
                is_upsell=False,
                condition_note=(
                    f"Oil change is genuine: {years} year(s) since last service "
                    f"({days_since_last_service} days ≥ {OIL_CHANGE_ANNUAL_DAYS_FLOOR}-day annual floor). "
                    f"Annual oil change is recommended regardless of mileage."
                ),
            )

        # ── NEW: Severe driving condition ceiling (Rule 5) ────────────────────
        # Under severe conditions the effective ceiling for a genuine oil change
        # is SEVERE_OIL_MAX_GENUINE_MILES (7,000 mi) unless the OEM provides a
        # tighter severe interval explicitly.
        if driving_condition == "severe":
            # Prefer the OEM-supplied severe interval when available and tighter.
            severe_ceiling = SEVERE_OIL_MAX_GENUINE_MILES
            if oem_interval_miles is not None and oem_interval_miles < severe_ceiling:
                severe_ceiling = oem_interval_miles

            if miles_since_last_service is None:
                # No prior record — cannot evaluate; do not flag.
                return UpsellDecision(
                    is_upsell=False,
                    condition_note="Severe driving condition noted; no prior mileage record to evaluate.",
                )

            threshold = severe_ceiling * OEM_INTERVAL_TOLERANCE
            if miles_since_last_service < threshold:
                miles_remaining = severe_ceiling - miles_since_last_service
                return UpsellDecision(
                    is_upsell=True,
                    override_interval_miles=severe_ceiling,
                    condition_note=(
                        f"Severe driving condition: effective oil change interval is "
                        f"{severe_ceiling:,} miles (stop-and-go traffic, mountainous terrain, "
                        f"or extreme temperatures shorten oil life)."
                    ),
                    reason=(
                        f"Oil change performed {miles_since_last_service:,} miles after the last "
                        f"service. Under severe driving conditions the recommended interval is "
                        f"{severe_ceiling:,} miles ({miles_remaining:,} miles remaining). "
                        f"This is a likely upsell."
                    ),
                )
            # miles_since >= threshold under severe conditions → genuine.
            return UpsellDecision(
                is_upsell=False,
                override_interval_miles=severe_ceiling,
                condition_note=(
                    f"Severe driving condition: {miles_since_last_service:,} miles since last "
                    f"oil change — at or beyond the {severe_ceiling:,}-mile severe-duty interval."
                ),
            )

        # ── Rule 3: Synthetic oil change interval override ────────────────────
        if _is_synthetic(service_type, service_description):

            # ── Oil-type switch guard ─────────────────────────────────────────
            # If the PRIOR service was conventional (no synthetic keywords in its
            # description) and the CURRENT service is synthetic, this is the first
            # synthetic fill — the mileage gap since the last *conventional* service
            # is irrelevant to the synthetic interval.  Flag as genuine immediately.
            prior_was_conventional = (
                prior_service_description != ""
                and not _is_synthetic("", prior_service_description)
            )
            if prior_was_conventional:
                return UpsellDecision(
                    is_upsell=False,
                    condition_note=(
                        "Oil type switch detected: prior service was conventional oil. "
                        "Current synthetic fill is the first of its kind — synthetic "
                        "interval threshold does not apply."
                    ),
                )

            if miles_since_last_service is None:
                return UpsellDecision(is_upsell=False)

            if miles_since_last_service < SYNTHETIC_OIL_UPSELL_THRESHOLD_MILES:
                return UpsellDecision(
                    is_upsell=True,
                    skip_flag=False,
                    override_interval_miles=SYNTHETIC_OIL_MIN_GENUINE_MILES,
                    reason=(
                        f"Synthetic oil change performed only {miles_since_last_service:,} miles "
                        f"after the last service. Synthetic oil should last "
                        f"{SYNTHETIC_OIL_MIN_GENUINE_MILES:,}–{SYNTHETIC_OIL_MAX_GENUINE_MILES:,} miles. "
                        f"This is a likely upsell."
                    ),
                )

            if miles_since_last_service < SYNTHETIC_OIL_MIN_GENUINE_MILES:
                return UpsellDecision(
                    is_upsell=True,
                    skip_flag=False,
                    override_interval_miles=SYNTHETIC_OIL_MIN_GENUINE_MILES,
                    reason=(
                        f"Synthetic oil change at {miles_since_last_service:,} miles since last "
                        f"service. Synthetic oil is genuine from "
                        f"{SYNTHETIC_OIL_MIN_GENUINE_MILES:,} miles onward — "
                        f"recommending it at {miles_since_last_service:,} miles is too early."
                    ),
                )

            # ≥ 7,000 miles → genuine.
            return UpsellDecision(
                is_upsell=False,
                override_interval_miles=SYNTHETIC_OIL_MIN_GENUINE_MILES,
            )

        # ── Rule 4: Standard oil change interval ─────────────────────────────
        if miles_since_last_service is None or oem_interval_miles is None:
            return UpsellDecision(is_upsell=False)

        threshold = oem_interval_miles * OEM_INTERVAL_TOLERANCE
        if miles_since_last_service < threshold:
            miles_remaining = oem_interval_miles - miles_since_last_service
            return UpsellDecision(
                is_upsell=True,
                reason=(
                    f"Oil change performed {miles_since_last_service:,} miles after the last "
                    f"service, but the OEM interval is {oem_interval_miles:,} miles "
                    f"({miles_remaining:,} miles remaining). This may be an upsell."
                ),
            )
        return UpsellDecision(is_upsell=False)

    # ── Rule 6: General OEM interval rule ─────────────────────────────────────
    #
    # OEM schedules define service intervals as "whichever comes first" — a
    # service is DUE when either the mileage OR time threshold is hit first.
    #
    # Upsell detection is the INVERSE operation: we want to flag a service that
    # was performed unnecessarily early. The correct flag logic depends on how
    # many criteria the OEM interval carries:
    #
    #   Dual-criterion  (miles AND months both defined):
    #     → Flag only if too soon on BOTH dimensions simultaneously.
    #     → Rationale: if the driver legitimately reached one threshold (e.g. a
    #       high-mileage driver hits the miles threshold in a short time), the
    #       service was genuinely due regardless of where the time dimension sits.
    #       Flagging on time alone would produce a false positive for any driver
    #       who drives more than the "average" implied by the OEM time interval.
    #
    #   Single-criterion (only miles OR only months defined):
    #     → Flag if the single available dimension is too early.
    #     → Rationale: no alternative threshold to shelter behind; early on the
    #       only available dimension is genuinely suspicious.
    #
    # NOTE: If oem_interval_months is defined but days_since_last_service is
    # None (no prior service date recorded), has_months_criterion is False and
    # the service falls into single-criterion mode governed by miles only. This
    # is the correct defensive choice — never penalise a user for missing data.
    #
    # Threshold in all cases: OEM_INTERVAL_TOLERANCE (85%) of the OEM interval.

    if miles_since_last_service is None and days_since_last_service is None:
        return UpsellDecision(is_upsell=False)

    has_miles_criterion  = (oem_interval_miles  is not None
                            and miles_since_last_service is not None)
    has_months_criterion = (oem_interval_months is not None
                            and days_since_last_service  is not None)

    too_soon_miles = (
        has_miles_criterion
        and miles_since_last_service < (oem_interval_miles * OEM_INTERVAL_TOLERANCE)
    )
    too_soon_months = (
        has_months_criterion
        and (days_since_last_service / 30) < (oem_interval_months * OEM_INTERVAL_TOLERANCE)
    )

    # Dual-criterion: require BOTH to be too soon (AND).
    # Single-criterion: flag if the one available dimension is too soon (OR).
    is_dual_criterion = has_miles_criterion and has_months_criterion
    flag_as_upsell = (
        (too_soon_miles and too_soon_months)
        if is_dual_criterion
        else (too_soon_miles or too_soon_months)
    )

    if flag_as_upsell:
        parts = []
        if too_soon_miles and oem_interval_miles and miles_since_last_service is not None:
            remaining = oem_interval_miles - miles_since_last_service
            parts.append(
                f"performed {miles_since_last_service:,} miles after last service "
                f"(OEM interval: {oem_interval_miles:,} miles; "
                f"{remaining:,} miles remaining)"
            )
        if too_soon_months and oem_interval_months and days_since_last_service is not None:
            months_since = round(days_since_last_service / 30, 1)
            remaining_months = round(oem_interval_months - months_since, 1)
            parts.append(
                f"{months_since} months since last service "
                f"(OEM interval: {oem_interval_months} months; "
                f"{remaining_months} months remaining)"
            )
        return UpsellDecision(
            is_upsell=True,
            reason=f"Service {'; '.join(parts)}. This is too soon per OEM schedule.",
        )

    return UpsellDecision(is_upsell=False)


def build_upsell_hint(
    service_type: str,
    decision: UpsellDecision,
    last_performed_mileage: Optional[int],
    last_performed_date: Optional[str],
    miles_since: Optional[int],
    days_since: Optional[int],
    oem_interval_miles: Optional[int],
    oem_interval_months: Optional[int],
) -> dict:
    """
    Format a upsell hint dict for the LLM prompt.
    Only call this when decision.is_upsell is True.
    """
    effective_interval = decision.override_interval_miles or oem_interval_miles
    miles_remaining = (
        (effective_interval - miles_since)
        if effective_interval and miles_since is not None
        else None
    )
    months_remaining = (
        round(oem_interval_months - days_since / 30, 1)
        if oem_interval_months and days_since is not None
        else None
    )
    hint = {
        "service_type": service_type,
        "last_performed_mileage": last_performed_mileage,
        "last_performed_date": last_performed_date,
        "miles_since_last_service": miles_since,
        "oem_interval_miles": effective_interval,
        "oem_interval_months": oem_interval_months,
        "miles_remaining_until_due": miles_remaining,
        "months_remaining_until_due": months_remaining,
        "verdict": "TOO_SOON — this service is not yet due per OEM schedule",
        "upsell_reason": decision.reason,
    }
    # ── NEW: surface condition note to LLM when present ──────────────────────
    if decision.condition_note:
        hint["condition_note"] = decision.condition_note
    return hint
