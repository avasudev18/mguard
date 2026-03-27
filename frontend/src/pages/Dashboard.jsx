import { useState, useEffect } from 'react';
import AriaChat from '../components/AriaChat';
import { Link, useLocation } from 'react-router-dom';
import { getVehicles, createVehicle, deleteVehicle, updateVehicle, getVehicleInvoices, getFleetSummary, getServicesDue } from '../services/api';

const S = {
  card: { background: '#fff', border: '1px solid #C7D2FE', borderRadius: 14, boxShadow: '0 2px 10px rgba(29,78,216,0.07)' },
  label: { display: 'block', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#6B7280', marginBottom: 6 },
  input: {
    width: '100%', padding: '9px 12px', fontFamily: 'DM Sans, sans-serif',
    fontSize: 13, color: '#0F172A', background: '#fff',
    border: '1px solid #D1D5DB', borderRadius: 8, outline: 'none',
    boxSizing: 'border-box',
  },
};

export default function Dashboard() {
  const [vehicles, setVehicles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [auditWarning, setAuditWarning] = useState(null);
  const [formData, setFormData] = useState({ year: new Date().getFullYear(), make: '', model: '', trim: '', vin: '', nickname: '', current_mileage: '', driving_condition: 'normal' });
  const [formError, setFormError] = useState('');
  const [editingMileageId, setEditingMileageId] = useState(null);
  const [editingMileageValue, setEditingMileageValue] = useState('');
  const [mileageError, setMileageError] = useState('');
  const [mileageSaving, setMileageSaving] = useState(false);
  const [openDisputeCount, setOpenDisputeCount] = useState(null); // null = loading, 0+ = real count
  const [provenSavings, setProvenSavings] = useState(null); // null = loading, float = dollars saved
  const [servicesDue, setServicesDue] = useState(null); // null = loading, { due_count, due_soon_count, total }
  const [vehicleDisputeCounts, setVehicleDisputeCounts] = useState({}); // vehicleId → open dispute count
  const [vehicleLastService, setVehicleLastService] = useState({}); // vehicleId → last service date string
  const [upsellsPerVehicle, setUpsellsPerVehicle] = useState({}); // vehicleId → proven upsell count
  const [editingDCVehicle, setEditingDCVehicle] = useState(null); // vehicle being edited for driving condition
  const [dcSaving, setDcSaving] = useState(false);

  const location = useLocation();

  useEffect(() => { loadVehicles(); }, [location.key]);

  const loadVehicles = async () => {
    try {
      const r = await getVehicles();
      setVehicles(r.data);
      // Tally open disputes across all vehicles
      let disputeCount = 0;
      const perVehicle = {};
      const perVehicleLastService = {};
      await Promise.all(r.data.map(async (v) => {
        try {
          const inv = await getVehicleInvoices(v.id, false);
          const invoices = inv.data || [];
          const count = invoices.filter(i => i.dispute_status === 'disputed').length;
          perVehicle[v.id] = count;
          disputeCount += count;
          // Find most recent confirmed invoice with a service date
          const lastInv = invoices
            .filter(i => i.is_confirmed && i.service_date)
            .sort((a, b) => new Date(b.service_date) - new Date(a.service_date))[0];
          perVehicleLastService[v.id] = lastInv
            ? new Date(lastInv.service_date.replace(/T.*/, '') + 'T00:00:00')
                .toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
            : '—';
        } catch (_) { perVehicle[v.id] = 0; perVehicleLastService[v.id] = '—'; }
      }));
      setOpenDisputeCount(disputeCount);
      setVehicleDisputeCounts(perVehicle);
      setVehicleLastService(perVehicleLastService);
      // Fetch proven savings and services due in parallel
      try {
        const [summary, due] = await Promise.all([getFleetSummary(), getServicesDue()]);
        setProvenSavings(summary.data.proven_savings ?? 0);
        setServicesDue(due.data);
        setUpsellsPerVehicle(summary.data.upsells_per_vehicle || {});
      } catch (_) { setProvenSavings(0); setServicesDue({ due_count: 0, due_soon_count: 0, total: 0 }); }
    }
    catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  const handleSubmit = async (e) => {
    e.preventDefault(); setFormError('');
    if (formData.vin && !/^[A-HJ-NPR-Z0-9]{17}$/.test(formData.vin.toUpperCase().trim())) {
      setFormError('VIN must be exactly 17 characters and cannot contain I, O, or Q.'); return;
    }
    try {
      await createVehicle({ ...formData, vin: formData.vin ? formData.vin.toUpperCase().trim() : null, current_mileage: formData.current_mileage ? parseInt(formData.current_mileage) : null });
      setShowAddForm(false);
      setFormData({ year: new Date().getFullYear(), make: '', model: '', trim: '', vin: '', nickname: '', current_mileage: '', driving_condition: 'normal' });
      loadVehicles();
    } catch (error) {
      const detail = error?.response?.data?.detail;
      if (error?.response?.status === 409 && detail?.code === 'VIN_ALREADY_REGISTERED') {
        setFormError(detail.message);
      } else {
        setFormError(typeof detail === 'string' ? detail : 'Failed to create vehicle. Please try again.');
      }
    }
  };

  const handleDelete = async (id, force = false) => {
    if (!force && !window.confirm('Delete this vehicle? This will remove all invoices and service records.')) return;
    try { await deleteVehicle(id, force); setAuditWarning(null); loadVehicles(); }
    catch (error) {
      if (error?.response?.status === 409) {
        const detail = error.response.data?.detail;
        setAuditWarning({ vehicleId: id, auditCount: detail?.audit_record_count || 0, message: detail?.message || '' });
      } else { alert('Failed to delete vehicle.'); }
    }
  };

  const startEditingMileage = (v) => { setEditingMileageId(v.id); setEditingMileageValue(v.current_mileage ? String(v.current_mileage) : ''); setMileageError(''); };
  const cancelEditingMileage = () => { setEditingMileageId(null); setEditingMileageValue(''); setMileageError(''); };
  const handleUpdateMileage = async (vehicleId) => {
    const newMileage = parseInt(editingMileageValue);
    if (!editingMileageValue || isNaN(newMileage) || newMileage < 0) { setMileageError('Please enter a valid mileage.'); return; }
    const vehicle = vehicles.find(v => v.id === vehicleId);
    if (vehicle?.current_mileage && newMileage < vehicle.current_mileage) { setMileageError(`Cannot be less than ${vehicle.current_mileage.toLocaleString()} miles.`); return; }
    setMileageSaving(true); setMileageError('');
    try { await updateVehicle(vehicleId, { current_mileage: newMileage }); setEditingMileageId(null); setEditingMileageValue(''); loadVehicles(); }
    catch { setMileageError('Failed to save.'); }
    finally { setMileageSaving(false); }
  };

  const openDrivingConditionEditor = (vehicle) => setEditingDCVehicle({ ...vehicle });
  const handleSaveDrivingCondition = async (newCondition) => {
    if (!editingDCVehicle) return;
    setDcSaving(true);
    try {
      await updateVehicle(editingDCVehicle.id, { driving_condition: newCondition });
      setEditingDCVehicle(null);
      loadVehicles();
    } catch {
      // non-blocking — surface error inline if needed
    } finally {
      setDcSaving(false);
    }
  };

  if (loading) return (
    <div style={{ textAlign: 'center', paddingTop: 80 }}>
      <div style={{ width: 36, height: 36, border: '2.5px solid #C7D2FE', borderTopColor: '#2563EB', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 12px' }} />
      <p style={{ fontSize: 13, color: '#94A3B8' }}>Loading vehicles…</p>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );

  return (
    <div>
      {/* ── Hero band — darker navy, dot-grid texture, no brand repeat ── */}
      <div style={{
        background: 'linear-gradient(135deg, #0C1A4E 0%, #1E3A8A 45%, #2563EB 100%)',
        padding: '30px 40px 58px',
        position: 'relative', overflow: 'hidden',
      }}>
        {/* dot-grid texture overlay */}
        <div style={{
          position: 'absolute', inset: 0,
          backgroundImage: 'radial-gradient(rgba(255,255,255,0.06) 1px, transparent 1px)',
          backgroundSize: '26px 26px',
          pointerEvents: 'none',
        }} />
        {/* decorative orbs */}
        <div style={{ position: 'absolute', right: -40, top: -60, width: 240, height: 240, background: 'rgba(255,255,255,0.03)', borderRadius: '50%' }} />
        <div style={{ position: 'absolute', right: 160, bottom: -30, width: 140, height: 140, background: 'rgba(255,255,255,0.03)', borderRadius: '50%' }} />
        <div style={{ maxWidth: 1200, margin: '0 auto', position: 'relative', zIndex: 1 }}>
          <p style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.12em', color: 'rgba(255,255,255,0.42)', margin: '0 0 8px' }}>
            Fleet Dashboard
          </p>
          <h1 style={{ fontFamily: 'DM Sans, sans-serif', fontSize: 26, fontWeight: 800, color: '#fff', margin: 0, letterSpacing: '-0.03em', lineHeight: 1.1 }}>
            Your {vehicles.length === 1 ? '1 vehicle' : `${vehicles.length} vehicles`}, protected.
          </h1>
          <p style={{ color: 'rgba(255,255,255,0.52)', fontSize: 13, margin: '10px 0 0', lineHeight: 1.6, maxWidth: 480 }}>
            Catch upsells, track maintenance history, and dispute overcharges — backed by AI and OEM data.
          </p>
        </div>
      </div>

      {/* ── Main content area with negative margin to overlap blue band ── */}
      <div style={{ maxWidth: 1200, margin: '-28px auto 0', padding: '0 40px 48px', position: 'relative', zIndex: 1 }}>

        {/* ── Stat Cards ── */}
        {vehicles.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 14, marginBottom: 32 }}>
            {[
              {
                label: 'Total Vehicles', pill: 'Fleet',
                value: vehicles.length, icon: '🚗',
                color: '#1D4ED8', bg: '#EFF6FF', pillColor: '#2563EB',
                accentColor: '#2563EB', sub: 'vehicles registered',
              },
              {
                label: 'Services Due', pill: 'Due',
                value: servicesDue === null ? '…'
                  : servicesDue.total === 0 ? '0'
                  : String(servicesDue.total),
                icon: '🔧',
                color: servicesDue?.due_count > 0 ? '#DC2626'
                  : servicesDue?.due_soon_count > 0 ? '#D97706'
                  : '#059669',
                bg: servicesDue?.due_count > 0 ? '#FEF2F2'
                  : servicesDue?.due_soon_count > 0 ? '#FFFBEB'
                  : '#F0FDF4',
                pillColor: servicesDue?.due_count > 0 ? '#DC2626' : '#D97706',
                accentColor: servicesDue?.due_count > 0 ? '#DC2626'
                  : servicesDue?.due_soon_count > 0 ? '#D97706'
                  : '#059669',
                sub: servicesDue === null ? null
                  : servicesDue.due_count > 0 ? `${servicesDue.due_count} overdue · ${servicesDue.due_soon_count} due soon`
                  : servicesDue.due_soon_count > 0 ? `${servicesDue.due_soon_count} due soon`
                  : 'all services up to date',
              },
              {
                label: 'Proven Savings', pill: 'Savings',
                value: provenSavings === null ? '…' : provenSavings > 0 ? `$${provenSavings.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}` : '$0',
                icon: '🛡️',
                color: provenSavings > 0 ? '#059669' : '#059669',
                bg: '#F0FDF4', pillColor: '#059669',
                accentColor: '#059669',
                sub: provenSavings > 0 ? 'recovered from disputes' : 'resolve disputes to track savings',
              },
              {
                label: 'Open Disputes', pill: 'Disputes',
                value: openDisputeCount === null ? '…' : String(openDisputeCount), icon: '⚖️',
                color: openDisputeCount > 0 ? '#DC2626' : '#10B981',
                bg: openDisputeCount > 0 ? '#FEF2F2' : '#F1F5F9',
                pillColor: openDisputeCount > 0 ? '#DC2626' : '#64748B',
                accentColor: openDisputeCount > 0 ? '#DC2626' : '#64748B',
                sub: openDisputeCount > 0 ? `${openDisputeCount} awaiting resolution` : 'all clear — nothing open',
              },
            ].map(s => (
              <div key={s.label} style={{
                ...S.card, padding: '18px 20px',
                borderTop: `3px solid ${s.accentColor}`,
              }}>
                {/* icon + pill row */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                  <div style={{ width: 32, height: 32, borderRadius: 8, background: s.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14 }}>{s.icon}</div>
                  <span style={{
                    fontSize: 10, fontWeight: 700, letterSpacing: '0.04em',
                    background: s.bg, color: s.pillColor,
                    padding: '2px 9px', borderRadius: 99,
                  }}>{s.pill}</span>
                </div>
                {/* value or actionable empty state */}
                {s.value !== null ? (
                  <>
                    <div style={{ fontSize: 28, fontWeight: 800, color: s.color, lineHeight: 1, letterSpacing: '-0.03em' }}>{s.value}</div>
                    <div style={{ fontSize: 11, color: '#94A3B8', marginTop: 5, fontWeight: 500 }}>{s.sub}</div>
                  </>
                ) : (
                  <>
                    <div style={{ fontSize: 12, fontWeight: 700, color: s.color, marginBottom: 4 }}>No data yet</div>
                    <div style={{ fontSize: 11, color: '#94A3B8', lineHeight: 1.5, marginBottom: 8 }}>Upload an invoice to start tracking</div>
                    <Link
                      to={vehicles[0] ? `/vehicle/${vehicles[0].id}/upload` : '/'}
                      style={{
                        fontSize: 11, fontWeight: 700, color: s.color,
                        background: s.bg, borderRadius: 5,
                        padding: '3px 9px', textDecoration: 'none',
                        display: 'inline-block',
                      }}
                    >
                      → Upload Invoice
                    </Link>
                  </>
                )}
              </div>
            ))}
          </div>
        )}

        {/* ── Two-column layout: vehicles list + sidebar ── */}
        <div style={{ display: 'grid', gridTemplateColumns: vehicles.length > 0 ? '1fr 280px' : '1fr', gap: 20 }}>

          {/* ── Left: vehicles ── */}
          <div>
            {/* Section Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div>
                <h2 style={{ fontFamily: 'DM Sans, sans-serif', fontSize: 17, fontWeight: 700, color: '#0F172A', margin: 0 }}>Your Vehicles</h2>
                {vehicles.length > 0 && <p style={{ fontSize: 12, color: '#94A3B8', margin: '2px 0 0' }}>{vehicles.length} vehicle{vehicles.length !== 1 ? 's' : ''} registered</p>}
              </div>
              <button onClick={() => setShowAddForm(true)} style={{
                background: 'linear-gradient(135deg, #1E3A8A, #2563EB)', color: '#fff', border: 'none', borderRadius: 9,
                padding: '10px 20px', fontSize: 13, fontWeight: 700, cursor: 'pointer',
                fontFamily: 'DM Sans, sans-serif', boxShadow: '0 4px 14px rgba(29,78,216,0.35)',
                transition: 'opacity 0.15s',
              }}
              onMouseEnter={e => e.currentTarget.style.opacity = '0.88'}
              onMouseLeave={e => e.currentTarget.style.opacity = '1'}
              >
                + Add Vehicle
              </button>
            </div>

            {/* Add Vehicle Form */}
            {showAddForm && (
              <div style={{ ...S.card, padding: '24px 28px', marginBottom: 16 }}>
                <h3 style={{ fontSize: 15, fontWeight: 700, color: '#0F172A', margin: '0 0 20px' }}>Add New Vehicle</h3>
                <form onSubmit={handleSubmit}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                    {[
                      { label: 'Year *', key: 'year', type: 'number', min: 1900, max: 2030, req: true },
                      { label: 'Make *', key: 'make', type: 'text', placeholder: 'e.g. Toyota', req: true },
                      { label: 'Model *', key: 'model', type: 'text', placeholder: 'e.g. Camry', req: true },
                      { label: 'Trim', key: 'trim', type: 'text', placeholder: 'e.g. LE' },
                    ].map(f => (
                      <div key={f.key}>
                        <label style={S.label}>{f.label}</label>
                        <input type={f.type} required={f.req} min={f.min} max={f.max}
                          placeholder={f.placeholder} value={formData[f.key]}
                          onChange={e => setFormData({ ...formData, [f.key]: f.type === 'number' ? parseInt(e.target.value) : e.target.value })}
                          style={S.input}
                          onFocus={e => { e.target.style.borderColor = '#3B82F6'; e.target.style.boxShadow = '0 0 0 3px rgba(59,130,246,0.12)'; }}
                          onBlur={e => { e.target.style.borderColor = '#D1D5DB'; e.target.style.boxShadow = 'none'; }}
                        />
                      </div>
                    ))}
                    <div style={{ gridColumn: '1 / -1' }}>
                      <label style={S.label}>
                        VIN <span style={{ textTransform: 'none', fontWeight: 400, color: '#9CA3AF', letterSpacing: 0 }}>17 chars — dashboard, door jamb, or title</span>
                      </label>
                      <input type="text" value={formData.vin} placeholder="e.g. 1HGCM82633A123456" maxLength={17}
                        onChange={e => setFormData({ ...formData, vin: e.target.value.toUpperCase() })}
                        style={{
                          ...S.input, fontFamily: 'monospace', letterSpacing: '0.06em',
                          borderColor: formData.vin && formData.vin.length !== 17 && formData.vin.length > 0 ? '#F59E0B' : formData.vin && formData.vin.length === 17 ? '#22C55E' : '#D1D5DB',
                          background: formData.vin && formData.vin.length !== 17 && formData.vin.length > 0 ? '#FFFBEB' : formData.vin && formData.vin.length === 17 ? '#F0FDF4' : '#fff',
                        }}
                      />
                      {formData.vin && (
                        <p style={{ fontSize: 11, marginTop: 4, color: formData.vin.length === 17 ? '#15803D' : '#B45309', fontWeight: 600 }}>
                          {formData.vin.length}/17 {formData.vin.length === 17 ? '✓' : ''}
                        </p>
                      )}
                    </div>
                    <div>
                      <label style={S.label}>Nickname</label>
                      <input type="text" value={formData.nickname} placeholder="e.g. Mom's Car"
                        onChange={e => setFormData({ ...formData, nickname: e.target.value })} style={S.input}
                        onFocus={e => { e.target.style.borderColor = '#3B82F6'; e.target.style.boxShadow = '0 0 0 3px rgba(59,130,246,0.12)'; }}
                        onBlur={e => { e.target.style.borderColor = '#D1D5DB'; e.target.style.boxShadow = 'none'; }}
                      />
                    </div>
                    <div>
                      <label style={S.label}>Current Mileage</label>
                      <input type="number" value={formData.current_mileage} placeholder="e.g. 45000"
                        onChange={e => setFormData({ ...formData, current_mileage: e.target.value })} style={S.input}
                        onFocus={e => { e.target.style.borderColor = '#3B82F6'; e.target.style.boxShadow = '0 0 0 3px rgba(59,130,246,0.12)'; }}
                        onBlur={e => { e.target.style.borderColor = '#D1D5DB'; e.target.style.boxShadow = 'none'; }}
                      />
                    </div>
                    <div style={{ gridColumn: '1 / -1' }}>
                      <label style={S.label}>Driving Conditions</label>
                      <select
                        value={formData.driving_condition}
                        onChange={e => setFormData({ ...formData, driving_condition: e.target.value })}
                        style={{ ...S.input, cursor: 'pointer' }}
                        onFocus={e => { e.target.style.borderColor = '#3B82F6'; e.target.style.boxShadow = '0 0 0 3px rgba(59,130,246,0.12)'; }}
                        onBlur={e => { e.target.style.borderColor = '#D1D5DB'; e.target.style.boxShadow = 'none'; }}
                      >
                        <option value="normal">Normal — standard highway and city driving</option>
                        <option value="severe">Severe — towing, extreme temps, mountains, or heavy stop-and-go</option>
                      </select>
                      <p style={{ fontSize: 11, color: '#6B7280', marginTop: 4 }}>
                        This determines which OEM maintenance intervals apply to this vehicle.
                      </p>
                    </div>
                  </div>
                  {formError && (
                    <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#DC2626', marginTop: 16 }}>
                      {formError}
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
                    <button type="submit" style={{ background: 'linear-gradient(135deg, #1E3A8A, #2563EB)', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 20px', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'DM Sans, sans-serif' }}>
                      Add Vehicle
                    </button>
                    <button type="button" onClick={() => { setShowAddForm(false); setFormError(''); }}
                      style={{ background: '#fff', color: '#6B7280', border: '1px solid #D1D5DB', borderRadius: 8, padding: '9px 20px', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'DM Sans, sans-serif' }}>
                      Cancel
                    </button>
                  </div>
                </form>
              </div>
            )}

            {/* Empty State */}
            {vehicles.length === 0 && (
              <div style={{ ...S.card, padding: '64px 40px', textAlign: 'center' }}>
                <div style={{ width: 60, height: 60, background: '#EFF6FF', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px', fontSize: 24 }}>🚗</div>
                <h3 style={{ fontSize: 16, fontWeight: 700, color: '#0F172A', margin: '0 0 6px' }}>No vehicles yet</h3>
                <p style={{ fontSize: 13, color: '#94A3B8', margin: '0 0 22px' }}>Get started by adding your first vehicle.</p>
                <button onClick={() => setShowAddForm(true)} style={{ background: 'linear-gradient(135deg, #1E3A8A, #2563EB)', color: '#fff', border: 'none', borderRadius: 9, padding: '11px 24px', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'DM Sans, sans-serif', boxShadow: '0 4px 14px rgba(29,78,216,0.3)' }}>
                  Add Your First Vehicle
                </button>
              </div>
            )}

            {/* Vehicle List */}
            {vehicles.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {vehicles.map((vehicle) => {
                  // Mileage progress toward next service (every 5k miles)
                  const mi = vehicle.current_mileage || 0;
                  const serviceInterval = 5000;
                  const nextService = Math.ceil(mi / serviceInterval) * serviceInterval;
                  const prevService = nextService - serviceInterval;
                  const pct = serviceInterval > 0 ? Math.min(((mi - prevService) / serviceInterval) * 100, 100) : 0;
                  const barColor = pct < 80
                    ? 'linear-gradient(90deg, #2563EB, #60A5FA)'
                    : pct < 95
                    ? 'linear-gradient(90deg, #F59E0B, #FCD34D)'
                    : 'linear-gradient(90deg, #EF4444, #FCA5A5)';

                  return (
                    <div key={vehicle.id} style={{
                      ...S.card,
                      display: 'flex',
                      flexDirection: 'column',
                      borderLeft: 'none',
                      overflow: 'hidden',
                      transition: 'box-shadow 0.15s, transform 0.15s',
                      cursor: 'default',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.boxShadow = '0 6px 24px rgba(29,78,216,0.15)'; e.currentTarget.style.transform = 'translateY(-1px)'; }}
                    onMouseLeave={e => { e.currentTarget.style.boxShadow = '0 2px 10px rgba(29,78,216,0.07)'; e.currentTarget.style.transform = 'translateY(0)'; }}
                    >
                      {/* Top gradient accent bar */}
                      <div style={{ height: 4, background: 'linear-gradient(90deg, #2563EB, #60A5FA)', flexShrink: 0 }} />

                      {/* Card body */}
                      <div style={{ padding: '16px 20px' }}>
                        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>

                          {/* Left: identity + mileage bar */}
                          <div style={{ flex: 1, minWidth: 0 }}>
                            {/* Make · year + VIN last-4 chip */}
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                              <p style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: '#94A3B8', margin: 0 }}>
                                {vehicle.make} · {vehicle.year}
                              </p>
                              {vehicle.vin && (
                                <span style={{
                                  fontFamily: 'monospace', fontSize: 10,
                                  background: '#F1F5F9', color: '#64748B',
                                  padding: '1px 6px', borderRadius: 4,
                                  border: '1px solid #E2E8F0',
                                }}>
                                  …{vehicle.vin.slice(-4)}
                                </span>
                              )}
                            </div>
                            <h3 style={{ fontSize: 18, fontWeight: 800, color: '#0F172A', margin: '0 0 1px', letterSpacing: '-0.02em' }}>
                              {vehicle.nickname || `${vehicle.model}${vehicle.trim ? ' ' + vehicle.trim : ''}`}
                            </h3>
                            {vehicle.nickname && (
                              <p style={{ fontSize: 12, color: '#94A3B8', margin: '1px 0 0' }}>
                                {vehicle.year} {vehicle.make} {vehicle.model}{vehicle.trim ? ' ' + vehicle.trim : ''}
                              </p>
                            )}

                            {/* Mileage + progress bar */}
                            <div style={{ marginTop: 10, maxWidth: 200 }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
                                {editingMileageId === vehicle.id ? (
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                    <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
                                      <input type="number" value={editingMileageValue} autoFocus placeholder="New miles"
                                        onChange={e => { setEditingMileageValue(e.target.value); setMileageError(''); }}
                                        onKeyDown={e => { if (e.key === 'Enter') handleUpdateMileage(vehicle.id); if (e.key === 'Escape') cancelEditingMileage(); }}
                                        style={{ ...S.input, width: 100, padding: '4px 8px', fontSize: 12 }}
                                      />
                                      <button onClick={() => handleUpdateMileage(vehicle.id)} disabled={mileageSaving}
                                        style={{ background: '#1D4ED8', color: '#fff', border: 'none', borderRadius: 6, padding: '4px 9px', fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'DM Sans, sans-serif' }}>
                                        {mileageSaving ? '…' : 'Save'}
                                      </button>
                                      <button onClick={cancelEditingMileage}
                                        style={{ background: 'none', border: 'none', color: '#94A3B8', fontSize: 14, cursor: 'pointer', lineHeight: 1 }}>✕</button>
                                    </div>
                                    {mileageError && <p style={{ fontSize: 11, color: '#DC2626', margin: 0 }}>{mileageError}</p>}
                                  </div>
                                ) : (
                                  <button onClick={() => startEditingMileage(vehicle)}
                                    style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'baseline', gap: 4 }}
                                    title="Click to update mileage">
                                    <span style={{ fontSize: 14, fontWeight: 700, color: '#0F172A', fontVariantNumeric: 'tabular-nums' }}>
                                      {vehicle.current_mileage ? vehicle.current_mileage.toLocaleString() : '—'}
                                    </span>
                                    <span style={{ fontSize: 10, color: '#94A3B8', fontWeight: 500 }}>
                                      {vehicle.current_mileage ? 'mi · edit' : '+ add mileage'}
                                    </span>
                                  </button>
                                )}
                                {vehicle.current_mileage && (
                                  <span style={{ fontSize: 10, color: '#CBD5E1' }}>next: {nextService.toLocaleString()}</span>
                                )}
                              </div>
                              {vehicle.current_mileage && (
                                <div style={{ height: 4, background: '#E2E8F0', borderRadius: 99, overflow: 'hidden' }}>
                                  <div style={{ height: '100%', width: `${pct}%`, background: barColor, borderRadius: 99 }} />
                                </div>
                              )}
                            </div>
                          </div>

                          {/* Right: 1 primary CTA + 2 secondary + delete */}
                          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 7, flexShrink: 0 }}>
                            <Link to={`/vehicle/${vehicle.id}/upload`} style={{
                              background: 'linear-gradient(135deg, #1E3A8A, #2563EB)', color: '#fff',
                              borderRadius: 8, padding: '8px 14px',
                              fontSize: 12, fontWeight: 700, textDecoration: 'none',
                              boxShadow: '0 3px 10px rgba(37,99,235,0.28)',
                              whiteSpace: 'nowrap',
                            }}>
                              📄 Upload Invoice
                            </Link>
                            <div style={{ display: 'flex', gap: 6 }}>
                              <Link to={`/vehicle/${vehicle.id}/recommendations`} style={{
                                border: '1.5px solid #BFDBFE', color: '#2563EB',
                                background: 'transparent', borderRadius: 7,
                                padding: '5px 10px', fontSize: 11, fontWeight: 700, textDecoration: 'none',
                              }}>
                                Recommendations
                              </Link>
                              <Link to={`/vehicle/${vehicle.id}`} style={{
                                border: '1.5px solid #BFDBFE', color: '#2563EB',
                                background: 'transparent', borderRadius: 7,
                                padding: '5px 10px', fontSize: 11, fontWeight: 700, textDecoration: 'none',
                              }}>
                                History
                              </Link>
                            </div>
                            {/* Delete */}
                            <button onClick={() => handleDelete(vehicle.id)}
                              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#CBD5E1', padding: 4, marginTop: 2 }}
                              onMouseEnter={e => e.currentTarget.style.color = '#EF4444'}
                              onMouseLeave={e => e.currentTarget.style.color = '#CBD5E1'}
                            >
                              <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                              </svg>
                            </button>
                          </div>
                        </div>

                        {/* Always-visible inline stat row */}
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 8, marginTop: 14, paddingTop: 12, borderTop: '1px solid #F1F5F9' }}>
                          {[
                            { label: 'Last Service', value: vehicleLastService[vehicle.id] || '—', color: '#94A3B8' },
                            { label: 'Upsells Caught', value: String(upsellsPerVehicle[String(vehicle.id)] || 0), color: upsellsPerVehicle[String(vehicle.id)] > 0 ? '#D97706' : '#059669' },
                            {
                              label: 'Open Disputes',
                              value: vehicleDisputeCounts[vehicle.id] > 0 ? String(vehicleDisputeCounts[vehicle.id]) : '0',
                              color: vehicleDisputeCounts[vehicle.id] > 0 ? '#DC2626' : '#10B981',
                            },
                            {
                              label: 'Drive Profile',
                              value: vehicle.driving_condition === 'severe' ? '⚠️ Severe' : '✓ Normal',
                              color: vehicle.driving_condition === 'severe' ? '#D97706' : '#059669',
                              isEditableLink: true,
                            },
                          ].map(stat => (
                            <div key={stat.label} style={{ background: '#F8FAFC', borderRadius: 8, padding: '8px 10px' }}>
                              <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#94A3B8', marginBottom: 3 }}>{stat.label}</div>
                              <div style={{ fontSize: 13, fontWeight: 700, color: stat.color }}>{stat.value}</div>
                              {stat.isEditableLink && (
                                <button
                                  onClick={() => openDrivingConditionEditor(vehicle)}
                                  style={{ fontSize: 10, color: '#3B82F6', background: 'none', border: 'none', cursor: 'pointer', padding: 0, marginTop: 2, fontFamily: 'DM Sans, sans-serif' }}
                                >
                                  edit
                                </button>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* ── Sidebar: Alerts + Savings ── */}
          {vehicles.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

              {/* Alerts widget */}
              <div style={{ ...S.card, padding: '20px 22px' }}>
                <h3 style={{ fontSize: 13, fontWeight: 700, color: '#0F172A', margin: '0 0 16px', display: 'flex', alignItems: 'center', gap: 6 }}>
                  🔔 <span>Alerts</span>
                </h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                  {[
                    { dot: '#F59E0B', text: 'Upload an invoice to detect service alerts', car: 'All vehicles' },
                    { dot: '#3B82F6', text: 'Add mileage to your vehicles for tracking', car: 'Action needed' },
                  ].map((a, i) => (
                    <div key={i} style={{ display: 'flex', gap: 10, padding: '10px 0', borderBottom: i === 0 ? '1px solid #F1F5F9' : 'none' }}>
                      <div style={{ width: 8, height: 8, borderRadius: '50%', background: a.dot, marginTop: 4, flexShrink: 0 }} />
                      <div>
                        <div style={{ fontSize: 12, color: '#374151', lineHeight: 1.5 }}>{a.text}</div>
                        <div style={{ fontSize: 11, color: '#94A3B8', marginTop: 2 }}>{a.car}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Upsell savings widget */}
              <div style={{ ...S.card, padding: '20px 22px', background: 'linear-gradient(135deg, #F0FDF4, #DCFCE7)', border: '1px solid #BBF7D0' }}>
                <h3 style={{ fontSize: 13, fontWeight: 700, color: '#14532D', margin: '0 0 8px' }}>💡 Proven Savings</h3>
                <div style={{ fontSize: 32, fontWeight: 800, color: '#15803D', letterSpacing: '-0.03em', lineHeight: 1 }}>
                  {provenSavings === null ? '…' : provenSavings > 0 ? `$${provenSavings.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}` : '$0'}
                </div>
                <div style={{ fontSize: 11, color: '#166534', marginTop: 8, lineHeight: 1.6 }}>
                  {provenSavings > 0
                    ? 'Total refunds recovered from resolved disputes across your fleet.'
                    : 'Dispute and resolve upsells to start tracking recovered savings.'}
                </div>
              </div>

              {/* Quick tips */}
              <div style={{ ...S.card, padding: '20px 22px', background: 'linear-gradient(135deg, #EFF6FF, #DBEAFE)', border: '1px solid #BFDBFE' }}>
                <h3 style={{ fontSize: 13, fontWeight: 700, color: '#1E3A8A', margin: '0 0 12px' }}>🚀 Quick Start</h3>
                {[
                  { n: 1, t: 'Add your vehicles above' },
                  { n: 2, t: 'Upload a service invoice' },
                  { n: 3, t: 'Get AI recommendations' },
                ].map(s => (
                  <div key={s.n} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                    <div style={{ width: 22, height: 22, borderRadius: '50%', background: '#1D4ED8', color: '#fff', fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{s.n}</div>
                    <span style={{ fontSize: 12, color: '#1E3A8A', fontWeight: 500 }}>{s.t}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Driving Condition Edit Modal ── */}
      {editingDCVehicle && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 20 }}>
          <div style={{ background: '#fff', borderRadius: 18, boxShadow: '0 20px 60px rgba(0,0,0,0.25)', maxWidth: 420, width: '100%', overflow: 'hidden' }}>
            <div style={{ background: 'linear-gradient(135deg, #1E3A8A, #2563EB)', padding: '18px 24px' }}>
              <h2 style={{ color: '#fff', fontWeight: 700, fontSize: 16, margin: 0 }}>🛣️ Driving Conditions</h2>
              <p style={{ color: 'rgba(255,255,255,0.7)', fontSize: 12, margin: '4px 0 0' }}>
                {editingDCVehicle.nickname || `${editingDCVehicle.year} ${editingDCVehicle.make} ${editingDCVehicle.model}`}
              </p>
            </div>
            <div style={{ padding: 24 }}>
              <p style={{ fontSize: 13, color: '#374151', margin: '0 0 16px', lineHeight: 1.6 }}>
                This setting determines which OEM maintenance intervals apply — severe conditions shorten oil change and service intervals.
              </p>
              {[
                {
                  value: 'normal',
                  label: 'Normal',
                  desc: 'Standard highway and city driving, moderate temperatures.',
                  icon: '✓',
                  iconColor: '#059669',
                  bg: '#F0FDF4',
                  border: '#86EFAC',
                },
                {
                  value: 'severe',
                  label: 'Severe',
                  desc: 'Towing, mountainous terrain, extreme hot/cold, or heavy stop-and-go traffic.',
                  icon: '⚠️',
                  iconColor: '#D97706',
                  bg: '#FFFBEB',
                  border: '#FCD34D',
                },
              ].map(opt => {
                const isSelected = editingDCVehicle.driving_condition === opt.value;
                return (
                  <div
                    key={opt.value}
                    onClick={() => setEditingDCVehicle({ ...editingDCVehicle, driving_condition: opt.value })}
                    style={{
                      display: 'flex', alignItems: 'flex-start', gap: 12,
                      border: `2px solid ${isSelected ? opt.border : '#E5E7EB'}`,
                      background: isSelected ? opt.bg : '#fff',
                      borderRadius: 10, padding: '12px 14px', marginBottom: 10,
                      cursor: 'pointer', transition: 'all 0.15s',
                    }}
                  >
                    <div style={{
                      width: 20, height: 20, borderRadius: '50%', flexShrink: 0, marginTop: 1,
                      border: `2px solid ${isSelected ? opt.iconColor : '#D1D5DB'}`,
                      background: isSelected ? opt.iconColor : '#fff',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      {isSelected && <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#fff' }} />}
                    </div>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: '#0F172A', marginBottom: 2 }}>{opt.label}</div>
                      <div style={{ fontSize: 12, color: '#6B7280', lineHeight: 1.5 }}>{opt.desc}</div>
                    </div>
                  </div>
                );
              })}
              <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
                <button
                  onClick={() => handleSaveDrivingCondition(editingDCVehicle.driving_condition)}
                  disabled={dcSaving}
                  style={{ flex: 1, background: 'linear-gradient(135deg, #1E3A8A, #2563EB)', color: '#fff', border: 'none', borderRadius: 10, padding: 11, fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'DM Sans, sans-serif', opacity: dcSaving ? 0.7 : 1 }}
                >
                  {dcSaving ? 'Saving…' : 'Save'}
                </button>
                <button
                  onClick={() => setEditingDCVehicle(null)}
                  disabled={dcSaving}
                  style={{ flex: 1, background: '#fff', border: '1px solid #D1D5DB', color: '#374151', borderRadius: 10, padding: 11, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'DM Sans, sans-serif' }}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Audit Warning Modal ── */}
      {auditWarning && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 20 }}>
          <div style={{ background: '#fff', borderRadius: 18, boxShadow: '0 20px 60px rgba(0,0,0,0.3)', maxWidth: 440, width: '100%', overflow: 'hidden' }}>
            <div style={{ background: 'linear-gradient(135deg, #DC2626, #B91C1C)', padding: '18px 24px' }}>
              <h2 style={{ color: '#fff', fontWeight: 700, fontSize: 16, margin: 0 }}>🗄️ Dispute Audit Records Will Be Deleted</h2>
            </div>
            <div style={{ padding: 24 }}>
              <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 10, padding: '14px 16px', marginBottom: 16, fontSize: 13, color: '#991B1B' }}>
                <p style={{ fontWeight: 700, margin: '0 0 6px' }}>⚠️ {auditWarning.auditCount} dispute audit record{auditWarning.auditCount !== 1 ? 's' : ''} found</p>
                <p style={{ margin: 0, lineHeight: 1.6 }}>These contain immutable evidence including invoice snapshots, dealer confirmations, and refund amounts. Deleting this vehicle will permanently destroy them.</p>
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                <button onClick={() => setAuditWarning(null)} style={{ flex: 1, background: '#fff', border: '1px solid #D1D5DB', color: '#374151', borderRadius: 10, padding: 11, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'DM Sans, sans-serif' }}>
                  Cancel — Keep Vehicle
                </button>
                <button onClick={() => handleDelete(auditWarning.vehicleId, true)} style={{ flex: 1, background: '#DC2626', color: '#fff', border: 'none', borderRadius: 10, padding: 11, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'DM Sans, sans-serif' }}>
                  Delete Anyway
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      {/* ARIA chat widget */}
      <AriaChat vehicleId={null} vehicleName="Fleet Overview" vehicles={vehicles} />
    </div>
  );
}
