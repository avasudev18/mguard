/**
 * frontend/src/admin/UpsellThresholds.jsx
 *
 * Admin UI for managing maintenance_thresholds — the Dynamic Asset-Based
 * Tolerance System (Flaws 1 & 3 fix).
 *
 * Mounted as a sub-tab inside OemMaintenance.jsx under "OEM Maintenance".
 * Design tokens, atoms (Card, PrimaryBtn, OutlineBtn, Modal), inputStyle and
 * labelStyle are copied exactly from OemMaintenance.jsx — same look and feel.
 *
 * Features:
 *   - List all threshold rows (global defaults + make/vehicle overrides)
 *   - Filter by service_category or severity_tier
 *   - Add override row (scoped to make, or make+model+year)
 *   - Edit any row (upsell_tolerance, annual_days_floor, severity_tier)
 *   - Delete override rows (global defaults protected — DELETE button hidden)
 *   - Seed global defaults (idempotent — safe to run multiple times)
 *   - Window description shows human-readable "last N%" tooltip
 */

import { useState, useEffect, useCallback } from 'react'
import {
  listThresholds, createThreshold,
  updateThreshold, deleteThreshold,
  seedThresholds,
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

// ── Shared atoms (verbatim from OemMaintenance.jsx) ───────────────────────────
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
        style={{ background: '#fff', borderRadius: 16, maxWidth: 560, width: '100%',
          maxHeight: '90vh', overflowY: 'auto',
          boxShadow: '0 20px 60px rgba(0,0,0,0.22)',
          borderTop: `4px solid ${borderColor || C.blue}`, padding: '28px 32px' }}>
        {children}
      </div>
    </div>
  )
}

const inputStyle = {
  width: '100%', padding: '9px 12px', borderRadius: 8,
  border: `1px solid ${C.cardBorder}`, fontSize: 13,
  fontFamily: 'inherit', color: C.dark, background: '#FAFBFF',
}
const labelStyle = {
  display: 'block', fontSize: 11, fontWeight: 700,
  color: C.muted, letterSpacing: '0.06em',
  textTransform: 'uppercase', marginBottom: 5,
}

// ── Severity tier config ──────────────────────────────────────────────────────
const TIER_CONFIG = {
  critical: { bg: C.redLight,    text: C.red,    border: C.redBorder,    label: 'CRITICAL' },
  high:     { bg: C.amberLight,  text: C.amber,  border: C.amberBorder,  label: 'HIGH'     },
  standard: { bg: C.blueLight,   text: C.blue,   border: C.blueBorder,   label: 'STANDARD' },
  low:      { bg: '#F3F4F6',     text: C.muted,  border: '#E5E7EB',      label: 'LOW'      },
}

function TierBadge({ tier }) {
  const cfg = TIER_CONFIG[tier] || TIER_CONFIG.standard
  return (
    <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 99,
      background: cfg.bg, color: cfg.text, border: `1px solid ${cfg.border}`,
      letterSpacing: '0.06em' }}>
      {cfg.label}
    </span>
  )
}

// ── Column definitions ────────────────────────────────────────────────────────
const COLS = [
  { key: 'service_category',  label: 'Category',    w: '160px' },
  { key: 'severity_tier',     label: 'Severity',    w: '90px'  },
  { key: 'upsell_tolerance',  label: 'Tolerance',   w: '90px'  },
  { key: 'window_description',label: 'Window',      w: '220px' },
  { key: 'annual_days_floor', label: 'Annual Floor',w: '100px' },
  { key: 'scope',             label: 'Scope',       w: '140px' },
]

// ── Empty form state ──────────────────────────────────────────────────────────
const EMPTY_FORM = {
  make: '', model: '', year: '',
  service_category: '', upsell_tolerance: '0.85',
  annual_days_floor: '', severity_tier: 'standard',
}

const EDIT_EMPTY = {
  upsell_tolerance: '', annual_days_floor: '',
  severity_tier: '', clear_annual_floor: false,
}

// ── FormFields — module-level to avoid focus loss on re-render ────────────────
function AddFormFields({ form, setF }) {
  return (
    <>
      <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10,
        background: C.blueLight, border: `1px solid ${C.blueBorder}`,
        fontSize: 12, color: C.blue }}>
        💡 Leave <strong>Make / Model / Year</strong> blank to create a <strong>global default</strong>.
        Fill Make only for a brand-level override. Fill all three for a vehicle-specific override.
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14, marginBottom: 14 }}>
        <div>
          <label style={labelStyle}>Make</label>
          <input type="text" value={form.make}
            onChange={e => setF('make', e.target.value)}
            placeholder="e.g. BMW" style={inputStyle} />
        </div>
        <div>
          <label style={labelStyle}>Model</label>
          <input type="text" value={form.model}
            onChange={e => setF('model', e.target.value)}
            placeholder="e.g. 3 Series" style={inputStyle} />
        </div>
        <div>
          <label style={labelStyle}>Year</label>
          <input type="number" value={form.year}
            onChange={e => setF('year', e.target.value)}
            placeholder="e.g. 2020" style={inputStyle} />
        </div>
      </div>

      <div style={{ marginBottom: 14 }}>
        <label style={labelStyle}>Service Category *</label>
        <input type="text" value={form.service_category}
          onChange={e => setF('service_category', e.target.value)}
          placeholder="e.g. brake_fluid, transmission_fluid, engine_oil"
          style={inputStyle} />
        <div style={{ fontSize: 11, color: C.muted, marginTop: 4 }}>
          Must match a category key in SERVICE_CATEGORY_MAP (upsell_rules.py)
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
        <div>
          <label style={labelStyle}>Upsell Tolerance *</label>
          <input type="number" step="0.01" min="0.01" max="1.0"
            value={form.upsell_tolerance}
            onChange={e => setF('upsell_tolerance', e.target.value)}
            placeholder="0.95" style={inputStyle} />
          <div style={{ fontSize: 11, color: C.muted, marginTop: 4 }}>
            0.95 = flag only in last 5% of interval
          </div>
        </div>
        <div>
          <label style={labelStyle}>Severity Tier *</label>
          <select value={form.severity_tier}
            onChange={e => setF('severity_tier', e.target.value)}
            style={{ ...inputStyle, cursor: 'pointer' }}>
            <option value="critical">Critical</option>
            <option value="high">High</option>
            <option value="standard">Standard</option>
            <option value="low">Low</option>
          </select>
        </div>
      </div>

      <div style={{ marginBottom: 22 }}>
        <label style={labelStyle}>Annual Days Floor</label>
        <input type="number" value={form.annual_days_floor}
          onChange={e => setF('annual_days_floor', e.target.value)}
          placeholder="730 (leave blank for none)" style={inputStyle} />
        <div style={{ fontSize: 11, color: C.muted, marginTop: 4 }}>
          Service is always genuine if this many days have elapsed (regardless of mileage)
        </div>
      </div>
    </>
  )
}

function EditFormFields({ form, setF }) {
  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
        <div>
          <label style={labelStyle}>Upsell Tolerance</label>
          <input type="number" step="0.01" min="0.01" max="1.0"
            value={form.upsell_tolerance}
            onChange={e => setF('upsell_tolerance', e.target.value)}
            style={inputStyle} />
        </div>
        <div>
          <label style={labelStyle}>Severity Tier</label>
          <select value={form.severity_tier}
            onChange={e => setF('severity_tier', e.target.value)}
            style={{ ...inputStyle, cursor: 'pointer' }}>
            <option value="">— no change —</option>
            <option value="critical">Critical</option>
            <option value="high">High</option>
            <option value="standard">Standard</option>
            <option value="low">Low</option>
          </select>
        </div>
      </div>

      <div style={{ marginBottom: 14 }}>
        <label style={labelStyle}>Annual Days Floor</label>
        <input type="number" value={form.annual_days_floor}
          onChange={e => setF('annual_days_floor', e.target.value)}
          placeholder="Leave blank to keep existing"
          style={inputStyle} />
      </div>

      <div style={{ marginBottom: 22 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
          <input type="checkbox" checked={form.clear_annual_floor}
            onChange={e => setF('clear_annual_floor', e.target.checked)}
            style={{ width: 14, height: 14 }} />
          <span style={{ fontSize: 12, color: C.mid }}>
            Remove annual floor (set to None)
          </span>
        </label>
      </div>
    </>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
export default function UpsellThresholds({ showToast }) {

  const [data,      setData]      = useState(null)
  const [loading,   setLoading]   = useState(true)
  const [err,       setErr]       = useState(null)
  const [seeding,   setSeeding]   = useState(false)

  // filters
  const [filterCat,  setFilterCat]  = useState('')
  const [filterTier, setFilterTier] = useState('')

  // modals
  const [addModal,  setAddModal]  = useState(false)
  const [editModal, setEditModal] = useState(null)   // row object
  const [delModal,  setDelModal]  = useState(null)   // row object
  const [delText,   setDelText]   = useState('')
  const [form,      setForm]      = useState(EMPTY_FORM)
  const [editForm,  setEditForm]  = useState(EDIT_EMPTY)
  const [saving,    setSaving]    = useState(false)

  const load = useCallback(() => {
    setLoading(true)
    setErr(null)
    const params = {}
    if (filterCat.trim())  params.service_category = filterCat.trim()
    if (filterTier.trim()) params.severity_tier     = filterTier.trim()
    listThresholds(params)
      .then(d  => { setData(d); setLoading(false) })
      .catch(e => { setErr(e.response?.data?.detail || e.message); setLoading(false) })
  }, [filterCat, filterTier])

  useEffect(() => { load() }, [load])

  // ── Form helpers ─────────────────────────────────────────────────────────
  const setF     = (key, val) => setForm(f => ({ ...f, [key]: val }))
  const setEF    = (key, val) => setEditForm(f => ({ ...f, [key]: val }))

  const addFormValid = (f) => (
    f.service_category.trim() &&
    f.upsell_tolerance !== '' &&
    parseFloat(f.upsell_tolerance) > 0 &&
    parseFloat(f.upsell_tolerance) <= 1.0 &&
    ['critical','high','standard','low'].includes(f.severity_tier)
  )

  const addPayload = (f) => {
    const p = {
      service_category:  f.service_category.trim().toLowerCase(),
      upsell_tolerance:  parseFloat(f.upsell_tolerance),
      severity_tier:     f.severity_tier,
    }
    if (f.make.trim())            p.make  = f.make.trim()
    if (f.model.trim())           p.model = f.model.trim()
    if (f.year.trim())            p.year  = parseInt(f.year.trim())
    if (f.annual_days_floor !== '') p.annual_days_floor = parseInt(f.annual_days_floor)
    return p
  }

  const editPayload = (f) => {
    const p = {}
    if (f.upsell_tolerance !== '')  p.upsell_tolerance  = parseFloat(f.upsell_tolerance)
    if (f.severity_tier !== '')     p.severity_tier     = f.severity_tier
    if (f.annual_days_floor !== '') p.annual_days_floor = parseInt(f.annual_days_floor)
    if (f.clear_annual_floor)       p.clear_annual_floor = true
    return p
  }

  // ── CRUD handlers ─────────────────────────────────────────────────────────
  const doSeed = async () => {
    setSeeding(true)
    try {
      const res = await seedThresholds()
      showToast(res.message || 'Seed complete.')
      load()
    } catch (e) {
      showToast(e.response?.data?.detail || 'Seed failed.', 'warn')
    } finally {
      setSeeding(false)
    }
  }

  const doAdd = async () => {
    if (!addFormValid(form)) return
    setSaving(true)
    try {
      await createThreshold(addPayload(form))
      showToast('Threshold created successfully.')
      setAddModal(false)
      setForm(EMPTY_FORM)
      load()
    } catch (e) {
      showToast(e.response?.data?.detail || 'Failed to create threshold.', 'warn')
    } finally {
      setSaving(false)
    }
  }

  const doEdit = async () => {
    if (!editModal) return
    const payload = editPayload(editForm)
    if (!Object.keys(payload).length) { setEditModal(null); return }
    setSaving(true)
    try {
      await updateThreshold(editModal.id, payload)
      showToast('Threshold updated successfully.')
      setEditModal(null)
      load()
    } catch (e) {
      showToast(e.response?.data?.detail || 'Failed to update threshold.', 'warn')
    } finally {
      setSaving(false)
    }
  }

  const doDelete = async () => {
    if (!delModal || delText !== 'DELETE') return
    setSaving(true)
    try {
      await deleteThreshold(delModal.id)
      showToast(`Threshold #${delModal.id} deleted.`, 'danger')
      setDelModal(null)
      setDelText('')
      load()
    } catch (e) {
      showToast(e.response?.data?.detail || 'Failed to delete threshold.', 'warn')
      setDelModal(null)
      setDelText('')
    } finally {
      setSaving(false)
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <>
      {/* Filters + actions */}
      <Card style={{ marginBottom: 20, padding: '16px 22px' }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div>
            <label style={labelStyle}>Filter by Category</label>
            <input value={filterCat} onChange={e => setFilterCat(e.target.value)}
              placeholder="e.g. brake_fluid"
              style={{ ...inputStyle, width: 180 }} />
          </div>
          <div>
            <label style={labelStyle}>Filter by Severity</label>
            <select value={filterTier} onChange={e => setFilterTier(e.target.value)}
              style={{ ...inputStyle, width: 140, cursor: 'pointer' }}>
              <option value="">All tiers</option>
              <option value="critical">Critical</option>
              <option value="high">High</option>
              <option value="standard">Standard</option>
              <option value="low">Low</option>
            </select>
          </div>
          <OutlineBtn small onClick={() => { setFilterCat(''); setFilterTier('') }}>
            Clear
          </OutlineBtn>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 10 }}>
            <OutlineBtn small onClick={doSeed} disabled={seeding}>
              {seeding ? 'Seeding…' : '⚙ Seed Defaults'}
            </OutlineBtn>
            <PrimaryBtn onClick={() => { setForm(EMPTY_FORM); setAddModal(true) }}>
              + Add Threshold
            </PrimaryBtn>
          </div>
        </div>
      </Card>

      {/* Info callout */}
      <div style={{ marginBottom: 16, padding: '10px 16px', borderRadius: 10,
        background: C.purpleLight, border: `1px solid ${C.purpleBorder}`,
        fontSize: 12, color: C.purple, lineHeight: 1.7 }}>
        <strong>How tolerance works:</strong> A tolerance of <strong>0.95</strong> means the upsell engine
        only flags a service if it was performed before <strong>95%</strong> of the OEM interval had elapsed —
        a 5% early window. Lower tolerance = wider window = more permissive.
        Global defaults (no Make/Model/Year) apply to all vehicles unless a more specific override exists.
      </div>

      {/* Error */}
      {err && (
        <div style={{ background: C.redLight, border: `1px solid ${C.redBorder}`, borderRadius: 10,
          padding: '12px 18px', marginBottom: 16, fontSize: 13, color: C.red }}>
          ⚠️ {err}
        </div>
      )}

      {/* Table */}
      <Card>
        {/* Header */}
        <div style={{ display: 'flex', padding: '10px 16px', background: '#FAFBFF',
          borderBottom: `1px solid ${C.cardBorder}`, borderRadius: '14px 14px 0 0', gap: 8 }}>
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

        {loading && (
          <div style={{ padding: '40px 22px', textAlign: 'center', fontSize: 13, color: C.muted }}>
            Loading…
          </div>
        )}

        {!loading && data?.items?.length === 0 && (
          <div style={{ padding: '40px 22px', textAlign: 'center', fontSize: 13, color: C.muted }}>
            No threshold rows found. Click <strong>⚙ Seed Defaults</strong> to populate global defaults,
            or use <strong>+ Add Threshold</strong> to create one manually.
          </div>
        )}

        {!loading && (data?.items || []).map((row, i, arr) => {
          const isGlobal = !row.make && !row.model && !row.year
          const scopeLabel = isGlobal
            ? <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 99,
                background: C.greenLight, color: C.green, border: `1px solid ${C.greenBorder}` }}>
                GLOBAL
              </span>
            : <span style={{ fontSize: 11, color: C.dark }}>
                {[row.make, row.model, row.year].filter(Boolean).join(' ')}
              </span>

          const pct = Math.round((1 - row.upsell_tolerance) * 100 * 10) / 10

          return (
            <div key={row.id}
              style={{ display: 'flex', padding: '12px 16px', gap: 8, alignItems: 'center',
                borderBottom: i < arr.length - 1 ? `1px solid ${C.cardBorder}` : 'none',
                transition: 'background 0.12s' }}
              onMouseEnter={e => e.currentTarget.style.background = '#FAFBFF'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>

              {/* service_category */}
              <div style={{ width: COLS[0].w, minWidth: COLS[0].w, flexShrink: 0 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: C.dark,
                  fontFamily: 'monospace' }}>
                  {row.service_category}
                </span>
              </div>

              {/* severity_tier */}
              <div style={{ width: COLS[1].w, minWidth: COLS[1].w, flexShrink: 0 }}>
                <TierBadge tier={row.severity_tier} />
              </div>

              {/* upsell_tolerance */}
              <div style={{ width: COLS[2].w, minWidth: COLS[2].w, flexShrink: 0 }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: C.dark }}>
                  {(row.upsell_tolerance * 100).toFixed(1)}%
                </span>
                <span style={{ fontSize: 10, color: C.muted, marginLeft: 4 }}>
                  ({pct}% early)
                </span>
              </div>

              {/* window_description */}
              <div style={{ width: COLS[3].w, minWidth: COLS[3].w, flexShrink: 0 }}>
                <span style={{ fontSize: 11, color: C.muted, fontStyle: 'italic' }}
                  title={row.window_description}>
                  {row.window_description}
                </span>
              </div>

              {/* annual_days_floor */}
              <div style={{ width: COLS[4].w, minWidth: COLS[4].w, flexShrink: 0 }}>
                {row.annual_days_floor != null
                  ? <span style={{ fontSize: 12, color: C.dark }}>
                      {row.annual_days_floor}d
                    </span>
                  : <span style={{ fontSize: 12, color: C.muted }}>—</span>
                }
              </div>

              {/* scope */}
              <div style={{ width: COLS[5].w, minWidth: COLS[5].w, flexShrink: 0 }}>
                {scopeLabel}
              </div>

              {/* Actions */}
              <div style={{ flex: 1, display: 'flex', gap: 6 }}>
                <button
                  onClick={() => {
                    setEditForm({
                      upsell_tolerance:  String(row.upsell_tolerance),
                      annual_days_floor: row.annual_days_floor != null ? String(row.annual_days_floor) : '',
                      severity_tier:     row.severity_tier,
                      clear_annual_floor: false,
                    })
                    setEditModal(row)
                  }}
                  style={{ padding: '5px 12px', borderRadius: 7, fontSize: 11, fontWeight: 600,
                    border: `1px solid ${C.blueBorder}`, background: C.blueLight,
                    color: C.blue, cursor: 'pointer', fontFamily: 'inherit' }}>
                  Edit
                </button>
                {/* Global defaults are protected — hide Delete button */}
                {!isGlobal && (
                  <button
                    onClick={() => { setDelModal(row); setDelText('') }}
                    style={{ padding: '5px 12px', borderRadius: 7, fontSize: 11, fontWeight: 600,
                      border: `1px solid ${C.redBorder}`, background: C.redLight,
                      color: C.red, cursor: 'pointer', fontFamily: 'inherit' }}>
                    Delete
                  </button>
                )}
              </div>
            </div>
          )
        })}

        {/* Footer count */}
        {data && (
          <div style={{ padding: '12px 16px', borderTop: `1px solid ${C.cardBorder}`,
            fontSize: 12, color: C.muted }}>
            {data.total} threshold row{data.total !== 1 ? 's' : ''} —&nbsp;
            {(data.items || []).filter(r => !r.make && !r.model && !r.year).length} global defaults,&nbsp;
            {(data.items || []).filter(r => r.make || r.model || r.year).length} overrides
          </div>
        )}
      </Card>

      {/* ── Add Modal ── */}
      {addModal && (
        <Modal onClose={() => setAddModal(false)} borderColor={C.blueBorder}>
          <div style={{ fontSize: 28, marginBottom: 14 }}>➕</div>
          <h3 style={{ fontSize: 18, fontWeight: 800, color: C.dark, marginBottom: 6 }}>
            Add Upsell Threshold
          </h3>
          <p style={{ fontSize: 12, color: C.muted, marginBottom: 20 }}>
            Create a new tolerance rule. Scoped overrides take priority over global defaults.
          </p>
          <AddFormFields form={form} setF={setF} />
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <OutlineBtn onClick={() => setAddModal(false)}>Cancel</OutlineBtn>
            <PrimaryBtn onClick={doAdd} disabled={saving || !addFormValid(form)}>
              {saving ? 'Saving…' : 'Save Threshold'}
            </PrimaryBtn>
          </div>
        </Modal>
      )}

      {/* ── Edit Modal ── */}
      {editModal && (
        <Modal onClose={() => setEditModal(null)} borderColor={C.blueBorder}>
          <div style={{ fontSize: 28, marginBottom: 14 }}>✏️</div>
          <h3 style={{ fontSize: 18, fontWeight: 800, color: C.dark, marginBottom: 4 }}>
            Edit Threshold #{editModal.id}
          </h3>
          <div style={{ marginBottom: 16, padding: '8px 12px', borderRadius: 8,
            background: '#FAFBFF', border: `1px solid ${C.cardBorder}`,
            fontSize: 12, color: C.muted }}>
            <strong style={{ color: C.dark, fontFamily: 'monospace' }}>
              {editModal.service_category}
            </strong>
            {editModal.make && (
              <span> · {[editModal.make, editModal.model, editModal.year].filter(Boolean).join(' ')}</span>
            )}
            {!editModal.make && <span> · Global default</span>}
          </div>
          <p style={{ fontSize: 12, color: C.muted, marginBottom: 20 }}>
            service_category and scope (make/model/year) are immutable.
            Leave fields blank to keep their current values.
          </p>
          <EditFormFields form={editForm} setF={setEF} />
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <OutlineBtn onClick={() => setEditModal(null)}>Cancel</OutlineBtn>
            <PrimaryBtn onClick={doEdit} disabled={saving}>
              {saving ? 'Saving…' : 'Save Changes'}
            </PrimaryBtn>
          </div>
        </Modal>
      )}

      {/* ── Delete Confirmation Modal ── */}
      {delModal && (
        <Modal onClose={() => { setDelModal(null); setDelText('') }} borderColor={C.redBorder}>
          <div style={{ fontSize: 28, marginBottom: 14 }}>⛔</div>
          <h3 style={{ fontSize: 18, fontWeight: 800, color: C.red, marginBottom: 8 }}>
            Delete Threshold #{delModal.id}
          </h3>
          <p style={{ fontSize: 13, color: C.mid, marginBottom: 6 }}>
            <strong style={{ fontFamily: 'monospace' }}>{delModal.service_category}</strong>
            {delModal.make && ` · ${[delModal.make, delModal.model, delModal.year].filter(Boolean).join(' ')}`}
          </p>
          <p style={{ fontSize: 12, color: C.muted, marginBottom: 16 }}>
            This override will be removed. The upsell engine will fall back to the global default
            for this category on the next evaluation.
          </p>
          <label style={labelStyle}>Type "DELETE" to confirm</label>
          <input value={delText} onChange={e => setDelText(e.target.value)} placeholder="DELETE"
            style={{ ...inputStyle, letterSpacing: '0.1em', fontSize: 14, marginBottom: 20 }} />
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <OutlineBtn onClick={() => { setDelModal(null); setDelText('') }}>Cancel</OutlineBtn>
            <button onClick={doDelete} disabled={delText !== 'DELETE' || saving}
              style={{ padding: '10px 22px', borderRadius: 9, border: 'none', fontFamily: 'inherit',
                background: delText === 'DELETE' ? C.red : '#E5E7EB',
                color: delText === 'DELETE' ? '#fff' : C.muted,
                fontSize: 13, fontWeight: 700,
                cursor: delText === 'DELETE' ? 'pointer' : 'not-allowed' }}>
              {saving ? 'Deleting…' : 'Delete Threshold'}
            </button>
          </div>
        </Modal>
      )}
    </>
  )
}
