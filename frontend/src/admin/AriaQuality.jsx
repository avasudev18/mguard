/**
 * frontend/src/admin/AriaQuality.jsx
 *
 * ARIA RAGAs Quality panel — rendered inside the Token Usage tab
 * in AdminDashboard as a collapsible section below the agent breakdown chart.
 *
 * Phase 1: Collapsible panel inside Token Usage tab.
 * Phase 3: Promote to its own top-level nav tab (AriaQualityPage).
 *
 * Sections:
 *   - Period selector (shared with parent or self-contained)
 *   - Alert banner (metric degradation warnings)
 *   - 6 KPI cards: Faithfulness, Answer Relevance, Context Precision,
 *                  Context Recall, Precision@5, Recall@5
 *   - Line chart: all RAGAs metrics over time
 *   - Embedding model comparison table (migration gate visibility)
 *   - Run count footer
 *
 * API: GET /api/admin/metrics/aria-quality?period=30d
 * No LLM calls on load — reads pre-computed scores from evaluation_log.
 */

import { useState, useEffect } from 'react'
import { getAriaQualityMetrics } from '../services/adminApi'
import {
  LineChart, Line, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid, ReferenceLine, Legend,
} from 'recharts'

// ── Colour palette — matches TokenMetrics.jsx ─────────────────────────────────
const C = {
  page: '#EEF2FF', card: '#FFFFFF', cardBorder: '#C7D2FE',
  cardShadow: '0 2px 10px rgba(29,78,216,0.07)',
  dark: '#0F172A', mid: '#374151', muted: '#6B7280',
  blue: '#2563EB', blueLight: '#EFF6FF', blueBorder: '#BFDBFE',
  red: '#EF4444', redLight: '#FEF2F2', redBorder: '#FECACA',
  green: '#10B981', greenLight: '#F0FDF4', greenBorder: '#86EFAC',
  amber: '#F59E0B', amberLight: '#FFFBEB', amberBorder: '#FDE68A',
  purple: '#7C3AED', purpleLight: '#F5F3FF', purpleBorder: '#DDD6FE',
  teal: '#0D9488',
  btnGrad: 'linear-gradient(135deg, #1E3A8A, #2563EB)',
}

// Metric colours for the line chart
const METRIC_COLORS = {
  faithfulness:      C.green,
  answer_relevance:  C.blue,
  context_precision: C.purple,
  context_recall:    C.teal,
  precision_at_5:    C.amber,
  recall_at_5:       C.red,
}

const METRIC_LABELS = {
  faithfulness:      'Faithfulness',
  answer_relevance:  'Answer Relevance',
  context_precision: 'Context Precision',
  context_recall:    'Context Recall',
  precision_at_5:    'Precision@5',
  recall_at_5:       'Recall@5',
}

const TARGETS = {
  faithfulness:      0.85,
  answer_relevance:  0.80,
  context_precision: 0.70,
  context_recall:    0.75,
  precision_at_5:    0.70,
  recall_at_5:       0.80,
}

// ── Metric descriptions — shown in tooltip and legend ────────────────────────
const METRIC_DESCRIPTIONS = {
  faithfulness:      "Are ARIA's responses grounded in the retrieved context? High = no hallucinations, every claim is supported by actual data.",
  answer_relevance:  "Does ARIA's response actually answer what the user asked? High = directly addresses the question.",
  context_precision: "Of the chunks retrieved, how many were actually needed? High = retrieval is precise, low noise.",
  context_recall:    "Did the retrieved context contain all the information needed to answer? High = nothing important was missed.",
  precision_at_5:    "Of the top-5 retrieved chunks, how many match the expected golden set? Measures retrieval accuracy.",
  recall_at_5:       "Of the expected golden chunks, how many appear in the top-5 results? Measures retrieval completeness.",
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Card({ children, style = {} }) {
  return (
    <div style={{
      background: C.card, border: `1px solid ${C.cardBorder}`,
      borderRadius: 14, boxShadow: C.cardShadow, ...style,
    }}>
      {children}
    </div>
  )
}

function MetricKpiCard({ metric, value, target }) {
  const [showTip, setShowTip] = useState(false)
  const label  = METRIC_LABELS[metric]
  const color  = METRIC_COLORS[metric]
  const desc   = METRIC_DESCRIPTIONS[metric]
  const status = value == null
    ? 'no-data'
    : value >= target           ? 'pass'
    : value >= target - 0.05    ? 'warn'
    : 'fail'

  const statusColor = { pass: C.green, warn: C.amber, fail: C.red, 'no-data': C.muted }[status]
  const statusLabel = { pass: 'On target', warn: 'Near threshold', fail: 'Below target', 'no-data': 'No data yet' }[status]
  const statusBg    = { pass: C.greenLight, warn: C.amberLight, fail: C.redLight, 'no-data': '#F8FAFC' }[status]

  return (
    <div style={{
      background: C.card,
      border: `1px solid ${C.cardBorder}`,
      borderTop: `3px solid ${color}`,
      borderRadius: 14,
      padding: '18px 20px',
      boxShadow: C.cardShadow,
      position: 'relative',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{
            fontSize: 10, fontWeight: 700, color: color,
            letterSpacing: '0.07em', textTransform: 'uppercase',
          }}>
            {label}
          </span>
          {/* Info icon */}
          <span
            onMouseEnter={() => setShowTip(true)}
            onMouseLeave={() => setShowTip(false)}
            style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              width: 14, height: 14, borderRadius: '50%',
              background: '#E2E8F0', color: C.muted,
              fontSize: 9, fontWeight: 800, cursor: 'default', flexShrink: 0,
            }}>
            ?
          </span>
          {/* Tooltip */}
          {showTip && (
            <div style={{
              position: 'absolute', top: 36, left: 0, zIndex: 50,
              background: '#1E293B', color: '#F8FAFC',
              fontSize: 11, lineHeight: 1.6, fontWeight: 400,
              padding: '10px 14px', borderRadius: 10,
              maxWidth: 240, boxShadow: '0 8px 24px rgba(0,0,0,0.25)',
              pointerEvents: 'none',
            }}>
              {desc}
            </div>
          )}
        </div>
        <span style={{
          fontSize: 10, fontWeight: 700, color: statusColor,
          background: statusBg, padding: '2px 8px', borderRadius: 20,
          whiteSpace: 'nowrap',
        }}>
          {statusLabel}
        </span>
      </div>

      {/* Score */}
      <div style={{ fontSize: 32, fontWeight: 800, color: C.dark, lineHeight: 1, marginBottom: 6 }}>
        {value != null ? value.toFixed(2) : '—'}
      </div>

      {/* Progress bar */}
      <div style={{
        height: 6, background: '#E2E8F0', borderRadius: 3,
        marginBottom: 6, overflow: 'hidden',
      }}>
        <div style={{
          height: '100%',
          width: `${Math.min((value ?? 0) * 100, 100)}%`,
          background: statusColor,
          borderRadius: 3,
          transition: 'width 0.5s ease',
        }} />
      </div>

      <div style={{ fontSize: 11, color: C.muted }}>
        Target ≥ {target.toFixed(2)}
      </div>
    </div>
  )
}

const QualityTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null
  return (
    <div style={{
      background: '#fff', border: `1px solid ${C.cardBorder}`,
      borderRadius: 10, padding: '10px 14px', fontSize: 12,
      boxShadow: C.cardShadow, minWidth: 180,
    }}>
      <div style={{ color: C.muted, marginBottom: 6, fontWeight: 600 }}>{label}</div>
      {payload.map((p, i) => (
        <div key={i} style={{
          display: 'flex', justifyContent: 'space-between',
          gap: 16, color: p.color, fontWeight: 700, marginBottom: 2,
        }}>
          <span style={{ color: C.mid, fontWeight: 400 }}>{p.name}</span>
          <span>{p.value != null ? Number(p.value).toFixed(3) : '—'}</span>
        </div>
      ))}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function AriaQuality({ initialPeriod = '30d' }) {
  const [period,   setPeriod]   = useState(initialPeriod)
  const [data,     setData]     = useState(null)
  const [loading,  setLoading]  = useState(false)
  const [err,      setErr]      = useState(null)
  const [expanded, setExpanded] = useState(true)   // panel open by default

  const load = (p = period) => {
    setLoading(true)
    setErr(null)
    getAriaQualityMetrics(p)
      .then(d => setData(d))
      .catch(e => setErr(e.response?.data?.detail || 'Failed to load ARIA quality metrics'))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  const handlePeriod = (p) => { setPeriod(p); load(p) }

  // Build chart data — only days with at least one data point
  const chartData = data?.by_day?.filter(d =>
    d.faithfulness != null ||
    d.answer_relevance != null ||
    d.precision_at_5 != null
  ) ?? []

  const hasData = data && !data.is_seeded

  return (
    <div style={{ marginTop: 28 }}>

      {/* ── Section header (collapsible toggle) ── */}
      <div
        onClick={() => setExpanded(e => !e)}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          cursor: 'pointer', marginBottom: expanded ? 18 : 0,
          padding: '14px 20px',
          background: `linear-gradient(135deg, #0F1F5C 0%, #1E3A8A 50%, #2563EB 100%)`,
          borderRadius: expanded ? '14px 14px 0 0' : 14,
          transition: 'border-radius 0.2s',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 18 }}>🎯</span>
          <div>
            <div style={{ fontSize: 14, fontWeight: 800, color: '#fff', letterSpacing: '-0.01em' }}>
              ARIA Quality Metrics
            </div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)', marginTop: 1 }}>
              RAGAs faithfulness · answer relevance · retrieval precision@5 & recall@5
            </div>
          </div>
          {data && data.is_seeded && (
            <span style={{
              fontSize: 10, fontWeight: 700, color: C.amber,
              background: C.amberLight, padding: '3px 10px', borderRadius: 20,
              border: `1px solid ${C.amberBorder}`,
            }}>
              AWAITING EVAL DATA
            </span>
          )}
          {hasData && data.alerts?.length > 0 && (
            <span style={{
              fontSize: 10, fontWeight: 700, color: '#fff',
              background: C.red, padding: '3px 10px', borderRadius: 20,
            }}>
              {data.alerts.length} ALERT{data.alerts.length > 1 ? 'S' : ''}
            </span>
          )}
        </div>
        <span style={{ fontSize: 18, color: 'rgba(255,255,255,0.7)', userSelect: 'none' }}>
          {expanded ? '▲' : '▼'}
        </span>
      </div>

      {!expanded && null}

      {expanded && (
        <div style={{
          border: `1px solid ${C.cardBorder}`,
          borderTop: 'none',
          borderRadius: '0 0 14px 14px',
          padding: '24px 24px 28px',
          background: '#FAFBFF',
        }}>

          {/* ── Period selector ── */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 20, alignItems: 'center' }}>
            {['7d', '30d', '90d'].map(p => (
              <button key={p} onClick={() => handlePeriod(p)}
                style={{
                  padding: '7px 16px', borderRadius: 9,
                  border: `1px solid ${period === p ? C.blue : C.cardBorder}`,
                  background: period === p ? C.blueLight : '#fff',
                  color: period === p ? C.blue : C.muted,
                  fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
                }}>
                {p}
              </button>
            ))}
            {loading && (
              <span style={{ fontSize: 12, color: C.muted, marginLeft: 4 }}>Loading…</span>
            )}
            {hasData && (
              <span style={{ fontSize: 11, color: C.muted, marginLeft: 'auto' }}>
                Model: <strong style={{ color: C.dark }}>{data.embedding_model}</strong>
                {data.golden_dataset_version && (
                  <> · Golden dataset: <strong style={{ color: C.dark }}>
                    {data.golden_dataset_version}
                  </strong></>
                )}
              </span>
            )}
          </div>

          {err && (
            <div style={{
              padding: '12px 18px', background: C.redLight,
              border: `1px solid ${C.redBorder}`, borderRadius: 12,
              fontSize: 13, color: C.red, marginBottom: 18,
            }}>
              ⚠️ {err}
            </div>
          )}

          {/* ── Alert banners ── */}
          {hasData && data.alerts?.length > 0 && (
            <div style={{ marginBottom: 20, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {data.alerts.map((alert, i) => (
                <div key={i} style={{
                  padding: '11px 16px', background: C.redLight,
                  border: `1px solid ${C.redBorder}`, borderRadius: 10,
                  fontSize: 13, color: C.red, display: 'flex', alignItems: 'center', gap: 8,
                }}>
                  <span>⚠️</span>
                  <span>{alert.message}</span>
                </div>
              ))}
            </div>
          )}

          {/* ── Seeded state ── */}
          {data?.is_seeded && (
            <div style={{
              padding: '20px 24px',
              background: C.amberLight,
              border: `1px solid ${C.amberBorder}`,
              borderRadius: 12,
              marginBottom: 24,
              fontSize: 13,
              color: '#92400E',
              lineHeight: 1.7,
            }}>
              <strong>No evaluation data yet.</strong> Quality metrics will appear here once the
              nightly RAGAs job (<code>scripts/eval_ragas.py</code>) has run at least once and
              the golden dataset retrieval evaluation (<code>scripts/eval_retrieval.py</code>) has
              been executed. See Section 11 of the ARIA proposal for setup instructions.
            </div>
          )}

          {/* ── KPI cards — 6 across ── */}
          {data && (
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(6, 1fr)',
              gap: 14,
              marginBottom: 24,
            }}>
              {['faithfulness', 'answer_relevance', 'context_precision',
                'context_recall', 'precision_at_5', 'recall_at_5'].map(metric => (
                <MetricKpiCard
                  key={metric}
                  metric={metric}
                  value={data[`avg_${metric}`]}
                  target={TARGETS[metric]}
                />
              ))}
            </div>
          )}

          {/* ── Metrics legend ── */}
          {data && (
            <div style={{
              background: '#FAFBFF', border: `1px solid ${C.cardBorder}`,
              borderRadius: 12, padding: '16px 20px', marginBottom: 20,
            }}>
              <p style={{ margin: '0 0 12px', fontSize: 11, fontWeight: 700,
                color: C.muted, textTransform: 'uppercase', letterSpacing: '0.07em' }}>
                What do these metrics mean?
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 24px' }}>
                {Object.entries(METRIC_DESCRIPTIONS).map(([key, desc]) => (
                  <div key={key} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                    <span style={{
                      width: 8, height: 8, borderRadius: '50%', flexShrink: 0, marginTop: 4,
                      background: METRIC_COLORS[key],
                    }} />
                    <div>
                      <span style={{ fontSize: 11, fontWeight: 700, color: C.dark }}>
                        {METRIC_LABELS[key]}:
                      </span>
                      {' '}
                      <span style={{ fontSize: 11, color: C.muted }}>{desc}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Line chart ── */}
          {hasData && chartData.length > 0 && (
            <Card style={{ padding: 24, marginBottom: 22 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: C.dark }}>
                  Quality Trends
                </h3>
                <span style={{ fontSize: 11, color: C.muted }}>
                  {data.ragas_run_count} RAGAs runs · {data.retrieval_run_count} retrieval runs
                </span>
              </div>
              <p style={{ margin: '0 0 18px', fontSize: 12, color: C.muted }}>
                Daily average scores — dashed lines show minimum targets
              </p>
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: -20 }}>
                  <CartesianGrid stroke="#F1F5F9" strokeDasharray="4 4" />
                  <XAxis dataKey="date" tick={{ fill: C.muted, fontSize: 10 }}
                    axisLine={false} tickLine={false}
                    tickFormatter={v => v.slice(5)} />
                  <YAxis domain={[0, 1]} tick={{ fill: C.muted, fontSize: 10 }}
                    axisLine={false} tickLine={false}
                    tickFormatter={v => v.toFixed(1)} />
                  <Tooltip content={<QualityTooltip />} />
                  <Legend
                    wrapperStyle={{ fontSize: 11, paddingTop: 12 }}
                    formatter={(value) => METRIC_LABELS[value] || value}
                  />
                  {/* Target reference lines */}
                  <ReferenceLine y={0.85} stroke={C.green}  strokeDasharray="3 3" strokeOpacity={0.4} />
                  <ReferenceLine y={0.80} stroke={C.blue}   strokeDasharray="3 3" strokeOpacity={0.4} />
                  <ReferenceLine y={0.70} stroke={C.purple} strokeDasharray="3 3" strokeOpacity={0.4} />

                  {['faithfulness', 'answer_relevance', 'context_precision',
                    'context_recall', 'precision_at_5', 'recall_at_5'].map(metric => (
                    <Line
                      key={metric}
                      type="monotone"
                      dataKey={metric}
                      name={metric}
                      stroke={METRIC_COLORS[metric]}
                      strokeWidth={2}
                      dot={false}
                      connectNulls={false}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </Card>
          )}

          {/* ── Embedding model comparison table ── */}
          {hasData && data.by_embedding_model?.length > 1 && (
            <Card>
              <div style={{ padding: '18px 22px 0' }}>
                <h3 style={{ margin: '0 0 4px', fontSize: 16, fontWeight: 800, color: C.dark }}>
                  Embedding Model Comparison
                </h3>
                <p style={{ margin: '0 0 14px', fontSize: 12, color: C.muted }}>
                  Migration gate — new model must meet or exceed baseline before production cutover
                </p>
              </div>
              <div style={{ overflowX: 'auto' }}>
                {/* Header */}
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 120px 120px 120px 80px',
                  padding: '10px 22px',
                  background: '#FAFBFF',
                  borderTop: `1px solid ${C.cardBorder}`,
                  borderBottom: `1px solid ${C.cardBorder}`,
                }}>
                  {['Model', 'Precision@5', 'Recall@5', 'Faithfulness', 'Runs'].map(h => (
                    <span key={h} style={{
                      fontSize: 10, fontWeight: 700, color: C.muted,
                      letterSpacing: '0.07em', textTransform: 'uppercase',
                    }}>
                      {h}
                    </span>
                  ))}
                </div>
                {/* Rows */}
                {data.by_embedding_model.map((row, i, arr) => {
                  const isLatest = row.embedding_model === data.embedding_model
                  return (
                    <div key={row.embedding_model} style={{
                      display: 'grid',
                      gridTemplateColumns: '1fr 120px 120px 120px 80px',
                      padding: '13px 22px',
                      borderBottom: i < arr.length - 1 ? `1px solid ${C.cardBorder}` : 'none',
                      alignItems: 'center',
                      background: isLatest ? C.blueLight : 'transparent',
                    }}>
                      <div>
                        <span style={{ fontSize: 13, fontWeight: 600, color: C.dark }}>
                          {row.embedding_model}
                        </span>
                        {isLatest && (
                          <span style={{
                            marginLeft: 8, fontSize: 10, fontWeight: 700,
                            color: C.blue, background: '#DBEAFE',
                            padding: '2px 7px', borderRadius: 20,
                          }}>
                            ACTIVE
                          </span>
                        )}
                      </div>
                      {['avg_precision_at_5', 'avg_recall_at_5', 'avg_faithfulness'].map(key => {
                        const val = row[key]
                        const metric = key.replace('avg_', '')
                        const target = TARGETS[metric] ?? 0.70
                        const color  = val == null ? C.muted
                          : val >= target ? C.green
                          : val >= target - 0.05 ? C.amber
                          : C.red
                        return (
                          <span key={key} style={{ fontSize: 13, fontWeight: 700, color }}>
                            {val != null ? val.toFixed(3) : '—'}
                          </span>
                        )
                      })}
                      <span style={{ fontSize: 13, color: C.muted }}>{row.run_count}</span>
                    </div>
                  )
                })}
              </div>
            </Card>
          )}

          {/* ── Empty state (data exists but chart is empty) ── */}
          {hasData && chartData.length === 0 && !data.is_seeded && (
            <Card style={{ padding: 32, textAlign: 'center' }}>
              <div style={{ fontSize: 13, color: C.muted }}>
                Evaluation runs exist but no per-day scores are available for this period.
                Try a longer period or check the eval_ragas.py logs.
              </div>
            </Card>
          )}

        </div>
      )}
    </div>
  )
}
