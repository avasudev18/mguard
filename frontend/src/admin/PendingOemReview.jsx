/**
 * frontend/src/admin/PendingOemReview.jsx
 *
 * Admin UI for reviewing AI-generated OEM maintenance schedule rows.
 * Mounted as the "🔍 Pending Review" sub-tab inside OemMaintenance.jsx.
 *
 * Design matches OemMaintenance.jsx exactly:
 *   - Same C design tokens
 *   - Same Card, PrimaryBtn, OutlineBtn, Modal atoms
 *   - Same table header / row / action pattern
 *
 * Features:
 *   - Groups pending rows by make + model (most common review unit)
 *   - Per-row Approve / Reject actions
 *   - Bulk "Approve All for {make}" for efficient batch review
 *   - Source badge (AI-generated indicator)
 *   - Empty state when no pending rows exist
 *   - Live refresh after each action
 */

import { useState, useEffect, useCallback } from 'react'
import {
  listPendingOemSchedules,
  approveOemSchedule,
  rejectOemSchedule,
  approveAllOemForMake,
} from '../services/adminApi'

// ── Design tokens (mirrors OemMaintenance.jsx exactly) ───────────────────────
const C = {
  page: '#EEF2FF', heroFrom: '#0F1F5C', heroTo: '#2563EB',
  card: '#FFFFFF', cardBorder: '#C7D2FE', cardShadow: '0 2px 10px rgba(29,78,216,0.07)',
  dark: '#0F172A', mid: '#374151', muted: '#6B7280',
  blue: '#2563EB', blueLight: '#EFF6FF', blueBorder: '#BFDBFE',
  red: '#EF4444', redLight: '#FEF2F2', redBorder: '#FECACA',
  green: '#10B981', greenLight: '#F0FDF4', greenBorder: '#86EFAC',
  amber: '#F59E0B', amberLight: '#FFFBEB', amberBorder: '#FDE68A',
  purple: '#7C3AED', purpleLight: '#F5F3FF', purpleBorder: '#DDD6FE',
  btnGrad: 'linear-gradient(135deg, #1E3A8A, #2563EB)',
}

// ── Shared atoms ──────────────────────────────────────────────────────────────
function Card({ children, style = {} }) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.cardBorder}`,
      borderRadius: 14, boxShadow: C.cardShadow, ...style }}>
      {children}
    </div>
  )
}

function PrimaryBtn({ children, onClick, small, disabled }) {
  const [hov, setHov] = useState(false)
  return (
    <button onClick={onClick} disabled={disabled}
      onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      style={{ background: disabled ? '#E5E7EB' : C.btnGrad,
        color: disabled ? C.muted : '#fff', border: 'none',
        borderRadius: 9, padding: small ? '7px 16px' : '10px 22px',
        fontSize: small ? 12 : 13, fontWeight: 700,
        cursor: disabled ? 'not-allowed' : 'pointer', fontFamily: 'inherit',
        boxShadow: hov && !disabled ? '0 4px 14px rgba(37,99,235,0.4)' : 'none',
        transition: 'all 0.15s' }}>
      {children}
    </button>
  )
}

function OutlineBtn({ children, onClick, small, danger, disabled }) {
  const [hov, setHov] = useState(false)
  return (
    <button onClick={onClick} disabled={disabled}
      onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      style={{ background: hov ? (danger ? C.redLight : '#F8FAFC') : '#fff',
        color: danger ? C.red : C.mid,
        border: `1px solid ${danger ? C.redBorder : C.cardBorder}`,
        borderRadius: 9, padding: small ? '6px 14px' : '9px 18px',
        fontSize: small ? 12 : 13, fontWeight: 600,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        fontFamily: 'inherit', transition: 'background 0.15s' }}>
      {children}
    </button>
  )
}

function Modal({ children, onClose, borderColor }) {
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0,
      background: 'rgba(15,31,92,0.45)', display: 'flex',
      alignItems: 'center', justifyContent: 'center', zIndex: 200, padding: 24 }}>
      <div onClick={e => e.stopPropagation()}
        style={{ background: '#fff', borderRadius: 16, maxWidth: 480, width: '100%',
          boxShadow: '0 20px 60px rgba(0,0,0,0.22)',
          borderTop: `4px solid ${borderColor || C.blue}`, padding: '28px 32px' }}>
        {children}
      </div>
    </div>
  )
}

// ── Column definitions ────────────────────────────────────────────────────────
const COLS = [
  { key: 'service_type',      label: 'Service Type',    w: '200px' },
  { key: 'interval_miles',    label: 'Miles',           w: '80px'  },
  { key: 'interval_months',   label: 'Months',          w: '70px'  },
  { key: 'driving_condition', label: 'Condition',       w: '90px'  },
  { key: 'notes',             label: 'AI Notes',        w: '260px' },
]

// ── Row action buttons ────────────────────────────────────────────────────────
function RowActions({ row, onApprove, onReject, busy }) {
  return (
    <div style={{ display: 'flex', gap: 6 }}>
      <button onClick={() => onApprove(row.id)} disabled={busy}
        style={{ padding: '5px 12px', borderRadius: 7, fontSize: 11, fontWeight: 600,
          border: `1px solid ${C.greenBorder}`, background: C.greenLight,
          color: C.green, cursor: busy ? 'not-allowed' : 'pointer',
          fontFamily: 'inherit', opacity: busy ? 0.5 : 1 }}>
        ✓ Approve
      </button>
      <button onClick={() => onReject(row.id)} disabled={busy}
        style={{ padding: '5px 12px', borderRadius: 7, fontSize: 11, fontWeight: 600,
          border: `1px solid ${C.redBorder}`, background: C.redLight,
          color: C.red, cursor: busy ? 'not-allowed' : 'pointer',
          fontFamily: 'inherit', opacity: busy ? 0.5 : 1 }}>
        ✗ Reject
      </button>
    </div>
  )
}

// ── Group header card ─────────────────────────────────────────────────────────
function GroupHeader({ make, model, year, count, onApproveAll, busy }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '14px 20px', background: C.purpleLight,
      borderBottom: `1px solid ${C.purpleBorder}` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{ fontSize: 16 }}>🤖</span>
        <div>
          <div style={{ fontSize: 14, fontWeight: 800, color: C.dark }}>
            {year} {make} {model}
          </div>
          <div style={{ fontSize: 11, color: C.purple, marginTop: 2 }}>
            {count} AI-generated row{count !== 1 ? 's' : ''} pending review
          </div>
        </div>
        <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 10px',
          borderRadius: 99, background: C.amberLight,
          color: C.amber, border: `1px solid ${C.amberBorder}`,
          letterSpacing: '0.06em' }}>
          AI GENERATED · PENDING
        </span>
      </div>
      <PrimaryBtn small onClick={() => onApproveAll(make)} disabled={busy}>
        ✓ Approve All for {make}
      </PrimaryBtn>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
export default function PendingOemReview({ showToast, onCountChange }) {
  const [data,    setData]    = useState(null)   // { total, groups }
  const [loading, setLoading] = useState(true)
  const [err,     setErr]     = useState(null)
  const [busy,    setBusy]    = useState(false)
  const [rejectModal, setRejectModal] = useState(null)  // row id

  const load = useCallback(() => {
    setLoading(true)
    setErr(null)
    listPendingOemSchedules()
      .then(d => {
        setData(d)
        setLoading(false)
        if (onCountChange) onCountChange(d.total || 0)
      })
      .catch(e => {
        setErr(e.response?.data?.detail || e.message)
        setLoading(false)
      })
  }, [onCountChange])

  useEffect(() => { load() }, [load])

  // ── Action handlers ────────────────────────────────────────────────────────
  const doApprove = async (id) => {
    setBusy(true)
    try {
      await approveOemSchedule(id)
      showToast('OEM schedule approved — now live in the upsell engine.')
      load()
    } catch (e) {
      showToast(e.response?.data?.detail || 'Failed to approve.', 'warn')
    } finally {
      setBusy(false)
    }
  }

  const doReject = async (id) => {
    setBusy(true)
    try {
      await rejectOemSchedule(id)
      showToast('OEM schedule rejected.', 'danger')
      setRejectModal(null)
      load()
    } catch (e) {
      showToast(e.response?.data?.detail || 'Failed to reject.', 'warn')
    } finally {
      setBusy(false)
    }
  }

  const doApproveAll = async (make) => {
    setBusy(true)
    try {
      const res = await approveAllOemForMake(make)
      showToast(res.message || `Approved all ${make} rows — now live.`)
      load()
    } catch (e) {
      showToast(e.response?.data?.detail || 'Failed to approve all.', 'warn')
    } finally {
      setBusy(false)
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div style={{ padding: '48px', textAlign: 'center', fontSize: 13, color: C.muted }}>
        Loading pending review queue…
      </div>
    )
  }

  if (err) {
    return (
      <div style={{ background: C.redLight, border: `1px solid ${C.redBorder}`,
        borderRadius: 10, padding: '14px 20px', fontSize: 13, color: C.red }}>
        ⚠️ {err}
      </div>
    )
  }

  if (!data || data.total === 0) {
    return (
      <Card style={{ padding: '56px 32px', textAlign: 'center' }}>
        <div style={{ fontSize: 40, marginBottom: 16 }}>✅</div>
        <div style={{ fontSize: 16, fontWeight: 800, color: C.dark, marginBottom: 8 }}>
          All caught up
        </div>
        <div style={{ fontSize: 13, color: C.muted, maxWidth: 360, margin: '0 auto',
          lineHeight: 1.7 }}>
          No AI-generated OEM schedules are waiting for review.
          When a user adds a vehicle with no existing OEM data, Claude generates
          a schedule automatically and it appears here for your review.
        </div>
      </Card>
    )
  }

  return (
    <>
      {/* Info callout */}
      <div style={{ marginBottom: 18, padding: '12px 18px', borderRadius: 10,
        background: C.amberLight, border: `1px solid ${C.amberBorder}`,
        fontSize: 12, color: '#92400E', lineHeight: 1.7 }}>
        <strong>🤖 AI-generated data — requires admin review before going live.</strong>
        <br />
        These maintenance intervals were generated by Claude when a user added a vehicle
        with no existing OEM data. Review each row for accuracy before approving.
        Approved rows are immediately used by the upsell engine and recommendations.
        Pending rows have zero effect on users until approved.
      </div>

      {/* Groups */}
      {(data.groups || []).map((group, gi) => (
        <Card key={`${group.make}-${group.model}-${group.year}`}
          style={{ marginBottom: 20 }}>

          {/* Group header */}
          <GroupHeader
            make={group.make} model={group.model} year={group.year}
            count={group.count}
            onApproveAll={doApproveAll}
            busy={busy}
          />

          {/* Column headers */}
          <div style={{ display: 'flex', padding: '10px 16px', background: '#FAFBFF',
            borderBottom: `1px solid ${C.cardBorder}`, gap: 8 }}>
            {COLS.map(col => (
              <span key={col.key} style={{ width: col.w, minWidth: col.w, flexShrink: 0,
                fontSize: 10, fontWeight: 700, color: C.muted,
                letterSpacing: '0.07em', textTransform: 'uppercase' }}>
                {col.label}
              </span>
            ))}
            <span style={{ flex: 1, fontSize: 10, fontWeight: 700, color: C.muted,
              letterSpacing: '0.07em', textTransform: 'uppercase' }}>Actions</span>
          </div>

          {/* Rows */}
          {(group.items || []).map((row, i, arr) => (
            <div key={row.id}
              style={{ display: 'flex', padding: '12px 16px', gap: 8,
                alignItems: 'center',
                borderBottom: i < arr.length - 1 ? `1px solid ${C.cardBorder}` : 'none',
                transition: 'background 0.12s' }}
              onMouseEnter={e => e.currentTarget.style.background = '#FAFBFF'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>

              {/* Service type */}
              <div style={{ width: COLS[0].w, minWidth: COLS[0].w, flexShrink: 0 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: C.dark }}>
                  {row.service_type}
                </span>
              </div>

              {/* Miles */}
              <div style={{ width: COLS[1].w, minWidth: COLS[1].w, flexShrink: 0 }}>
                <span style={{ fontSize: 12, color: row.interval_miles ? C.dark : C.muted }}>
                  {row.interval_miles ? row.interval_miles.toLocaleString() : '—'}
                </span>
              </div>

              {/* Months */}
              <div style={{ width: COLS[2].w, minWidth: COLS[2].w, flexShrink: 0 }}>
                <span style={{ fontSize: 12, color: row.interval_months ? C.dark : C.muted }}>
                  {row.interval_months || '—'}
                </span>
              </div>

              {/* Driving condition */}
              <div style={{ width: COLS[3].w, minWidth: COLS[3].w, flexShrink: 0 }}>
                <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px',
                  borderRadius: 99,
                  background: row.driving_condition === 'severe' ? C.amberLight : C.blueLight,
                  color:      row.driving_condition === 'severe' ? C.amber      : C.blue,
                  border: `1px solid ${row.driving_condition === 'severe' ? C.amberBorder : C.blueBorder}` }}>
                  {row.driving_condition || 'normal'}
                </span>
              </div>

              {/* AI notes */}
              <div style={{ width: COLS[4].w, minWidth: COLS[4].w, flexShrink: 0 }}>
                <span style={{ fontSize: 11, color: C.muted, fontStyle: 'italic',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  display: 'block' }} title={row.notes || ''}>
                  {row.notes || '—'}
                </span>
              </div>

              {/* Actions */}
              <div style={{ flex: 1 }}>
                <RowActions
                  row={row}
                  onApprove={doApprove}
                  onReject={(id) => setRejectModal(id)}
                  busy={busy}
                />
              </div>
            </div>
          ))}
        </Card>
      ))}

      {/* Summary footer */}
      <div style={{ fontSize: 12, color: C.muted, marginTop: 8 }}>
        {data.total} row{data.total !== 1 ? 's' : ''} pending review across{' '}
        {(data.groups || []).length} vehicle group{(data.groups || []).length !== 1 ? 's' : ''}
      </div>

      {/* ── Reject Confirmation Modal ── */}
      {rejectModal && (
        <Modal onClose={() => setRejectModal(null)} borderColor={C.redBorder}>
          <div style={{ fontSize: 28, marginBottom: 14 }}>⛔</div>
          <h3 style={{ fontSize: 18, fontWeight: 800, color: C.red, marginBottom: 8 }}>
            Reject OEM Schedule #{rejectModal}
          </h3>
          <p style={{ fontSize: 13, color: C.mid, marginBottom: 20, lineHeight: 1.65 }}>
            This row will be permanently excluded from the upsell engine and
            recommendations. The vehicle owner will continue to see generic
            interval fallbacks until new data is approved.
          </p>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <OutlineBtn onClick={() => setRejectModal(null)}>Cancel</OutlineBtn>
            <button onClick={() => doReject(rejectModal)} disabled={busy}
              style={{ padding: '10px 22px', borderRadius: 9, border: 'none',
                fontFamily: 'inherit', background: C.red, color: '#fff',
                fontSize: 13, fontWeight: 700,
                cursor: busy ? 'not-allowed' : 'pointer',
                opacity: busy ? 0.7 : 1 }}>
              {busy ? 'Rejecting…' : 'Reject'}
            </button>
          </div>
        </Modal>
      )}
    </>
  )
}
