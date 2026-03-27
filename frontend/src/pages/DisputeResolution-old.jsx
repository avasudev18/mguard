import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { getInvoice, raiseDispute, resolveDispute, getDisputeHistory } from '../services/api';
import AriaChat from '../components/AriaChat';


// ── Status badge helper ────────────────────────────────────────────────────────
const STATUS_CONFIG = {
  disputed:          { label: 'Disputed',           bg: 'bg-yellow-100',  text: 'text-yellow-800',  border: 'border-yellow-300',  icon: '⚠️' },
  proven_upsell:     { label: 'Proven Upsell',      bg: 'bg-red-100',     text: 'text-red-800',     border: 'border-red-300',     icon: '🚨' },
  proven_duplicate:  { label: 'Proven Duplicate',   bg: 'bg-red-100',     text: 'text-red-800',     border: 'border-red-300',     icon: '🚨' },
  dismissed:         { label: 'Dismissed',           bg: 'bg-gray-100',    text: 'text-gray-600',    border: 'border-gray-300',    icon: '✅' },
  null:              { label: 'No Dispute',          bg: 'bg-green-100',   text: 'text-green-800',   border: 'border-green-300',   icon: '✅' },
};

function StatusBadge({ status }) {
  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.null;
  return (
    <span className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-sm font-semibold border ${cfg.bg} ${cfg.text} ${cfg.border}`}>
      <span>{cfg.icon}</span> {cfg.label}
    </span>
  );
}

// ── Step indicator ─────────────────────────────────────────────────────────────
function StepIndicator({ currentStep }) {
  const steps = ['Review Invoice', 'Raise Dispute', 'Dealer Confirms', 'Archived'];
  return (
    <div className="flex items-center justify-center gap-0 mb-8">
      {steps.map((label, i) => {
        const stepNum = i + 1;
        const done    = stepNum < currentStep;
        const active  = stepNum === currentStep;
        return (
          <div key={label} className="flex items-center">
            <div className="flex flex-col items-center">
              <div className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold border-2 transition-all
                ${done   ? 'bg-blue-600 border-blue-600 text-white' : ''}
                ${active ? 'bg-white border-blue-600 text-blue-600 ring-4 ring-blue-100' : ''}
                ${!done && !active ? 'bg-white border-gray-300 text-gray-400' : ''}
              `}>
                {done ? '✓' : stepNum}
              </div>
              <span className={`text-xs mt-1 font-medium whitespace-nowrap
                ${active ? 'text-blue-700' : done ? 'text-blue-500' : 'text-gray-400'}
              `}>{label}</span>
            </div>
            {i < steps.length - 1 && (
              <div className={`w-16 h-0.5 mb-5 mx-1 ${done ? 'bg-blue-600' : 'bg-gray-200'}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────
export default function DisputeResolution() {
  const { invoiceId } = useParams();

  const [invoice,        setInvoice]        = useState(null);
  const [auditLog,       setAuditLog]       = useState([]);
  const [loading,        setLoading]        = useState(true);
  const [error,          setError]          = useState('');
  const [successMsg,     setSuccessMsg]     = useState('');
  const [activeTab,      setActiveTab]      = useState('dispute'); // 'dispute' | 'audit'
  const [submitting,     setSubmitting]     = useState(false);

  // Raise dispute form
  const [raiseForm, setRaiseForm] = useState({
    dispute_type:  'upsell',
    dispute_notes: '',
  });

  // Resolve dispute form
  const [resolveForm, setResolveForm] = useState({
    resolution_status: 'proven',
    confirmed_by:      'dealer_confirmed',
    dealer_name:       '',
    refund_amount:     '',
    evidence_notes:    '',
  });

  useEffect(() => {
    loadData();
  }, [invoiceId]);

  async function loadData() {
    setLoading(true);
    setError('');
    try {
      const [invRes, auditRes] = await Promise.all([
        getInvoice(invoiceId),
        getDisputeHistory(invoiceId),
      ]);
      setInvoice(invRes.data);
      setAuditLog(auditRes.data);
    } catch (e) {
      setError(e?.response?.data?.detail || 'Failed to load invoice data.');
    } finally {
      setLoading(false);
    }
  }

  async function handleRaiseDispute(e) {
    e.preventDefault();
    setSubmitting(true);
    setError('');
    setSuccessMsg('');
    try {
      await raiseDispute(invoiceId, {
        dispute_type:  raiseForm.dispute_type,
        dispute_notes: raiseForm.dispute_notes || null,
      });
      setSuccessMsg('Dispute raised successfully. The invoice is now flagged for review.');
      await loadData();
    } catch (e) {
      setError(e?.response?.data?.detail || 'Failed to raise dispute.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleResolveDispute(e) {
    e.preventDefault();
    setSubmitting(true);
    setError('');
    setSuccessMsg('');
    try {
      await resolveDispute(invoiceId, {
        resolution_status: resolveForm.resolution_status,
        confirmed_by:      resolveForm.confirmed_by,
        dealer_name:       resolveForm.dealer_name   || null,
        refund_amount:     resolveForm.refund_amount ? parseFloat(resolveForm.refund_amount) : null,
        evidence_notes:    resolveForm.evidence_notes || null,
      });
      const action = resolveForm.resolution_status === 'dismissed'
        ? 'Dispute dismissed. Invoice remains active.'
        : 'Disputed service records excluded from your timeline. Invoice archived only if all items were disputed.';
      setSuccessMsg(`Dispute resolved. ${action} An immutable audit record has been saved.`);
      await loadData();
    } catch (e) {
      setError(e?.response?.data?.detail || 'Failed to resolve dispute.');
    } finally {
      setSubmitting(false);
    }
  }

  // Derive which step we're on
  function getStep(invoice) {
    if (!invoice) return 1;
    if (invoice.is_archived) return 4;
    if (invoice.dispute_status === 'disputed') return 3;
    if (invoice.dispute_status && invoice.dispute_status !== 'dismissed') return 4;
    return invoice.is_confirmed ? 2 : 1;
  }

  // ── Render ──────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div style={{maxWidth:900,margin:"0 auto",padding:"60px 40px",textAlign:"center"}}>
        <div className="animate-spin rounded-full h-12 w-12 border-4 border-blue-600 border-t-transparent mx-auto mb-4" />
        <p className="text-gray-500">Loading invoice data…</p>
      </div>
    );
  }

  if (!invoice) {
    return (
      <div style={{maxWidth:900,margin:"0 auto",padding:"48px 40px",textAlign:"center"}}>
        <p className="text-red-500 text-lg">{error || 'Invoice not found.'}</p>
        <Link to="/" className="mt-4 inline-block text-blue-600 underline">← Back to Dashboard</Link>
      </div>
    );
  }

  const step = getStep(invoice);
  const canRaiseDispute   = invoice.is_confirmed && !invoice.dispute_status && !invoice.is_archived;
  const canResolveDispute = invoice.dispute_status === 'disputed';
  const isFullyResolved   = invoice.is_archived || (invoice.dispute_status && invoice.dispute_status !== 'disputed');

  return (
    <div className="max-w-7xl mx-auto" style={{maxWidth:900,margin:"0 auto",padding:"32px 40px"}}>

      {/* Page header */}
      <div className="flex items-center gap-3 mb-6">
        <Link to="/" className="text-gray-400 hover:text-gray-600 transition" style={{display:"flex",alignItems:"center",justifyContent:"center",width:32,height:32,borderRadius:8,border:"1px solid #E2E8F0",background:"#fff",textDecoration:"none"}}>
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </Link>
        
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Dispute Resolution</h1>
          <p className="text-sm text-gray-500">Invoice #{invoice.id} · {invoice.shop_name || 'Unknown Shop'}</p>
        </div>
        <div className="ml-auto">
          <StatusBadge status={invoice.dispute_status} />
        </div>
      </div>

      {/* Step indicator */}
      <StepIndicator currentStep={step} />

      {/* Feedback banners */}
      {successMsg && (
        <div className="mb-5 bg-green-50 border border-green-300 rounded-xl p-4 flex items-start gap-3">
          <span className="text-green-600 text-xl mt-0.5">✅</span>
          <p className="text-green-800 font-medium">{successMsg}</p>
        </div>
      )}
      {error && (
        <div className="mb-5 bg-red-50 border border-red-300 rounded-xl p-4 flex items-start gap-3">
          <span className="text-red-500 text-xl mt-0.5">⚠️</span>
          <p className="text-red-700 font-medium">{error}</p>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-gray-100 p-1 rounded-xl w-fit">
        {['dispute', 'audit'].map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-5 py-2 rounded-lg text-sm font-semibold transition-all ${
              activeTab === tab
                ? 'bg-white text-blue-700 shadow'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab === 'dispute' ? '🛡️ Dispute Workflow' : `📋 Audit Log (${auditLog.length})`}
          </button>
        ))}
      </div>

      {/* ── Tab: Dispute Workflow ── */}
      {activeTab === 'dispute' && (
        <div className="space-y-6">

          {/* Invoice summary card */}
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="bg-gradient-to-r from-slate-700 to-slate-800 px-6 py-4">
              <h2 className="text-white font-bold text-lg">Invoice Summary</h2>
            </div>
            <div className="p-6 grid grid-cols-2 md:grid-cols-4 gap-4">
              <Stat label="Service Date"    value={invoice.service_date ? new Date(invoice.service_date).toLocaleDateString() : '—'} />
              <Stat label="Shop"            value={invoice.shop_name || '—'} />
              <Stat label="Mileage"         value={invoice.mileage_at_service ? `${invoice.mileage_at_service.toLocaleString()} mi` : '—'} />
              <Stat label="Total"           value={invoice.total_amount ? `$${invoice.total_amount.toFixed(2)}` : '—'} />
            </div>
            {invoice.line_items?.length > 0 && (() => {
              const disputedItems  = invoice.line_items.filter(i => i.is_disputed);
              const remainingItems = invoice.line_items.filter(i => !i.is_disputed);
              return (
                <div className="border-t border-gray-100 px-6 pb-5">
                  {/* Disputed items — shown first with amber highlight */}
                  {disputedItems.length > 0 && (
                    <>
                      <div className="flex items-center gap-2 mb-2 mt-4">
                        <p className="text-xs uppercase tracking-widest text-amber-600 font-semibold">
                          ⚠ Disputed Items
                        </p>
                        <span className="text-xs bg-amber-100 text-amber-700 border border-amber-300 rounded-full px-2 py-0.5 font-bold">
                          {disputedItems.length}
                        </span>
                      </div>
                      <div className="space-y-2 mb-4">
                        {disputedItems.map(item => (
                          <div key={item.id}
                            className="flex justify-between items-center text-sm bg-amber-50 border border-amber-200 rounded-lg px-4 py-2">
                            <div className="flex items-center gap-2">
                              <span className="text-amber-500 font-bold text-xs">⚠</span>
                              <span className="font-semibold text-amber-900">{item.service_type}</span>
                              <span className="text-xs bg-amber-200 text-amber-800 rounded-full px-2 py-0.5 font-semibold">
                                Under Dispute
                              </span>
                            </div>
                            <span className="font-semibold text-amber-800">
                              {item.line_total ? `$${item.line_total.toFixed(2)}` : '—'}
                            </span>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                  {/* Remaining (non-disputed) items */}
                  {remainingItems.length > 0 && (
                    <>
                      <p className="text-xs uppercase tracking-widest text-gray-400 mb-2 font-semibold">
                        {disputedItems.length > 0 ? 'Other Line Items' : 'Line Items'}
                      </p>
                      <div className="space-y-2">
                        {remainingItems.map(item => (
                          <div key={item.id}
                            className="flex justify-between items-center text-sm text-gray-700 bg-gray-50 rounded-lg px-4 py-2">
                            <span className="font-medium">{item.service_type}</span>
                            <span className="text-gray-500">
                              {item.line_total ? `$${item.line_total.toFixed(2)}` : '—'}
                            </span>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              );
            })()}
          </div>

          {/* Resolved state */}
          {isFullyResolved && (
            <div className={`rounded-2xl border-2 p-6 ${
              invoice.is_archived
                ? 'bg-red-50 border-red-200'
                : 'bg-gray-50 border-gray-200'
            }`}>
              <div className="flex items-center gap-3 mb-3">
                <span className="text-3xl">{invoice.is_archived ? '🗄️' : '✅'}</span>
                <div>
                  <h3 className="font-bold text-lg text-gray-800">
                    {invoice.is_archived ? 'Invoice Archived' : 'Dispute Dismissed'}
                  </h3>
                  <p className="text-sm text-gray-500">
                    Resolved {invoice.dispute_resolved_at
                      ? new Date(invoice.dispute_resolved_at).toLocaleString()
                      : '—'}
                    {invoice.dispute_confirmed_by && ` · Confirmed by: ${invoice.dispute_confirmed_by.replace(/_/g, ' ')}`}
                  </p>
                </div>
              </div>
              {invoice.is_archived && (
                <div className="mt-3 bg-white rounded-xl border border-red-100 p-4 text-sm text-gray-700 space-y-1">
                  <p>✅ Invoice hidden from normal views</p>
                  <p>✅ Service records excluded from timeline &amp; recommendation engine</p>
                  <p>✅ Immutable audit record saved — data is <strong>never deleted</strong></p>
                  <p>✅ Full invoice snapshot preserved for legal/audit purposes</p>
                </div>
              )}
              <p className="mt-4 text-xs text-gray-400">View the full audit trail in the Audit Log tab →</p>
            </div>
          )}

          {/* Step 1 → 2: Raise a dispute */}
          {canRaiseDispute && (
            <div className="bg-white rounded-2xl border border-amber-200 shadow-sm overflow-hidden">
              <div className="bg-gradient-to-r from-amber-500 to-orange-500 px-6 py-4">
                <h2 className="text-white font-bold text-lg">Step 1 — Raise a Dispute</h2>
                <p className="text-amber-100 text-sm mt-0.5">Flag this invoice for review. No records will be deleted at this stage.</p>
              </div>
              <form onSubmit={handleRaiseDispute} className="p-6 space-y-5">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Dispute Type</label>
                  <div className="grid grid-cols-2 gap-3">
                    {[
                      { value: 'upsell',              label: '🚗 Unnecessary Upsell',   desc: 'Service performed too soon or not needed' },
                      { value: 'duplicate',            label: '📄 Duplicate Charge',     desc: 'Same service charged twice' },
                      { value: 'unauthorized_charge',  label: '🚫 Unauthorized Charge',  desc: 'Work performed without consent' },
                      { value: 'other',                label: '❓ Other',                desc: 'Other billing discrepancy' },
                    ].map(opt => (
                      <label key={opt.value} className={`cursor-pointer rounded-xl border-2 p-3 transition-all ${
                        raiseForm.dispute_type === opt.value
                          ? 'border-amber-500 bg-amber-50'
                          : 'border-gray-200 hover:border-gray-300'
                      }`}>
                        <input
                          type="radio"
                          name="dispute_type"
                          value={opt.value}
                          checked={raiseForm.dispute_type === opt.value}
                          onChange={e => setRaiseForm(f => ({ ...f, dispute_type: e.target.value }))}
                          className="sr-only"
                        />
                        <p className="font-semibold text-sm text-gray-800">{opt.label}</p>
                        <p className="text-xs text-gray-500 mt-0.5">{opt.desc}</p>
                      </label>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Notes <span className="text-gray-400 font-normal">(optional)</span></label>
                  <textarea
                    rows={3}
                    value={raiseForm.dispute_notes}
                    onChange={e => setRaiseForm(f => ({ ...f, dispute_notes: e.target.value }))}
                    placeholder="Describe why you believe this charge is incorrect…"
                    className="w-full border border-gray-300 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                  />
                </div>
                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full bg-amber-500 hover:bg-amber-600 disabled:bg-amber-300 text-white font-bold py-3 rounded-xl transition-colors"
                >
                  {submitting ? 'Raising Dispute…' : '⚠️ Raise Dispute'}
                </button>
              </form>
            </div>
          )}

          {/* Step 2 → 3: Resolve the dispute */}
          {canResolveDispute && (
            <div className="bg-white rounded-2xl border border-blue-200 shadow-sm overflow-hidden">
              <div className="bg-gradient-to-r from-blue-600 to-blue-700 px-6 py-4">
                <h2 className="text-white font-bold text-lg">Step 2 — Resolve the Dispute</h2>
                <p className="text-blue-200 text-sm mt-0.5">
                  Once the dealer confirms or the dispute is decided, record the resolution here.
                  When proven, the invoice is archived — <strong>never deleted</strong>.
                </p>
              </div>
              <form onSubmit={handleResolveDispute} className="p-6 space-y-5">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Resolution Outcome</label>
                  <div className="grid grid-cols-3 gap-3">
                    {[
                      { value: 'proven',    label: '🚨 Proven',    desc: 'Dispute upheld; disputed records excluded', color: 'red' },
                      { value: 'dismissed', label: '✅ Dismissed',  desc: 'Dispute not upheld; invoice stays', color: 'gray' },
                      { value: 'partial',   label: '⚖️ Partial',    desc: 'Partially upheld; disputed records excluded', color: 'orange' },
                    ].map(opt => {
                      const borders = { red: 'border-red-400 bg-red-50', gray: 'border-gray-400 bg-gray-50', orange: 'border-orange-400 bg-orange-50' };
                      return (
                        <label key={opt.value} className={`cursor-pointer rounded-xl border-2 p-3 transition-all ${
                          resolveForm.resolution_status === opt.value
                            ? borders[opt.color]
                            : 'border-gray-200 hover:border-gray-300'
                        }`}>
                          <input
                            type="radio"
                            name="resolution_status"
                            value={opt.value}
                            checked={resolveForm.resolution_status === opt.value}
                            onChange={e => setResolveForm(f => ({ ...f, resolution_status: e.target.value }))}
                            className="sr-only"
                          />
                          <p className="font-semibold text-sm text-gray-800">{opt.label}</p>
                          <p className="text-xs text-gray-500 mt-0.5">{opt.desc}</p>
                        </label>
                      );
                    })}
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Confirmed By</label>
                  <select
                    value={resolveForm.confirmed_by}
                    onChange={e => setResolveForm(f => ({ ...f, confirmed_by: e.target.value }))}
                    className="w-full border border-gray-300 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                  >
                    <option value="dealer_confirmed">Dealer Confirmed</option>
                    <option value="user_self_resolved">User Self-Resolved</option>
                    <option value="admin_decision">Admin Decision</option>
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">Dealer Name <span className="text-gray-400 font-normal">(optional)</span></label>
                    <input
                      type="text"
                      value={resolveForm.dealer_name}
                      onChange={e => setResolveForm(f => ({ ...f, dealer_name: e.target.value }))}
                      placeholder="e.g. Toyota of Dallas"
                      className="w-full border border-gray-300 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">Refund Amount <span className="text-gray-400 font-normal">(optional)</span></label>
                    <div className="relative">
                      <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 font-medium">$</span>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={resolveForm.refund_amount}
                        onChange={e => setResolveForm(f => ({ ...f, refund_amount: e.target.value }))}
                        placeholder="0.00"
                        className="w-full border border-gray-300 rounded-xl pl-8 pr-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                      />
                    </div>
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Evidence Notes <span className="text-gray-400 font-normal">(optional)</span></label>
                  <textarea
                    rows={3}
                    value={resolveForm.evidence_notes}
                    onChange={e => setResolveForm(f => ({ ...f, evidence_notes: e.target.value }))}
                    placeholder="Summarise what the dealer said, any documentation received, etc…"
                    className="w-full border border-gray-300 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                  />
                </div>
                {resolveForm.resolution_status !== 'dismissed' && (
                  <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800">
                    <strong>What happens when you click Resolve:</strong>
                    <ul className="mt-2 space-y-1 list-disc list-inside">
                      <li>Only the <strong>disputed service records</strong> are excluded from your timeline and recommendation engine</li>
                      <li>Non-disputed services on this invoice remain in your history</li>
                      <li>Invoice is <strong>archived</strong> only if every line item was part of this dispute</li>
                      <li>An <strong>immutable audit record</strong> with a full invoice snapshot is saved permanently</li>
                    </ul>
                  </div>
                )}
                <button
                  type="submit"
                  disabled={submitting}
                  className={`w-full font-bold py-3 rounded-xl transition-colors text-white ${
                    resolveForm.resolution_status === 'dismissed'
                      ? 'bg-gray-600 hover:bg-gray-700 disabled:bg-gray-400'
                      : 'bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300'
                  }`}
                >
                  {submitting ? 'Resolving…' : `Confirm Resolution — ${resolveForm.resolution_status.charAt(0).toUpperCase() + resolveForm.resolution_status.slice(1)}`}
                </button>
              </form>
            </div>
          )}
        </div>
      )}

      {/* ── Tab: Audit Log ── */}
      {activeTab === 'audit' && (
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="bg-gradient-to-r from-slate-700 to-slate-800 px-6 py-4 flex items-center justify-between">
            <div>
              <h2 className="text-white font-bold text-lg">Immutable Audit Log</h2>
              <p className="text-slate-300 text-sm mt-0.5">These records are never deleted — retained for legal compliance.</p>
            </div>
            <span className="bg-slate-600 text-white text-sm font-bold px-3 py-1 rounded-full">
              {auditLog.length} record{auditLog.length !== 1 ? 's' : ''}
            </span>
          </div>

          {auditLog.length === 0 ? (
            <div className="p-12 text-center text-gray-400">
              <p className="text-4xl mb-3">📋</p>
              <p className="font-medium">No audit records yet.</p>
              <p className="text-sm mt-1">Records will appear here once a dispute is raised and resolved.</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {auditLog.map((record, idx) => (
                <AuditRecord key={record.id} record={record} index={idx} total={auditLog.length} />
              ))}
            </div>
          )}
        </div>
      )}
      {/* ARIA chat widget */}
      <AriaChat vehicleId={vehicleId ? parseInt(vehicleId) : null} vehicleName="" />
    </div>
  );
}

// ── Audit Record Row ───────────────────────────────────────────────────────────
function AuditRecord({ record, index, total }) {
  const [expanded, setExpanded] = useState(false);

  const statusColors = {
    proven:    'bg-red-100 text-red-700 border-red-200',
    dismissed: 'bg-gray-100 text-gray-600 border-gray-200',
    partial:   'bg-orange-100 text-orange-700 border-orange-200',
    pending:   'bg-yellow-100 text-yellow-700 border-yellow-200',
  };

  return (
    <div className="p-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 rounded-full bg-slate-700 text-white text-xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5">
            {total - index}
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`text-xs font-bold px-2 py-0.5 rounded-full border uppercase tracking-wide ${statusColors[record.resolution_status] || ''}`}>
                {record.resolution_status}
              </span>
              <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
                {record.dispute_type.replace(/_/g, ' ')}
              </span>
              <span className="text-xs text-gray-400">
                {record.confirmed_by.replace(/_/g, ' ')}
              </span>
            </div>
            <p className="text-sm text-gray-500 mt-1">
              Resolved {new Date(record.resolved_at).toLocaleString()}
            </p>
            {record.dealer_name && (
              <p className="text-sm text-gray-600 mt-1">🏢 {record.dealer_name}</p>
            )}
            {record.evidence_notes && (
              <p className="text-sm text-gray-600 mt-1 italic">"{record.evidence_notes}"</p>
            )}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1 flex-shrink-0">
          {record.original_amount != null && (
            <span className="text-sm font-semibold text-gray-700">${record.original_amount}</span>
          )}
          {record.refund_amount != null && (
            <span className="text-sm font-semibold text-green-600">↩ ${record.refund_amount} refund</span>
          )}
        </div>
      </div>
      {record.invoice_snapshot && (
        <div className="mt-3 ml-11">
          <button
            onClick={() => setExpanded(v => !v)}
            className="text-xs text-blue-600 hover:text-blue-800 font-medium flex items-center gap-1"
          >
            {expanded ? '▲ Hide' : '▼ View'} invoice snapshot ({record.invoice_snapshot.line_items?.length || 0} line items)
          </button>
          {expanded && (
            <div className="mt-3 bg-gray-50 rounded-xl border border-gray-200 overflow-hidden">
              <div className="bg-gray-100 px-4 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                Invoice Snapshot — captured at resolution time
              </div>
              <div className="p-4">
                <div className="grid grid-cols-2 gap-2 text-xs text-gray-600 mb-3">
                  <span><strong>Shop:</strong> {record.invoice_snapshot.shop_name || '—'}</span>
                  <span><strong>Date:</strong> {record.invoice_snapshot.service_date ? new Date(record.invoice_snapshot.service_date).toLocaleDateString() : '—'}</span>
                  <span><strong>Mileage:</strong> {record.invoice_snapshot.mileage_at_service?.toLocaleString() || '—'} mi</span>
                  <span><strong>Total:</strong> ${record.invoice_snapshot.total_amount || '—'}</span>
                </div>
                {record.invoice_snapshot.line_items?.length > 0 && (
                  <div className="space-y-1">
                    {record.invoice_snapshot.line_items.map((item, i) => (
                      <div key={i} className="flex justify-between text-xs bg-white border border-gray-100 rounded-lg px-3 py-2">
                        <span className="font-medium text-gray-700">{item.service_type}</span>
                        <span className="text-gray-500">{item.line_total ? `$${item.line_total}` : '—'}</span>
                      </div>
                    ))}
                  </div>
                )}
                <p className="text-xs text-gray-400 mt-2">Snapshot taken: {record.invoice_snapshot.snapshot_taken_at ? new Date(record.invoice_snapshot.snapshot_taken_at).toLocaleString() : '—'}</p>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-widest text-gray-400 font-semibold">{label}</p>
      <p className="text-sm font-semibold text-gray-800 mt-0.5">{value}</p>
    </div>
  );
}
