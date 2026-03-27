/**
 * frontend/src/admin/UserNotes.jsx
 *
 * Timestamped support notes component.
 * Used inside the User Detail section of AdminDashboard.jsx.
 * Each note is immutable — append only.
 */

import { useState, useEffect, useCallback } from 'react'
import { getUserNotes, addUserNote } from '../services/adminApi'

const C = {
  card: '#FFFFFF', cardBorder: '#C7D2FE', cardShadow: '0 2px 10px rgba(29,78,216,0.07)',
  blue: '#2563EB', blueLight: '#EFF6FF', blueBorder: '#BFDBFE',
  dark: '#0F172A', mid: '#374151', muted: '#6B7280',
  red: '#EF4444', redLight: '#FEF2F2',
  green: '#10B981',
}

export default function UserNotes({ userId, showToast }) {
  const [notes,       setNotes]       = useState([])
  const [loading,     setLoading]     = useState(true)
  const [submitting,  setSubmitting]  = useState(false)
  const [noteText,    setNoteText]    = useState('')
  const [err,         setErr]         = useState(null)

  const load = useCallback(() => {
    setLoading(true)
    getUserNotes(userId)
      .then(d => { setNotes(d.notes || []); setErr(null) })
      .catch(e => setErr(e.message))
      .finally(() => setLoading(false))
  }, [userId])

  useEffect(() => { load() }, [load])

  const handleAdd = async () => {
    if (noteText.trim().length < 5) return
    setSubmitting(true)
    try {
      await addUserNote(userId, noteText.trim())
      setNoteText('')
      load()
      if (showToast) showToast('Note added')
    } catch (e) {
      if (showToast) showToast(e.response?.data?.detail || 'Failed to add note', 'danger')
    } finally {
      setSubmitting(false)
    }
  }

  const handleKeyDown = (e) => {
    // Ctrl+Enter / Cmd+Enter submits
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') handleAdd()
  }

  return (
    <div style={{ background: C.card, border: `1px solid ${C.cardBorder}`,
      borderRadius: 14, boxShadow: C.cardShadow, overflow: 'hidden' }}>

      {/* Header */}
      <div style={{ padding: '16px 22px', borderBottom: `1px solid ${C.cardBorder}`,
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        background: '#FAFBFF' }}>
        <div>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 800, color: C.dark }}>
            Support Notes
          </h3>
          <p style={{ margin: '2px 0 0', fontSize: 11, color: C.muted }}>
            Append-only — notes cannot be edited or deleted
          </p>
        </div>
        <span style={{ fontSize: 11, fontWeight: 700, background: C.blueLight,
          color: C.blue, padding: '2px 10px', borderRadius: 99 }}>
          {notes.length} note{notes.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Add note form */}
      <div style={{ padding: '16px 22px', borderBottom: `1px solid ${C.cardBorder}` }}>
        <textarea
          value={noteText}
          onChange={e => setNoteText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Add a support note… (Ctrl+Enter to submit)"
          rows={3}
          style={{
            width: '100%', padding: '9px 13px', fontFamily: 'DM Sans, sans-serif',
            fontSize: 13, color: C.dark, background: '#F8FAFC',
            border: `1px solid ${C.cardBorder}`, borderRadius: 9,
            resize: 'vertical', boxSizing: 'border-box', outline: 'none',
            lineHeight: 1.6,
          }}
        />
        <div style={{ display: 'flex', justifyContent: 'space-between',
          alignItems: 'center', marginTop: 8 }}>
          <span style={{ fontSize: 11, color: noteText.length < 5 ? C.muted : C.green }}>
            {noteText.length} chars {noteText.length < 5 && noteText.length > 0 ? '(min 5)' : ''}
          </span>
          <button
            onClick={handleAdd}
            disabled={submitting || noteText.trim().length < 5}
            style={{
              padding: '8px 20px', borderRadius: 9, border: 'none',
              background: noteText.trim().length >= 5
                ? 'linear-gradient(135deg, #1E3A8A, #2563EB)' : '#E5E7EB',
              color: noteText.trim().length >= 5 ? '#fff' : C.muted,
              fontSize: 12, fontWeight: 700, fontFamily: 'inherit',
              cursor: submitting || noteText.trim().length < 5 ? 'not-allowed' : 'pointer',
              transition: 'all 0.15s',
            }}
          >
            {submitting ? 'Adding…' : '+ Add Note'}
          </button>
        </div>
      </div>

      {/* Notes list */}
      <div style={{ maxHeight: 420, overflowY: 'auto' }}>
        {loading && (
          <div style={{ padding: '24px 22px', textAlign: 'center', fontSize: 13, color: C.muted }}>
            Loading…
          </div>
        )}
        {err && !loading && (
          <div style={{ padding: '16px 22px', fontSize: 13, color: C.red, background: C.redLight }}>
            ⚠️ {err}
          </div>
        )}
        {!loading && !err && notes.length === 0 && (
          <div style={{ padding: '32px 22px', textAlign: 'center', fontSize: 13, color: C.muted }}>
            No support notes yet.
          </div>
        )}
        {notes.map((note, i) => (
          <div key={note.id}
            style={{
              padding: '14px 22px',
              borderBottom: i < notes.length - 1 ? `1px solid ${C.cardBorder}` : 'none',
              borderLeft: `3px solid ${C.blue}`,
              marginLeft: 0,
              transition: 'background 0.12s',
            }}
            onMouseEnter={e => e.currentTarget.style.background = '#FAFBFF'}
            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
          >
            {/* Meta row */}
            <div style={{ display: 'flex', justifyContent: 'space-between',
              alignItems: 'center', marginBottom: 6 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ width: 24, height: 24, borderRadius: 7,
                  background: 'linear-gradient(135deg, #1E3A8A, #2563EB)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 10, fontWeight: 800, color: '#fff', flexShrink: 0 }}>
                  {(note.admin_email || 'A')[0].toUpperCase()}
                </div>
                <span style={{ fontSize: 12, fontWeight: 600, color: C.blue }}>
                  {note.admin_email || 'Admin'}
                </span>
              </div>
              <span style={{ fontSize: 11, color: C.muted }}>
                {new Date(note.created_at).toLocaleString()}
              </span>
            </div>
            {/* Note text */}
            <p style={{ margin: 0, fontSize: 13, color: C.mid, lineHeight: 1.65,
              paddingLeft: 32, whiteSpace: 'pre-wrap' }}>
              {note.note}
            </p>
          </div>
        ))}
      </div>
    </div>
  )
}
