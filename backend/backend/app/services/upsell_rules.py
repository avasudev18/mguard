"""
upsell_rules.py
===============
Single source of truth for all upsell detection business logic.

Rules applied (in priority order):
  0. JUST PERFORMED — service done at 0 miles / 0 days ago is never flagged.

  1. ZERO-DOLLAR COURTESY EXEMPTION  — any line item with a $0 charge is a
     courtesy/complimentary service and must never be flagged as an upsell.

  1b. is_complimentary flag set by LLM extraction.
      ── FLAW 4 FIX ──
      Previously only exempted when line_total is None AND unit_price is None.
      Now exempts whenever is_complimentary=True (and not is_labor), regardless
      of what price OCR may have extracted. The LLM's explicit complimentary
      label is authoritative over any OCR rounding artifact.

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
     ── FLAW 5 FIX — three-state switch guard ──
     • prior_service_description == "" (no prior record): genuine — cannot
       evaluate, treated as first recorded service. Prevents false-positive
       on vehicles with sparse history or first-ever synthetic fill.
     • prior was conventional: genuine — current service IS the first
       synthetic fill, mileage since last conventional is irrelevant.
     • prior was also synthetic: apply mileage thresholds as before.

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
from dataclasses import dataclass
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

# ── Dynamic threshold system ──────────────────────────────────────────────────
# Replaces the single OEM_INTERVAL_TOLERANCE = 0.85 constant with per-category
# values loaded from the maintenance_thresholds table at evaluation time.
#
# Resolution order inside resolve_threshold():
#   1. make + model + year  (vehicle-specific override)
#   2. make only            (brand-level override)
#   3. NULL / global        (system default — seed data)
#
# Falls back to _FALLBACK_THRESHOLD when DB is unavailable or the service type
# is unrecognised — producing behaviour identical to the previous hardcoded
# OEM_INTERVAL_TOLERANCE = 0.85 constant (zero regression risk).

@dataclass(frozen=True)
class ThresholdConfig:
    """
    Resolved threshold values for a single service + vehicle combination.

    upsell_tolerance  : Fraction of OEM interval required before a service is
                        considered genuine. 0.95 = flag only within last 5%.
    annual_days_floor : Days elapsed that always make a service genuine
                        regardless of mileage. None = no floor.
    severity_tier     : 'critical' | 'high' | 'standard' | 'low'
                        Drives UI colour and notification urgency.
    """
    upsell_tolerance:  float
    annual_days_floor: Optional[int]
    severity_tier:     str


# Global fallback — reproduces previous hardcoded behaviour exactly.
# Used when DB is unavailable or service category is unrecognised.
_FALLBACK_THRESHOLD = ThresholdConfig(
    upsell_tolerance  = 0.85,   # == OEM_INTERVAL_TOLERANCE (unchanged)
    annual_days_floor = 365,    # == OIL_CHANGE_ANNUAL_DAYS_FLOOR (unchanged)
    severity_tier     = "standard",
)

# Maps raw service_type strings (lower-cased) to category keys.
# Category keys must match the service_category column in maintenance_thresholds.
# Keyword matching: first match wins, so more-specific keywords must come first.
SERVICE_CATEGORY_MAP: dict[str, str] = {
    # ── Critical ──────────────────────────────────────────────────────────────
    "brake fluid":              "brake_fluid",
    "transmission fluid":       "transmission_fluid",
    "differential fluid":       "differential_fluid",
    "transfer case fluid":      "differential_fluid",
    "power steering fluid":     "power_steering_fluid",
    # ── High ──────────────────────────────────────────────────────────────────
    "coolant flush":            "coolant",
    "coolant":                  "coolant",
    "timing belt":              "timing_belt",
    "timing chain":             "timing_belt",
    "spark plug":               "spark_plugs",
    # ── Standard (oil change family — handled by Rules 3/4 above Rule 6) ─────
    "oil change":               "engine_oil",
    "oil & filter":             "engine_oil",
    "oil and filter":           "engine_oil",
    "lube oil":                 "engine_oil",
    "oil svc":                  "engine_oil",
    "oil service":              "engine_oil",
    # ── Low ───────────────────────────────────────────────────────────────────
    "tire rotation":            "tire_rotation",
    "cabin air filter":         "cabin_air_filter",
    "air filter":               "engine_air_filter",
    "wiper blade":              "wiper_blades",
    "multi-point inspection":   "inspection",
    "multipoint inspection":    "inspection",
    "inspection":               "inspection",
}


def _categorise_service(service_type: str) -> Optional[str]:
    """Map a raw service_type string to a SERVICE_CATEGORY_MAP key."""
    norm = re.sub(r"\s+", " ", (service_type or "").lower().strip())
    for keyword, category in SERVICE_CATEGORY_MAP.items():
        if keyword in norm:
            return category
    return None


def resolve_threshold(
    service_type: str,
    vehicle_make:  Optional[str] = None,
    vehicle_model: Optional[str] = None,
    vehicle_year:  Optional[int] = None,
    db=None,
) -> ThresholdConfig:
    """
    Return the most specific ThresholdConfig available for this service + vehicle.

    Resolution order (most specific first):
      1. make + model + year  — vehicle-specific override
      2. make only            — brand-level override
      3. NULL / global        — system default (seed rows)

    Returns _FALLBACK_THRESHOLD when:
      - db is None (unit tests, DB unavailable)
      - service category is unrecognised
      - no row found at any scope level
    This guarantees zero regression: behaviour is identical to the previous
    hardcoded OEM_INTERVAL_TOLERANCE = 0.85 in all fallback paths.
    """
    category = _categorise_service(service_type)
    if category is None or db is None:
        return _FALLBACK_THRESHOLD

    try:
        # Import here to avoid circular imports at module load time
        from app.models.models import MaintenanceThreshold

        scope_filters = []
        if vehicle_make and vehicle_model and vehicle_year:
            scope_filters.append(
                (MaintenanceThreshold.make  == vehicle_make,
                 MaintenanceThreshold.model == vehicle_model,
                 MaintenanceThreshold.year  == vehicle_year)
            )
        if vehicle_make:
            scope_filters.append(
                (MaintenanceThreshold.make  == vehicle_make,
                 MaintenanceThreshold.model == None,
                 MaintenanceThreshold.year  == None)
            )
        # Global default always checked last
        scope_filters.append(
            (MaintenanceThreshold.make  == None,
             MaintenanceThreshold.model == None,
             MaintenanceThreshold.year  == None)
        )

        from sqlalchemy import and_
        for filters in scope_filters:
            row = db.query(MaintenanceThreshold).filter(
                MaintenanceThreshold.service_category == category,
                and_(*filters),
            ).first()
            if row:
                return ThresholdConfig(
                    upsell_tolerance  = float(row.upsell_tolerance),
                    annual_days_floor = row.annual_days_floor,
                    severity_tier     = row.severity_tier,
                )
    except Exception:
        # Any DB error (table missing before migration, connection loss, etc.)
        # falls through to the hardcoded fallback — no crash, no regression.
        pass

    return _FALLBACK_THRESHOLD


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
    # ── NEW: vehicle context for dynamic threshold resolution ─────────────────
    # Pass these from both call sites (invoices.py and recommendations.py) so
    # resolve_threshold() can apply make/model/year-specific overrides when they
    # exist in the maintenance_thresholds table.
    # All three default to None → falls back to global default threshold row.
    vehicle_make:  Optional[str] = None,
    vehicle_model: Optional[str] = None,
    vehicle_year:  Optional[int] = None,
    db=None,
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
    vehicle_make              : Vehicle make — passed to resolve_threshold() for
                                make-level overrides in maintenance_thresholds.
    vehicle_model             : Vehicle model — same purpose.
    vehicle_year              : Vehicle year  — same purpose.
    db                        : SQLAlchemy session — required for threshold lookup.
                                When None, falls back to hardcoded 0.85 tolerance.

    Returns
    -------
    UpsellDecision
    """

    # ── Resolve per-category threshold ───────────────────────────────────────
    # Replaces the hardcoded OEM_INTERVAL_TOLERANCE = 0.85 with a value loaded
    # from the maintenance_thresholds table (or the fallback if unavailable).
    # Oil-change-specific rules (Rules 3/4/5) are unaffected — they use their
    # own constants (SYNTHETIC_OIL_*, SEVERE_OIL_*) which are not overridden.
    threshold_cfg = resolve_threshold(
        service_type  = service_type,
        vehicle_make  = vehicle_make,
        vehicle_model = vehicle_model,
        vehicle_year  = vehicle_year,
        db            = db,
    )
    _tolerance    = threshold_cfg.upsell_tolerance     # used in Rules 4 & 6
    _annual_floor = threshold_cfg.annual_days_floor    # used in oil + Rule 6

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
    #
    # ╔══════════════════════════════════════════════════════════════════════╗
    # ║  FLAW 4 FIX — is_complimentary price-condition silent gap           ║
    # ╠══════════════════════════════════════════════════════════════════════╣
    # ║  WHAT WAS WRONG                                                     ║
    # ║  The original condition was:                                        ║
    # ║    if is_complimentary and not is_labor                             ║
    # ║       and line_total is None and unit_price is None:               ║
    # ║                                                                     ║
    # ║  This only exempted a complimentary service when BOTH price fields  ║
    # ║  were None. If the OCR extracted even a small non-zero rounding     ║
    # ║  artifact (e.g. $0.01) the condition failed silently — the service  ║
    # ║  fell through to upsell evaluation and could be falsely flagged.   ║
    # ║                                                                     ║
    # ║  SCENARIO THAT WAS BROKEN                                           ║
    # ║  LLM sets is_complimentary=True (e.g. "Complimentary Inspection")  ║
    # ║  OCR extracts line_total=0.01 (rounding artifact from PDF)         ║
    # ║  Rule 1  → abs(0.01) < 0.01 = False → not caught                  ║
    # ║  Rule 1b → line_total is None = False → not caught                 ║
    # ║  Result:  service evaluated → potential false-positive upsell flag  ║
    # ║                                                                     ║
    # ║  WHY THE FIX IS SAFE                                                ║
    # ║  Rule 1b fires AFTER Rule 1. If the price is genuinely $0.00,      ║
    # ║  Rule 1 already caught it. Rule 1b is the LLM's explicit semantic  ║
    # ║  override — if the model labelled a service as complimentary, that  ║
    # ║  intent is authoritative regardless of what OCR extracted.         ║
    # ║  Labor lines are still excluded via `not is_labor`.                ║
    # ║                                                                     ║
    # ║  CHANGE MADE                                                        ║
    # ║  Removed: `and line_total is None and unit_price is None`          ║
    # ║  Rule 1b now fires whenever is_complimentary=True and not is_labor  ║
    # ║  regardless of what price value OCR may have extracted.            ║
    # ╚══════════════════════════════════════════════════════════════════════╝
    if is_complimentary and not is_labor:
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

        # ── Annual time floor (applies to ALL oil change sub-rules) ──────────
        # Flaw 3 fix: floor is now sourced from threshold_cfg.annual_days_floor
        # instead of the hardcoded OIL_CHANGE_ANNUAL_DAYS_FLOOR constant.
        # For engine_oil the resolved value is still 365 (no behaviour change).
        # The floor is also applied to non-oil services via Rule 6 below.
        if (
            _annual_floor is not None
            and days_since_last_service is not None
            and days_since_last_service >= _annual_floor
        ):
            years = round(days_since_last_service / 365, 1)
            return UpsellDecision(
                is_upsell=False,
                condition_note=(
                    f"Oil change is genuine: {years} year(s) since last service "
                    f"({days_since_last_service} days ≥ {_annual_floor}-day annual floor). "
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

            threshold = severe_ceiling * _tolerance
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

            # ── Oil-type switch guard (FLAW 5 FIX) ───────────────────────────
            #
            # ╔══════════════════════════════════════════════════════════════════╗
            # ║  FLAW 5 FIX — switch guard bypassed when no prior record       ║
            # ╠══════════════════════════════════════════════════════════════════╣
            # ║  WHAT WAS WRONG                                                 ║
            # ║  The original guard was two-state:                              ║
            # ║    prior_was_conventional = (                                   ║
            # ║        prior_service_description != ""                          ║
            # ║        and not _is_synthetic("", prior_service_description)     ║
            # ║    )                                                             ║
            # ║    if prior_was_conventional:                                   ║
            # ║        return genuine   # first synthetic fill                  ║
            # ║                                                                  ║
            # ║  When prior_service_description == "" (no prior record exists   ║
            # ║  for this vehicle), the condition evaluated to False and the     ║
            # ║  guard was silently bypassed. The engine then applied the        ║
            # ║  synthetic mileage thresholds (4,000 / 7,000 mi) to what was    ║
            # ║  actually the very FIRST oil change ever recorded — which has    ║
            # ║  no meaningful "miles since last synthetic" to evaluate.         ║
            # ║                                                                  ║
            # ║  SCENARIO THAT WAS BROKEN                                        ║
            # ║  Vehicle has one conventional oil change in history.             ║
            # ║  Second oil change (the first synthetic fill) is being           ║
            # ║  confirmed via invoice.                                           ║
            # ║  prior_service_description = "" because:                         ║
            # ║    invoices.py:  prior is None  → ""                             ║
            # ║    recommendations.py: other_matching is empty → ""              ║
            # ║  The two-state guard saw "" → not conventional → fell through    ║
            # ║  Synthetic threshold applied to a first fill → false positive    ║
            # ║                                                                  ║
            # ║  WHY THE FIX IS SAFE                                             ║
            # ║  Both call sites pass "" when no prior record is available.      ║
            # ║  The three-state model makes the implicit assumption explicit:   ║
            # ║    State 1: "" → no prior record → genuine (cannot evaluate)    ║
            # ║    State 2: prior exists + conventional → genuine (first fill)   ║
            # ║    State 3: prior exists + synthetic → apply mileage thresholds  ║
            # ║  States 2 and 3 are identical to the previous behaviour.         ║
            # ║  Only State 1 (the broken case) changes — it now returns         ║
            # ║  genuine with a condition_note instead of falling through.       ║
            # ║                                                                  ║
            # ║  CHANGE MADE                                                     ║
            # ║  Replaced the single prior_was_conventional boolean with three   ║
            # ║  explicit named states. Added an early-return for the no-prior   ║
            # ║  case before reaching mileage threshold evaluation.              ║
            # ╚══════════════════════════════════════════════════════════════════╝

            # Determine which of the three prior-record states we are in.
            # Both call sites pass "" when no prior record exists, so "" is the
            # sentinel value for "no history available".
            prior_record_exists    = prior_service_description != ""
            prior_was_conventional = (
                prior_record_exists
                and not _is_synthetic("", prior_service_description)
            )
            # prior_was_synthetic is implicitly: prior_record_exists and not conventional

            # ── State 1: No prior record ──────────────────────────────────────
            # Cannot determine if this is a first synthetic fill or a repeat.
            # Defensive default: treat as genuine to avoid false-positive flags
            # on vehicles with sparse history (e.g. recently acquired, first use
            # of the app, or first service after a data migration).
            if not prior_record_exists:
                return UpsellDecision(
                    is_upsell=False,
                    condition_note=(
                        "No prior oil change record found. Cannot evaluate synthetic "
                        "interval — treating as genuine (first recorded service for "
                        "this vehicle in the system)."
                    ),
                )

            # ── State 2: Prior record exists and was conventional ─────────────
            # Current invoice is synthetic but prior was conventional → this is
            # the FIRST synthetic fill. The mileage gap since the last conventional
            # service is irrelevant to the synthetic interval. Flag as genuine.
            if prior_was_conventional:
                return UpsellDecision(
                    is_upsell=False,
                    condition_note=(
                        "Oil type switch detected: prior service was conventional oil. "
                        "Current synthetic fill is the first of its kind — synthetic "
                        "interval threshold does not apply."
                    ),
                )

            # ── State 3: Prior record exists and was also synthetic ───────────
            # Normal case: evaluate mileage since last synthetic service.
            # Falls through to the existing threshold checks below.

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

        threshold = oem_interval_miles * _tolerance
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
    # Tolerance: sourced from resolve_threshold() (_tolerance), not the global
    # OEM_INTERVAL_TOLERANCE constant. Brake fluid uses 0.95, tire rotation
    # uses 0.80, etc. Falls back to 0.85 when DB unavailable (no regression).
    #
    # Annual floor (Flaw 3 fix): _annual_floor from threshold_cfg now applies
    # to ALL service categories that carry one — not just oil changes. A brake
    # fluid flush overdue by 2+ years on a low-mileage vehicle is always genuine.

    if miles_since_last_service is None and days_since_last_service is None:
        return UpsellDecision(is_upsell=False)

    # ── Annual time floor for non-oil services (Flaw 3 fix) ──────────────────
    # Mirrors the oil-change floor applied above, now extended to every category
    # whose threshold row carries an annual_days_floor value.
    if (
        _annual_floor is not None
        and days_since_last_service is not None
        and days_since_last_service >= _annual_floor
    ):
        return UpsellDecision(
            is_upsell=False,
            condition_note=(
                f"Service is genuine: {days_since_last_service} days since last "
                f"service meets the {_annual_floor}-day annual floor for "
                f"'{service_type}'. Time-based protection applied."
            ),
        )

    has_miles_criterion  = (oem_interval_miles  is not None
                            and miles_since_last_service is not None)
    has_months_criterion = (oem_interval_months is not None
                            and days_since_last_service  is not None)

    too_soon_miles = (
        has_miles_criterion
        and miles_since_last_service < (oem_interval_miles * _tolerance)
    )
    too_soon_months = (
        has_months_criterion
        and (days_since_last_service / 30) < (oem_interval_months * _tolerance)
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
