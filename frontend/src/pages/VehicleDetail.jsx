import { useState, useEffect, useRef } from 'react';
import AriaChat from '../components/AriaChat';
import { useParams, Link } from 'react-router-dom';
import {
  getVehicle,
  getVehicleInvoicesWithTags,
  getInvoiceLineItems,
  raiseDisputeWithLineItems,
} from '../services/api';

const TAG_PALETTE = {
  'Oil Change':             { bg: '#FEF3C7', text: '#92400E', dot: '#F59E0B' },
  'Oil Filter':             { bg: '#FEF3C7', text: '#92400E', dot: '#F59E0B' },
  'Oil Change Labor':       { bg: '#FFEDD5', text: '#9A3412', dot: '#F97316' },
  'Tire Rotation':          { bg: '#DBEAFE', text: '#1E40AF', dot: '#3B82F6' },
  'Multi-Point Inspection': { bg: '#F3E8FF', text: '#6B21A8', dot: '#A855F7' },
  'Differential Fluid':     { bg: '#CCFBF1', text: '#134E4A', dot: '#14B8A6' },
  'On Board Diagnostics':   { bg: '#FFE4E6', text: '#9F1239', dot: '#F43F5E' },
  'Wheel Alignment':        { bg: '#DCFCE7', text: '#14532D', dot: '#22C55E' },
  'Brake Inspection':       { bg: '#FEE2E2', text: '#991B1B', dot: '#EF4444' },
  'Shop Supplies':          { bg: '#F1F5F9', text: '#475569', dot: '#94A3B8' },
};
function getTagStyle(tag) {
  return TAG_PALETTE[tag] || { bg: '#E0E7FF', text: '#3730A3', dot: '#6366F1' };
}
function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
function fmtMiles(m) { return m ? m.toLocaleString() + ' mi' : '—'; }
function fmtPrice(v) { return (v === null || v === undefined) ? null : '$' + Number(v).toFixed(2); }

function ServiceTag({ label, small }) {
  const s = getTagStyle(label);
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: s.bg, color: s.text,
      padding: small ? '2px 7px' : '3px 9px', borderRadius: 999, fontSize: small ? 10 : 11, fontWeight: 600, whiteSpace: 'nowrap' }}>
      <span style={{ width: 5, height: 5, borderRadius: '50%', background: s.dot, flexShrink: 0 }} />
      {label}
    </span>
  );
}

function DisputeBadge() {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: '#FEF2F2', color: '#DC2626',
      border: '1px solid #FECACA', padding: '2px 8px', borderRadius: 999, fontSize: 10, fontWeight: 700 }}>
      ⚠ Dispute Active
    </span>
  );
}

function Chevron({ open }) {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none"
      style={{ transform: open ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.22s ease', flexShrink: 0 }}>
      <path d="M2.5 5L7 9.5L11.5 5" stroke="#94A3B8" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function LineItemRow({ item, disputeMode, selected, onToggle }) {
  // upsell_verdict: 'genuine' | 'upsell' | 'exempt' | null (legacy rows pre-008 migration)
  const isUpsell        = item.upsell_verdict === 'upsell';
  // Only show Complimentary badge if LLM flagged it AND the engine didn't flag it as upsell.
  // Upsell verdict always wins — a bundled-charged service is never "complimentary".
  const isComplimentary = item.is_complimentary === true && !isUpsell;
  // Upsell items must be disputable even if is_complimentary was incorrectly set.
  const canDispute      = !isComplimentary || isUpsell;

  return (
    <div onClick={() => disputeMode && canDispute && onToggle(item.id)} style={{
      display: 'flex', alignItems: 'flex-start', gap: 10, padding: '9px 16px',
      borderRadius: 8, margin: '1px 8px', cursor: disputeMode && canDispute ? 'pointer' : 'default',
      background: selected ? '#FEF2F2' : isUpsell ? '#FFFBEB' : 'transparent',
      border: selected ? '1px solid #FECACA' : isUpsell ? '1px solid #FDE68A' : '1px solid transparent',
      transition: 'all 0.15s ease',
    }}>
      {disputeMode && (
        <div style={{ paddingTop: 2, flexShrink: 0 }}>
          <input type="checkbox" checked={selected} disabled={!canDispute}
            onChange={() => canDispute && onToggle(item.id)} onClick={e => e.stopPropagation()}
            style={{ width: 15, height: 15, cursor: canDispute ? 'pointer' : 'not-allowed', accentColor: '#DC2626' }} />
        </div>
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: '#1E293B' }}>{item.service_type}</span>
          {item.is_labor && <span style={{ fontSize: 10, color: '#64748B', background: '#F1F5F9', padding: '1px 6px', borderRadius: 4 }}>Labor</span>}
          {item.is_parts && <span style={{ fontSize: 10, color: '#64748B', background: '#F1F5F9', padding: '1px 6px', borderRadius: 4 }}>Parts</span>}
          {isUpsell && (
            <span style={{ fontSize: 10, color: '#B45309', background: '#FEF3C7', padding: '1px 6px', borderRadius: 4, fontWeight: 600 }}>
              ⚠ Potential Upsell
            </span>
          )}
          {isComplimentary && !isUpsell && (
            <span style={{ fontSize: 10, color: '#059669', background: '#ECFDF5', padding: '1px 6px', borderRadius: 4, fontWeight: 600 }}>
              Complimentary
            </span>
          )}
          {/* Legacy rows (pre-008 migration) — no verdict stored, show nothing extra */}
        </div>
        <div style={{ fontSize: 11, color: '#94A3B8', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {item.service_description}
        </div>
      </div>
      <div style={{ textAlign: 'right', flexShrink: 0, minWidth: 56 }}>
        {isComplimentary && !isUpsell
          ? <span style={{ fontSize: 13, color: '#CBD5E1' }}>—</span>
          : <span style={{ fontSize: 13, fontWeight: 700, color: isUpsell ? '#B45309' : '#1E293B' }}>{fmtPrice(item.line_total)}</span>}
      </div>
    </div>
  );
}

function InvoiceCard({ invoice, onDisputeSubmit }) {
  const [expanded, setExpanded]       = useState(false);
  const [lineItems, setLineItems]     = useState(null);
  const [loading, setLoading]         = useState(false);
  const [loadError, setLoadError]     = useState(null);
  const [disputeMode, setDisputeMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState([]);
  const [reason, setReason]           = useState('');
  const [submitting, setSubmitting]   = useState(false);
  const [submitError, setSubmitError] = useState(null);
  const [submitted, setSubmitted]     = useState(false);

  const hasDispute = invoice.has_active_dispute || submitted;

  const handleExpand = async () => {
    if (!expanded && !lineItems) {
      setLoading(true); setLoadError(null);
      try {
        const res = await getInvoiceLineItems(invoice.id);
        setLineItems(res.data.line_items || []);
      } catch (e) {
        setLoadError('Failed to load line items. Please try again.');
      } finally { setLoading(false); }
    }
    if (expanded) { setDisputeMode(false); setSelectedIds([]); setReason(''); setSubmitError(null); }
    setExpanded(e => !e);
  };

  const toggleItem = (id) => setSelectedIds(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);

  const handleSubmit = async () => {
    setSubmitting(true); setSubmitError(null);
    try {
      await raiseDisputeWithLineItems(invoice.id, {
        invoice_line_item_ids: selectedIds,
        dispute_type: 'upsell',
        dispute_notes: reason || null,
      });
      setSubmitted(true); setDisputeMode(false); setSelectedIds([]);
      if (onDisputeSubmit) onDisputeSubmit(invoice.id);
    } catch (e) {
      setSubmitError(e?.response?.data?.detail || 'Failed to submit. Please try again.');
    } finally { setSubmitting(false); }
  };

  const disputedLabels = lineItems?.filter(i => selectedIds.includes(i.id)).map(i => i.service_type) || [];

  return (
    <div style={{ background: '#fff', borderRadius: 16,
      border: expanded ? '1.5px solid #BAE6FD' : '1.5px solid #E2E8F0',
      boxShadow: expanded ? '0 4px 24px rgba(14,165,233,0.08)' : '0 1px 4px rgba(0,0,0,0.04)',
      overflow: 'hidden', transition: 'border-color 0.2s, box-shadow 0.2s' }}>

      {/* Header */}
      <div onClick={handleExpand} style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '14px 16px', cursor: 'pointer', userSelect: 'none' }}>
        <div style={{ width: 38, height: 38, borderRadius: 10, flexShrink: 0, background: expanded ? '#EFF6FF' : '#F8FAFC',
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 17, border: '1px solid #E2E8F0' }}>🧾</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 3 }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: '#0F172A' }}>{invoice.shop_name || 'Unknown Shop'}</span>
            {hasDispute && <DisputeBadge />}
          </div>
          <div style={{ fontSize: 12, color: '#64748B', display: 'flex', gap: 6, alignItems: 'center', marginBottom: 8 }}>
            <span>{fmtDate(invoice.service_date)}</span>
            <span style={{ color: '#CBD5E1' }}>·</span>
            <span>{fmtMiles(invoice.mileage_at_service)}</span>
            {invoice.total_amount && <><span style={{ color: '#CBD5E1' }}>·</span>
              <span style={{ fontWeight: 700, color: '#334155' }}>${Number(invoice.total_amount).toFixed(2)}</span></>}
          </div>
          {invoice.service_tags?.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
              {invoice.service_tags.map(tag => <ServiceTag key={tag} label={tag} small />)}
            </div>
          )}
        </div>
        <Chevron open={expanded} />
      </div>

      {/* Body */}
      {expanded && (
        <div style={{ borderTop: '1px solid #F1F5F9' }}>
          {loading && <div style={{ padding: '24px', textAlign: 'center', fontSize: 12, color: '#94A3B8' }}>Loading line items…</div>}
          {loadError && <div style={{ margin: 12, padding: '12px 16px', background: '#FEF2F2', borderRadius: 10, fontSize: 12, color: '#DC2626' }}>{loadError}</div>}

          {submitted && (
            <div style={{ margin: 12, padding: '18px 16px', borderRadius: 12, background: '#F0FDF4', border: '1px solid #BBF7D0', textAlign: 'center' }}>
              <div style={{ fontSize: 22, marginBottom: 6 }}>✅</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#14532D', marginBottom: 4 }}>Dispute Submitted</div>
              <div style={{ fontSize: 12, color: '#166534', marginBottom: 8 }}>Your dispute is under review. You'll be notified when the dealer responds.</div>
              <button onClick={() => setSubmitted(false)} style={{ fontSize: 11, color: '#15803D', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}>Dismiss</button>
            </div>
          )}

          {!loading && !loadError && !submitted && lineItems && (<>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 24px', background: '#F8FAFC', borderBottom: '1px solid #F1F5F9' }}>
              {disputeMode && <div style={{ width: 15 }} />}
              <div style={{ flex: 1, fontSize: 10, fontWeight: 700, color: '#94A3B8', letterSpacing: '0.08em', textTransform: 'uppercase' }}>Service</div>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#94A3B8', letterSpacing: '0.08em', textTransform: 'uppercase', minWidth: 56, textAlign: 'right' }}>Total</div>
            </div>

            <div style={{ paddingTop: 4, paddingBottom: 4 }}>
              {lineItems.length === 0
                ? <div style={{ padding: '20px', textAlign: 'center', fontSize: 12, color: '#94A3B8' }}>No line items found.</div>
                : lineItems.map(item => (
                  <LineItemRow key={item.id} item={item} disputeMode={disputeMode}
                    selected={selectedIds.includes(item.id)} onToggle={toggleItem} />
                ))}
            </div>

            {invoice.total_amount && (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 24px', borderTop: '1px solid #F1F5F9', background: '#F8FAFC' }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.07em' }}>Invoice Total</span>
                <span style={{ fontSize: 15, fontWeight: 800, color: '#0F172A' }}>${Number(invoice.total_amount).toFixed(2)}</span>
              </div>
            )}

            {invoice.is_confirmed && !invoice.is_archived && invoice.dispute_status !== 'disputed' && (
              !disputeMode ? (
                <div style={{ padding: '10px 16px', borderTop: '1px solid #F1F5F9', display: 'flex', justifyContent: 'flex-end' }}>
                  <button onClick={() => setDisputeMode(true)} style={{ display: 'flex', alignItems: 'center', gap: 6,
                    background: 'none', border: '1px solid #FECACA', color: '#DC2626',
                    padding: '7px 14px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                    🚩 Dispute an Item
                  </button>
                </div>
              ) : (
                <div style={{ padding: '14px 16px', borderTop: '1.5px solid #FECACA', background: '#FFF8F8' }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#991B1B', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span>Select items to dispute</span>
                    {selectedIds.length > 0 && (
                      <span style={{ background: '#DC2626', color: '#fff', borderRadius: 999, padding: '1px 8px', fontSize: 10, fontWeight: 700 }}>{selectedIds.length} selected</span>
                    )}
                  </div>
                  {selectedIds.length > 0 && (
                    <div style={{ background: '#FEE2E2', borderRadius: 8, padding: '8px 12px', marginBottom: 10, fontSize: 11, color: '#991B1B' }}>
                      <span style={{ fontWeight: 700 }}>Disputing: </span>{disputedLabels.join(', ')}
                    </div>
                  )}
                  <textarea value={reason} onChange={e => setReason(e.target.value)}
                    placeholder="Describe the issue (optional)…" rows={2}
                    style={{ width: '100%', fontSize: 12, border: '1px solid #FECACA', borderRadius: 8,
                      padding: '8px 10px', resize: 'none', background: '#fff', color: '#1E293B',
                      outline: 'none', fontFamily: 'inherit', marginBottom: 10, boxSizing: 'border-box' }} />
                  {lineItems.some(i => i.unit_price === null || i.unit_price === undefined) && (
                    <div style={{ fontSize: 10, color: '#94A3B8', marginBottom: 10 }}>* Complimentary items cannot be disputed.</div>
                  )}
                  {submitError && (
                    <div style={{ fontSize: 11, color: '#DC2626', background: '#FEF2F2', borderRadius: 6, padding: '6px 10px', marginBottom: 10 }}>{submitError}</div>
                  )}
                  <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                    <button onClick={() => { setDisputeMode(false); setSelectedIds([]); setReason(''); setSubmitError(null); }}
                      style={{ background: 'none', border: '1px solid #E2E8F0', color: '#64748B', padding: '7px 14px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                      Cancel
                    </button>
                    <button onClick={handleSubmit} disabled={selectedIds.length === 0 || submitting}
                      style={{ background: selectedIds.length > 0 && !submitting ? '#DC2626' : '#F1F5F9',
                        color: selectedIds.length > 0 && !submitting ? '#fff' : '#94A3B8',
                        border: 'none', padding: '7px 18px', borderRadius: 8, fontSize: 12, fontWeight: 700,
                        cursor: selectedIds.length > 0 && !submitting ? 'pointer' : 'not-allowed' }}>
                      {submitting ? 'Submitting…' : 'Submit Dispute'}
                    </button>
                  </div>
                </div>
              )
            )}

            {invoice.dispute_status === 'disputed' && (
              <div style={{ padding: '10px 16px', borderTop: '1px solid #F1F5F9', display: 'flex', justifyContent: 'flex-end' }}>
                <Link to={`/invoice/${invoice.id}/dispute`} style={{ padding: '7px 14px', borderRadius: 8, fontSize: 12, fontWeight: 600, textDecoration: 'none', background: '#1D4ED8', color: '#fff' }}>
                  ⚖️ Resolve Dispute
                </Link>
              </div>
            )}
          </>)}
        </div>
      )}
    </div>
  );
}

export default function VehicleDetail() {
  const { id } = useParams();
  const [vehicle, setVehicle]           = useState(null);
  const [allInvoices, setAllInvoices]   = useState([]);
  const [invoices, setInvoices]         = useState([]);
  const [loading, setLoading]           = useState(true);
  const [showArchived, setShowArchived] = useState(false);
  const [search, setSearch]             = useState('');
  const [filterType, setFilterType]     = useState('');
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef(null);

  const allServiceTypes = [...new Set(allInvoices.flatMap(inv => inv.service_tags || []))].sort();

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const [vRes, iRes] = await Promise.all([getVehicle(id), getVehicleInvoicesWithTags(id, showArchived)]);
        setVehicle(vRes.data);
        setAllInvoices(iRes.data);
      } catch (e) { console.error(e); }
      finally { setLoading(false); }
    }
    load();
  }, [id, showArchived]);

  useEffect(() => {
    let filtered = allInvoices;
    if (search) {
      const q = search.toLowerCase();
      filtered = filtered.filter(inv =>
        (inv.shop_name || '').toLowerCase().includes(q) ||
        (inv.service_tags || []).some(t => t.toLowerCase().includes(q))
      );
    }
    if (filterType) filtered = filtered.filter(inv => (inv.service_tags || []).includes(filterType));
    setInvoices(filtered);
  }, [search, filterType, allInvoices]);

  useEffect(() => {
    function handleClick(e) { if (dropdownRef.current && !dropdownRef.current.contains(e.target)) setDropdownOpen(false); }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const handleDisputeSubmit = (invoiceId) => {
    setAllInvoices(prev => prev.map(inv =>
      inv.id === invoiceId ? { ...inv, has_active_dispute: true, dispute_status: 'disputed' } : inv
    ));
  };

  if (loading) return (
    <div style={{ maxWidth: 760, margin: '0 auto', padding: '60px 24px', textAlign: 'center' }}>
      <div style={{ width: 36, height: 36, border: '2.5px solid #E2E8F0', borderTopColor: '#2563EB', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto' }} />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );

  if (!vehicle) return <div style={{ maxWidth: 760, margin: '0 auto', padding: '48px 24px', textAlign: 'center', color: '#EF4444', fontSize: 14 }}>Vehicle not found.</div>;

  const activeFilters = (search ? 1 : 0) + (filterType ? 1 : 0);

  return (
    <div style={{ minHeight: '100vh', background: '#F0F4F8', fontFamily: "'DM Sans', 'Segoe UI', sans-serif" }}>
      <div style={{ background: '#fff', borderBottom: '1px solid #E2E8F0' }}>
        <div style={{ maxWidth: 720, margin: '0 auto', padding: '14px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Link to="/" style={{ width: 30, height: 30, borderRadius: 8, background: '#F8FAFC', border: '1px solid #E2E8F0', color: '#64748B', textDecoration: 'none', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>←</Link>
            <div>
              <div style={{ fontSize: 16, fontWeight: 800, color: '#0F172A' }}>{vehicle.nickname || `${vehicle.year} ${vehicle.make} ${vehicle.model}`}</div>
              <div style={{ fontSize: 10, color: '#94A3B8' }}>{vehicle.year} {vehicle.make} {vehicle.model}{vehicle.vin ? ` · VIN ${vehicle.vin}` : ''}</div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <Link to={`/vehicle/${id}/upload`} style={{ background: '#1D4ED8', color: '#fff', borderRadius: 9, padding: '7px 14px', fontSize: 12, fontWeight: 700, textDecoration: 'none' }}>+ Upload Invoice</Link>
            <Link to={`/vehicle/${id}/recommendations`} style={{ background: 'transparent', color: '#1D4ED8', border: '1px solid #BFDBFE', borderRadius: 9, padding: '7px 14px', fontSize: 12, fontWeight: 600, textDecoration: 'none' }}>Recommendations</Link>
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 720, margin: '0 auto', padding: '20px 16px' }}>
        <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
          <div style={{ flex: 1, position: 'relative' }}>
            <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', fontSize: 14, color: '#94A3B8' }}>🔍</span>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by service type or shop…"
              style={{ width: '100%', paddingLeft: 36, paddingRight: search ? 32 : 14, paddingTop: 10, paddingBottom: 10,
                fontSize: 13, border: '1.5px solid #E2E8F0', borderRadius: 11, background: '#fff', color: '#1E293B',
                outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' }}
              onFocus={e => e.target.style.borderColor = '#93C5FD'}
              onBlur={e => e.target.style.borderColor = '#E2E8F0'} />
            {search && (
              <button onClick={() => setSearch('')} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: '#E2E8F0', border: 'none', borderRadius: '50%', width: 18, height: 18, cursor: 'pointer', fontSize: 10, color: '#64748B', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
            )}
          </div>
          <div ref={dropdownRef} style={{ position: 'relative' }}>
            <button onClick={() => setDropdownOpen(d => !d)} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '10px 14px', borderRadius: 11, fontSize: 12, fontWeight: 600,
              border: filterType ? '1.5px solid #93C5FD' : '1.5px solid #E2E8F0', background: filterType ? '#EFF6FF' : '#fff', color: filterType ? '#1D4ED8' : '#475569', cursor: 'pointer', whiteSpace: 'nowrap' }}>
              <span>⚙</span><span>{filterType || 'Filter'}</span>
              {filterType && <span onClick={e => { e.stopPropagation(); setFilterType(''); }} style={{ marginLeft: 2, color: '#93C5FD', fontWeight: 700 }}>✕</span>}
            </button>
            {dropdownOpen && allServiceTypes.length > 0 && (
              <div style={{ position: 'absolute', right: 0, top: 'calc(100% + 6px)', width: 230, background: '#fff', border: '1.5px solid #E2E8F0', borderRadius: 12, boxShadow: '0 8px 32px rgba(0,0,0,0.12)', zIndex: 50, overflow: 'hidden' }}>
                <div style={{ padding: '8px 12px 6px', fontSize: 10, fontWeight: 700, color: '#94A3B8', letterSpacing: '0.08em', textTransform: 'uppercase', borderBottom: '1px solid #F1F5F9' }}>Filter by Service Type</div>
                <div style={{ maxHeight: 240, overflowY: 'auto' }}>
                  {allServiceTypes.map(type => (
                    <button key={type} onClick={() => { setFilterType(type); setDropdownOpen(false); }}
                      style={{ width: '100%', textAlign: 'left', padding: '9px 14px', fontSize: 12, fontWeight: filterType === type ? 700 : 400,
                        color: filterType === type ? '#1D4ED8' : '#334155', background: filterType === type ? '#EFF6FF' : 'transparent',
                        border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}>
                      <ServiceTag label={type} small />
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 12, color: '#64748B' }}>
            <span>{invoices.length === allInvoices.length
              ? <><strong style={{ color: '#334155' }}>{allInvoices.length}</strong> invoices</>
              : <><strong style={{ color: '#334155' }}>{invoices.length}</strong> of {allInvoices.length} invoices</>}</span>
            <label style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer', userSelect: 'none' }}>
              <input type="checkbox" checked={showArchived} onChange={e => setShowArchived(e.target.checked)} style={{ accentColor: '#2563EB', width: 12, height: 12 }} />
              Show archived
            </label>
          </div>
          {activeFilters > 0 && (
            <button onClick={() => { setSearch(''); setFilterType(''); }} style={{ fontSize: 11, color: '#2563EB', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}>Clear filters</button>
          )}
        </div>

        {invoices.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '48px 24px', background: '#fff', borderRadius: 16, border: '1.5px solid #E2E8F0' }}>
            <div style={{ fontSize: 36, marginBottom: 10 }}>{allInvoices.length === 0 ? '📄' : '🔍'}</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#334155', marginBottom: 6 }}>{allInvoices.length === 0 ? 'No invoices yet' : 'No invoices match'}</div>
            {allInvoices.length === 0
              ? <Link to={`/vehicle/${id}/upload`} style={{ fontSize: 13, color: '#2563EB', fontWeight: 600 }}>Upload your first invoice →</Link>
              : <button onClick={() => { setSearch(''); setFilterType(''); }} style={{ background: '#2563EB', color: '#fff', border: 'none', padding: '8px 18px', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>Clear Filters</button>}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {invoices.map(inv => <InvoiceCard key={inv.id} invoice={inv} onDisputeSubmit={handleDisputeSubmit} />)}
          </div>
        )}
      </div>
      {/* ARIA chat widget */}
      <AriaChat vehicleId={vehicle?.id || null} vehicleName={vehicle ? vehicle.year + " " + vehicle.make + " " + vehicle.model : ""} currentMileage={vehicle?.current_mileage || null} />
    </div>
  );
}
