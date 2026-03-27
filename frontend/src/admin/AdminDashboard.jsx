/**
 * frontend/src/admin/AdminDashboard.jsx
 *
 * Phase 2 additions:
 *   - Anomaly alert banner at top of Dashboard page
 *   - Activity chart (DAU + new signups) in Dashboard
 *   - Conversion KPI card in Dashboard
 *   - "Token Usage" nav tab -> TokenMetrics page
 *   - UserNotes component in UserDetail
 *   - Impersonation action in UserDetail
 *   - Date filters on Users list
 *
 * All Phase 1 features preserved unchanged.
 */

import { useState, useEffect, useCallback } from 'react'
import {
  AreaChart, Area, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid,
} from 'recharts'
import {
  getOverviewMetrics, getCostMetrics,
  listUsers, getUser,
  disableUser, enableUser, deleteUser,
  getAuditLog,
  listAdmins, createAdmin, updateAdmin, deleteAdmin,
  // Phase 2 imports
  getAnomalies, resolveAnomaly,
  getActivityMetrics, getConversions,
  startImpersonation,
  getPendingOemCount,
} from '../services/adminApi'
import TokenMetrics from './TokenMetrics'
import UserNotes from './UserNotes'
import OemMaintenance from './OemMaintenance'

// ── Design tokens ─────────────────────────────────────────────────────────────
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
function Badge({ children, color }) {
  const m = {
    blue:   { bg: C.blueLight,   text: C.blue,   border: C.blueBorder },
    red:    { bg: C.redLight,    text: C.red,     border: C.redBorder },
    green:  { bg: C.greenLight,  text: C.green,   border: C.greenBorder },
    amber:  { bg: C.amberLight,  text: C.amber,   border: C.amberBorder },
    purple: { bg: C.purpleLight, text: C.purple,  border: C.purpleBorder },
    grey:   { bg: '#F3F4F6',     text: C.muted,   border: '#E5E7EB' },
  }
  const s = m[color] || m.grey
  return (
    <span style={{ display: 'inline-block', fontSize: 10, fontWeight: 700,
      letterSpacing: '0.06em', textTransform: 'uppercase', padding: '2px 9px',
      borderRadius: 99, background: s.bg, color: s.text, border: `1px solid ${s.border}` }}>
      {children}
    </span>
  )
}

function isNewUser(createdAt) {
  if (!createdAt) return false
  // created_at is stored as UTC in Postgres.
  // new Date() parses ISO strings as UTC automatically, so this comparison is correct
  // regardless of the browser's local timezone.
  const created = new Date(createdAt.endsWith('Z') ? createdAt : createdAt + 'Z')
  return (Date.now() - created.getTime()) < 24 * 60 * 60 * 1000
}

function NewBadge() {
  return (
    <span style={{
      display: 'inline-block', fontSize: 9, fontWeight: 800,
      letterSpacing: '0.08em', textTransform: 'uppercase',
      padding: '2px 7px', borderRadius: 99, marginLeft: 7,
      background: '#DCFCE7', color: '#166534', border: '1px solid #86EFAC',
      verticalAlign: 'middle', lineHeight: 1.6,
    }}>NEW</span>
  )
}

function Card({ children, style = {} }) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.cardBorder}`,
      borderRadius: 14, boxShadow: C.cardShadow, ...style }}>
      {children}
    </div>
  )
}

function KpiCard({ label, value, sub, borderColor, icon, onClick }) {
  const [hov, setHov] = useState(false)
  return (
    <div onClick={onClick}
      onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      style={{ background: C.card, border: `1px solid ${C.cardBorder}`, borderRadius: 14,
        borderTop: `3px solid ${borderColor}`, padding: '20px 22px',
        boxShadow: hov ? '0 4px 20px rgba(29,78,216,0.13)' : C.cardShadow,
        cursor: onClick ? 'pointer' : 'default', transition: 'box-shadow 0.18s' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
        <span style={{ fontSize: 18 }}>{icon}</span>
        <span style={{ fontSize: 10, fontWeight: 700, color: borderColor,
          letterSpacing: '0.07em', textTransform: 'uppercase' }}>{label}</span>
      </div>
      <div style={{ fontSize: 32, fontWeight: 800, color: C.dark, lineHeight: 1, marginBottom: 4 }}>{value}</div>
      <div style={{ fontSize: 12, color: C.muted }}>{sub}</div>
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

function OutlineBtn({ children, onClick, small }) {
  const [hov, setHov] = useState(false)
  return (
    <button onClick={onClick}
      onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      style={{ background: hov ? '#F8FAFC' : '#fff', color: C.mid,
        border: `1px solid ${C.cardBorder}`, borderRadius: 9,
        padding: small ? '6px 14px' : '9px 18px',
        fontSize: small ? 12 : 13, fontWeight: 600, cursor: 'pointer',
        fontFamily: 'inherit', transition: 'background 0.15s' }}>
      {children}
    </button>
  )
}

function SectionTitle({ children }) {
  return <h3 style={{ margin: '0 0 4px', fontSize: 16, fontWeight: 800, color: C.dark }}>{children}</h3>
}

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null
  return (
    <div style={{ background: '#fff', border: `1px solid ${C.cardBorder}`, borderRadius: 10,
      padding: '10px 14px', fontSize: 12, boxShadow: C.cardShadow }}>
      <div style={{ color: C.muted, marginBottom: 5, fontWeight: 600 }}>{label}</div>
      {payload.map((p, i) => (
        <div key={i} style={{ color: p.color || C.blue, fontWeight: 700 }}>
          {p.name}: {p.name === 'cost' ? `$${Number(p.value).toFixed(2)}` : p.value}
        </div>
      ))}
    </div>
  )
}

function Modal({ children, onClose, borderColor = C.cardBorder }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.4)',
      backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'center',
      justifyContent: 'center', zIndex: 999 }} onClick={onClose}>
      <div style={{ background: C.card, border: `1px solid ${borderColor}`,
        borderRadius: 18, padding: 32, width: 460,
        boxShadow: '0 20px 60px rgba(15,23,42,0.18)', animation: 'fadeUp 0.2s ease' }}
        onClick={e => e.stopPropagation()}>
        {children}
      </div>
    </div>
  )
}

function LoadingCard() {
  return <Card style={{ padding: 32, textAlign: 'center' }}>
    <div style={{ fontSize: 13, color: C.muted }}>Loading…</div>
  </Card>
}

function ErrorCard({ msg }) {
  return <Card style={{ padding: 24, background: C.redLight, borderColor: C.redBorder }}>
    <div style={{ fontSize: 13, color: C.red }}>⚠️ {msg}</div>
  </Card>
}

const inputStyle = {
  width: '100%', padding: '9px 13px', fontFamily: 'inherit',
  fontSize: 13, color: C.dark, background: '#fff',
  border: `1px solid ${C.cardBorder}`, borderRadius: 9, boxSizing: 'border-box',
}
const labelStyle = {
  display: 'block', fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
  letterSpacing: '0.07em', color: C.muted, marginBottom: 6,
}


// ── AI OEM Pending Review Banner ──────────────────────────────────────────────
function PendingOemBanner({ count, onNavigate }) {
  if (!count || count === 0) return null
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '12px 20px', borderRadius: 12, marginBottom: 8,
      background: C.amberLight, border: `1px solid ${C.amberBorder}`,
      boxShadow: '0 2px 8px rgba(245,158,11,0.1)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 16 }}>🤖</span>
        <div>
          <span style={{ fontSize: 13, fontWeight: 700, color: C.amber }}>
            {count} AI-generated OEM schedule{count !== 1 ? 's' : ''} pending review
          </span>
          <span style={{ fontSize: 13, color: '#92400E', marginLeft: 6 }}>
            — these rows are not live until approved
          </span>
        </div>
      </div>
      <button onClick={() => onNavigate('oem')}
        style={{ padding: '5px 14px', borderRadius: 7, border: `1px solid ${C.amberBorder}`,
          background: '#fff', color: C.amber, fontSize: 11, fontWeight: 700,
          cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0 }}>
        Review Now
      </button>
    </div>
  )
}

// ── Phase 2: Anomaly Banner ───────────────────────────────────────────────────
function AnomalyBanner({ onDismiss }) {
  const [alerts, setAlerts] = useState([])

  useEffect(() => {
    getAnomalies()
      .then(data => setAlerts(Array.isArray(data) ? data : []))
      .catch(() => {})
  }, [])

  if (!alerts.length) return null

  const handleDismiss = async (alertId) => {
    try {
      await resolveAnomaly(alertId)
      setAlerts(prev => prev.filter(a => a.id !== alertId))
      if (onDismiss) onDismiss()
    } catch {}
  }

  return (
    <div style={{ marginBottom: 16 }}>
      {alerts.map(alert => (
        <div key={alert.id} style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '12px 20px', borderRadius: 12, marginBottom: 8,
          background: C.redLight, border: `1px solid ${C.redBorder}`,
          boxShadow: '0 2px 8px rgba(239,68,68,0.1)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 16 }}>⚠️</span>
            <div>
              <span style={{ fontSize: 13, fontWeight: 700, color: C.red }}>
                Daily spend exceeded threshold on {alert.metric_date}:
              </span>
              <span style={{ fontSize: 13, color: '#991B1B', marginLeft: 6 }}>
                ${Number(alert.actual_value).toFixed(2)} vs ${Number(alert.threshold_value).toFixed(2)} limit
              </span>
            </div>
          </div>
          <button onClick={() => handleDismiss(alert.id)}
            style={{ padding: '5px 14px', borderRadius: 7, border: `1px solid ${C.redBorder}`,
              background: '#fff', color: C.red, fontSize: 11, fontWeight: 700,
              cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0 }}>
            Dismiss
          </button>
        </div>
      ))}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
export default function AdminDashboard({ admin, onLogout, showToast }) {
  const [nav, setNav]                     = useState('dashboard')
  const [selectedUser, setSelectedUser]   = useState(null)
  const [disableModal, setDisableModal]   = useState(null)
  const [deleteModal, setDeleteModal]     = useState(null)
  const [deleteText, setDeleteText]       = useState('')
  const [disableReason, setDisableReason] = useState('')
  const [period, setPeriod]               = useState('30d')

  const [pendingOemCount, setPendingOemCount] = useState(0)

  // Fetch pending OEM count on mount — drives nav badge
  useEffect(() => {
    getPendingOemCount()
      .then(d => setPendingOemCount(d.total || 0))
      .catch(() => {})
  }, [])

  const isSuperAdmin = admin?.role === 'super_admin'
  const navigate = (page, user = null) => { setNav(page); setSelectedUser(user) }

  const navItems = [
    { id: 'dashboard', label: 'Dashboard' },
    { id: 'users',     label: 'Users' },
    { id: 'costs',     label: 'AI Costs' },
    { id: 'tokens',    label: 'Token Usage' },
    { id: 'audit',     label: 'Audit Log' },
    { id: 'oem', label: 'OEM Maintenance', badge: pendingOemCount },
    ...(isSuperAdmin ? [{ id: 'admins', label: 'Admin Accounts' }] : []),
  ]

  const Header = () => (
    <header style={{ background: 'rgba(255,255,255,0.97)', backdropFilter: 'blur(12px)',
      borderBottom: '1px solid rgba(37,99,235,0.08)', position: 'sticky', top: 0, zIndex: 50 }}>
      <div style={{ maxWidth: 1280, margin: '0 auto', padding: '0 40px', height: 56,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 34, height: 34, borderRadius: 9, background: C.btnGrad,
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16 }}>🛡</div>
          <span style={{ fontWeight: 800, fontSize: 16, color: C.dark }}>Guard</span>
          <span style={{ fontSize: 10, fontWeight: 700, background: C.blueLight,
            color: C.blue, padding: '2px 8px', borderRadius: 99 }}>BETA</span>
          <span style={{ fontSize: 10, fontWeight: 700, background: C.redLight,
            color: C.red, border: `1px solid ${C.redBorder}`, padding: '2px 10px', borderRadius: 99 }}>
            ADMIN
          </span>
        </div>
        <nav style={{ display: 'flex', gap: 4 }}>
          {navItems.map(item => {
            const active = nav === item.id
            return (
              <button key={item.id} onClick={() => navigate(item.id)}
                style={{ padding: '7px 16px', borderRadius: 8, border: 'none',
                  background: active ? C.blueLight : 'transparent',
                  color: active ? C.blue : C.muted,
                  fontSize: 13, fontWeight: active ? 700 : 500, cursor: 'pointer',
                  fontFamily: 'inherit',
                  borderBottom: active ? `2px solid ${C.blue}` : '2px solid transparent',
                  transition: 'all 0.15s',
                  display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                {item.label}
                {item.badge > 0 && (
                  <span style={{ display: 'inline-flex', alignItems: 'center',
                    justifyContent: 'center', minWidth: 16, height: 16,
                    borderRadius: 99, background: C.red, color: '#fff',
                    fontSize: 9, fontWeight: 800, padding: '0 4px' }}>
                    {item.badge}
                  </span>
                )}
              </button>
            )
          })}
        </nav>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 30, height: 30, borderRadius: 8, background: C.btnGrad,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 12, fontWeight: 800, color: '#fff' }}>
              {admin?.email?.[0]?.toUpperCase() || 'A'}
            </div>
            <span style={{ fontSize: 13, fontWeight: 500, color: C.mid }}>
              {admin?.role === 'super_admin' ? 'Super Admin' : 'Support Admin'}
            </span>
          </div>
          <OutlineBtn small onClick={onLogout}>Sign Out</OutlineBtn>
        </div>
      </div>
    </header>
  )

  const Hero = ({ title, sub }) => (
    <div style={{ background: `linear-gradient(135deg, ${C.heroFrom} 0%, #1E3A8A 50%, ${C.heroTo} 100%)`,
      padding: '36px 40px 56px' }}>
      <div style={{ maxWidth: 1280, margin: '0 auto' }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.12em',
          textTransform: 'uppercase', color: 'rgba(255,255,255,0.5)', marginBottom: 8 }}>
          ADMIN CONSOLE
        </div>
        <h1 style={{ margin: '0 0 10px', fontSize: 28, fontWeight: 800, color: '#fff',
          letterSpacing: '-0.02em' }}>{title}</h1>
        <p style={{ margin: 0, fontSize: 14, color: 'rgba(255,255,255,0.6)',
          maxWidth: 480, lineHeight: 1.7 }}>{sub}</p>
      </div>
    </div>
  )

  const PageWrap = ({ children }) => (
    <div style={{ maxWidth: 1280, margin: '-28px auto 0', padding: '0 40px 48px', position: 'relative' }}>
      {children}
    </div>
  )

  // ── DASHBOARD PAGE ────────────────────────────────────────────────────────
  const DashboardPage = () => {
    const [metrics,    setMetrics]    = useState(null)
    const [costs,      setCosts]      = useState(null)
    const [users,      setUsers]      = useState([])
    const [activity,   setActivity]   = useState(null)
    const [conversion, setConversion] = useState(null)
    const [err,        setErr]        = useState(null)

    useEffect(() => {
      Promise.all([
        getOverviewMetrics(),
        getCostMetrics('7d').catch(() => null),
        listUsers({ per_page: 5 }).catch(() => ({ users: [] })),
        getActivityMetrics('30d').catch(() => null),
        getConversions('30d').catch(() => null),
      ])
        .then(([m, c, u, act, conv]) => {
          setMetrics(m); setCosts(c); setUsers(u?.users || [])
          setActivity(act); setConversion(conv)
          setErr(null)
        })
        .catch(e => setErr(e.message))
    }, [])

    if (err) return <PageWrap><ErrorCard msg={err} /></PageWrap>
    if (!metrics) return <PageWrap><LoadingCard /></PageWrap>

    return (
      <>
        <Hero title="Admin Operations Dashboard"
          sub="Monitor system health, user activity, AI costs, and perform support actions." />
        <PageWrap>
          {/* AI OEM Pending Review Banner */}
          <PendingOemBanner count={pendingOemCount} onNavigate={navigate} />

          {/* Phase 2: Anomaly alert banner */}
          <AnomalyBanner />

          {/* Row 1: Phase 1 KPI cards — 4 columns */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 16, marginBottom: 14 }}>
            <KpiCard label="Fleet"    icon="👤" value={metrics.total_users}
              sub={`${metrics.active_users} active · ${metrics.disabled_users} disabled`}
              borderColor={C.blue} onClick={() => navigate('users')} />
            <KpiCard label="AI Costs" icon="💰"
              value={costs?.total_cost_usd != null ? `$${costs.total_cost_usd.toFixed(0)}` : '---'}
              sub="7-day spend" borderColor={C.amber} onClick={() => navigate('costs')} />
            <KpiCard label="Premium"  icon="⭐" value={metrics.premium_users}
              sub={`${((metrics.premium_users / Math.max(metrics.total_users, 1)) * 100).toFixed(1)}% of users`}
              borderColor={C.green} />
            <KpiCard label="Vehicles" icon="🚗" value={metrics.total_vehicles}
              sub={`${metrics.total_invoices.toLocaleString()} invoices total`}
              borderColor={C.muted} />
          </div>

          {/* Row 2: Phase 2 KPI cards — 2 wide columns, always visible */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 14 }}>
            <KpiCard label="Free to Paid Conversions" icon="📈"
              value={conversion ? conversion.total_upgrades : '---'}
              sub={conversion
                ? `${conversion.conversion_rate_pct.toFixed(1)}% rate this month`
                : 'Loading...'}
              borderColor={C.purple} onClick={() => navigate('tokens')} />
            <KpiCard label="Token Usage" icon="🔢"
              value={costs?.total_cost_usd != null ? `$${costs.total_cost_usd.toFixed(2)}` : '---'}
              sub="7-day AI spend - click for full breakdown"
              borderColor={C.blue} onClick={() => navigate('tokens')} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 22 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

              {/* Phase 2: Activity chart */}
              {activity && activity.data && activity.data.length > 0 && (
                <Card style={{ padding: 24 }}>
                  <SectionTitle>User Activity (30 days)</SectionTitle>
                  <p style={{ margin: '3px 0 18px', fontSize: 12, color: C.muted }}>
                    Daily active users and new signups
                  </p>
                  <ResponsiveContainer width="100%" height={180}>
                    <AreaChart data={activity.data} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
                      <defs>
                        <linearGradient id="gActive" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor={C.blue} stopOpacity={0.2} />
                          <stop offset="100%" stopColor={C.blue} stopOpacity={0} />
                        </linearGradient>
                        <linearGradient id="gSignup" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor={C.green} stopOpacity={0.2} />
                          <stop offset="100%" stopColor={C.green} stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid stroke="#F1F5F9" strokeDasharray="4 4" />
                      <XAxis dataKey="date" tick={{ fill: C.muted, fontSize: 10 }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fill: C.muted, fontSize: 10 }} axisLine={false} tickLine={false} />
                      <Tooltip content={<CustomTooltip />} />
                      <Area type="monotone" dataKey="active_users" name="active users"
                        stroke={C.blue} strokeWidth={2} fill="url(#gActive)" />
                      <Area type="monotone" dataKey="new_signups" name="new signups"
                        stroke={C.green} strokeWidth={2} fill="url(#gSignup)" />
                    </AreaChart>
                  </ResponsiveContainer>
                </Card>
              )}

              {/* Phase 1: AI spend chart */}
              {costs?.daily_breakdown?.length > 0 && (
                <Card style={{ padding: 24 }}>
                  <SectionTitle>Daily AI Spend</SectionTitle>
                  <p style={{ margin: '3px 0 18px', fontSize: 12, color: C.muted }}>Last 7 days ($)</p>
                  <ResponsiveContainer width="100%" height={180}>
                    <AreaChart data={costs.daily_breakdown} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
                      <defs>
                        <linearGradient id="gCost" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor={C.amber} stopOpacity={0.25} />
                          <stop offset="100%" stopColor={C.amber} stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid stroke="#F1F5F9" strokeDasharray="4 4" />
                      <XAxis dataKey="date" tick={{ fill: C.muted, fontSize: 11 }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fill: C.muted, fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={v => `$${v}`} />
                      <Tooltip content={<CustomTooltip />} />
                      <Area type="monotone" dataKey="estimated_cost_usd" name="cost"
                        stroke={C.amber} strokeWidth={2.5} fill="url(#gCost)" />
                    </AreaChart>
                  </ResponsiveContainer>
                </Card>
              )}

              {/* Phase 1: Recent users */}
              <Card>
                <div style={{ padding: '20px 22px 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <SectionTitle>Recent Users</SectionTitle>
                    <p style={{ margin: '3px 0 0', fontSize: 12, color: C.muted }}>{metrics.total_users} users registered</p>
                  </div>
                  <PrimaryBtn onClick={() => navigate('users')}>View All Users</PrimaryBtn>
                </div>
                <div style={{ marginTop: 16 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px 90px 70px 100px',
                    padding: '8px 22px', borderTop: `1px solid ${C.cardBorder}`,
                    borderBottom: `1px solid ${C.cardBorder}`, background: '#FAFBFF' }}>
                    {['User', 'Tier', 'Status', 'Invoices', 'Last Active'].map(h => (
                      <span key={h} style={{ fontSize: 10, fontWeight: 700, color: C.muted,
                        letterSpacing: '0.07em', textTransform: 'uppercase' }}>{h}</span>
                    ))}
                  </div>
                  {users.map((u, i) => (
                    <div key={u.id} onClick={() => navigate('users', u)}
                      style={{ display: 'grid', gridTemplateColumns: '1fr 80px 90px 70px 100px',
                        padding: '12px 22px', borderBottom: i < users.length - 1 ? `1px solid ${C.cardBorder}` : 'none',
                        cursor: 'pointer', alignItems: 'center' }}
                      onMouseEnter={e => e.currentTarget.style.background = '#FAFBFF'}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: C.dark }}>
                          {u.full_name || u.email}{isNewUser(u.created_at) && <NewBadge />}
                        </div>
                        <div style={{ fontSize: 11, color: C.muted }}>{u.email}</div>
                      </div>
                      <div><Badge color={u.subscription_tier === 'premium' ? 'blue' : 'grey'}>{u.subscription_tier}</Badge></div>
                      <div><Badge color={u.status === 'active' ? 'green' : 'red'}>{u.status}</Badge></div>
                      <div style={{ fontSize: 13, color: u.invoice_count > 100 ? C.red : C.dark,
                        fontWeight: u.invoice_count > 100 ? 700 : 400 }}>
                        {u.invoice_count > 100 && '⚠️ '}{u.invoice_count}
                      </div>
                      <div style={{ fontSize: 12, color: C.muted }}>
                        {u.last_active_at ? new Date(u.last_active_at).toLocaleDateString() : '—'}
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            </div>

            {/* Sidebar */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <Card style={{ padding: '18px 20px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
                  <span style={{ fontSize: 16 }}>🔔</span>
                  <span style={{ fontSize: 14, fontWeight: 700, color: C.dark }}>Alerts</span>
                </div>
                {[
                  { dot: C.amber, title: `${metrics.disabled_users} accounts disabled`, sub: 'Review if action needed' },
                  { dot: C.blue,  title: 'Admin console active', sub: 'Phase 2 deployed' },
                  { dot: C.green, title: `${metrics.premium_users} premium users`, sub: 'Revenue-generating accounts' },
                ].map((a, i) => (
                  <div key={i} style={{ display: 'flex', gap: 10, marginBottom: i < 2 ? 14 : 0 }}>
                    <div style={{ width: 8, height: 8, borderRadius: 99, background: a.dot, flexShrink: 0, marginTop: 4 }} />
                    <div>
                      <div style={{ fontSize: 13, color: C.dark, fontWeight: 500 }}>{a.title}</div>
                      <div style={{ fontSize: 11, color: C.muted }}>{a.sub}</div>
                    </div>
                  </div>
                ))}
              </Card>

              <Card style={{ padding: '18px 20px', background: C.greenLight, borderColor: C.greenBorder }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <span>💡</span>
                  <span style={{ fontSize: 14, fontWeight: 700, color: C.dark }}>Quick Stats</span>
                </div>
                {[
                  ['Total Users', metrics.total_users],
                  ['Premium',     metrics.premium_users],
                  ['Free',        metrics.free_users],
                  ['Disabled',    metrics.disabled_users],
                  ['Vehicles',    metrics.total_vehicles],
                  ['Invoices',    metrics.total_invoices],
                ].map(([label, val], i, arr) => (
                  <div key={label} style={{ display: 'flex', justifyContent: 'space-between',
                    padding: '7px 0', borderBottom: i < arr.length - 1 ? `1px solid ${C.greenBorder}` : 'none' }}>
                    <span style={{ fontSize: 12, color: C.muted }}>{label}</span>
                    <span style={{ fontSize: 13, fontWeight: 700, color: C.dark }}>{(val || 0).toLocaleString()}</span>
                  </div>
                ))}
              </Card>
            </div>
          </div>
        </PageWrap>
      </>
    )
  }

  // ── USERS PAGE ────────────────────────────────────────────────────────────
  const UsersPage = () => {
    const [data,        setData]        = useState(null)
    const [search,      setSearch]      = useState('')
    const [err,         setErr]         = useState(null)
    const [loading,     setLoading]     = useState(false)
    // Phase 2: date filters
    const [createdAfter,  setCreatedAfter]  = useState('')
    const [createdBefore, setCreatedBefore] = useState('')
    const [activeAfter,   setActiveAfter]   = useState('')

    const load = useCallback((q = '', filters = {}) => {
      setLoading(true)
      const params = { search: q || undefined, ...filters }
      Object.keys(params).forEach(k => !params[k] && delete params[k])
      listUsers(params)
        .then(d => { setData(d); setErr(null) })
        .catch(e => setErr(e.message))
        .finally(() => setLoading(false))
    }, [])

    useEffect(() => { load() }, [load])

    const handleSearch = (e) => {
      const v = e.target.value; setSearch(v)
      clearTimeout(window._adminSearchTimer)
      window._adminSearchTimer = setTimeout(() => load(v, buildFilters()), 350)
    }

    const buildFilters = () => ({
      created_after:  createdAfter  || undefined,
      created_before: createdBefore || undefined,
      last_active_after: activeAfter || undefined,
    })

    const applyFilters = () => load(search, buildFilters())
    const clearFilters = () => {
      setCreatedAfter(''); setCreatedBefore(''); setActiveAfter('')
      load(search, {})
    }

    const doDisable = async () => {
      if (!disableReason.trim()) return
      try {
        await disableUser(disableModal.id, disableReason)
        showToast(`Disabled ${disableModal.email}`)
        setDisableModal(null); setDisableReason(''); load(search, buildFilters())
      } catch (e) { showToast(e.response?.data?.detail || 'Error', 'danger') }
    }

    const doEnable = async (u) => {
      try {
        await enableUser(u.id); showToast(`Enabled ${u.email}`); load(search, buildFilters())
      } catch (e) { showToast(e.response?.data?.detail || 'Error', 'danger') }
    }

    const doDelete = async () => {
      if (deleteText !== 'DELETE') return
      try {
        await deleteUser(deleteModal.id)
        showToast(`Deleted ${deleteModal.email}`, 'danger')
        setDeleteModal(null); setDeleteText('')
        if (selectedUser?.id === deleteModal.id) setSelectedUser(null)
        load(search, buildFilters())
      } catch (e) {
        showToast(e.response?.data?.detail || 'Cannot delete', 'warn')
        setDeleteModal(null); setDeleteText('')
      }
    }

    if (selectedUser) return (
      <UserDetailPage user={selectedUser}
        onBack={() => setSelectedUser(null)}
        onDisable={setDisableModal}
        onEnable={doEnable}
        onDelete={setDeleteModal}
      />
    )

    return (
      <>
        <Hero title="User Management" sub="Search, inspect, disable, or remove user accounts. All actions are audit-logged." />
        <PageWrap>
          {err && <ErrorCard msg={err} />}
          <Card>
            {/* Search + Phase 2 date filters */}
            <div style={{ padding: '16px 22px', borderBottom: `1px solid ${C.cardBorder}`,
              display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <div style={{ flex: 1, position: 'relative' }}>
                  <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)',
                    fontSize: 15, color: C.muted, pointerEvents: 'none' }}>⌕</span>
                  <input value={search} onChange={handleSearch} placeholder="Search by email or name…"
                    style={{ ...inputStyle, paddingLeft: 36 }} />
                </div>
                {loading && <span style={{ fontSize: 12, color: C.muted }}>Loading…</span>}
              </div>
              {/* Date filters */}
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: 'uppercase',
                  letterSpacing: '0.07em', flexShrink: 0 }}>Filters:</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <label style={{ fontSize: 11, color: C.muted }}>Registered after</label>
                  <input type="date" value={createdAfter} onChange={e => setCreatedAfter(e.target.value)}
                    style={{ ...inputStyle, width: 140, padding: '5px 8px', fontSize: 11 }} />
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <label style={{ fontSize: 11, color: C.muted }}>before</label>
                  <input type="date" value={createdBefore} onChange={e => setCreatedBefore(e.target.value)}
                    style={{ ...inputStyle, width: 140, padding: '5px 8px', fontSize: 11 }} />
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <label style={{ fontSize: 11, color: C.muted }}>Active after</label>
                  <input type="date" value={activeAfter} onChange={e => setActiveAfter(e.target.value)}
                    style={{ ...inputStyle, width: 140, padding: '5px 8px', fontSize: 11 }} />
                </div>
                <button onClick={applyFilters}
                  style={{ padding: '5px 14px', borderRadius: 7, border: 'none', background: C.btnGrad,
                    color: '#fff', fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                  Apply
                </button>
                {(createdAfter || createdBefore || activeAfter) && (
                  <button onClick={clearFilters}
                    style={{ padding: '5px 12px', borderRadius: 7, border: `1px solid ${C.cardBorder}`,
                      background: '#fff', color: C.muted, fontSize: 11, cursor: 'pointer', fontFamily: 'inherit' }}>
                    Clear
                  </button>
                )}
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '60px 1fr 90px 90px 70px 80px 100px 140px',
              padding: '10px 22px', background: '#FAFBFF', borderBottom: `1px solid ${C.cardBorder}` }}>
              {['ID', 'User', 'Tier', 'Status', 'Veh.', 'Invoices', 'Last Active', 'Actions'].map(h => (
                <span key={h} style={{ fontSize: 10, fontWeight: 700, color: C.muted,
                  letterSpacing: '0.07em', textTransform: 'uppercase' }}>{h}</span>
              ))}
            </div>

            {(data?.users || []).map((u, i, arr) => (
              <div key={u.id}
                style={{ display: 'grid', gridTemplateColumns: '60px 1fr 90px 90px 70px 80px 100px 140px',
                  padding: '13px 22px', borderBottom: i < arr.length - 1 ? `1px solid ${C.cardBorder}` : 'none',
                  alignItems: 'center', transition: 'background 0.12s' }}
                onMouseEnter={e => e.currentTarget.style.background = '#FAFBFF'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                <span style={{ fontSize: 11, color: C.muted }}>#{u.id}</span>
                <div style={{ cursor: 'pointer' }} onClick={() => setSelectedUser(u)}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: C.dark }}>
                    {u.full_name || '—'}{isNewUser(u.created_at) && <NewBadge />}
                  </div>
                  <div style={{ fontSize: 11, color: C.muted }}>{u.email}</div>
                </div>
                <div><Badge color={u.subscription_tier === 'premium' ? 'blue' : 'grey'}>{u.subscription_tier}</Badge></div>
                <div><Badge color={u.status === 'active' ? 'green' : 'red'}>{u.status}</Badge></div>
                <span style={{ fontSize: 13, color: C.dark }}>{u.vehicle_count}</span>
                <span style={{ fontSize: 13, fontWeight: u.invoice_count > 100 ? 700 : 400,
                  color: u.invoice_count > 100 ? C.red : C.dark }}>
                  {u.invoice_count > 100 && '⚠️ '}{u.invoice_count}
                </span>
                <span style={{ fontSize: 12, color: C.muted }}>
                  {u.last_active_at ? new Date(u.last_active_at).toLocaleDateString() : '—'}
                </span>
                <div style={{ display: 'flex', gap: 6 }}>
                  <OutlineBtn small onClick={() => setSelectedUser(u)}>View</OutlineBtn>
                  {u.status === 'active'
                    ? <button onClick={() => setDisableModal(u)}
                        style={{ padding: '5px 10px', borderRadius: 7, fontSize: 11, fontWeight: 600,
                          border: `1px solid ${C.amberBorder}`, background: C.amberLight,
                          color: C.amber, cursor: 'pointer', fontFamily: 'inherit' }}>Disable</button>
                    : <button onClick={() => doEnable(u)}
                        style={{ padding: '5px 10px', borderRadius: 7, fontSize: 11, fontWeight: 600,
                          border: `1px solid ${C.greenBorder}`, background: C.greenLight,
                          color: C.green, cursor: 'pointer', fontFamily: 'inherit' }}>Enable</button>
                  }
                </div>
              </div>
            ))}
            <div style={{ padding: '12px 22px', fontSize: 11, color: C.muted }}>
              Showing {data?.users?.length || 0} of {data?.total || 0} users
            </div>
          </Card>
        </PageWrap>

        {disableModal && (
          <Modal onClose={() => { setDisableModal(null); setDisableReason('') }} borderColor={C.amberBorder}>
            <div style={{ fontSize: 28, marginBottom: 14 }}>🔒</div>
            <h3 style={{ fontSize: 18, fontWeight: 800, color: C.dark, marginBottom: 8 }}>Disable Account</h3>
            <p style={{ fontSize: 13, color: C.muted, marginBottom: 20, lineHeight: 1.65 }}>
              <strong style={{ color: C.amber }}>{disableModal.email}</strong> will not be able to log in.
            </p>
            <label style={labelStyle}>Reason (required)</label>
            <textarea value={disableReason} onChange={e => setDisableReason(e.target.value)} rows={3}
              style={{ ...inputStyle, resize: 'none', marginBottom: 20 }} />
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <OutlineBtn onClick={() => { setDisableModal(null); setDisableReason('') }}>Cancel</OutlineBtn>
              <button onClick={doDisable} disabled={!disableReason.trim()}
                style={{ padding: '10px 22px', borderRadius: 9, border: 'none', fontFamily: 'inherit',
                  background: disableReason.trim() ? C.amber : '#E5E7EB',
                  color: disableReason.trim() ? '#fff' : C.muted,
                  fontSize: 13, fontWeight: 700, cursor: disableReason.trim() ? 'pointer' : 'not-allowed' }}>
                Disable Account
              </button>
            </div>
          </Modal>
        )}

        {deleteModal && (
          <Modal onClose={() => { setDeleteModal(null); setDeleteText('') }} borderColor={C.redBorder}>
            <div style={{ fontSize: 28, marginBottom: 14 }}>⛔</div>
            <h3 style={{ fontSize: 18, fontWeight: 800, color: C.red, marginBottom: 8 }}>Permanently Delete Account</h3>
            <div style={{ padding: '12px 16px', background: C.redLight, border: `1px solid ${C.redBorder}`,
              borderRadius: 10, fontSize: 12, color: C.muted, lineHeight: 1.75, marginBottom: 20 }}>
              Deletes <strong style={{ color: C.dark }}>{deleteModal?.email}</strong> and all data.<br />
              <strong style={{ color: C.red }}>This cannot be undone.</strong>
            </div>
            <label style={labelStyle}>Type "DELETE" to confirm</label>
            <input value={deleteText} onChange={e => setDeleteText(e.target.value)} placeholder="DELETE"
              style={{ ...inputStyle, border: `1px solid ${deleteText === 'DELETE' ? C.red : C.cardBorder}`,
                letterSpacing: '0.1em', fontSize: 14, marginBottom: 20 }} />
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <OutlineBtn onClick={() => { setDeleteModal(null); setDeleteText('') }}>Cancel</OutlineBtn>
              <button onClick={doDelete} disabled={deleteText !== 'DELETE'}
                style={{ padding: '10px 22px', borderRadius: 9, border: 'none', fontFamily: 'inherit',
                  background: deleteText === 'DELETE' ? C.red : '#E5E7EB',
                  color: deleteText === 'DELETE' ? '#fff' : C.muted,
                  fontSize: 13, fontWeight: 700, cursor: deleteText === 'DELETE' ? 'pointer' : 'not-allowed' }}>
                Delete Permanently
              </button>
            </div>
          </Modal>
        )}
      </>
    )
  }

  // ── USER DETAIL PAGE ──────────────────────────────────────────────────────
  const UserDetailPage = ({ user, onBack, onDisable, onEnable, onDelete }) => {
    const [detail,      setDetail]      = useState(user)
    const [impersonating, setImpersonating] = useState(false)

    useEffect(() => { getUser(user.id).then(setDetail).catch(() => {}) }, [user.id])

    const handleImpersonate = async () => {
      setImpersonating(true)
      try {
        const res = await startImpersonation(detail.id)
        // Store token and metadata for ImpersonationBanner
        localStorage.setItem('mg_impersonation_token', res.impersonation_token)
        localStorage.setItem('mg_impersonation_meta', JSON.stringify({
          userId: detail.id,
          userEmail: detail.email,
          adminConsoleUrl: window.location.href,
        }))
        showToast(`Impersonating ${detail.email} — opening user app`)
        // Open main user app in same tab
        setTimeout(() => { window.location.href = '/' }, 800)
      } catch (e) {
        showToast(e.response?.data?.detail || 'Failed to start impersonation', 'danger')
        setImpersonating(false)
      }
    }

    return (
      <>
        <Hero title={`User · #${detail.id}`} sub={detail.email} />
        <PageWrap>
          <button onClick={onBack}
            style={{ marginBottom: 18, display: 'flex', alignItems: 'center', gap: 6,
              background: 'none', border: 'none', color: C.blue, cursor: 'pointer',
              fontSize: 13, fontWeight: 600, fontFamily: 'inherit' }}>
            ← Back to Users
          </button>
          <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: 20 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {/* Profile card */}
              <Card style={{ padding: 22 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 14,
                  paddingBottom: 16, marginBottom: 16, borderBottom: `1px solid ${C.cardBorder}` }}>
                  <div style={{ width: 48, height: 48, borderRadius: 14, background: C.btnGrad,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 20, fontWeight: 800, color: '#fff' }}>
                    {(detail.full_name || detail.email)[0].toUpperCase()}
                  </div>
                  <div>
                    <div style={{ fontWeight: 800, fontSize: 15, color: C.dark }}>{detail.full_name || '—'}</div>
                    <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>{detail.email}</div>
                  </div>
                </div>
                {[
                  ['User ID',     `#${detail.id}`],
                  ['Status',      'badge'],
                  ['Tier',        'tier'],
                  ['Vehicles',    detail.vehicle_count],
                  ['Invoices',    detail.invoice_count],
                  ['Registered',  detail.created_at ? new Date(detail.created_at).toLocaleDateString() : '—'],
                  ['Last Active', detail.last_active_at ? new Date(detail.last_active_at).toLocaleDateString() : '—'],
                ].map(([label, val]) => (
                  <div key={label} style={{ display: 'flex', justifyContent: 'space-between',
                    alignItems: 'center', padding: '8px 0', borderBottom: `1px solid ${C.cardBorder}` }}>
                    <span style={{ fontSize: 11, color: C.muted }}>{label}</span>
                    {val === 'badge'
                      ? <Badge color={detail.status === 'active' ? 'green' : 'red'}>{detail.status}</Badge>
                      : val === 'tier'
                      ? <Badge color={detail.subscription_tier === 'premium' ? 'blue' : 'grey'}>{detail.subscription_tier}</Badge>
                      : <span style={{ fontSize: 12, fontWeight: 500, color: C.dark }}>{val}</span>
                    }
                  </div>
                ))}
              </Card>

              {/* Admin actions */}
              <Card style={{ padding: 18 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: C.muted,
                  textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 12 }}>Admin Actions</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {detail.status === 'active'
                    ? <button onClick={() => onDisable(detail)} style={{ padding: '10px 16px', borderRadius: 9,
                        border: `1px solid ${C.amberBorder}`, background: C.amberLight, color: C.amber,
                        fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' }}>
                        🔒 Disable Account</button>
                    : <button onClick={() => onEnable(detail)} style={{ padding: '10px 16px', borderRadius: 9,
                        border: `1px solid ${C.greenBorder}`, background: C.greenLight, color: C.green,
                        fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' }}>
                        ✅ Enable Account</button>
                  }
                  {/* Phase 2: Impersonate button */}
                  <button onClick={handleImpersonate} disabled={impersonating}
                    style={{ padding: '10px 16px', borderRadius: 9,
                      border: `1px solid ${C.purpleBorder}`, background: C.purpleLight, color: C.purple,
                      fontSize: 13, fontWeight: 700, cursor: impersonating ? 'not-allowed' : 'pointer',
                      fontFamily: 'inherit', textAlign: 'left', opacity: impersonating ? 0.7 : 1 }}>
                    {impersonating ? '⏳ Starting…' : '👁 Impersonate User'}
                  </button>
                  <button onClick={() => onDelete(detail)} style={{ padding: '10px 16px', borderRadius: 9,
                    border: `1px solid ${C.redBorder}`, background: C.redLight, color: C.red,
                    fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' }}>
                    🗑 Delete Permanently</button>
                </div>
              </Card>
            </div>

            {/* Right column */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <Card style={{ padding: 22 }}>
                <h3 style={{ margin: '0 0 4px', fontSize: 16, fontWeight: 800, color: C.dark }}>
                  Account Details
                </h3>
                <p style={{ margin: '3px 0 0', fontSize: 12, color: C.muted }}>
                  {detail.vehicle_count} vehicle{detail.vehicle_count !== 1 ? 's' : ''} · {detail.invoice_count} invoices
                </p>
                {detail.disabled_reason && (
                  <div style={{ marginTop: 16, padding: '12px 16px', background: C.amberLight,
                    border: `1px solid ${C.amberBorder}`, borderRadius: 10, fontSize: 13, color: C.amber }}>
                    <strong>Disabled reason:</strong> {detail.disabled_reason}
                  </div>
                )}
              </Card>

              {/* Phase 2: Support notes */}
              <UserNotes userId={detail.id} showToast={showToast} />
            </div>
          </div>
        </PageWrap>
      </>
    )
  }

  // ── COSTS PAGE ────────────────────────────────────────────────────────────
  const CostsPage = () => {
    const [data, setData] = useState(null)
    const [err,  setErr]  = useState(null)

    const load = (p) => getCostMetrics(p).then(setData).catch(e => setErr(e.message))
    useEffect(() => { load(period) }, [])

    const reload = (p) => { setPeriod(p); load(p) }

    return (
      <>
        <Hero title="AI Cost Tracking" sub="Monitor token usage and spend. Target: $0.38 per user per month." />
        <PageWrap>
          <div style={{ display: 'flex', gap: 8, marginBottom: 22 }}>
            {['7d', '30d', '90d'].map(p => (
              <button key={p} onClick={() => reload(p)}
                style={{ padding: '8px 18px', borderRadius: 9,
                  border: `1px solid ${period === p ? C.blue : C.cardBorder}`,
                  background: period === p ? C.blueLight : '#fff',
                  color: period === p ? C.blue : C.muted,
                  fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>{p}</button>
            ))}
          </div>
          {err && <ErrorCard msg={err} />}
          {!data && !err && <LoadingCard />}
          {data && (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 16, marginBottom: 24 }}>
                <KpiCard label="Total Cost" icon="💰" borderColor={C.amber}
                  value={`$${data.total_cost_usd.toFixed(2)}`} sub={`Last ${data.period_days} days`} />
                <KpiCard label="Cost Per User" icon="📉" borderColor={C.green}
                  value={`$${data.cost_per_active_user.toFixed(3)}`}
                  sub={`Target <= $${data.target_cost_per_user} ${data.cost_per_active_user <= data.target_cost_per_user ? '✓' : '⚠️'}`} />
                <KpiCard label="Days Tracked" icon="📅" borderColor={C.blue}
                  value={data.daily_breakdown.length} sub={`of ${data.period_days} days with data`} />
              </div>
              <Card style={{ padding: 24 }}>
                <SectionTitle>Daily AI Spend</SectionTitle>
                <p style={{ margin: '3px 0 18px', fontSize: 12, color: C.muted }}>Estimated cost ($) per day</p>
                {data.daily_breakdown.length > 0 ? (
                  <ResponsiveContainer width="100%" height={220}>
                    <AreaChart data={data.daily_breakdown} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
                      <defs>
                        <linearGradient id="gCost2" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor={C.amber} stopOpacity={0.25} />
                          <stop offset="100%" stopColor={C.amber} stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid stroke="#F1F5F9" strokeDasharray="4 4" />
                      <XAxis dataKey="date" tick={{ fill: C.muted, fontSize: 10 }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fill: C.muted, fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={v => `$${v}`} />
                      <Tooltip content={<CustomTooltip />} />
                      <Area type="monotone" dataKey="estimated_cost_usd" name="cost"
                        stroke={C.amber} strokeWidth={2.5} fill="url(#gCost2)" />
                    </AreaChart>
                  </ResponsiveContainer>
                ) : (
                  <div style={{ textAlign: 'center', padding: '40px 0', fontSize: 13, color: C.muted }}>
                    No cost data yet. Run the nightly metrics job to populate.
                  </div>
                )}
              </Card>
            </>
          )}
        </PageWrap>
      </>
    )
  }

  // ── AUDIT LOG PAGE ────────────────────────────────────────────────────────
  const AuditPage = () => {
    const [data, setData] = useState(null)
    const [err,  setErr]  = useState(null)
    const [page, setPage] = useState(1)

    const load = useCallback((p) => {
      getAuditLog(p).then(d => { setData(d); setErr(null) }).catch(e => setErr(e.message))
    }, [])
    useEffect(() => { load(page) }, [load, page])

    return (
      <>
        <Hero title="Audit Log" sub="Immutable record of all admin actions." />
        <PageWrap>
          {err && <ErrorCard msg={err} />}
          {!data && !err && <LoadingCard />}
          {data && (
            <Card>
              <div style={{ display: 'grid', gridTemplateColumns: '150px 130px 140px 1fr 200px 90px',
                padding: '10px 22px', background: '#FAFBFF', borderBottom: `1px solid ${C.cardBorder}` }}>
                {['Timestamp', 'Admin', 'Action', 'Target', 'Reason', 'IP'].map(h => (
                  <span key={h} style={{ fontSize: 10, fontWeight: 700, color: C.muted,
                    letterSpacing: '0.07em', textTransform: 'uppercase' }}>{h}</span>
                ))}
              </div>
              {data.actions.length === 0 && (
                <div style={{ padding: '40px 22px', textAlign: 'center', fontSize: 13, color: C.muted }}>
                  No audit actions recorded yet.
                </div>
              )}
              {data.actions.map((row, i, arr) => (
                <div key={row.id}
                  style={{ display: 'grid', gridTemplateColumns: '150px 130px 140px 1fr 200px 90px',
                    padding: '14px 22px', borderBottom: i < arr.length - 1 ? `1px solid ${C.cardBorder}` : 'none',
                    alignItems: 'center', transition: 'background 0.12s' }}
                  onMouseEnter={e => e.currentTarget.style.background = '#FAFBFF'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                  <span style={{ fontSize: 11, color: C.muted }}>{new Date(row.timestamp).toLocaleString()}</span>
                  <span style={{ fontSize: 12, color: C.blue, fontWeight: 600 }}>{row.admin_email}</span>
                  <div>
                    <Badge color={
                      row.action_type === 'delete_user' || row.action_type === 'delete_admin' ? 'red' :
                      row.action_type === 'disable_user' ? 'amber' :
                      row.action_type === 'enable_user' ? 'green' :
                      row.action_type.includes('impersonat') ? 'purple' :
                      row.action_type === 'create_admin' || row.action_type === 'update_admin' ? 'purple' : 'blue'
                    }>{row.action_type}</Badge>
                  </div>
                  <span style={{ fontSize: 12, color: C.dark }}>
                    {row.target_user_email || (row.target_user_id ? `#${row.target_user_id}` : '—')}
                  </span>
                  <span style={{ fontSize: 12, color: C.muted, overflow: 'hidden',
                    textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.reason || '—'}</span>
                  <span style={{ fontSize: 11, color: C.muted }}>{row.ip_address || '—'}</span>
                </div>
              ))}
              <div style={{ padding: '12px 22px', fontSize: 11, color: C.muted,
                display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>Showing {data.actions.length} of {data.total} actions</span>
                <div style={{ display: 'flex', gap: 8 }}>
                  {page > 1 && <OutlineBtn small onClick={() => setPage(p => p - 1)}>← Prev</OutlineBtn>}
                  {data.total > page * 50 && <OutlineBtn small onClick={() => setPage(p => p + 1)}>Next →</OutlineBtn>}
                </div>
              </div>
            </Card>
          )}
        </PageWrap>
      </>
    )
  }

  // ── ADMIN ACCOUNTS PAGE ───────────────────────────────────────────────────
  const AdminsPage = () => {
    const [data,        setData]        = useState(null)
    const [err,         setErr]         = useState(null)
    const [createModal, setCreateModal] = useState(false)
    const [editModal,   setEditModal]   = useState(null)
    const [delModal,    setDelModal]    = useState(null)
    const [delText,     setDelText]     = useState('')
    const [form,        setForm]        = useState({ email: '', password: '', role: 'support_admin' })
    const [editForm,    setEditForm]    = useState({ role: '', password: '' })
    const [submitting,  setSubmitting]  = useState(false)

    const load = useCallback(() => {
      listAdmins().then(d => { setData(d); setErr(null) }).catch(e => setErr(e.message))
    }, [])
    useEffect(() => { load() }, [load])

    const doCreate = async () => {
      if (!form.email || !form.password) return
      setSubmitting(true)
      try {
        await createAdmin(form.email, form.password, form.role)
        showToast(`Created admin ${form.email}`)
        setCreateModal(false); setForm({ email: '', password: '', role: 'support_admin' }); load()
      } catch (e) {
        showToast(e.response?.data?.detail || 'Error creating admin', 'danger')
      } finally { setSubmitting(false) }
    }

    const doEdit = async () => {
      const updates = {}
      if (editForm.role)     updates.role     = editForm.role
      if (editForm.password) updates.password = editForm.password
      if (!Object.keys(updates).length) { setEditModal(null); return }
      setSubmitting(true)
      try {
        await updateAdmin(editModal.id, updates)
        showToast(`Updated admin ${editModal.email}`)
        setEditModal(null); setEditForm({ role: '', password: '' }); load()
      } catch (e) {
        showToast(e.response?.data?.detail || 'Error', 'danger')
      } finally { setSubmitting(false) }
    }

    const doDelete = async () => {
      if (delText !== 'DELETE') return
      try {
        await deleteAdmin(delModal.id)
        showToast(`Deleted admin ${delModal.email}`, 'danger')
        setDelModal(null); setDelText(''); load()
      } catch (e) {
        showToast(e.response?.data?.detail || 'Error', 'warn')
        setDelModal(null); setDelText('')
      }
    }

    return (
      <>
        <Hero title="Admin Accounts" sub="Create and manage admin accounts. Super admins only." />
        <PageWrap>
          {err && <ErrorCard msg={err} />}
          <Card>
            <div style={{ padding: '18px 22px', borderBottom: `1px solid ${C.cardBorder}`,
              display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h3 style={{ margin: '0 0 4px', fontSize: 16, fontWeight: 800, color: C.dark }}>All Admin Accounts</h3>
                <p style={{ margin: 0, fontSize: 12, color: C.muted }}>
                  {data?.total || 0} admin{data?.total !== 1 ? 's' : ''} — new admins set up TOTP on first login
                </p>
              </div>
              <PrimaryBtn onClick={() => setCreateModal(true)}>+ Add Admin</PrimaryBtn>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '60px 1fr 120px 160px 160px 120px',
              padding: '10px 22px', background: '#FAFBFF', borderBottom: `1px solid ${C.cardBorder}` }}>
              {['ID', 'Email', 'Role', 'Created', 'Last Login', 'Actions'].map(h => (
                <span key={h} style={{ fontSize: 10, fontWeight: 700, color: C.muted,
                  letterSpacing: '0.07em', textTransform: 'uppercase' }}>{h}</span>
              ))}
            </div>
            {!data && <div style={{ padding: '32px 22px', textAlign: 'center', fontSize: 13, color: C.muted }}>Loading…</div>}
            {(data?.admins || []).map((a, i, arr) => {
              const isSelf = a.id === admin?.id
              return (
                <div key={a.id}
                  style={{ display: 'grid', gridTemplateColumns: '60px 1fr 120px 160px 160px 120px',
                    padding: '14px 22px', borderBottom: i < arr.length - 1 ? `1px solid ${C.cardBorder}` : 'none',
                    alignItems: 'center', transition: 'background 0.12s' }}
                  onMouseEnter={e => e.currentTarget.style.background = '#FAFBFF'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                  <span style={{ fontSize: 11, color: C.muted }}>#{a.id}</span>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: C.dark }}>{a.email}</div>
                    {isSelf && <div style={{ fontSize: 10, color: C.blue }}>You</div>}
                  </div>
                  <div><Badge color={a.role === 'super_admin' ? 'purple' : 'blue'}>
                    {a.role === 'super_admin' ? 'super' : 'support'}
                  </Badge></div>
                  <span style={{ fontSize: 12, color: C.muted }}>{new Date(a.created_at).toLocaleDateString()}</span>
                  <span style={{ fontSize: 12, color: a.last_login ? C.dark : C.muted }}>
                    {a.last_login ? new Date(a.last_login).toLocaleDateString() : 'Never'}
                  </span>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button onClick={() => { setEditModal(a); setEditForm({ role: a.role, password: '' }) }}
                      style={{ padding: '5px 10px', borderRadius: 7, fontSize: 11, fontWeight: 600,
                        border: `1px solid ${C.blueBorder}`, background: C.blueLight,
                        color: C.blue, cursor: 'pointer', fontFamily: 'inherit' }}>Edit</button>
                    {!isSelf && (
                      <button onClick={() => setDelModal(a)}
                        style={{ padding: '5px 10px', borderRadius: 7, fontSize: 11, fontWeight: 600,
                          border: `1px solid ${C.redBorder}`, background: C.redLight,
                          color: C.red, cursor: 'pointer', fontFamily: 'inherit' }}>Delete</button>
                    )}
                  </div>
                </div>
              )
            })}
          </Card>
        </PageWrap>

        {createModal && (
          <Modal onClose={() => setCreateModal(false)} borderColor={C.blueBorder}>
            <div style={{ fontSize: 28, marginBottom: 14 }}>👤</div>
            <h3 style={{ fontSize: 18, fontWeight: 800, color: C.dark, marginBottom: 20 }}>Create Admin Account</h3>
            <label style={labelStyle}>Email</label>
            <input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
              placeholder="admin@company.com" style={{ ...inputStyle, marginBottom: 14 }} />
            <label style={labelStyle}>Password</label>
            <input type="password" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
              placeholder="Min 8 chars" style={{ ...inputStyle, marginBottom: 14 }} />
            <label style={labelStyle}>Role</label>
            <select value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))}
              style={{ ...inputStyle, marginBottom: 22, cursor: 'pointer' }}>
              <option value="support_admin">Support Admin</option>
              <option value="super_admin">Super Admin</option>
            </select>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <OutlineBtn onClick={() => setCreateModal(false)}>Cancel</OutlineBtn>
              <PrimaryBtn onClick={doCreate} disabled={submitting || !form.email || form.password.length < 8}>
                {submitting ? 'Creating…' : 'Create Admin'}
              </PrimaryBtn>
            </div>
          </Modal>
        )}

        {editModal && (
          <Modal onClose={() => setEditModal(null)} borderColor={C.blueBorder}>
            <div style={{ fontSize: 28, marginBottom: 14 }}>✏️</div>
            <h3 style={{ fontSize: 18, fontWeight: 800, color: C.dark, marginBottom: 20 }}>
              Edit Admin — {editModal.email}
            </h3>
            <label style={labelStyle}>Role</label>
            <select value={editForm.role} onChange={e => setEditForm(f => ({ ...f, role: e.target.value }))}
              style={{ ...inputStyle, marginBottom: 14, cursor: 'pointer' }}>
              <option value="support_admin">Support Admin</option>
              <option value="super_admin">Super Admin</option>
            </select>
            <label style={labelStyle}>New Password (leave blank to keep)</label>
            <input type="password" value={editForm.password}
              onChange={e => setEditForm(f => ({ ...f, password: e.target.value }))}
              placeholder="••••••••" style={{ ...inputStyle, marginBottom: 22 }} />
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <OutlineBtn onClick={() => setEditModal(null)}>Cancel</OutlineBtn>
              <PrimaryBtn onClick={doEdit} disabled={submitting}>{submitting ? 'Saving…' : 'Save'}</PrimaryBtn>
            </div>
          </Modal>
        )}

        {delModal && (
          <Modal onClose={() => { setDelModal(null); setDelText('') }} borderColor={C.redBorder}>
            <div style={{ fontSize: 28, marginBottom: 14 }}>⛔</div>
            <h3 style={{ fontSize: 18, fontWeight: 800, color: C.red, marginBottom: 20 }}>
              Delete Admin — {delModal?.email}
            </h3>
            <label style={labelStyle}>Type "DELETE" to confirm</label>
            <input value={delText} onChange={e => setDelText(e.target.value)} placeholder="DELETE"
              style={{ ...inputStyle, letterSpacing: '0.1em', fontSize: 14, marginBottom: 20 }} />
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <OutlineBtn onClick={() => { setDelModal(null); setDelText('') }}>Cancel</OutlineBtn>
              <button onClick={doDelete} disabled={delText !== 'DELETE'}
                style={{ padding: '10px 22px', borderRadius: 9, border: 'none', fontFamily: 'inherit',
                  background: delText === 'DELETE' ? C.red : '#E5E7EB',
                  color: delText === 'DELETE' ? '#fff' : C.muted,
                  fontSize: 13, fontWeight: 700, cursor: delText === 'DELETE' ? 'pointer' : 'not-allowed' }}>
                Delete Admin
              </button>
            </div>
          </Modal>
        )}
      </>
    )
  }

  // ── RENDER ────────────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight: '100vh', background: C.page, fontFamily: 'DM Sans, sans-serif', color: C.dark }}>
      <Header />
      <div style={{ animation: 'fadeUp 0.25s ease' }} key={nav + (selectedUser?.id || '')}>
        {nav === 'dashboard' && <DashboardPage />}
        {nav === 'users'     && <UsersPage />}
        {nav === 'costs'     && <CostsPage />}
        {nav === 'tokens'    && <TokenMetrics onNavigateToUser={(uid) => { navigate('users', { id: uid }) }} />}
        {nav === 'audit'     && <AuditPage />}
        {nav === 'admins'    && isSuperAdmin && <AdminsPage />}
        {nav === 'oem'       && <OemMaintenance showToast={showToast} />}
      </div>
    </div>
  )
}
