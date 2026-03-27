/**
 * frontend/src/admin/TokenMetrics.jsx
 *
 * Phase 2 — Token Usage page in the admin console.
 * Accessible via the "Token Usage" tab in AdminDashboard nav.
 *
 * Sections:
 *   - Period selector (7d / 30d / 90d + custom date range)
 *   - KPI cards: Total Tokens, Total Cost, Avg Cost/Day, vs Target
 *   - Agent breakdown bar chart (recharts BarChart)
 *   - Daily cost area chart
 *   - Top consumers table
 */

import { useState, useEffect } from 'react'
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis,
  Tooltip, ResponsiveContainer, CartesianGrid, Cell,
} from 'recharts'
import { getTokenMetrics, getTopConsumers } from '../services/adminApi'
import AriaQuality from './AriaQuality'

const C = {
  page: '#EEF2FF', card: '#FFFFFF', cardBorder: '#C7D2FE',
  cardShadow: '0 2px 10px rgba(29,78,216,0.07)',
  dark: '#0F172A', mid: '#374151', muted: '#6B7280',
  blue: '#2563EB', blueLight: '#EFF6FF', blueBorder: '#BFDBFE',
  red: '#EF4444', redLight: '#FEF2F2',
  green: '#10B981', greenLight: '#F0FDF4', greenBorder: '#86EFAC',
  amber: '#F59E0B', amberLight: '#FFFBEB', amberBorder: '#FDE68A',
  purple: '#7C3AED', purpleLight: '#F5F3FF',
  btnGrad: 'linear-gradient(135deg, #1E3A8A, #2563EB)',
}

const AGENT_COLORS = {
  invoice_parser:  '#2563EB',
  invoice_vision:  '#7C3AED',
  recommendation:  '#10B981',
  upsell_check:    '#F59E0B',
}

const AGENT_LABELS = {
  invoice_parser:  'Invoice Parser',
  invoice_vision:  'Invoice Vision',
  recommendation:  'Recommendations',
  upsell_check:    'Upsell Check',
}

function Card({ children, style = {} }) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.cardBorder}`,
      borderRadius: 14, boxShadow: C.cardShadow, ...style }}>
      {children}
    </div>
  )
}

function KpiCard({ label, value, sub, borderColor, icon }) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.cardBorder}`, borderRadius: 14,
      borderTop: `3px solid ${borderColor}`, padding: '20px 22px', boxShadow: C.cardShadow }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
        <span style={{ fontSize: 18 }}>{icon}</span>
        <span style={{ fontSize: 10, fontWeight: 700, color: borderColor,
          letterSpacing: '0.07em', textTransform: 'uppercase' }}>{label}</span>
      </div>
      <div style={{ fontSize: 30, fontWeight: 800, color: C.dark, lineHeight: 1, marginBottom: 4 }}>{value}</div>
      <div style={{ fontSize: 12, color: C.muted }}>{sub}</div>
    </div>
  )
}

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null
  return (
    <div style={{ background: '#fff', border: `1px solid ${C.cardBorder}`, borderRadius: 10,
      padding: '10px 14px', fontSize: 12, boxShadow: C.cardShadow }}>
      <div style={{ color: C.muted, marginBottom: 5, fontWeight: 600 }}>{label}</div>
      {payload.map((p, i) => (
        <div key={i} style={{ color: p.color, fontWeight: 700 }}>
          {p.name}: {p.name === 'cost' ? `$${Number(p.value).toFixed(4)}` : Number(p.value).toLocaleString()}
        </div>
      ))}
    </div>
  )
}

export default function TokenMetrics({ onNavigateToUser }) {
  const [period,    setPeriod]    = useState('30d')
  const [dateFrom,  setDateFrom]  = useState('')
  const [dateTo,    setDateTo]    = useState('')
  const [metrics,   setMetrics]   = useState(null)
  const [consumers, setConsumers] = useState(null)
  const [loading,   setLoading]   = useState(false)
  const [err,       setErr]       = useState(null)

  const load = (p = period, df = dateFrom, dt = dateTo) => {
    setLoading(true)
    Promise.all([
      getTokenMetrics(p, df || null, dt || null),
      getTopConsumers(p),
    ])
      .then(([m, c]) => { setMetrics(m); setConsumers(c); setErr(null) })
      .catch(e => setErr(e.message))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  const handlePeriod = (p) => { setPeriod(p); setDateFrom(''); setDateTo(''); load(p, '', '') }
  const handleCustomApply = () => { if (dateFrom && dateTo) load(period, dateFrom, dateTo) }

  const totalTokens = metrics
    ? (metrics.total_input_tokens + metrics.total_output_tokens).toLocaleString()
    : '—'

  const avgCostDay = metrics && metrics.by_day.length > 0
    ? (metrics.total_cost_usd / metrics.by_day.length).toFixed(3)
    : '0.000'

  const TARGET_PER_USER_MONTH = 0.38

  return (
    <div style={{ fontFamily: 'DM Sans, sans-serif', color: C.dark }}>

      {/* Hero */}
      <div style={{ background: `linear-gradient(135deg, #0F1F5C 0%, #1E3A8A 50%, #2563EB 100%)`,
        padding: '36px 40px 56px' }}>
        <div style={{ maxWidth: 1280, margin: '0 auto' }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.12em',
            textTransform: 'uppercase', color: 'rgba(255,255,255,0.5)', marginBottom: 8 }}>
            ADMIN CONSOLE
          </div>
          <h1 style={{ margin: '0 0 10px', fontSize: 28, fontWeight: 800, color: '#fff',
            letterSpacing: '-0.02em' }}>Token Usage & Costs</h1>
          <p style={{ margin: 0, fontSize: 14, color: 'rgba(255,255,255,0.6)', lineHeight: 1.7 }}>
            Exact per-call token tracking across all AI agents. Target: $0.38/user/month.
          </p>
        </div>
      </div>

      <div style={{ maxWidth: 1280, margin: '-28px auto 0', padding: '0 40px 48px' }}>

        {/* Period controls */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 22, alignItems: 'center', flexWrap: 'wrap' }}>
          {['7d', '30d', '90d'].map(p => (
            <button key={p} onClick={() => handlePeriod(p)}
              style={{ padding: '8px 18px', borderRadius: 9,
                border: `1px solid ${period === p && !dateFrom ? C.blue : C.cardBorder}`,
                background: period === p && !dateFrom ? C.blueLight : '#fff',
                color: period === p && !dateFrom ? C.blue : C.muted,
                fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
              {p}
            </button>
          ))}
          <span style={{ fontSize: 12, color: C.muted, margin: '0 6px' }}>or</span>
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
            style={{ padding: '7px 10px', borderRadius: 9, border: `1px solid ${C.cardBorder}`,
              fontSize: 12, fontFamily: 'inherit', color: C.dark }} />
          <span style={{ fontSize: 12, color: C.muted }}>to</span>
          <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
            style={{ padding: '7px 10px', borderRadius: 9, border: `1px solid ${C.cardBorder}`,
              fontSize: 12, fontFamily: 'inherit', color: C.dark }} />
          <button onClick={handleCustomApply}
            style={{ padding: '8px 18px', borderRadius: 9, border: 'none',
              background: C.btnGrad, color: '#fff', fontSize: 12, fontWeight: 700,
              cursor: 'pointer', fontFamily: 'inherit' }}>
            Apply
          </button>
          {loading && <span style={{ fontSize: 12, color: C.muted }}>Loading…</span>}
        </div>

        {err && (
          <div style={{ padding: '14px 20px', background: C.redLight, borderRadius: 12,
            fontSize: 13, color: C.red, marginBottom: 20 }}>⚠️ {err}</div>
        )}

        {metrics && (
          <>
            {/* KPI Cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 16, marginBottom: 24 }}>
              <KpiCard label="Total Tokens" icon="🔢" borderColor={C.blue}
                value={totalTokens}
                sub={`${metrics.total_input_tokens.toLocaleString()} in · ${metrics.total_output_tokens.toLocaleString()} out`} />
              <KpiCard label="Total Cost" icon="💰" borderColor={C.amber}
                value={`$${metrics.total_cost_usd.toFixed(2)}`}
                sub={`Last ${metrics.period_days} days`} />
              <KpiCard label="Avg Cost/Day" icon="📅" borderColor={C.green}
                value={`$${avgCostDay}`}
                sub="Average daily spend" />
              <KpiCard label="Cost Status" icon="🎯" borderColor={C.purple}
                value={metrics.total_cost_usd <= TARGET_PER_USER_MONTH * 30 ? 'On Track' : 'Review'}
                sub={`$${TARGET_PER_USER_MONTH}/user/month target`} />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 360px', gap: 22, marginBottom: 22 }}>

              {/* Daily cost chart */}
              <Card style={{ padding: 24 }}>
                <h3 style={{ margin: '0 0 4px', fontSize: 16, fontWeight: 800, color: C.dark }}>
                  Daily AI Spend
                </h3>
                <p style={{ margin: '0 0 18px', fontSize: 12, color: C.muted }}>Estimated cost ($) per day</p>
                {metrics.by_day.length > 0 ? (
                  <ResponsiveContainer width="100%" height={200}>
                    <AreaChart data={metrics.by_day} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
                      <defs>
                        <linearGradient id="gTokenCost" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor={C.amber} stopOpacity={0.25} />
                          <stop offset="100%" stopColor={C.amber} stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid stroke="#F1F5F9" strokeDasharray="4 4" />
                      <XAxis dataKey="date" tick={{ fill: C.muted, fontSize: 10 }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fill: C.muted, fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={v => `$${v}`} />
                      <Tooltip content={<CustomTooltip />} />
                      <Area type="monotone" dataKey="cost_usd" name="cost"
                        stroke={C.amber} strokeWidth={2.5} fill="url(#gTokenCost)" />
                    </AreaChart>
                  </ResponsiveContainer>
                ) : (
                  <div style={{ textAlign: 'center', padding: '40px 0', fontSize: 13, color: C.muted }}>
                    No data for this period yet.
                  </div>
                )}
              </Card>

              {/* Agent breakdown bar chart */}
              <Card style={{ padding: 24 }}>
                <h3 style={{ margin: '0 0 4px', fontSize: 16, fontWeight: 800, color: C.dark }}>
                  Cost by Agent
                </h3>
                <p style={{ margin: '0 0 18px', fontSize: 12, color: C.muted }}>Spend breakdown per AI agent</p>
                {metrics.by_agent.length > 0 ? (
                  <>
                    <ResponsiveContainer width="100%" height={140}>
                      <BarChart
                        data={metrics.by_agent.map(a => ({
                          name: AGENT_LABELS[a.agent_name] || a.agent_name,
                          cost: a.cost_usd,
                          color: AGENT_COLORS[a.agent_name] || C.blue,
                        }))}
                        margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
                        <CartesianGrid stroke="#F1F5F9" strokeDasharray="4 4" />
                        <XAxis dataKey="name" tick={{ fill: C.muted, fontSize: 9 }} axisLine={false} tickLine={false} />
                        <YAxis tick={{ fill: C.muted, fontSize: 9 }} axisLine={false} tickLine={false} tickFormatter={v => `$${v}`} />
                        <Tooltip content={<CustomTooltip />} />
                        <Bar dataKey="cost" name="cost" radius={[4, 4, 0, 0]}>
                          {metrics.by_agent.map((a, i) => (
                            <Cell key={i} fill={AGENT_COLORS[a.agent_name] || C.blue} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                    {/* Legend */}
                    <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {metrics.by_agent.map(a => (
                        <div key={a.agent_name} style={{ display: 'flex', justifyContent: 'space-between',
                          alignItems: 'center' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <div style={{ width: 10, height: 10, borderRadius: 3,
                              background: AGENT_COLORS[a.agent_name] || C.blue }} />
                            <span style={{ fontSize: 11, color: C.mid }}>
                              {AGENT_LABELS[a.agent_name] || a.agent_name}
                            </span>
                          </div>
                          <div style={{ display: 'flex', gap: 12 }}>
                            <span style={{ fontSize: 11, color: C.muted }}>{a.call_count} calls</span>
                            <span style={{ fontSize: 11, fontWeight: 700, color: C.dark }}>
                              ${a.cost_usd.toFixed(3)} ({a.pct_of_total}%)
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                ) : (
                  <div style={{ textAlign: 'center', padding: '40px 0', fontSize: 13, color: C.muted }}>
                    No data for this period yet.
                  </div>
                )}
              </Card>
            </div>

            {/* Top consumers table */}
            {consumers && consumers.consumers.length > 0 && (
              <Card>
                <div style={{ padding: '18px 22px 0', display: 'flex',
                  justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <h3 style={{ margin: '0 0 4px', fontSize: 16, fontWeight: 800, color: C.dark }}>
                      Top Token Consumers
                    </h3>
                    <p style={{ margin: 0, fontSize: 12, color: C.muted }}>
                      Users ranked by AI spend — last {consumers.period_days} days
                    </p>
                  </div>
                </div>
                <div style={{ marginTop: 14 }}>
                  <div style={{ display: 'grid',
                    gridTemplateColumns: '50px 1fr 120px 120px 80px 120px',
                    padding: '10px 22px', background: '#FAFBFF',
                    borderTop: `1px solid ${C.cardBorder}`,
                    borderBottom: `1px solid ${C.cardBorder}` }}>
                    {['Rank', 'User', 'Total Tokens', 'Total Cost', 'Calls', 'Avg Cost/Call'].map(h => (
                      <span key={h} style={{ fontSize: 10, fontWeight: 700, color: C.muted,
                        letterSpacing: '0.07em', textTransform: 'uppercase' }}>{h}</span>
                    ))}
                  </div>
                  {consumers.consumers.map((u, i, arr) => (
                    <div key={u.user_id}
                      onClick={() => onNavigateToUser && onNavigateToUser(u.user_id)}
                      style={{ display: 'grid',
                        gridTemplateColumns: '50px 1fr 120px 120px 80px 120px',
                        padding: '13px 22px',
                        borderBottom: i < arr.length - 1 ? `1px solid ${C.cardBorder}` : 'none',
                        alignItems: 'center', cursor: onNavigateToUser ? 'pointer' : 'default',
                        transition: 'background 0.12s' }}
                      onMouseEnter={e => e.currentTarget.style.background = '#FAFBFF'}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                      <div style={{ width: 28, height: 28, borderRadius: 8,
                        background: i < 3 ? C.btnGrad : '#F1F5F9',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 12, fontWeight: 800, color: i < 3 ? '#fff' : C.muted }}>
                        {i + 1}
                      </div>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: C.dark }}>
                          {u.full_name || u.email}
                        </div>
                        <div style={{ fontSize: 11, color: C.muted }}>{u.email}</div>
                      </div>
                      <span style={{ fontSize: 13, color: C.dark }}>
                        {u.total_tokens.toLocaleString()}
                      </span>
                      <span style={{ fontSize: 13, fontWeight: 700, color: C.amber }}>
                        ${u.total_cost_usd.toFixed(3)}
                      </span>
                      <span style={{ fontSize: 13, color: C.muted }}>{u.call_count}</span>
                      <span style={{ fontSize: 12, color: C.muted }}>
                        ${(u.total_cost_usd / Math.max(u.call_count, 1)).toFixed(4)}
                      </span>
                    </div>
                  ))}
                </div>
              </Card>
            )}
          </>
        )}

        {/* ── ARIA Quality panel ─────────────────────────────────────── */}
        <AriaQuality initialPeriod={period} />

        {!metrics && !loading && !err && (
          <Card style={{ padding: 32, textAlign: 'center' }}>
            <div style={{ fontSize: 13, color: C.muted }}>
              No token data available. Token logging begins after the next invoice upload or recommendation request.
            </div>
          </Card>
        )}
      </div>
    </div>
  )
}
