import { useState } from 'react';
import AriaChat from '../components/AriaChat';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { uploadInvoice, confirmInvoice, batchDisputeInvoice, deleteInvoice } from '../services/api';


// ─── Step indicator ───────────────────────────────────────────────────────────
function Steps({ current }) {
  const steps = ['Upload', 'Review & Edit', 'Analysis & Dispute'];
  return (
    <div className="flex items-center gap-2 mb-8">
      {steps.map((label, i) => {
        const idx = i + 1;
        const done = current > idx;
        const active = current === idx;
        return (
          <div key={label} className="flex items-center gap-2">
            <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold border-2 transition-colors ${
              done    ? 'bg-green-500 border-green-500 text-white'
              : active ? 'bg-blue-600 border-blue-600 text-white'
              :          'bg-white border-gray-300 text-gray-400'
            }`}>
              {done ? '✓' : idx}
            </div>
            <span className={`text-sm font-medium ${active ? 'text-blue-700' : done ? 'text-green-700' : 'text-gray-400'}`}>
              {label}
            </span>
            {i < steps.length - 1 && <div className="w-8 h-px bg-gray-200 mx-1" />}
          </div>
        );
      })}
    </div>
  );
}

// ─── Line item editor row ─────────────────────────────────────────────────────
function LineItemRow({ item, index, onChange, onRemove }) {
  return (
    <div className="grid grid-cols-12 gap-2 items-start py-2 border-b border-gray-100 last:border-0">
      <div className="col-span-4">
        <input
          type="text"
          value={item.service_type || ''}
          onChange={(e) => onChange(index, 'service_type', e.target.value)}
          placeholder="Service type"
          className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm focus:ring-1 focus:ring-blue-500"
        />
      </div>
      <div className="col-span-4">
        <input
          type="text"
          value={item.service_description || ''}
          onChange={(e) => onChange(index, 'service_description', e.target.value)}
          placeholder="Description (optional)"
          className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm focus:ring-1 focus:ring-blue-500"
        />
      </div>
      <div className="col-span-2">
        <input
          type="number"
          value={item.line_total || ''}
          onChange={(e) => onChange(index, 'line_total', parseFloat(e.target.value) || null)}
          placeholder="$0.00"
          className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm focus:ring-1 focus:ring-blue-500"
        />
      </div>
      <div className="col-span-1 flex items-center gap-1 pt-1.5">
        <input
          type="checkbox"
          checked={item.is_labor || false}
          onChange={(e) => onChange(index, 'is_labor', e.target.checked)}
          title="Labor"
          className="w-3.5 h-3.5 cursor-pointer"
        />
        <span className="text-xs text-gray-400">L</span>
      </div>
      <div className="col-span-1 flex justify-end pt-1">
        <button
          type="button"
          onClick={() => onRemove(index)}
          className="text-red-400 hover:text-red-600 transition text-lg leading-none"
          title="Remove line item"
        >
          ×
        </button>
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function UploadInvoice() {
  const { id: vehicleId } = useParams();
  const navigate = useNavigate();

  const [step, setStep] = useState(1);
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [uploadError, setUploadError] = useState(null);
  const [confirmError, setConfirmError] = useState(null);
  const [vinMismatch, setVinMismatch] = useState(null); // { invoice_vin, vehicle_vin, message }
  const [vinUnreadable, setVinUnreadable] = useState(null); // { vehicle_vin, vehicle_vin_last4, message }
  const [vinMismatchConfirmed, setVinMismatchConfirmed] = useState(false); // user explicitly accepted override
  const [showVinOverrideModal, setShowVinOverrideModal] = useState(false);

  // Invoice header fields (editable)
  const [invoiceId, setInvoiceId] = useState(null);
  const [serviceDate, setServiceDate] = useState('');
  const [mileage, setMileage] = useState('');
  const [shopName, setShopName] = useState('');
  const [shopAddress, setShopAddress] = useState('');
  const [totalAmount, setTotalAmount] = useState('');
  const [lineItems, setLineItems] = useState([]);
  const [confirmedCount, setConfirmedCount] = useState(0);
  const [upsellWarnings, setUpsellWarnings] = useState([]);
  const [lineItemAnalysis, setLineItemAnalysis] = useState([]);  // per-item OEM verdict
  const [selectedDisputes, setSelectedDisputes] = useState({});  // { serviceType: bool }
  const [disputeSubmitting, setDisputeSubmitting] = useState(false);
  const [disputeSubmitted, setDisputeSubmitted] = useState(false);
  const [disputeSubmitCount, setDisputeSubmitCount] = useState(0);
  const [disputeError, setDisputeError] = useState(null);

  // ── Duplicate invoice warning state ─────────────────────────────────────────
  const [isDuplicate, setIsDuplicate] = useState(false);
  const [duplicateDetail, setDuplicateDetail] = useState(null); // { duplicate_of_invoice_id, service_date, shop_name, message }
  const [discarding, setDiscarding] = useState(false);

  // ── Step 1: upload & extract ────────────────────────────────────────────────
  const handleUpload = async (e) => {
    e.preventDefault();
    if (!file) return;
    setUploading(true);
    setUploadError(null);
    try {
      const res = await uploadInvoice(vehicleId, file);
      const data = res.data;
      const extracted = data.extracted_data || {};

      setInvoiceId(data.invoice_id);
      setServiceDate(extracted.service_date ? extracted.service_date.split('T')[0] : '');
      setMileage(extracted.mileage ? String(extracted.mileage) : '');
      setShopName(extracted.shop_name || '');
      setShopAddress(extracted.shop_address || '');
      setTotalAmount(extracted.total_amount ? String(extracted.total_amount) : '');
      setLineItems(
        (extracted.line_items || []).map((item) => ({
          service_type: item.service_type || '',
          service_description: item.service_description || '',
          quantity: item.quantity || 1,
          unit_price: item.unit_price || null,
          line_total: item.line_total || null,
          is_labor: item.is_labor || false,
          is_parts: item.is_parts || false,
        }))
      );
      // Capture VIN mismatch warning if present
      if (data.vin_mismatch && data.vin_mismatch_detail) {
        setVinMismatch(data.vin_mismatch_detail);
      }
      // Capture VIN unreadable caution if present
      if (data.vin_unreadable && data.vin_unreadable_detail) {
        setVinUnreadable(data.vin_unreadable_detail);
      }
      // Capture duplicate invoice warning if present
      if (data.is_duplicate && data.duplicate_detail) {
        setIsDuplicate(true);
        setDuplicateDetail(data.duplicate_detail);
      }
      setStep(2);
    } catch (err) {
      setUploadError(err?.response?.data?.detail || 'Upload failed. Please try again.');
    } finally {
      setUploading(false);
    }
  };

  // ── Line item helpers ───────────────────────────────────────────────────────
  const updateLineItem = (index, field, value) => {
    setLineItems((prev) => prev.map((item, i) => i === index ? { ...item, [field]: value } : item));
  };

  const removeLineItem = (index) => {
    setLineItems((prev) => prev.filter((_, i) => i !== index));
  };

  const addLineItem = () => {
    setLineItems((prev) => [...prev, {
      service_type: '', service_description: '',
      quantity: 1, unit_price: null, line_total: null,
      is_labor: false, is_parts: false,
    }]);
  };

  // ── Step 2: confirm ─────────────────────────────────────────────────────────
  const handleConfirm = async (forceVinOverride = false) => {
    if (!invoiceId) return;
    if (!serviceDate) { setConfirmError('Please enter a service date.'); return; }
    if (!mileage || isNaN(parseInt(mileage))) { setConfirmError('Please enter a valid mileage.'); return; }
    if (lineItems.length === 0) { setConfirmError('Please add at least one service line item.'); return; }
    const emptyTypes = lineItems.some((item) => !item.service_type.trim());
    if (emptyTypes) { setConfirmError('All line items must have a service type.'); return; }

    setConfirming(true);
    setConfirmError(null);
    try {
      const payload = {
        service_date: serviceDate, // plain YYYY-MM-DD — no UTC conversion to prevent date shift for non-UTC users
        mileage_at_service: parseInt(mileage),
        shop_name: shopName || null,
        shop_address: shopAddress || null,
        total_amount: totalAmount ? parseFloat(totalAmount) : null,
        line_items: lineItems,
        force_vin_override: forceVinOverride,
      };
      const res = await confirmInvoice(invoiceId, payload);
      setConfirmedCount(res.data.service_records_created || lineItems.length);
      setUpsellWarnings(res.data.upsell_warnings || []);
      const analysis = res.data.line_item_analysis || [];
      setLineItemAnalysis(analysis);
      // Pre-check all upsell rows so the user sees them selected by default
      const initSelected = {};
      analysis.forEach(item => {
        if (item.verdict === 'upsell') initSelected[item.service_type] = true;
      });
      setSelectedDisputes(initSelected);
      setStep(3);
    } catch (err) {
      // 409 VIN_MISMATCH — server caught a mismatch the UI warning didn't block
      const detail = err?.response?.data?.detail;
      if (err?.response?.status === 409 && detail?.code === 'VIN_MISMATCH') {
        setVinMismatch({ invoice_vin: detail.invoice_vin, vehicle_vin: detail.vehicle_vin });
        setShowVinOverrideModal(true);
        return;
      }
      setConfirmError(detail?.message || detail || 'Confirmation failed. Please try again.');
    } finally {
      setConfirming(false);
    }
  };

  // ── Discard duplicate upload ────────────────────────────────────────────────
  const handleDiscard = async () => {
    if (!invoiceId) { setStep(1); return; }
    setDiscarding(true);
    try {
      await deleteInvoice(invoiceId);
    } catch (err) {
      // If delete fails (e.g. already deleted), proceed to step 1 anyway
      console.warn('Discard delete failed:', err);
    } finally {
      setDiscarding(false);
      // Reset all state and return to step 1
      setInvoiceId(null);
      setIsDuplicate(false);
      setDuplicateDetail(null);
      setServiceDate('');
      setMileage('');
      setShopName('');
      setShopAddress('');
      setTotalAmount('');
      setLineItems([]);
      setVinMismatch(null);
      setVinUnreadable(null);
      setVinMismatchConfirmed(false);
      setConfirmError(null);
      setFile(null);
      setStep(1);
    }
  };

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="max-w-7xl mx-auto" style={{maxWidth:760,margin:"0 auto",padding:"32px 40px"}}>
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <Link to="/" className="text-gray-400 hover:text-gray-600 transition" style={{display:"flex",alignItems:"center",justifyContent:"center",width:32,height:32,borderRadius:8,border:"1px solid #E2E8F0",background:"#fff",textDecoration:"none"}}>
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </Link>
        
        <h1 className="text-2xl font-bold text-gray-900">Upload Invoice</h1>
      </div>

      <Steps current={step} />

      {/* ── Step 1: Upload ── */}
      {step === 1 && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
          <p className="text-sm text-gray-500 mb-5">
            Upload a PDF or image of your service invoice. The system will extract the details automatically.
          </p>
          <form onSubmit={handleUpload}>
            <div
              className="border-2 border-dashed border-gray-300 rounded-xl p-10 text-center mb-5 hover:border-blue-400 transition cursor-pointer"
              onClick={() => document.getElementById('file-input').click()}
            >
              <svg className="mx-auto h-12 w-12 text-gray-300 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
              </svg>
              {file ? (
                <p className="text-sm font-medium text-blue-700">{file.name}</p>
              ) : (
                <>
                  <p className="text-sm font-medium text-gray-600">Click to select or drag & drop</p>
                  <p className="text-xs text-gray-400 mt-1">PDF, JPG, PNG supported</p>
                </>
              )}
              <input
                id="file-input"
                type="file"
                accept=".pdf,.jpg,.jpeg,.png"
                className="hidden"
                onChange={(e) => setFile(e.target.files[0])}
                required
              />
            </div>

            {uploadError && (
              <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm mb-4">
                {uploadError}
              </div>
            )}

            <div className="flex gap-3">
              <button
                type="submit"
                disabled={uploading || !file}
                className="bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white px-6 py-2.5 rounded-lg font-semibold text-sm transition"
              >
                {uploading ? (
                  <span className="flex items-center gap-2">
                    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                    </svg>
                    Processing...
                  </span>
                ) : 'Upload & Extract'}
              </button>
              <button type="button" onClick={() => navigate('/')}
                className="bg-gray-100 hover:bg-gray-200 text-gray-700 px-6 py-2.5 rounded-lg font-semibold text-sm transition">
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ── Step 2: Review & Confirm ── */}
      {step === 2 && (
        <div className="space-y-5">

          {/* VIN Mismatch — HARD BLOCK banner */}
          {vinMismatch && !vinMismatchConfirmed && (
            <div style={{ background: '#FEF2F2', border: '2px solid #EF4444', borderRadius: 12, padding: '16px 20px' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                <span style={{ fontSize: 24, flexShrink: 0 }}>🚨</span>
                <div style={{ flex: 1 }}>
                  <p style={{ fontWeight: 700, color: '#B91C1C', fontSize: 14, margin: '0 0 6px' }}>
                    Wrong Vehicle — VIN Mismatch Detected
                  </p>
                  <p style={{ color: '#DC2626', fontSize: 13, margin: '0 0 10px' }}>
                    This invoice belongs to a <strong>different vehicle</strong> than the one you selected.
                    Confirming it will corrupt your service history, upsell detection, and dispute records.
                  </p>
                  <div style={{ background: '#fff', border: '1px solid #FECACA', borderRadius: 8, padding: '10px 14px', fontFamily: 'monospace', fontSize: 12, marginBottom: 12 }}>
                    <div style={{ display: 'flex', gap: 12, marginBottom: 4 }}>
                      <span style={{ color: '#EF4444', width: 110, flexShrink: 0 }}>Invoice VIN:</span>
                      <span style={{ fontWeight: 700, color: '#B91C1C' }}>{vinMismatch.invoice_vin}</span>
                    </div>
                    <div style={{ display: 'flex', gap: 12 }}>
                      <span style={{ color: '#94A3B8', width: 110, flexShrink: 0 }}>Vehicle VIN:</span>
                      <span style={{ fontWeight: 700, color: '#0F172A' }}>{vinMismatch.vehicle_vin}</span>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      onClick={() => { setStep(1); setVinMismatch(null); setVinMismatchConfirmed(false); }}
                      style={{ background: '#DC2626', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 16px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                      ← Go Back & Select Correct Vehicle
                    </button>
                    <button
                      onClick={() => setShowVinOverrideModal(true)}
                      style={{ background: 'transparent', color: '#DC2626', border: '1.5px solid #FCA5A5', borderRadius: 8, padding: '8px 16px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                      Override anyway…
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* VIN Unreadable — soft yellow caution */}
          {vinUnreadable && !vinMismatch && (
            <div style={{ background: '#FFFBEB', border: '2px solid #F59E0B', borderRadius: 12, padding: '16px 20px' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                <span style={{ fontSize: 22, flexShrink: 0 }}>⚠️</span>
                <div style={{ flex: 1 }}>
                  <p style={{ fontWeight: 700, color: '#92400E', fontSize: 14, margin: '0 0 5px' }}>
                    VIN Could Not Be Read — Please Verify
                  </p>
                  <p style={{ color: '#B45309', fontSize: 13, margin: '0 0 10px', lineHeight: 1.6 }}>
                    The VIN on this invoice is blurred, missing, or unreadable. We cannot automatically
                    confirm it belongs to your vehicle.
                  </p>
                  <div style={{ background: '#fff', border: '1px solid #FDE68A', borderRadius: 8, padding: '10px 14px', fontFamily: 'monospace', fontSize: 12, marginBottom: 10 }}>
                    <div style={{ display: 'flex', gap: 12 }}>
                      <span style={{ color: '#D97706', width: 130, flexShrink: 0 }}>Your vehicle VIN:</span>
                      <span style={{ fontWeight: 700, color: '#92400E' }}>
                        …{vinUnreadable.vehicle_vin_last4}
                        <span style={{ fontWeight: 400, color: '#B45309', marginLeft: 8, fontFamily: 'sans-serif', fontSize: 11 }}>
                          (last 4 shown for privacy)
                        </span>
                      </span>
                    </div>
                  </div>
                  <p style={{ fontSize: 12, color: '#B45309', margin: 0 }}>
                    ✓ If the plate, make, model, and mileage below match your vehicle, you can safely confirm.
                    Otherwise, go back and upload the correct invoice.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* VIN Override confirmation modal */}
          {showVinOverrideModal && vinMismatch && (
            <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200, padding: 20 }}>
              <div style={{ background: '#fff', borderRadius: 16, boxShadow: '0 20px 60px rgba(0,0,0,0.3)', maxWidth: 420, width: '100%', overflow: 'hidden' }}>
                <div style={{ background: 'linear-gradient(135deg, #DC2626, #B91C1C)', padding: '16px 22px' }}>
                  <h2 style={{ color: '#fff', fontWeight: 700, fontSize: 15, margin: 0 }}>⚠️ Confirm VIN Mismatch Override</h2>
                </div>
                <div style={{ padding: '20px 22px' }}>
                  <p style={{ fontSize: 13, color: '#374151', marginBottom: 14, lineHeight: 1.6 }}>
                    You are about to save this invoice under the <strong>wrong vehicle</strong>. This will corrupt:
                  </p>
                  <ul style={{ fontSize: 12, color: '#6B7280', paddingLeft: 18, marginBottom: 16, lineHeight: 2 }}>
                    <li>Upsell detection accuracy</li>
                    <li>Maintenance recommendations</li>
                    <li>Dispute audit trail</li>
                  </ul>
                  <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, padding: '10px 14px', fontFamily: 'monospace', fontSize: 11, marginBottom: 18 }}>
                    <div><span style={{ color: '#EF4444' }}>Invoice VIN: </span><strong>{vinMismatch.invoice_vin}</strong></div>
                    <div><span style={{ color: '#94A3B8' }}>Vehicle VIN: </span><strong>{vinMismatch.vehicle_vin}</strong></div>
                  </div>
                  <p style={{ fontSize: 12, color: '#9CA3AF', marginBottom: 18 }}>
                    Only proceed if you are certain this is an OCR error or intentional cross-vehicle record.
                  </p>
                  <div style={{ display: 'flex', gap: 10 }}>
                    <button
                      onClick={() => { setShowVinOverrideModal(false); }}
                      style={{ flex: 1, background: '#fff', border: '1px solid #D1D5DB', color: '#374151', borderRadius: 10, padding: 10, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                      Cancel
                    </button>
                    <button
                      onClick={() => {
                        setShowVinOverrideModal(false);
                        setVinMismatchConfirmed(true);
                        handleConfirm(true); // pass force_vin_override=true
                      }}
                      style={{ flex: 1, background: '#DC2626', color: '#fff', border: 'none', borderRadius: 10, padding: 10, fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                      Save Anyway
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Duplicate Invoice Warning */}
          {isDuplicate && duplicateDetail && (
            <div style={{ background: '#FFFBEB', border: '2px solid #F59E0B', borderRadius: 12, padding: '16px 20px' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                <span style={{ fontSize: 22, flexShrink: 0 }}>⚠️</span>
                <div style={{ flex: 1 }}>
                  <p style={{ fontWeight: 700, color: '#92400E', fontSize: 14, margin: '0 0 5px' }}>
                    Possible Duplicate Invoice
                  </p>
                  <p style={{ color: '#B45309', fontSize: 13, margin: '0 0 10px', lineHeight: 1.6 }}>
                    A confirmed invoice already exists for this vehicle on{' '}
                    <strong>{duplicateDetail.service_date}</strong> at{' '}
                    <strong>{duplicateDetail.mileage_at_service?.toLocaleString()} miles</strong>{' '}
                    ({duplicateDetail.shop_name}).
                  </p>
                  <p style={{ fontSize: 12, color: '#B45309', margin: '0 0 12px' }}>
                    If this is a re-upload to fix a mistake, you can still confirm below.
                    Otherwise, discard this upload to keep your history clean.
                  </p>
                  <button
                    onClick={handleDiscard}
                    disabled={discarding}
                    style={{ background: '#D97706', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 16px', fontSize: 13, fontWeight: 700, cursor: discarding ? 'not-allowed' : 'pointer', opacity: discarding ? 0.7 : 1 }}>
                    {discarding ? 'Discarding…' : '🗑 Discard This Upload'}
                  </button>
                </div>
              </div>
            </div>
          )}

          <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 text-sm text-blue-800">
            ✅ Invoice processed successfully. Review the extracted data below, make any corrections, then click <strong>Confirm & Save</strong>.
          </div>

          {/* Invoice header */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
            <h2 className="font-bold text-gray-800 mb-4">Invoice Details</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Service Date *</label>
                <input type="date" value={serviceDate}
                  onChange={(e) => setServiceDate(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Mileage at Service *</label>
                <input type="number" value={mileage} placeholder="e.g. 45000"
                  onChange={(e) => setMileage(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Shop Name</label>
                <input type="text" value={shopName} placeholder="e.g. Jiffy Lube"
                  onChange={(e) => setShopName(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Total Amount</label>
                <input type="number" step="0.01" value={totalAmount} placeholder="e.g. 89.99"
                  onChange={(e) => setTotalAmount(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500" />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-gray-500 mb-1">Shop Address</label>
                <input type="text" value={shopAddress} placeholder="e.g. 123 Main St"
                  onChange={(e) => setShopAddress(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500" />
              </div>
            </div>
          </div>

          {/* Line items */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="font-bold text-gray-800">Service Line Items</h2>
                <p className="text-xs text-gray-400 mt-0.5">Each line item will become a service record. Edit or remove as needed.</p>
              </div>
              <span className="text-xs bg-blue-100 text-blue-700 font-semibold px-2 py-1 rounded-full">
                {lineItems.length} item{lineItems.length !== 1 ? 's' : ''}
              </span>
            </div>

            {lineItems.length > 0 && (
              <div className="grid grid-cols-12 gap-2 mb-1 px-0">
                <span className="col-span-4 text-xs font-medium text-gray-400">Service Type *</span>
                <span className="col-span-4 text-xs font-medium text-gray-400">Description</span>
                <span className="col-span-2 text-xs font-medium text-gray-400">Amount</span>
                <span className="col-span-1 text-xs font-medium text-gray-400">Labor</span>
              </div>
            )}

            {lineItems.map((item, i) => (
              <LineItemRow key={i} item={item} index={i} onChange={updateLineItem} onRemove={removeLineItem} />
            ))}

            {lineItems.length === 0 && (
              <p className="text-sm text-gray-400 text-center py-6 border border-dashed border-gray-200 rounded-lg">
                No line items extracted. Add them manually below.
              </p>
            )}

            <button type="button" onClick={addLineItem}
              className="mt-3 text-sm text-blue-600 hover:text-blue-800 font-medium flex items-center gap-1 transition">
              + Add line item
            </button>
          </div>

          {confirmError && (
            <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">
              {confirmError}
            </div>
          )}

          <div className="flex gap-3">
            <button onClick={() => handleConfirm(false)} disabled={confirming || (vinMismatch && !vinMismatchConfirmed)}
              className="bg-green-600 hover:bg-green-700 disabled:bg-green-400 text-white px-6 py-2.5 rounded-lg font-semibold text-sm transition flex items-center gap-2"
              title={vinMismatch && !vinMismatchConfirmed ? 'Resolve VIN mismatch before confirming' : ''}>
              {confirming ? (
                <>
                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                  </svg>
                  Saving...
                </>
              ) : '✅ Confirm & Save to History'}
            </button>
            <button onClick={() => setStep(1)}
              className="bg-gray-100 hover:bg-gray-200 text-gray-700 px-6 py-2.5 rounded-lg font-semibold text-sm transition">
              ← Re-upload
            </button>
            <button onClick={handleDiscard} disabled={discarding}
              className="bg-white hover:bg-red-50 text-red-600 border border-red-200 hover:border-red-400 px-6 py-2.5 rounded-lg font-semibold text-sm transition disabled:opacity-50">
              {discarding ? 'Discarding…' : '🗑 Discard'}
            </button>
          </div>
        </div>
      )}

      {/* ── Step 3: Analysis & Dispute ── */}
      {step === 3 && (() => {
        const upsellItems = lineItemAnalysis.filter(a => a.verdict === 'upsell');
        const checkedCount = Object.values(selectedDisputes).filter(Boolean).length;

        const handleToggle = (serviceType, canDispute) => {
          if (!canDispute) return;
          setSelectedDisputes(prev => ({ ...prev, [serviceType]: !prev[serviceType] }));
        };

        const handleDisputeSubmit = async () => {
          const disputed = Object.entries(selectedDisputes)
            .filter(([, checked]) => checked)
            .map(([stype]) => stype);
          if (!disputed.length) return;
          setDisputeSubmitting(true);
          setDisputeError(null);
          try {
            await batchDisputeInvoice(invoiceId, {
              disputed_service_types: disputed,
              dispute_type: 'upsell',
              dispute_notes: `Flagged by system upsell analysis: ${disputed.join(', ')}`,
            });
            setDisputeSubmitCount(disputed.length);
            setDisputeSubmitted(true);
          } catch (err) {
            setDisputeError(err?.response?.data?.detail || 'Failed to raise dispute. Please try again.');
          } finally {
            setDisputeSubmitting(false);
          }
        };

        // ── Sub-state B: Dispute submitted ───────────────────────────────
        if (disputeSubmitted) {
          return (
            <div style={{background:'#fff',borderRadius:16,border:'1px solid #E2E8F0',padding:'40px 32px',textAlign:'center',boxShadow:'0 2px 12px rgba(0,0,0,0.06)'}}>
              <div style={{fontSize:48,marginBottom:16}}>🛡️</div>
              <h2 style={{fontSize:20,fontWeight:800,color:'#1E3A8A',marginBottom:8}}>Dispute Raised</h2>
              <p style={{color:'#374151',fontSize:15,marginBottom:4}}>
                <strong style={{color:'#DC2626'}}>{disputeSubmitCount} service{disputeSubmitCount !== 1 ? 's' : ''}</strong> flagged for dispute.
              </p>
              <p style={{color:'#64748B',fontSize:13,marginBottom:28}}>
                Track and resolve it from the Dispute Resolution page when the dealer responds.
              </p>
              <div style={{display:'flex',gap:12,justifyContent:'center',flexWrap:'wrap'}}>
                <button
                  onClick={() => navigate(`/invoice/${invoiceId}/dispute`)}
                  style={{background:'linear-gradient(135deg,#1E3A8A,#2563EB)',color:'#fff',padding:'10px 22px',borderRadius:10,fontWeight:700,fontSize:14,border:'none',cursor:'pointer'}}
                >
                  View Dispute →
                </button>
                <button
                  onClick={() => navigate('/')}
                  style={{background:'#F8FAFC',color:'#374151',padding:'10px 22px',borderRadius:10,fontWeight:600,fontSize:14,border:'1px solid #E2E8F0',cursor:'pointer'}}
                >
                  Back to Dashboard
                </button>
              </div>
            </div>
          );
        }

        // ── Verdict badge helper ─────────────────────────────────────────
        const VerdictBadge = ({ verdict, label }) => {
          const styles = {
            upsell:  { bg:'#FEF3C7', color:'#92400E', border:'#FDE68A', icon:'⚠️' },
            genuine: { bg:'#DCFCE7', color:'#166534', border:'#BBF7D0', icon:'✅' },
            exempt:  { bg:'#EEF2FF', color:'#3730A3', border:'#C7D2FE', icon:'🎁' },
          };
          const s = styles[verdict] || styles.genuine;
          return (
            <span style={{display:'inline-flex',alignItems:'center',gap:4,padding:'3px 10px',borderRadius:20,fontSize:12,fontWeight:700,background:s.bg,color:s.color,border:`1px solid ${s.border}`,whiteSpace:'nowrap'}}>
              {s.icon} {label}
            </span>
          );
        };

        // ── Sub-state A: Analysis table ──────────────────────────────────
        return (
          <div style={{display:'flex',flexDirection:'column',gap:20}}>

            {/* Header */}
            <div style={{background:'linear-gradient(135deg,#1E3A8A 0%,#2563EB 100%)',borderRadius:16,padding:'24px 28px',color:'#fff'}}>
              <h2 style={{fontSize:20,fontWeight:800,margin:0,marginBottom:6}}>
                ✅ Invoice Confirmed — Service Analysis
              </h2>
              <p style={{margin:0,fontSize:14,color:'#BFDBFE'}}>
                {confirmedCount} service record{confirmedCount !== 1 ? 's' : ''} saved to history.
                {upsellItems.length > 0
                  ? ` ${upsellItems.length} potential upsell${upsellItems.length > 1 ? 's' : ''} detected — review below.`
                  : ' All services verified — no upsell concerns.'}
              </p>
            </div>

            {/* All-clear state */}
            {upsellItems.length === 0 && (
              <div style={{background:'#fff',borderRadius:12,border:'1px solid #E2E8F0',padding:'32px',textAlign:'center'}}>
                <div style={{fontSize:40,marginBottom:12}}>🎉</div>
                <p style={{fontSize:16,fontWeight:700,color:'#166534',marginBottom:4}}>All services look legitimate</p>
                <p style={{fontSize:13,color:'#64748B',marginBottom:24}}>No upsell concerns detected based on your OEM schedule and service history.</p>
                <button onClick={() => navigate('/')}
                  style={{background:'linear-gradient(135deg,#1E3A8A,#2563EB)',color:'#fff',padding:'10px 24px',borderRadius:10,fontWeight:700,fontSize:14,border:'none',cursor:'pointer'}}>
                  Back to Dashboard
                </button>
              </div>
            )}

            {/* Analysis table */}
            {lineItemAnalysis.length > 0 && (
              <div style={{background:'#fff',borderRadius:12,border:'1px solid #E2E8F0',overflow:'hidden',boxShadow:'0 2px 8px rgba(0,0,0,0.04)'}}>

                {/* Table header */}
                <div style={{display:'grid',gridTemplateColumns:'2fr 90px 160px 2fr 56px',gap:0,background:'#1E3A8A',padding:'10px 20px'}}>
                  {['Service','Amount','Verdict','Reason / OEM Interval','Dispute?'].map(h => (
                    <span key={h} style={{fontSize:11,fontWeight:700,color:'#BFDBFE',textTransform:'uppercase',letterSpacing:'0.06em'}}>{h}</span>
                  ))}
                </div>

                {/* Rows */}
                {lineItemAnalysis.map((item, i) => {
                  const canDispute = item.verdict === 'upsell';
                  const checked = !!selectedDisputes[item.service_type];
                  const rowBg = item.verdict === 'upsell'
                    ? (checked ? '#FFFBEB' : '#FFFBEB')
                    : i % 2 === 0 ? '#F8FAFC' : '#fff';
                  const leftBorder = item.verdict === 'upsell' ? '3px solid #F59E0B'
                    : item.verdict === 'exempt' ? '3px solid #818CF8'
                    : '3px solid #22C55E';

                  return (
                    <div
                      key={i}
                      onClick={() => handleToggle(item.service_type, canDispute)}
                      style={{
                        display:'grid',gridTemplateColumns:'2fr 90px 160px 2fr 56px',
                        gap:0,padding:'14px 20px',
                        background:rowBg,
                        borderLeft:leftBorder,
                        borderBottom: i < lineItemAnalysis.length - 1 ? '1px solid #F1F5F9' : 'none',
                        cursor: canDispute ? 'pointer' : 'default',
                        transition:'background 0.15s',
                      }}
                    >
                      {/* Service */}
                      <div>
                        <p style={{margin:0,fontSize:14,fontWeight:600,color:'#1E3A8A'}}>{item.service_type}</p>
                        {item.service_description && (
                          <p style={{margin:'2px 0 0',fontSize:12,color:'#94A3B8'}}>{item.service_description}</p>
                        )}
                      </div>

                      {/* Amount */}
                      <div style={{display:'flex',alignItems:'center'}}>
                        <span style={{fontSize:14,fontWeight:600,color: item.line_total === 0 ? '#64748B' : '#374151'}}>
                          {item.line_total === null ? '—' : item.line_total === 0 ? 'Free' : `$${item.line_total.toFixed(2)}`}
                        </span>
                      </div>

                      {/* Verdict badge */}
                      <div style={{display:'flex',alignItems:'center'}}>
                        <VerdictBadge verdict={item.verdict} label={item.verdict_label} />
                      </div>

                      {/* Reason */}
                      <div style={{display:'flex',flexDirection:'column',justifyContent:'center',paddingRight:8}}>
                        {item.reason ? (
                          <p style={{margin:0,fontSize:12,color:'#64748B',lineHeight:1.4}}>{item.reason}</p>
                        ) : item.oem_interval_miles ? (
                          <p style={{margin:0,fontSize:12,color:'#94A3B8'}}>
                            OEM interval: {item.oem_interval_miles.toLocaleString()} mi
                            {item.miles_since_last_service != null && ` · Last service: ${item.miles_since_last_service.toLocaleString()} mi ago`}
                          </p>
                        ) : (
                          <p style={{margin:0,fontSize:12,color:'#CBD5E1'}}>No prior service history</p>
                        )}
                        {item.previous_service_date && (
                          <p style={{margin:'3px 0 0',fontSize:11,color:'#94A3B8'}}>
                            Previously: {item.previous_service_date}
                            {item.previous_service_mileage && ` @ ${item.previous_service_mileage.toLocaleString()} mi`}
                          </p>
                        )}
                      </div>

                      {/* Dispute checkbox */}
                      <div style={{display:'flex',alignItems:'center',justifyContent:'center'}}>
                        {canDispute ? (
                          <div style={{
                            width:20,height:20,borderRadius:5,border:`2px solid ${checked ? '#F59E0B' : '#CBD5E1'}`,
                            background: checked ? '#F59E0B' : '#fff',
                            display:'flex',alignItems:'center',justifyContent:'center',
                            transition:'all 0.15s',flexShrink:0,
                          }}>
                            {checked && <svg width="11" height="9" viewBox="0 0 11 9" fill="none"><path d="M1 4L4 7L10 1" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                          </div>
                        ) : (
                          <div style={{width:20,height:20,borderRadius:5,border:'2px solid #E2E8F0',background:'#F8FAFC',flexShrink:0}} title="Cannot dispute this service type" />
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Legend */}
            {lineItemAnalysis.length > 0 && (
              <div style={{display:'flex',gap:16,flexWrap:'wrap',padding:'4px 0'}}>
                {[
                  {color:'#F59E0B',label:'Potential Upsell — click row to select/deselect'},
                  {color:'#22C55E',label:'Genuine Service'},
                  {color:'#818CF8',label:'Courtesy / Recall — exempt from dispute'},
                ].map(l => (
                  <div key={l.label} style={{display:'flex',alignItems:'center',gap:6}}>
                    <div style={{width:10,height:10,borderRadius:'50%',background:l.color,flexShrink:0}} />
                    <span style={{fontSize:12,color:'#64748B'}}>{l.label}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Dispute footer */}
            {upsellItems.length > 0 && (
              <div style={{background:'#fff',borderRadius:12,border:'1px solid #E2E8F0',padding:'20px 24px',display:'flex',alignItems:'center',justifyContent:'space-between',gap:16,flexWrap:'wrap'}}>
                <div>
                  <p style={{margin:0,fontSize:14,fontWeight:700,color:'#374151'}}>
                    {checkedCount > 0
                      ? `${checkedCount} service${checkedCount !== 1 ? 's' : ''} selected for dispute`
                      : 'Select services above to dispute'}
                  </p>
                  <p style={{margin:'3px 0 0',fontSize:12,color:'#94A3B8'}}>
                    Only items flagged as "Potential Upsell" can be disputed.
                  </p>
                  {disputeError && (
                    <p style={{margin:'6px 0 0',fontSize:13,color:'#DC2626'}}>{disputeError}</p>
                  )}
                </div>
                <div style={{display:'flex',gap:10,alignItems:'center',flexWrap:'wrap'}}>
                  <button
                    onClick={handleDisputeSubmit}
                    disabled={checkedCount === 0 || disputeSubmitting}
                    style={{
                      background: checkedCount > 0 ? 'linear-gradient(135deg,#D97706,#F59E0B)' : '#E2E8F0',
                      color: checkedCount > 0 ? '#fff' : '#94A3B8',
                      padding:'10px 22px',borderRadius:10,fontWeight:700,fontSize:14,
                      border:'none',cursor: checkedCount > 0 ? 'pointer' : 'not-allowed',
                      transition:'all 0.15s',
                    }}
                  >
                    {disputeSubmitting
                      ? 'Submitting…'
                      : checkedCount > 0
                        ? `⚠️ Dispute ${checkedCount} Service${checkedCount !== 1 ? 's' : ''}`
                        : '⚠️ Dispute Selected'}
                  </button>
                  <button
                    onClick={() => navigate('/')}
                    style={{background:'#F8FAFC',color:'#64748B',padding:'10px 18px',borderRadius:10,fontWeight:600,fontSize:14,border:'1px solid #E2E8F0',cursor:'pointer'}}
                  >
                    Skip — Back to Dashboard
                  </button>
                </div>
              </div>
            )}

            {/* No upsells: just show back button */}
            {upsellItems.length === 0 && lineItemAnalysis.length === 0 && (
              <div style={{textAlign:'center',paddingTop:8}}>
                <button onClick={() => navigate('/')}
                  style={{background:'linear-gradient(135deg,#1E3A8A,#2563EB)',color:'#fff',padding:'10px 24px',borderRadius:10,fontWeight:700,fontSize:14,border:'none',cursor:'pointer'}}>
                  Back to Dashboard
                </button>
              </div>
            )}
          </div>
        );
      })()}
      {/* ARIA chat widget */}
      <AriaChat vehicleId={vehicleId ? parseInt(vehicleId) : null} vehicleName="" />
    </div>
  );
}
