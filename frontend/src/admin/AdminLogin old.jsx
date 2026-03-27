/**
 * frontend/src/admin/AdminLogin.jsx
 *
 * Handles two login flows automatically:
 *
 * A) No TOTP (simple mode):
 *    Email + password → logged in immediately
 *    Backend returns status: "authenticated" + access_token
 *
 * B) TOTP configured (secure mode):
 *    Email + password → 6-digit code screen
 *    Backend returns status: "totp_required" + pre_auth_token
 */

import { useState } from 'react'
import { adminLogin, adminVerifyTotp, saveAdminToken } from '../services/adminApi'

const C = {
  page: '#EEF2FF',
  card: '#FFFFFF', cardBorder: '#C7D2FE',
  dark: '#0F172A', muted: '#6B7280',
  blue: '#2563EB', blueLight: '#EFF6FF', blueBorder: '#BFDBFE',
  red: '#EF4444', redLight: '#FEF2F2', redBorder: '#FECACA',
  btnGrad: 'linear-gradient(135deg, #1E3A8A, #2563EB)',
}

export default function AdminLogin({ onSuccess, showToast }) {
  const [step, setStep]            = useState('password')  // 'password' | 'totp'
  const [email, setEmail]          = useState('')
  const [password, setPassword]    = useState('')
  const [totpCode, setTotpCode]    = useState('')
  const [preAuthToken, setPreAuth] = useState('')
  const [loading, setLoading]      = useState(false)
  const [error, setError]          = useState('')

  const inputStyle = {
    width: '100%', padding: '10px 14px', fontSize: 14, fontFamily: 'inherit',
    background: '#F8FAFC', border: `1px solid ${C.cardBorder}`, borderRadius: 9,
    color: C.dark, outline: 'none', boxSizing: 'border-box',
  }

  const handlePasswordSubmit = async (e) => {
    e.preventDefault()
    setError(''); setLoading(true)
    try {
      const res = await adminLogin(email, password)

      // ── Simple mode: no TOTP — logged in immediately ──────────────────
      if (res.status === 'authenticated') {
        saveAdminToken(res.access_token)
        onSuccess(res.admin)
        return
      }

      // ── Secure mode: TOTP required ────────────────────────────────────
      if (res.status === 'totp_required') {
        setPreAuth(res.pre_auth_token)
        setStep('totp')
        return
      }

    } catch (err) {
      setError(err.response?.data?.detail || 'Invalid credentials')
    } finally {
      setLoading(false)
    }
  }

  const handleTotpSubmit = async (e) => {
    e.preventDefault()
    setError(''); setLoading(true)
    try {
      const res = await adminVerifyTotp(preAuthToken, totpCode)
      saveAdminToken(res.access_token)
      onSuccess(res.admin)
    } catch (err) {
      setError(err.response?.data?.detail || 'Invalid TOTP code')
      setTotpCode('')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ minHeight: '100vh', background: C.page, display: 'flex',
      flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      fontFamily: 'DM Sans, sans-serif' }}>

      {/* Logo */}
      <div style={{ marginBottom: 28, textAlign: 'center' }}>
        <div style={{ width: 48, height: 48, borderRadius: 14, background: C.btnGrad,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 24, margin: '0 auto 12px' }}>🛡</div>
        <div style={{ fontSize: 20, fontWeight: 800, color: C.dark }}>MaintenanceGuard</div>
        <div style={{ marginTop: 6, display: 'inline-block', fontSize: 10, fontWeight: 700,
          letterSpacing: '0.1em', color: C.red, background: C.redLight,
          border: `1px solid ${C.redBorder}`, padding: '2px 10px', borderRadius: 99 }}>
          ADMIN CONSOLE
        </div>
      </div>

      {/* Card */}
      <div style={{ width: 380, background: C.card, border: `1px solid ${C.cardBorder}`,
        borderRadius: 18, padding: 32, boxShadow: '0 4px 24px rgba(29,78,216,0.09)',
        animation: 'fadeUp 0.25s ease' }}>

        {/* ── Step 1: Password ── */}
        {step === 'password' && (
          <form onSubmit={handlePasswordSubmit}>
            <h2 style={{ fontSize: 18, fontWeight: 800, color: C.dark, marginBottom: 6 }}>Sign in</h2>
            <p style={{ fontSize: 13, color: C.muted, marginBottom: 24 }}>Admin access only</p>

            <label style={{ display: 'block', fontSize: 11, fontWeight: 700,
              textTransform: 'uppercase', letterSpacing: '0.07em', color: C.muted, marginBottom: 6 }}>
              Email
            </label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)}
              placeholder="admin@yourcompany.com" required autoFocus
              style={{ ...inputStyle, marginBottom: 16 }} />

            <label style={{ display: 'block', fontSize: 11, fontWeight: 700,
              textTransform: 'uppercase', letterSpacing: '0.07em', color: C.muted, marginBottom: 6 }}>
              Password
            </label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)}
              placeholder="••••••••" required
              style={{ ...inputStyle, marginBottom: 20 }} />

            {error && (
              <div style={{ padding: '9px 14px', background: C.redLight,
                border: `1px solid ${C.redBorder}`, borderRadius: 8,
                fontSize: 13, color: C.red, marginBottom: 16 }}>{error}</div>
            )}

            <button type="submit" disabled={loading}
              style={{ width: '100%', padding: '11px', borderRadius: 9, border: 'none',
                background: C.btnGrad, color: '#fff', fontSize: 14, fontWeight: 700,
                cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.7 : 1,
                fontFamily: 'inherit' }}>
              {loading ? 'Signing in…' : 'Sign In →'}
            </button>
          </form>
        )}

        {/* ── Step 2: TOTP (only shown if backend requires it) ── */}
        {step === 'totp' && (
          <form onSubmit={handleTotpSubmit}>
            <h2 style={{ fontSize: 18, fontWeight: 800, color: C.dark, marginBottom: 6 }}>
              Two-factor authentication
            </h2>
            <p style={{ fontSize: 13, color: C.muted, marginBottom: 24, lineHeight: 1.6 }}>
              Enter the 6-digit code from your authenticator app.
            </p>

            <label style={{ display: 'block', fontSize: 11, fontWeight: 700,
              textTransform: 'uppercase', letterSpacing: '0.07em', color: C.muted, marginBottom: 6 }}>
              6-digit code
            </label>
            <input type="text" inputMode="numeric" pattern="[0-9]{6}" maxLength={6}
              value={totpCode} onChange={e => setTotpCode(e.target.value.replace(/\D/g, ''))}
              placeholder="000000" required autoFocus
              style={{ ...inputStyle, letterSpacing: '0.3em', fontSize: 20,
                textAlign: 'center', marginBottom: 20 }} />

            {error && (
              <div style={{ padding: '9px 14px', background: C.redLight,
                border: `1px solid ${C.redBorder}`, borderRadius: 8,
                fontSize: 13, color: C.red, marginBottom: 16 }}>{error}</div>
            )}

            <button type="submit" disabled={loading || totpCode.length !== 6}
              style={{ width: '100%', padding: '11px', borderRadius: 9, border: 'none',
                background: totpCode.length === 6 ? C.btnGrad : '#E5E7EB',
                color: totpCode.length === 6 ? '#fff' : C.muted,
                fontSize: 14, fontWeight: 700,
                cursor: loading || totpCode.length !== 6 ? 'not-allowed' : 'pointer',
                fontFamily: 'inherit', transition: 'all 0.15s' }}>
              {loading ? 'Verifying…' : 'Sign In'}
            </button>

            <button type="button" onClick={() => { setStep('password'); setError(''); setTotpCode('') }}
              style={{ width: '100%', marginTop: 10, padding: '9px', borderRadius: 9,
                border: `1px solid ${C.cardBorder}`, background: 'transparent',
                color: C.muted, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>
              ← Back
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
