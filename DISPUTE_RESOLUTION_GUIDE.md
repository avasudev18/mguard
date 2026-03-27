# Dispute Resolution & Archival — Implementation Guide

## What Was Built

This update adds a full dispute lifecycle to MaintenanceGuard.
**Records are never hard-deleted.** Instead, proven disputes archive the invoice and
exclude the matching service records from the timeline and recommendation engine,
while writing an immutable audit log with a full invoice snapshot.

---

## Files Changed

### Backend

| File | What Changed |
|------|-------------|
| `backend/app/models/models.py` | Added `dispute_status`, `is_archived`, `dispute_raised_at`, `dispute_resolved_at`, `dispute_confirmed_by`, `dispute_notes` to `Invoice`; added `excluded_from_timeline`, `exclusion_reason` to `ServiceRecord`; new `DisputeResolution` ORM model |
| `backend/app/models/schemas.py` | Added `RaiseDisputeRequest`, `ResolveDisputeRequest`, `DisputeResolutionResponse` Pydantic schemas; updated `InvoiceResponse` and `ServiceRecordResponse` with new fields; updated `TimelineEvent` with `is_disputed` / `dispute_status` |
| `backend/app/api/invoices.py` | Added `POST /{id}/dispute` (raise), `POST /{id}/dispute/resolve` (resolve + archive), `GET /{id}/disputes` (audit history); `DELETE` now blocked for confirmed invoices; `GET /vehicle/{id}` accepts `?include_archived=true` |
| `backend/app/api/timeline.py` | Filters out `excluded_from_timeline` records by default; accepts `?include_archived=true`; returns `is_disputed` and `dispute_status` on each event |
| `backend/app/api/service_history.py` | Search now excludes records where `excluded_from_timeline = True` |
| `backend/app/api/recommendations.py` | OEM interval calculations now exclude excluded service records so a proven-upsell spark plug doesn't reset the service clock |
| `backend/app/main.py` | Explicit `from app.models import models` import ensures `DisputeResolution` table is created on startup |

### Database

| File | What Changed |
|------|-------------|
| `database/migrations/003_dispute_resolution.sql` | Adds columns to `invoices` and `service_records`; creates `dispute_resolutions` audit table with indexes and comments |

### Frontend

| File | What Changed |
|------|-------------|
| `frontend/src/services/api.js` | Added `raiseDispute`, `resolveDispute`, `getDisputeHistory`; updated `getVehicleInvoices` and `getTimeline` to accept `includeArchived` param |
| `frontend/src/pages/DisputeResolution.jsx` | **New page** — full dispute workflow UI with step indicator, raise form, resolve form, and expandable audit log |
| `frontend/src/pages/VehicleDetail.jsx` | Rewritten — shows invoice list with dispute status badges and 🛡️ Dispute / ⚖️ Resolve / 📋 Audit buttons |
| `frontend/src/App.jsx` | Added `import DisputeResolution` and route `/invoice/:invoiceId/dispute` |

---

## Step-by-Step Setup Instructions

### Step 1 — Apply the Database Migration

Run this against your PostgreSQL database:

```bash
psql -U postgres -d maintenanceguard -f database/migrations/003_dispute_resolution.sql
```

Or if using Docker Compose:

```bash
docker compose exec db psql -U postgres -d maintenanceguard \
  -f /migrations/003_dispute_resolution.sql
```

**What this creates:**
- New columns on `invoices`: `dispute_status`, `is_archived`, `dispute_raised_at`, `dispute_resolved_at`, `dispute_confirmed_by`, `dispute_notes`
- New columns on `service_records`: `excluded_from_timeline`, `exclusion_reason`
- New table: `dispute_resolutions` (immutable audit log)
- Performance indexes on all new filterable columns

> ⚠️ **Important:** Existing rows are safe. All new columns default to `NULL` / `FALSE`.
> The `ON DELETE RESTRICT` on `dispute_resolutions.invoice_id` prevents anyone from
> accidentally hard-deleting an invoice that has a resolution record.

---

### Step 2 — Restart the Backend

```bash
# Docker Compose
docker compose restart backend

# or manually
cd backend
uvicorn app.main:app --reload
```

SQLAlchemy will auto-create the `dispute_resolutions` table via `Base.metadata.create_all()`
if you skipped the SQL migration (development only — always use migrations in production).

---

### Step 3 — Install No New Frontend Dependencies

No new packages are needed. The UI uses only existing React + Tailwind.

```bash
cd frontend
npm run dev
```

---

### Step 4 — Verify the New API Endpoints

Open `http://localhost:8000/docs` and confirm these routes are listed:

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/invoices/{id}/dispute` | Raise a dispute (Step 1) |
| `POST` | `/api/invoices/{id}/dispute/resolve` | Resolve a dispute (Step 2) |
| `GET`  | `/api/invoices/{id}/disputes` | Fetch audit log |
| `GET`  | `/api/invoices/vehicle/{id}?include_archived=true` | Include archived invoices |
| `GET`  | `/api/timeline/{id}?include_archived=true` | Include archived service records |

---

## How the Dispute Workflow Works

### Step 1 — Raise a Dispute

Call `POST /api/invoices/{id}/dispute` with:

```json
{
  "dispute_type": "upsell",
  "dispute_notes": "Spark plugs changed at 3,500 miles, OEM interval is 60,000"
}
```

Valid `dispute_type` values: `upsell`, `duplicate`, `unauthorized_charge`, `other`

**Effect:** `invoice.dispute_status = 'disputed'`. Nothing else changes. All data preserved.

---

### Step 2 — Resolve the Dispute

Once the dealer confirms or you have evidence, call `POST /api/invoices/{id}/dispute/resolve`:

```json
{
  "resolution_status": "proven",
  "confirmed_by": "dealer_confirmed",
  "dealer_name": "Toyota of Dallas",
  "refund_amount": 149.99,
  "evidence_notes": "Service manager confirmed spark plugs were not yet due"
}
```

**When `resolution_status = "proven"`:**
1. `invoice.is_archived = True` → hidden from all normal queries
2. `invoice.dispute_status = 'proven_upsell'` or `'proven_duplicate'`
3. All `ServiceRecord` rows linked to this invoice → `excluded_from_timeline = True`
4. An immutable `DisputeResolution` row is written with a full JSON snapshot of the invoice

**When `resolution_status = "dismissed"`:**
1. `invoice.dispute_status = 'dismissed'`
2. Invoice remains visible and active
3. An audit record is still written (for completeness)

Valid `confirmed_by` values: `dealer_confirmed`, `user_self_resolved`, `admin_decision`

---

### Step 3 — View the Audit Log

```
GET /api/invoices/{id}/disputes
```

Returns all resolution records including `invoice_snapshot` — the full state of the invoice
and its line items at the moment of resolution. This snapshot is your legal safety net.

---

## Data Architecture — Why No Deletes

```
invoices
  ├── is_archived = FALSE   → visible everywhere
  ├── is_archived = TRUE    → hidden from UI, recommendations, search
  │                            but PRESERVED in database with full data
  └── dispute_resolutions   → immutable audit log (ON DELETE RESTRICT)
                               prevents invoice deletion while log exists

service_records
  ├── excluded_from_timeline = FALSE  → included in timeline, recommendations
  └── excluded_from_timeline = TRUE   → silently excluded from all queries
                                         data intact, just hidden
```

This means:
- The recommendation engine won't reset service intervals based on proven-fraudulent records
- The timeline stays clean
- You always have evidence if needed for small claims court or insurance
- GDPR's "right to erasure" is satisfied for personal data (anonymise PII) while financial records are retained per legal obligation

---

## Frontend Navigation

```
Dashboard → /
  └── Vehicle card → /vehicle/:id
        ├── Invoice list with 🛡️ Dispute buttons
        └── Each invoice → /invoice/:invoiceId/dispute
              ├── Step indicator (Review → Raise → Dealer Confirms → Archived)
              ├── Dispute Workflow tab (raise form or resolve form based on current state)
              └── Audit Log tab (expandable records with invoice snapshots)
```
