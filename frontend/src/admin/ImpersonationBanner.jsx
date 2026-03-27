/**
 * frontend/src/admin/ImpersonationBanner.jsx
 *
 * Sticky amber banner rendered in the MAIN user app (App.jsx) when an
 * impersonation token is active in localStorage under mg_impersonation_token.
 *
 * Shows: which user is being viewed, a warning about real account impact,
 * and an "End Session" button that clears the token and returns to the admin console.
 */

import { useState, useEffect } from 'react'
import { endImpersonation } from '../services/adminApi'

const IMPERSONATION_KEY = 'mg_impersonation_token'
const IMPERSONATION_META_KEY = 'mg_impersonation_meta'  // { userId, userEmail, adminConsoleUrl }

export default function ImpersonationBanner() {
  const [meta,    setMeta]    = useState(null)
  const [ending,  setEnding]  = useState(false)

  useEffect(() => {
    const token = localStorage.getItem(IMPERSONATION_KEY)
    if (!token) return

    try {
      const raw = localStorage.getItem(IMPERSONATION_META_KEY)
      if (raw) setMeta(JSON.parse(raw))
    } catch {
      // Meta missing — still show a generic banner
      setMeta({ userId: null, userEmail: 'user', adminConsoleUrl: '/index-admin.html' })
    }
  }, [])

  if (!meta) return null

  const handleEnd = async () => {
    setEnding(true)
    try {
      if (meta.userId) {
        await endImpersonation(meta.userId)
      }
    } catch {
      // Best-effort — clear tokens regardless
    } finally {
      localStorage.removeItem(IMPERSONATION_KEY)
      localStorage.removeItem(IMPERSONATION_META_KEY)
      window.location.href = meta.adminConsoleUrl || '/index-admin.html'
    }
  }

  return (
    <div style={{
      position: 'sticky', top: 0, zIndex: 9999,
      background: '#FEF3C7',
      border: 'none',
      borderBottom: '2px solid #FDE68A',
      padding: '10px 24px',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      fontFamily: 'DM Sans, sans-serif',
      boxShadow: '0 2px 8px rgba(245,158,11,0.15)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 18 }}>👁</span>
        <div>
          <span style={{ fontSize: 13, fontWeight: 700, color: '#92400E' }}>
            Admin View — Viewing as{' '}
            <span style={{ color: '#78350F' }}>{meta.userEmail}</span>
          </span>
          <span style={{ fontSize: 12, color: '#B45309', marginLeft: 10 }}>
            Actions you take affect this account.
          </span>
        </div>
      </div>

      <button
        onClick={handleEnd}
        disabled={ending}
        style={{
          padding: '7px 18px', borderRadius: 8,
          background: ending ? '#FDE68A' : '#F59E0B',
          border: 'none', cursor: ending ? 'not-allowed' : 'pointer',
          fontSize: 12, fontWeight: 700, color: '#fff',
          fontFamily: 'inherit',
          boxShadow: '0 2px 6px rgba(245,158,11,0.3)',
          transition: 'background 0.15s',
        }}
      >
        {ending ? 'Ending…' : 'End Session →'}
      </button>
    </div>
  )
}
