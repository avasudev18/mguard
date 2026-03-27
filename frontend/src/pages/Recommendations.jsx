import { useState, useEffect, useCallback } from 'react';
import AriaChat from '../components/AriaChat';
import { useParams, Link } from 'react-router-dom';
import { getVehicle, getRecommendations, addRecommendationsToHistory, searchServiceHistory, updateVehicle } from '../services/api';


const CATEGORY_CONFIG = {
  overdue: {
    label: 'Overdue',
    badgeClass: 'bg-red-100 text-red-800 border-red-200',
    headerClass: 'border-red-200',
    icon: '🚨',
    description: 'Past the recommended OEM service interval. Schedule as soon as possible.',
  },
  recommended_now: {
    label: 'Recommended Now',
    badgeClass: 'bg-green-100 text-green-800 border-green-200',
    headerClass: 'border-green-200',
    icon: '✅',
    description: 'Service aligns with OEM schedule and current vehicle condition.',
  },
  due_soon: {
    label: 'Due Soon',
    badgeClass: 'bg-yellow-100 text-yellow-800 border-yellow-200',
    headerClass: 'border-yellow-200',
    icon: '⏰',
    description: 'Approaching recommended interval. Consider scheduling within next 1,000 miles or 30 days.',
  },
  optional: {
    label: 'Optional Enhancement',
    badgeClass: 'bg-blue-100 text-blue-800 border-blue-200',
    headerClass: 'border-blue-200',
    icon: '💡',
    description: 'May provide added benefit but not required by OEM schedule.',
  },
  not_needed: {
    label: 'Not Typically Required',
    badgeClass: 'bg-orange-100 text-orange-800 border-orange-200',
    headerClass: 'border-orange-200',
    icon: '⚠️',
    description: 'Based on manufacturer guidelines, this service is not typically required at this interval.',
  },
};

const CONFIDENCE_STYLES = {
  high: 'bg-green-100 text-green-700',
  medium: 'bg-yellow-100 text-yellow-700',
  low: 'bg-red-100 text-red-700',
};

function RecommendationCard({ rec, isSelected, onToggle, index }) {
  const [expanded, setExpanded] = useState(false);
  const config = CATEGORY_CONFIG[rec.category] || CATEGORY_CONFIG.optional;
  const isUpsell = rec.is_upsell_flag;
  const isNotNeeded = rec.category === 'not_needed';
  const isOemUnavailable = rec.service_type === 'OEM Schedule Not Available';
  const isSelectable = !isNotNeeded && !isUpsell && !isOemUnavailable;

  if (isOemUnavailable) {
    return (
      <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm text-gray-500 flex items-start gap-3">
        <span className="text-lg">ℹ️</span>
        <div>
          <p className="font-medium text-gray-700 mb-1">OEM Schedule Not Available</p>
          <p>{rec.reason}</p>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`rounded-lg border-2 transition-all duration-200 bg-white ${
        isSelected
          ? 'border-blue-500 shadow-md'
          : `border-gray-200 hover:border-gray-300`
      } ${isSelectable ? 'cursor-pointer' : ''}`}
      onClick={() => isSelectable && onToggle(index)}
    >
      <div className="p-4">
        <div className="flex items-start gap-3">
          <div className="flex-shrink-0 mt-0.5">
            {isSelectable ? (
              <div
                className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
                  isSelected ? 'bg-blue-600 border-blue-600' : 'bg-white border-gray-400 hover:border-blue-400'
                }`}
              >
                {isSelected && (
                  <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </div>
            ) : (
              <span className="text-base">{config.icon}</span>
            )}
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2 mb-1">
              <span className="font-semibold text-gray-900 text-sm">{rec.service_type}</span>
              <span className={`text-xs font-medium px-2 py-0.5 rounded-full border ${config.badgeClass}`}>
                {config.label}
              </span>
              {rec.confidence && (
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${CONFIDENCE_STYLES[rec.confidence] || 'bg-gray-100 text-gray-600'}`}>
                  {rec.confidence.charAt(0).toUpperCase() + rec.confidence.slice(1)} confidence
                </span>
              )}
              {isUpsell && (
                <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-red-100 text-red-700 border border-red-200">
                  🚨 Possible Upsell
                </span>
              )}
            </div>

            <p className="text-sm text-gray-600 leading-relaxed">{rec.reason}</p>

            <div className="flex flex-wrap gap-4 mt-2 text-xs text-gray-500">
              {rec.interval_miles && <span>📏 Every {rec.interval_miles.toLocaleString()} miles</span>}
              {rec.interval_months && <span>🗓 Every {rec.interval_months} months</span>}
              {rec.last_performed_mileage && <span>🔧 Last at {rec.last_performed_mileage.toLocaleString()} miles</span>}
              {rec.last_performed_date && <span>📅 Last: {new Date(rec.last_performed_date).toLocaleDateString()}</span>}
            </div>
          </div>

          <button
            onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
            className="flex-shrink-0 text-gray-400 hover:text-gray-600 transition-colors p-1"
          >
            <svg className={`w-4 h-4 transition-transform ${expanded ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
        </div>

        {expanded && (
          <div className="mt-3 ml-8 pt-3 border-t border-gray-100 space-y-2">
            {rec.citation && (
              <div className="flex gap-2">
                <span className="text-xs font-semibold text-gray-500 w-16 flex-shrink-0">Citation:</span>
                <span className="text-xs text-blue-700 italic">{rec.citation}</span>
              </div>
            )}
            {rec.upsell_reason && (
              <div className="flex gap-2">
                <span className="text-xs font-semibold text-gray-500 w-16 flex-shrink-0">Warning:</span>
                <span className="text-xs text-red-600">{rec.upsell_reason}</span>
              </div>
            )}
            <div className="flex gap-2">
              <span className="text-xs font-semibold text-gray-500 w-16 flex-shrink-0">Note:</span>
              <span className="text-xs text-gray-500">{config.description}</span>
            </div>
            {!isSelectable && (
              <p className="text-xs text-orange-600 font-medium mt-1">
                ℹ️ This item is not selectable — consider asking your service provider why this is recommended.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function AddToHistoryModal({ selectedRecs, onConfirm, onCancel, loading }) {
  const today = new Date().toISOString().split('T')[0];
  const [formData, setFormData] = useState({ service_date: today, shop_name: '' });

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6">
        <h3 className="text-lg font-bold text-gray-900 mb-1">Add to Service History</h3>
        <p className="text-sm text-gray-500 mb-4">
          Recording {selectedRecs.length} service{selectedRecs.length > 1 ? 's' : ''} as completed.
        </p>

        <div className="bg-gray-50 rounded-lg p-3 mb-4 max-h-36 overflow-y-auto space-y-1">
          {selectedRecs.map((r, i) => (
            <div key={i} className="flex items-center gap-2 text-sm text-gray-700">
              <svg className="w-4 h-4 text-green-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              {r.service_type}
            </div>
          ))}
        </div>

        <div className="space-y-3 mb-5">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Service Date</label>
            <input
              type="date"
              value={formData.service_date}
              onChange={(e) => setFormData({ ...formData, service_date: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Shop / Provider <span className="text-gray-400 font-normal">(optional)</span></label>
            <input
              type="text"
              value={formData.shop_name}
              onChange={(e) => setFormData({ ...formData, shop_name: e.target.value })}
              placeholder="e.g., Jiffy Lube, DIY"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
        </div>

        <div className="flex gap-3">
          <button
            onClick={() => onConfirm(formData)}
            disabled={loading}
            className="flex-1 bg-green-600 hover:bg-green-700 disabled:bg-green-400 text-white px-4 py-2.5 rounded-lg font-semibold text-sm transition"
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                </svg>
                Saving...
              </span>
            ) : 'Confirm & Save'}
          </button>
          <button
            onClick={onCancel}
            disabled={loading}
            className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-700 px-4 py-2.5 rounded-lg font-semibold text-sm transition"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}


// ─── Service History Search ────────────────────────────────────────────────
const QUICK_SEARCHES = [
  'Battery', 'Oil Change', 'Tire Rotation', 'Brake', 'Transmission Fluid',
  'Differential Fluid', 'Air Filter', 'Spark Plugs', 'Coolant', 'Alignment',
];

function ServiceHistorySearch({ vehicleId }) {
  const [open, setOpen] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const handleSearch = async (term) => {
    const q = (term || keyword).trim();
    if (!q) return;
    setKeyword(q);
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await searchServiceHistory(vehicleId, q);
      setResult(res.data);
    } catch {
      setError('Search failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm mb-5">
      {/* Header toggle */}
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-5 py-4 text-left"
      >
        <div className="flex items-center gap-2">
          <span className="text-base">🔎</span>
          <span className="font-semibold text-gray-800 text-sm">Search Service History</span>
          <span className="text-xs text-gray-400 font-normal hidden sm:inline">
            — find when a service was last performed
          </span>
        </div>
        <svg
          className={`w-4 h-4 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="px-5 pb-5 border-t border-gray-100">
          {/* Search input */}
          <div className="flex gap-2 mt-4">
            <input
              type="text"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              placeholder="e.g., battery, oil change, differential fluid..."
              className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
            <button
              onClick={() => handleSearch()}
              disabled={loading || !keyword.trim()}
              className="bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white px-4 py-2 rounded-lg text-sm font-semibold transition"
            >
              {loading ? '...' : 'Search'}
            </button>
          </div>

          {/* Quick search chips */}
          <div className="flex flex-wrap gap-2 mt-3">
            {QUICK_SEARCHES.map((term) => (
              <button
                key={term}
                onClick={() => handleSearch(term)}
                className="text-xs px-3 py-1 rounded-full border border-gray-200 bg-gray-50 hover:bg-blue-50 hover:border-blue-300 hover:text-blue-700 text-gray-600 transition"
              >
                {term}
              </button>
            ))}
          </div>

          {/* Error */}
          {error && (
            <p className="mt-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
          )}

          {/* Results */}
          {result && (
            <div className="mt-4">
              {/* Summary banner */}
              <div className={`rounded-lg px-4 py-3 text-sm font-medium mb-3 ${
                result.total_matches === 0
                  ? 'bg-gray-50 border border-gray-200 text-gray-500'
                  : 'bg-blue-50 border border-blue-200 text-blue-800'
              }`}>
                {result.total_matches === 0
                  ? `🔍 No records found for "${result.keyword}"`
                  : `📋 ${result.summary}`
                }
              </div>

              {/* Result rows */}
              {result.results.length > 0 && (
                <div className="space-y-2">
                  {result.results.map((rec, i) => (
                    <div key={i} className="bg-gray-50 border border-gray-100 rounded-lg px-4 py-3 text-sm">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-semibold text-gray-800">{rec.service_type}</span>
                        <div className="flex gap-2 flex-wrap">
                          {rec.days_ago !== null && (
                            <span className="text-xs bg-white border border-gray-200 rounded-full px-2 py-0.5 text-gray-500">
                              {rec.days_ago === 0 ? 'Today' : rec.days_ago === 1 ? 'Yesterday' : `${rec.days_ago} days ago`}
                            </span>
                          )}
                          {rec.miles_ago !== null && rec.miles_ago >= 0 && (
                            <span className="text-xs bg-white border border-gray-200 rounded-full px-2 py-0.5 text-gray-500">
                              {rec.miles_ago.toLocaleString()} miles ago
                            </span>
                          )}
                          {rec.is_manual_entry && (
                            <span className="text-xs bg-yellow-50 border border-yellow-200 rounded-full px-2 py-0.5 text-yellow-700">
                              Manual entry
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1 text-xs text-gray-500">
                        {rec.service_date && (
                          <span>📅 {new Date(rec.service_date).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}</span>
                        )}
                        {rec.mileage_at_service && (
                          <span>📏 {rec.mileage_at_service.toLocaleString()} miles</span>
                        )}
                        {rec.shop_name && (
                          <span>🔧 {rec.shop_name}</span>
                        )}
                      </div>
                      {rec.service_description && (
                        <p className="mt-1 text-xs text-gray-400 italic">{rec.service_description}</p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function Recommendations() {
  const { id: vehicleId } = useParams();
  const [vehicle, setVehicle] = useState(null);
  const [recommendations, setRecommendations] = useState([]);
  const [selectedIndices, setSelectedIndices] = useState(new Set());
  const [mileage, setMileage] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [successMessage, setSuccessMessage] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [hasGenerated, setHasGenerated] = useState(false);

  useEffect(() => {
    const loadVehicle = async () => {
      try {
        const res = await getVehicle(vehicleId);
        setVehicle(res.data);
        if (res.data.current_mileage) setMileage(String(res.data.current_mileage));
      } catch {
        setError('Failed to load vehicle info.');
      }
    };
    loadVehicle();
  }, [vehicleId]);

  const handleGenerate = useCallback(async () => {
    if (!mileage || isNaN(parseInt(mileage))) {
      setError('Please enter a valid mileage.');
      return;
    }
    setLoading(true);
    setError(null);
    setSuccessMessage(null);
    setSelectedIndices(new Set());
    setRecommendations([]);
    // Persist mileage to DB so the fleet dashboard stays in sync
    try {
      await updateVehicle(parseInt(vehicleId), { current_mileage: parseInt(mileage) });
    } catch (_) {
      // non-blocking — proceed with recommendations even if mileage save fails
    }
    try {
      const res = await getRecommendations({
        vehicle_id: parseInt(vehicleId),
        current_mileage: parseInt(mileage),
        driving_condition: vehicle?.driving_condition || 'normal',
        // driving_condition comes from the persisted vehicle profile, not a
        // local UI state. Users change it on the Fleet Dashboard vehicle card.
      });
      setRecommendations(res.data.recommendations || []);
      setHasGenerated(true);
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to generate recommendations. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [vehicleId, mileage, vehicle]);

  const toggleSelect = (index) => {
    setSelectedIndices((prev) => {
      const next = new Set(prev);
      next.has(index) ? next.delete(index) : next.add(index);
      return next;
    });
  };

  const selectableIndices = recommendations
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => r.category !== 'not_needed' && !r.is_upsell_flag && r.service_type !== 'OEM Schedule Not Available')
    .map(({ i }) => i);

  const toggleSelectAll = () => {
    setSelectedIndices(
      selectedIndices.size === selectableIndices.length ? new Set() : new Set(selectableIndices)
    );
  };

  const [pendingRecs, setPendingRecs] = useState([]);

  const openModal = () => {
    // Capture selected recs at the moment user clicks the button
    const recs = [...selectedIndices].map((i) => recommendations[i]).filter(Boolean);
    setPendingRecs(recs);
    setShowModal(true);
  };

  const handleAddToHistory = async (formData) => {
    setSaving(true);
    try {
      await addRecommendationsToHistory({
        vehicle_id: parseInt(vehicleId),
        current_mileage: parseInt(mileage),
        service_date: formData.service_date,
        shop_name: formData.shop_name || null,
        selected_recommendations: pendingRecs.map((r) => ({
          service_type: r.service_type,
          category: r.category,
          reason: r.reason,
          interval_miles: r.interval_miles,
          interval_months: r.interval_months,
          citation: r.citation,
          confidence: r.confidence || 'medium',
        })),
      });

      const count = selectedIndices.size;
      setShowModal(false);
      setSelectedIndices(new Set());
      setSuccessMessage(`✅ Added ${count} service record${count > 1 ? 's' : ''} to history. Refreshing recommendations...`);

      // Re-generate recommendations to reflect updated history
      setTimeout(async () => {
        setLoading(true);
        setSuccessMessage(null);
        try {
          const res = await getRecommendations({
            vehicle_id: parseInt(vehicleId),
            current_mileage: parseInt(mileage),
            driving_condition: vehicle?.driving_condition || 'normal',
          });
          setRecommendations(res.data.recommendations || []);
          setSuccessMessage('✅ Recommendations refreshed based on your updated service history.');
        } catch {
          setError('Records saved. Please click Re-run to refresh recommendations.');
        } finally {
          setLoading(false);
        }
      }, 600);
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to save service records.');
      setShowModal(false);
    } finally {
      setSaving(false);
    }
  };

  const CATEGORY_ORDER = ['overdue', 'recommended_now', 'due_soon', 'optional', 'not_needed'];
  const grouped = CATEGORY_ORDER.reduce((acc, cat) => {
    const items = recommendations.map((r, i) => ({ r, i })).filter(({ r }) => r.category === cat);
    if (items.length) acc[cat] = items;
    return acc;
  }, {});

  const selectedCount = selectedIndices.size;
  const allSelectableSelected = selectableIndices.length > 0 && selectedCount === selectableIndices.length;

  return (
    <div className="max-w-7xl mx-auto" style={{maxWidth:760,margin:"0 auto",padding:"32px 40px"}}>
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <Link to="/" className="text-gray-400 hover:text-gray-600 transition" style={{display:"flex",alignItems:"center",justifyContent:"center",width:32,height:32,borderRadius:8,border:"1px solid #E2E8F0",background:"#fff",textDecoration:"none"}}>
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </Link>
        <div className="flex items-center space-x-3">
          
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Maintenance Recommendations</h1>
            {vehicle && (
              <p className="text-gray-500 text-sm">
                {vehicle.nickname || `${vehicle.year} ${vehicle.make} ${vehicle.model}`}
                {vehicle.nickname && ` · ${vehicle.year} ${vehicle.make} ${vehicle.model}`}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Input panel */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 mb-5">
        <div className="flex flex-col sm:flex-row gap-4 items-end">
          <div className="flex-1">
            <label className="block text-sm font-medium text-gray-700 mb-1">Current Mileage *</label>
            <input
              type="number"
              value={mileage}
              onChange={(e) => setMileage(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleGenerate()}
              placeholder="e.g., 45000"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
          {/* Driving condition is a vehicle-level setting, not a per-session
              choice. It is displayed here for context and links to the
              Fleet Dashboard where users can change it on their vehicle profile. */}
          <div className="flex-1 flex flex-col justify-end">
            <div className="px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm flex items-center justify-between">
              <span className="text-gray-500">
                {vehicle?.driving_condition === 'severe'
                  ? <span>⚠️ <span className="font-medium text-amber-700">Severe</span> conditions</span>
                  : <span>✓ <span className="font-medium text-green-700">Normal</span> conditions</span>
                }
              </span>
              <Link
                to="/"
                className="text-xs text-blue-600 hover:text-blue-800 font-medium ml-3 whitespace-nowrap"
              >
                Change in vehicle settings →
              </Link>
            </div>
            <p className="text-xs text-gray-400 mt-1">Set on your vehicle profile</p>
          </div>
          <button
            onClick={handleGenerate}
            disabled={loading}
            className="bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white px-6 py-2 rounded-lg font-semibold text-sm transition whitespace-nowrap"
          >
            {loading ? (
              <span className="flex items-center gap-2">
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                </svg>
                Analyzing...
              </span>
            ) : hasGenerated ? '🔄 Re-run' : '🔍 Get Recommendations'}
          </button>
        </div>
      </div>

      {/* Disclaimer */}
      <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 mb-5 text-xs text-amber-800">
        <strong>Disclaimer:</strong> MaintenanceGuard provides informational guidance based on manufacturer recommendations.
        This is not a substitute for professional mechanical advice. Driving conditions, climate, and component condition
        may warrant different service intervals than manufacturer guidelines.
      </div>

      {/* Service History Search */}
      {vehicle && <ServiceHistorySearch vehicleId={vehicleId} />}

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 mb-4 text-sm text-red-700 flex items-center justify-between">
          {error}
          <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600 ml-2">✕</button>
        </div>
      )}

      {/* Success */}
      {successMessage && (
        <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-3 mb-4 text-sm text-green-700 flex items-center justify-between">
          {successMessage}
          <button onClick={() => setSuccessMessage(null)} className="text-green-400 hover:text-green-600 ml-2">✕</button>
        </div>
      )}

      {/* Loading skeleton */}
      {loading && recommendations.length === 0 && (
        <div className="space-y-3">
          {[1, 2, 3, 4].map((n) => (
            <div key={n} className="bg-white rounded-lg border border-gray-200 p-4 animate-pulse">
              <div className="flex gap-3 items-start">
                <div className="w-5 h-5 bg-gray-200 rounded flex-shrink-0 mt-0.5" />
                <div className="flex-1 space-y-2">
                  <div className="flex gap-2">
                    <div className="h-4 bg-gray-200 rounded w-1/3" />
                    <div className="h-4 bg-gray-200 rounded w-1/4" />
                  </div>
                  <div className="h-3 bg-gray-200 rounded w-3/4" />
                  <div className="h-3 bg-gray-200 rounded w-1/2" />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Results */}
      {recommendations.length > 0 && !loading && (
        <>
          {/* Sticky action bar */}
          <div className="sticky top-2 z-10 bg-white/95 backdrop-blur border border-gray-200 rounded-xl shadow-md px-4 py-3 mb-5 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <button
                onClick={toggleSelectAll}
                disabled={selectableIndices.length === 0}
                className="text-sm text-blue-600 hover:text-blue-800 font-medium transition disabled:text-gray-400"
              >
                {allSelectableSelected ? 'Deselect All' : 'Select All'}
              </button>
              {selectedCount > 0 && (
                <span className="text-sm text-gray-600">
                  <span className="font-semibold text-blue-700">{selectedCount}</span> selected
                </span>
              )}
            </div>
            <button
              onClick={openModal}
              disabled={selectedCount === 0}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg font-semibold text-sm transition ${
                selectedCount > 0
                  ? 'bg-green-600 hover:bg-green-700 text-white shadow-sm'
                  : 'bg-gray-100 text-gray-400 cursor-not-allowed'
              }`}
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              Add to Service History
              {selectedCount > 0 && (
                <span className="bg-white text-green-700 rounded-full w-5 h-5 flex items-center justify-center text-xs font-bold">
                  {selectedCount}
                </span>
              )}
            </button>
          </div>

          {selectableIndices.length > 0 && selectedCount === 0 && (
            <p className="text-xs text-gray-400 text-center mb-4">
              ☝️ Click a card to select services you've had done, then save them to your history.
            </p>
          )}

          {/* Category sections */}
          <div className="space-y-7">
            {CATEGORY_ORDER.map((cat) => {
              const items = grouped[cat];
              if (!items) return null;
              const config = CATEGORY_CONFIG[cat];
              return (
                <div key={cat}>
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-base">{config.icon}</span>
                    <h2 className="font-bold text-gray-800 text-sm uppercase tracking-wide">{config.label}</h2>
                    <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">{items.length}</span>
                  </div>
                  <div className="space-y-2">
                    {items.map(({ r, i }) => (
                      <RecommendationCard
                        key={i}
                        rec={r}
                        index={i}
                        isSelected={selectedIndices.has(i)}
                        onToggle={toggleSelect}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Bottom add button */}
          {selectedCount > 0 && (
            <div className="mt-8 flex justify-end">
              <button
                onClick={openModal}
                className="flex items-center gap-2 bg-green-600 hover:bg-green-700 text-white px-6 py-3 rounded-xl font-semibold transition shadow-md"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                Add {selectedCount} Service{selectedCount > 1 ? 's' : ''} to History
              </button>
            </div>
          )}
        </>
      )}

      {/* Empty initial state */}
      {!loading && !hasGenerated && (
        <div className="text-center py-16 text-gray-400">
          <svg className="mx-auto h-16 w-16 mb-4 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          <p className="text-sm">Enter your current mileage and click <strong className="text-gray-600">Get Recommendations</strong> to begin.</p>
        </div>
      )}

      {showModal && (
        <AddToHistoryModal
          selectedRecs={[...selectedIndices].map((i) => recommendations[i])}
          onConfirm={handleAddToHistory}
          onCancel={() => setShowModal(false)}
          loading={saving}
        />
      )}
      {/* ARIA chat widget */}
      <AriaChat vehicleId={vehicle?.id || null} vehicleName={vehicle ? vehicle.year + " " + vehicle.make + " " + vehicle.model : ""} currentMileage={vehicle?.current_mileage || null} />
    </div>
  );
}
