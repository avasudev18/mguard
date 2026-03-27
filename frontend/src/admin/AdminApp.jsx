/**
 * frontend/src/admin/AdminApp.jsx
 *
 * Root of the admin console. Handles:
 *   - Auth state (token in localStorage under mg_admin_token)
 *   - Route switching: Login → Dashboard → Users → Costs → Audit
 *   - Global toast notifications
 */

import { useState, useEffect, useCallback } from 'react'
import AdminLogin from './AdminLogin'
import AdminDashboard from './AdminDashboard'
import { getAdminToken, clearAdminToken, adminGetMe } from '../services/adminApi'

export default function AdminApp() {
  const [admin, setAdmin]     = useState(null)   // null = not logged in
  const [loading, setLoading] = useState(true)
  const [toast, setToast]     = useState(null)   // { msg, type }

  const showToast = useCallback((msg, type = 'success') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3500)
  }, [])

  const logout = useCallback(() => {
    clearAdminToken()
    setAdmin(null)
  }, [])

  const onLoginSuccess = useCallback((adminData) => {
    setAdmin(adminData)
  }, [])

  // Re-hydrate session on page load
  useEffect(() => {
    const token = getAdminToken()
    if (!token) { setLoading(false); return }

    adminGetMe()
      .then((data) => setAdmin(data))
      .catch(() => clearAdminToken())
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center',
        justifyContent: 'center', background: '#EEF2FF', fontFamily: 'DM Sans, sans-serif' }}>
        <div style={{ fontSize: 14, color: '#6B7280' }}>Loading…</div>
      </div>
    )
  }

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: #EEF2FF; font-family: 'DM Sans', sans-serif; }
        @keyframes fadeUp { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:translateY(0)} }
        @keyframes toastIn { from{opacity:0;transform:translateY(10px)} to{opacity:1;transform:translateY(0)} }
        input:focus, textarea:focus { outline: 2px solid #BFDBFE; outline-offset: 0; }
      `}</style>

      {!admin
        ? <AdminLogin onSuccess={onLoginSuccess} showToast={showToast} />
        : <AdminDashboard admin={admin} onLogout={logout} showToast={showToast} />
      }

      {/* Global toast */}
      {toast && (
        <div style={{
          position: 'fixed', bottom: 24, right: 24,
          padding: '11px 20px', borderRadius: 10,
          background: toast.type === 'danger' ? '#EF4444' : toast.type === 'warn' ? '#F59E0B' : '#10B981',
          color: '#fff', fontSize: 13, fontWeight: 600,
          animation: 'toastIn 0.2s ease', zIndex: 1000,
          boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
        }}>
          {toast.type === 'danger' ? '🗑 ' : toast.type === 'warn' ? '⚠️ ' : '✅ '}
          {toast.msg}
        </div>
      )}
    </>
  )
}
