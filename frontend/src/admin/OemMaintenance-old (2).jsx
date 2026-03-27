/**
 * frontend/src/admin/OemMaintenance.jsx
 *
 * Admin UI for managing OEM maintenance schedule data.
 * Provides full CRUD: list (paginated + filtered), add, edit (modal), delete.
 * Triggers embedding generation on create/update via the backend.
 *
 * Uses the same design tokens (C) and shared atoms as AdminDashboard.jsx.
 * Receives showToast from AdminDashboard so feedback is consistent.
 */

import { useState, useEffect, useCallback } from 'react'
import {
  listOemSchedules, createOemSchedule,
  updateOemSchedule, deleteOemSchedule,
} from '../services/adminApi'
import UpsellThresholds from './UpsellThresholds'

// ── Design tokens (mirrors AdminDashboard.jsx exactly) ────────────────────────
const C = {
  page: '#EEF2FF', heroFrom: '#0F1F5C', heroTo: '#2563EB',
  card: '#FFFFFF', cardBorder: '#C7D2FE', cardShadow: '0 2px 10px rgba(29,78,216,0.07)',
  dark: '#0F172A', mid: '#374151', muted: '#6B7280',
  blue: '#2563EB', blueLight: '#EFF6FF', blueBorder: '#BFDBFE',
  red: '#EF4444', redLight: '#FEF2F2', redBorder: '#FECACA',
  green: '#10B981', greenLight: '#F0FDF4', greenBorder: '#86EFAC',
  amber: '#F59E0B', amberLight: '#FFFBEB', amberBorder: '#FDE68A',
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

function OutlineBtn({ children, onClick, small, danger }) {
  const [hov, setHov] = useState(false)
  return (
    <button onClick={onClick}
      onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      style={{ background: hov ? (danger ? C.redLight : '#F8FAFC') : '#fff',
        color: danger ? C.red : C.mid,
        border: `1px solid ${danger ? C.redBorder : C.cardBorder}`,
        borderRadius: 9, padding: small ? '6px 14px' : '9px 18px',
        fontSize: small ? 12 : 13, fontWeight: 600, cursor: 'pointer',
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

// ── Empty form state ──────────────────────────────────────────────────────────
const EMPTY_FORM = {
  year: '', make: '', model: '', trim: '',
  service_type: '', interval_miles: '', interval_months: '',
  driving_condition: 'normal', citation: '', notes: '',
}

// ── Column definitions ────────────────────────────────────────────────────────
const COLS = [
  { key: 'year',              label: 'Year',            w: '60px',  readonly: true  },
  { key: 'make',              label: 'Make',            w: '90px',  readonly: true  },
  { key: 'model',             label: 'Model',           w: '90px',  readonly: true  },
  { key: 'trim',              label: 'Trim',            w: '70px',  readonly: false },
  { key: 'service_type',      label: 'Service Type',    w: '160px', readonly: false },
  { key: 'interval_miles',    label: 'Miles',           w: '70px',  readonly: false },
  { key: 'interval_months',   label: 'Months',          w: '70px',  readonly: false },
  { key: 'driving_condition', label: 'Condition',       w: '90px',  readonly: false },
  { key: 'citation',          label: 'Citation',        w: '140px', readonly: false },
  { key: 'has_embedding',     label: 'Embedded',        w: '70px',  readonly: true  },
]

// ── Main component ────────────────────────────────────────────────────────────
// ── FormFields — defined at module level to prevent focus loss on keystroke ────
// If defined inside OemMaintenance, React treats it as a new component type on
// every render, unmounting/remounting inputs and losing focus after each character.
function FormFields({ form, setF, isEdit }) {
  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14, marginBottom: 14 }}>
        <div>
          <label style={labelStyle}>Year *</label>
          <input type="number" value={form.year} onChange={e => setF('year', e.target.value)}
            placeholder="2020" readOnly={isEdit}
            style={{ ...inputStyle, background: isEdit ? '#F3F4F6' : '#FAFBFF', cursor: isEdit ? 'not-allowed' : 'text' }} />
        </div>
        <div>
          <label style={labelStyle}>Make *</label>
          <input type="text" value={form.make} onChange={e => setF('make', e.target.value)}
            placeholder="Toyota" readOnly={isEdit}
            style={{ ...inputStyle, background: isEdit ? '#F3F4F6' : '#FAFBFF', cursor: isEdit ? 'not-allowed' : 'text' }} />
        </div>
        <div>
          <label style={labelStyle}>Model *</label>
          <input type="text" value={form.model} onChange={e => setF('model', e.target.value)}
            placeholder="Prius" readOnly={isEdit}
            style={{ ...inputStyle, background: isEdit ? '#F3F4F6' : '#FAFBFF', cursor: isEdit ? 'not-allowed' : 'text' }} />
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
        <div>
          <label style={labelStyle}>Trim</label>
          <input type="text" value={form.trim} onChange={e => setF('trim', e.target.value)}
            placeholder="LE / XLE / Base" style={inputStyle} />
        </div>
        <div>
          <label style={labelStyle}>Driving Condition *</label>
          <select value={form.driving_condition} onChange={e => setF('driving_condition', e.target.value)}
            style={{ ...inputStyle, cursor: 'pointer' }}>
            <option value="normal">Normal</option>
            <option value="severe">Severe</option>
          </select>
        </div>
      </div>
      <div style={{ marginBottom: 14 }}>
        <label style={labelStyle}>Service Type *</label>
        <input type="text" value={form.service_type} onChange={e => setF('service_type', e.target.value)}
          placeholder="Oil Change" style={inputStyle} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
        <div>
          <label style={labelStyle}>Interval (Miles)</label>
          <input type="number" value={form.interval_miles} onChange={e => setF('interval_miles', e.target.value)}
            placeholder="5000" style={inputStyle} />
        </div>
        <div>
          <label style={labelStyle}>Interval (Months)</label>
          <input type="number" value={form.interval_months} onChange={e => setF('interval_months', e.target.value)}
            placeholder="6" style={inputStyle} />
        </div>
      </div>
      <div style={{ marginBottom: 14 }}>
        <label style={labelStyle}>Citation</label>
        <input type="text" value={form.citation} onChange={e => setF('citation', e.target.value)}
          placeholder="Toyota Owner Manual 2020, p.42" style={inputStyle} />
      </div>
      <div style={{ marginBottom: 22 }}>
        <label style={labelStyle}>Notes</label>
        <textarea value={form.notes} onChange={e => setF('notes', e.target.value)}
          rows={3} placeholder="Additional notes…"
          style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.5 }} />
      </div>
    </>
  )
}

export default function OemMaintenance({ showToast }) {

  // ── Sub-tab state ─────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState('schedules')  // 'schedules' | 'thresholds'

  const [data,       setData]       = useState(null)   // { total, items }
  const [loading,    setLoading]    = useState(true)
  const [err,        setErr]        = useState(null)

  // filters
  const [filterMake,  setFilterMake]  = useState('')
  const [filterModel, setFilterModel] = useState('')
  const [filterYear,  setFilterYear]  = useState('')
  const [page,        setPage]        = useState(1)
  const PER_PAGE = 50

  // modals
  const [addModal,  setAddModal]  = useState(false)
  const [editModal, setEditModal] = useState(null)  // row object
  const [delModal,  setDelModal]  = useState(null)  // row object
  const [delText,   setDelText]   = useState('')
  const [form,      setForm]      = useState(EMPTY_FORM)
  const [saving,    setSaving]    = useState(false)

  const load = useCallback(() => {
    setLoading(true)
    setErr(null)
    const params = { page, per_page: PER_PAGE }
    if (filterMake.trim())  params.make  = filterMake.trim()
    if (filterModel.trim()) params.model = filterModel.trim()
    if (filterYear.trim())  params.year  = parseInt(filterYear.trim())
    listOemSchedules(params)
      .then(d  => { setData(d); setLoading(false) })
      .catch(e => { setErr(e.response?.data?.detail || e.message); setLoading(false) })
  }, [page, filterMake, filterModel, filterYear])

  useEffect(() => { load() }, [load])

  // ── Form helpers ────────────────────────────────────────────────────────────
  const setF = (key, val) => setForm(f => ({ ...f, [key]: val }))

  const formValid = (f) => (
    f.year && !isNaN(parseInt(f.year)) &&
    f.make.trim() && f.model.trim() && f.service_type.trim() &&
    ['normal', 'severe'].includes(f.driving_condition)
  )

  const rowToForm = (row) => ({
    year:              String(row.year),
    make:              row.make,
    model:             row.model,
    trim:              row.trim || '',
    service_type:      row.service_type,
    interval_miles:    row.interval_miles != null ? String(row.interval_miles) : '',
    interval_months:   row.interval_months != null ? String(row.interval_months) : '',
    driving_condition: row.driving_condition || 'normal',
    citation:          row.citation || '',
    notes:             row.notes || '',
  })

  const formToPayload = (f) => ({
    year:              parseInt(f.year),
    make:              f.make.trim(),
    model:             f.model.trim(),
    trim:              f.trim.trim() || null,
    service_type:      f.service_type.trim(),
    interval_miles:    f.interval_miles !== '' ? parseInt(f.interval_miles) : null,
    interval_months:   f.interval_months !== '' ? parseInt(f.interval_months) : null,
    driving_condition: f.driving_condition,
    citation:          f.citation.trim() || null,
    notes:             f.notes.trim() || null,
  })

  // ── CRUD handlers ───────────────────────────────────────────────────────────
  const doAdd = async () => {
    if (!formValid(form)) return
    setSaving(true)
    try {
      await createOemSchedule(formToPayload(form))
      showToast('OEM maintenance schedule created successfully.')
      setAddModal(false)
      setForm(EMPTY_FORM)
      setPage(1)
      load()
    } catch (e) {
      showToast(e.response?.data?.detail || 'Failed to create schedule.', 'warn')
    } finally {
      setSaving(false)
    }
  }

  const doEdit = async () => {
    if (!editModal || !formValid(form)) return
    setSaving(true)
    // Only send editable fields (year/make/model excluded)
    const { year, make, model, ...editableFields } = formToPayload(form)
    try {
      await updateOemSchedule(editModal.id, editableFields)
      showToast('OEM maintenance schedule updated successfully.')
      setEditModal(null)
      load()
    } catch (e) {
      showToast(e.response?.data?.detail || 'Failed to update schedule.', 'warn')
    } finally {
      setSaving(false)
    }
  }

  const doDelete = async () => {
    if (!delModal || delText !== 'DELETE') return
    setSaving(true)
    try {
      await deleteOemSchedule(delModal.id)
      showToast(`OEM schedule #${delModal.id} deleted.`, 'danger')
      setDelModal(null)
      setDelText('')
      load()
    } catch (e) {
      showToast(e.response?.data?.detail || 'Failed to delete schedule.', 'warn')
      setDelModal(null)
      setDelText('')
    } finally {
      setSaving(false)
    }
  }

  // ── Form fields (shared between Add and Edit) ───────────────────────────────
  // ── Pagination ──────────────────────────────────────────────────────────────
  const totalPages = data ? Math.ceil(data.total / PER_PAGE) : 1

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <>
      {/* Hero */}
      <div style={{ background: `linear-gradient(135deg, ${C.heroFrom} 0%, #1E3A8A 50%, ${C.heroTo} 100%)`,
        padding: '36px 40px 56px' }}>
        <div style={{ maxWidth: 1280, margin: '0 auto' }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.12em',
            textTransform: 'uppercase', color: 'rgba(255,255,255,0.5)', marginBottom: 8 }}>
            ADMIN CONSOLE
          </div>
          <h1 style={{ margin: '0 0 10px', fontSize: 28, fontWeight: 800, color: '#fff',
            letterSpacing: '-0.02em' }}>OEM Maintenance Schedules</h1>
          <p style={{ margin: 0, fontSize: 14, color: 'rgba(255,255,255,0.6)',
            maxWidth: 520, lineHeight: 1.7 }}>
            Manage OEM-recommended maintenance intervals used by the upsell detection engine and ARIA.
          </p>
        </div>
      </div>

      {/* Page content */}
      <div style={{ maxWidth: 1280, margin: '-28px auto 0', padding: '0 40px 48px', position: 'relative' }}>

        {/* Sub-tab navigation */}
        <div style={{ display: 'flex', gap: 4, marginBottom: 22,
          borderBottom: `2px solid ${C.cardBorder}`, paddingBottom: 0 }}>
          {[
            { id: 'schedules',  label: 'OEM Schedules',      icon: '📋' },
            { id: 'thresholds', label: 'Upsell Thresholds',  icon: '⚙️' },
          ].map(tab => {
            const active = activeTab === tab.id
            return (
              <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                style={{ padding: '10px 20px', border: 'none', background: 'none',
                  fontFamily: 'inherit', fontSize: 13, fontWeight: active ? 700 : 500,
                  color: active ? C.blue : C.muted, cursor: 'pointer',
                  borderBottom: active ? `3px solid ${C.blue}` : '3px solid transparent',
                  marginBottom: -2, transition: 'all 0.15s' }}>
                {tab.icon} {tab.label}
              </button>
            )
          })}
        </div>

        {/* Thresholds sub-tab */}
        {activeTab === 'thresholds' && (
          <UpsellThresholds showToast={showToast} />
        )}

        {/* Schedules sub-tab — existing content below */}
        {activeTab === 'schedules' && <>

        {/* Filters + Add */}
        <Card style={{ marginBottom: 20, padding: '16px 22px' }}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div>
              <label style={labelStyle}>Filter by Make</label>
              <input value={filterMake} onChange={e => { setFilterMake(e.target.value); setPage(1) }}
                placeholder="e.g. Toyota" style={{ ...inputStyle, width: 140 }} />
            </div>
            <div>
              <label style={labelStyle}>Filter by Model</label>
              <input value={filterModel} onChange={e => { setFilterModel(e.target.value); setPage(1) }}
                placeholder="e.g. Prius" style={{ ...inputStyle, width: 140 }} />
            </div>
            <div>
              <label style={labelStyle}>Filter by Year</label>
              <input type="number" value={filterYear} onChange={e => { setFilterYear(e.target.value); setPage(1) }}
                placeholder="e.g. 2020" style={{ ...inputStyle, width: 100 }} />
            </div>
            <OutlineBtn small onClick={() => { setFilterMake(''); setFilterModel(''); setFilterYear(''); setPage(1) }}>
              Clear
            </OutlineBtn>
            <div style={{ marginLeft: 'auto' }}>
              <PrimaryBtn onClick={() => { setForm(EMPTY_FORM); setAddModal(true) }}>
                + Add Schedule
              </PrimaryBtn>
            </div>
          </div>
        </Card>

        {/* Error */}
        {err && (
          <div style={{ background: C.redLight, border: `1px solid ${C.redBorder}`, borderRadius: 10,
            padding: '12px 18px', marginBottom: 16, fontSize: 13, color: C.red }}>
            ⚠️ {err}
          </div>
        )}

        {/* Table */}
        <Card>
          {/* Header row */}
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
              No OEM schedules found. Adjust filters or add a new schedule.
            </div>
          )}

          {!loading && (data?.items || []).map((row, i, arr) => (
            <div key={row.id}
              style={{ display: 'flex', padding: '12px 16px', gap: 8, alignItems: 'center',
                borderBottom: i < arr.length - 1 ? `1px solid ${C.cardBorder}` : 'none',
                transition: 'background 0.12s' }}
              onMouseEnter={e => e.currentTarget.style.background = '#FAFBFF'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>

              {COLS.map(col => {
                const val = row[col.key]
                let display = val ?? '—'
                if (col.key === 'has_embedding') {
                  display = val
                    ? <span style={{ color: C.green, fontWeight: 700, fontSize: 12 }}>✓</span>
                    : <span style={{ color: C.muted, fontSize: 12 }}>—</span>
                } else if (col.key === 'driving_condition') {
                  display = (
                    <span style={{
                      fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 99,
                      background: val === 'severe' ? C.amberLight : C.blueLight,
                      color: val === 'severe' ? C.amber : C.blue,
                      border: `1px solid ${val === 'severe' ? C.amberBorder : C.blueBorder}`,
                    }}>{val || '—'}</span>
                  )
                } else {
                  display = (
                    <span style={{ fontSize: 12, color: col.readonly ? C.muted : C.dark,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      display: 'block' }}
                      title={String(val ?? '')}>
                      {val ?? '—'}
                    </span>
                  )
                }
                return (
                  <div key={col.key} style={{ width: col.w, minWidth: col.w, flexShrink: 0 }}>
                    {display}
                  </div>
                )
              })}

              {/* Actions */}
              <div style={{ flex: 1, display: 'flex', gap: 6 }}>
                <button
                  onClick={() => { setForm(rowToForm(row)); setEditModal(row) }}
                  style={{ padding: '5px 12px', borderRadius: 7, fontSize: 11, fontWeight: 600,
                    border: `1px solid ${C.blueBorder}`, background: C.blueLight,
                    color: C.blue, cursor: 'pointer', fontFamily: 'inherit' }}>
                  Edit
                </button>
                <button
                  onClick={() => { setDelModal(row); setDelText('') }}
                  style={{ padding: '5px 12px', borderRadius: 7, fontSize: 11, fontWeight: 600,
                    border: `1px solid ${C.redBorder}`, background: C.redLight,
                    color: C.red, cursor: 'pointer', fontFamily: 'inherit' }}>
                  Delete
                </button>
              </div>
            </div>
          ))}

          {/* Pagination footer */}
          {data && data.total > PER_PAGE && (
            <div style={{ padding: '14px 22px', borderTop: `1px solid ${C.cardBorder}`,
              display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 12, color: C.muted }}>
                {data.total} total — page {page} of {totalPages}
              </span>
              <div style={{ display: 'flex', gap: 8 }}>
                <OutlineBtn small onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>
                  ← Prev
                </OutlineBtn>
                <OutlineBtn small onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}>
                  Next →
                </OutlineBtn>
              </div>
            </div>
          )}
        </Card>

        {/* Row count */}
        {data && (
          <p style={{ marginTop: 10, fontSize: 12, color: C.muted }}>
            Showing {data.items?.length || 0} of {data.total} records
          </p>
        )}
      </div>

      {/* ── Add Modal ── */}
      {addModal && (
        <Modal onClose={() => setAddModal(false)} borderColor={C.blueBorder}>
          <div style={{ fontSize: 28, marginBottom: 14 }}>➕</div>
          <h3 style={{ fontSize: 18, fontWeight: 800, color: C.dark, marginBottom: 6 }}>
            Add OEM Maintenance Schedule
          </h3>
          <p style={{ fontSize: 12, color: C.muted, marginBottom: 20 }}>
            An embedding will be automatically generated after saving.
          </p>
          <FormFields form={form} setF={setF} isEdit={false} />
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <OutlineBtn onClick={() => setAddModal(false)}>Cancel</OutlineBtn>
            <PrimaryBtn onClick={doAdd} disabled={saving || !formValid(form)}>
              {saving ? 'Saving…' : 'Save Schedule'}
            </PrimaryBtn>
          </div>
        </Modal>
      )}

      {/* ── Edit Modal ── */}
      {editModal && (
        <Modal onClose={() => setEditModal(null)} borderColor={C.blueBorder}>
          <div style={{ fontSize: 28, marginBottom: 14 }}>✏️</div>
          <h3 style={{ fontSize: 18, fontWeight: 800, color: C.dark, marginBottom: 4 }}>
            Edit OEM Schedule #{editModal.id}
          </h3>
          <p style={{ fontSize: 12, color: C.muted, marginBottom: 20 }}>
            Year, Make and Model are read-only. Embedding will be regenerated on save.
          </p>
          <FormFields form={form} setF={setF} isEdit={true} />
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <OutlineBtn onClick={() => setEditModal(null)}>Cancel</OutlineBtn>
            <PrimaryBtn onClick={doEdit} disabled={saving || !formValid(form)}>
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
            Delete OEM Schedule #{delModal.id}
          </h3>
          <p style={{ fontSize: 13, color: C.mid, marginBottom: 6 }}>
            <strong>{delModal.year} {delModal.make} {delModal.model}</strong> — {delModal.service_type}
          </p>
          <p style={{ fontSize: 12, color: C.muted, marginBottom: 16 }}>
            This will permanently remove this schedule and its embedding. The upsell engine
            will no longer use this row for interval calculations.
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
              {saving ? 'Deleting…' : 'Delete Schedule'}
            </button>
          </div>
        </Modal>
      )}
      </>}{/* end activeTab === 'schedules' */}
    </>
  )
}
