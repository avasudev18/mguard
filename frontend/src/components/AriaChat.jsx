/**
 * frontend/src/components/AriaChat.jsx
 *
 * Phase 1 — ARIA chat widget.
 * Persistent collapsible panel anchored bottom-right on all dashboard pages.
 *
 * Props:
 *   vehicleId     {number|null}  Pre-loaded from page route. null = fleet overview.
 *   vehicleName   {string}       Display name shown in the panel header.
 *   currentMileage {number|null} Pre-loaded from vehicle record.
 *
 * Calls: POST /api/chat/ask  (see api.js askAria)
 *
 * State management:
 *   - Stateless per session (Phase 1). No persistence across page navigations.
 *   - Phase 3: add localStorage-backed conversation history.
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { askAria } from '../services/api';

// ── Colours ───────────────────────────────────────────────────────────────────
const C = {
  navy:    '#1E3A5F',
  blue:    '#2563EB',
  blueLt:  '#EFF6FF',
  blueBd:  '#BFDBFE',
  white:   '#FFFFFF',
  bg:      '#F8FAFF',
  text:    '#0F172A',
  muted:   '#6B7280',
  border:  '#C7D2FE',
  green:   '#059669',
  amber:   '#D97706',
  red:     '#EF4444',
  redLt:   '#FEF2F2',
  shadow:  '0 8px 32px rgba(29,78,216,0.18)',
};

// ── Typing indicator (animated dots) ─────────────────────────────────────────
function TypingDots() {
  return (
    <div style={{ display: 'flex', gap: 4, padding: '10px 14px', alignItems: 'center' }}>
      {[0, 1, 2].map(i => (
        <div key={i} style={{
          width: 7, height: 7, borderRadius: '50%',
          background: C.blue, opacity: 0.6,
          animation: `ariaDot 1.2s ${i * 0.2}s ease-in-out infinite`,
        }} />
      ))}
    </div>
  );
}

// ── Citation card ─────────────────────────────────────────────────────────────
function CitationCard({ citation }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{
      marginTop: 6, border: `1px solid ${C.blueBd}`, borderRadius: 8,
      fontSize: 11, overflow: 'hidden',
    }}>
      <div
        onClick={() => setOpen(o => !o)}
        style={{
          padding: '5px 10px', background: C.blueLt, cursor: 'pointer',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          color: C.blue, fontWeight: 600,
        }}
      >
        <span>📎 {citation.source}</span>
        <span style={{ fontSize: 9 }}>{open ? '▲' : '▼'}</span>
      </div>
      {open && (
        <div style={{ padding: '6px 10px', color: C.muted, lineHeight: 1.5 }}>
          {citation.text}
        </div>
      )}
    </div>
  );
}

// ── Message bubble ────────────────────────────────────────────────────────────
function MessageBubble({ msg }) {
  const isUser = msg.role === 'user';
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: isUser ? 'flex-end' : 'flex-start',
      marginBottom: 12,
    }}>
      <div style={{
        maxWidth: '82%',
        padding: '10px 14px',
        borderRadius: isUser ? '14px 14px 4px 14px' : '14px 14px 14px 4px',
        background: isUser ? C.blue : C.white,
        color: isUser ? C.white : C.text,
        fontSize: 13,
        lineHeight: 1.6,
        border: isUser ? 'none' : `1px solid ${C.border}`,
        boxShadow: isUser ? 'none' : '0 1px 4px rgba(0,0,0,0.06)',
        whiteSpace: 'pre-wrap',
      }}>
        {msg.content}
      </div>

      {/* Escalation CTA */}
      {msg.escalate && (
        <div style={{
          maxWidth: '82%', marginTop: 8,
          padding: '10px 14px',
          background: C.redLt, border: `1px solid #FECACA`,
          borderRadius: 10, fontSize: 12, color: C.red,
        }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>Need more help?</div>
          <a
            href="mailto:support@maintenanceguard.com?subject=ARIA Escalation"
            style={{
              display: 'inline-block', padding: '6px 14px',
              background: C.red, color: C.white,
              borderRadius: 8, textDecoration: 'none',
              fontSize: 12, fontWeight: 600,
            }}
          >
            Connect to Support Agent →
          </a>
        </div>
      )}

      {/* Citation cards */}
      {msg.citations?.length > 0 && (
        <div style={{ maxWidth: '82%', width: '100%', marginTop: 4 }}>
          {msg.citations.map((c, i) => (
            <CitationCard key={i} citation={c} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main widget ───────────────────────────────────────────────────────────────
export default function AriaChat({ vehicleId = null, vehicleName = '', currentMileage = null, vehicles = [] }) {
  const [open,       setOpen]       = useState(false);
  const [selectedVid, setSelectedVid] = useState(vehicleId);
  const [selectedName, setSelectedName] = useState(vehicleName);
  const [messages, setMessages] = useState([]);
  const [input,    setInput]    = useState('');
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState(null);

  const bottomRef  = useRef(null);
  const inputRef   = useRef(null);

  // Auto-scroll to latest message
  useEffect(() => {
    if (open) bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, open, loading]);

  // Focus input when opened
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 150);
  }, [open]);

  // Sync vehicleId prop changes to selectedVid state
  useEffect(() => {
    if (vehicleId !== null) {
      setSelectedVid(vehicleId);
      setSelectedName(vehicleName);
    }
  }, [vehicleId, vehicleName]);

  const handleSend = useCallback(async () => {
    const q = input.trim();
    if (!q || loading) return;

    setInput('');
    setError(null);
    setMessages(prev => [...prev, { role: 'user', content: q, id: Date.now() }]);
    setLoading(true);

    try {
      const res = await askAria({
        vehicle_id:       selectedVid,
        question:         q,
        current_mileage:  currentMileage,
        conversation_history: [],
      });

      setMessages(prev => [...prev, {
        role:       'assistant',
        content:    res.data.response,
        citations:  res.data.citations || [],
        escalate:   res.data.escalate,
        id:         Date.now() + 1,
      }]);
    } catch (err) {
      const status = err.response?.status;
      const detail = err.response?.data?.detail || err.message || 'Something went wrong. Please try again.';
      // 401 = not logged in, 422 = bad request (e.g. no vehicle), 404 = vehicle not found
      const userMsg = status === 401
        ? 'Please log in to use ARIA.'
        : status === 422
        ? 'Please select a vehicle first, then ask your question.'
        : status === 404
        ? 'Vehicle not found. Please select a valid vehicle.'
        : detail;
      setMessages(prev => [...prev, {
        role:    'assistant',
        content: userMsg,
        citations: [],
        escalate: false,
        id:      Date.now() + 1,
      }]);
    } finally {
      setLoading(false);
    }
  }, [selectedVid, currentMileage, input, loading]);

  const handleKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const unreadCount = !open ? messages.filter(m => m.role === 'assistant').length : 0;

  return (
    <>
      {/* CSS keyframes injected once */}
      <style>{`
        @keyframes ariaDot {
          0%,80%,100% { transform: scale(0.7); opacity:0.4; }
          40%         { transform: scale(1.0); opacity:1.0; }
        }
        @keyframes ariaSlideUp {
          from { opacity:0; transform:translateY(12px); }
          to   { opacity:1; transform:translateY(0); }
        }
      `}</style>

      {/* ── Collapsed button ── */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          title="Ask ARIA"
          style={{
            position: 'fixed', bottom: 24, right: 24, zIndex: 9999,
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '12px 18px',
            background: `linear-gradient(135deg, ${C.navy}, ${C.blue})`,
            color: C.white, border: 'none', borderRadius: 40,
            fontSize: 13, fontWeight: 700, cursor: 'pointer',
            boxShadow: C.shadow,
            fontFamily: 'DM Sans, sans-serif',
          }}
        >
          <span style={{ fontSize: 16 }}>🤖</span>
          Ask ARIA
          {unreadCount > 0 && (
            <span style={{
              background: C.red, color: C.white,
              borderRadius: 10, padding: '1px 6px', fontSize: 10, fontWeight: 800,
            }}>
              {unreadCount}
            </span>
          )}
        </button>
      )}

      {/* ── Expanded panel ── */}
      {open && (
        <div style={{
          position: 'fixed', bottom: 24, right: 24, zIndex: 9999,
          width: 360, height: 520,
          display: 'flex', flexDirection: 'column',
          background: C.bg,
          border: `1px solid ${C.border}`,
          borderRadius: 18,
          boxShadow: C.shadow,
          fontFamily: 'DM Sans, sans-serif',
          animation: 'ariaSlideUp 0.22s ease',
          overflow: 'hidden',
        }}>

          {/* Header */}
          <div style={{
            background: `linear-gradient(135deg, ${C.navy}, ${C.blue})`,
            padding: '14px 16px',
            display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
            flexShrink: 0,
          }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 15 }}>🤖</span>
                <span style={{ color: C.white, fontWeight: 700, fontSize: 14 }}>
                  ARIA
                </span>
                <span style={{
                  fontSize: 9, fontWeight: 700, color: 'rgba(255,255,255,0.6)',
                  textTransform: 'uppercase', letterSpacing: '0.06em',
                }}>
                  Vehicle Maintenance Assistant
                </span>
              </div>
              {vehicleName && (
                <div style={{ color: 'rgba(255,255,255,0.65)', fontSize: 11, marginTop: 3 }}>
                  {vehicleName}
                  {currentMileage && ` · ${currentMileage.toLocaleString()} mi`}
                </div>
              )}
              {vehicles.length > 0 && !selectedVid && (
                <div style={{ color: C.amber, fontSize: 11, marginTop: 3, fontWeight: 600 }}>
                  ⚠ Select a vehicle below for specific answers
                </div>
              )}
              {vehicles.length === 0 && !selectedVid && (
                <div style={{ color: C.amber, fontSize: 11, marginTop: 3, fontWeight: 600 }}>
                  ⚠ Select a vehicle for vehicle-specific answers
                </div>
              )}
            </div>
            <button
              onClick={() => setOpen(false)}
              style={{
                background: 'rgba(255,255,255,0.15)', border: 'none',
                color: C.white, borderRadius: 8, padding: '4px 9px',
                cursor: 'pointer', fontSize: 13, fontWeight: 700,
              }}
            >
              ✕
            </button>
          </div>

          {/* Vehicle selector — shown on fleet overview when vehicles list provided */}
          {vehicles.length > 0 && (
            <div style={{
              padding: '8px 12px', borderBottom: `1px solid ${C.border}`,
              background: '#F8FAFF', flexShrink: 0,
              display: 'flex', alignItems: 'center', gap: 8,
            }}>
              <span style={{ fontSize: 11, color: C.muted, whiteSpace: 'nowrap' }}>Vehicle:</span>
              <select
                value={selectedVid || ''}
                onChange={e => {
                  const vid = e.target.value ? parseInt(e.target.value) : null;
                  const v   = vehicles.find(v => v.id === vid);
                  setSelectedVid(vid);
                  setSelectedName(v ? `${v.year} ${v.make} ${v.model}` : '');
                  setMessages([]);
                }}
                style={{
                  flex: 1, padding: '5px 8px', borderRadius: 8,
                  border: `1px solid ${C.border}`, fontSize: 12,
                  fontFamily: 'DM Sans, sans-serif', color: C.dark,
                  background: '#fff', cursor: 'pointer',
                }}
              >
                <option value="">— Select a vehicle —</option>
                {vehicles.map(v => (
                  <option key={v.id} value={v.id}>
                    {v.year} {v.make} {v.model}{v.nickname ? ` (${v.nickname})` : ''}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Messages */}
          <div style={{
            flex: 1, overflowY: 'auto', padding: '16px 14px 8px',
            display: 'flex', flexDirection: 'column',
          }}>
            {messages.length === 0 && (
              <div style={{ textAlign: 'center', padding: '28px 16px', color: C.muted }}>
                <div style={{ fontSize: 28, marginBottom: 10 }}>🔧</div>
                <div style={{ fontSize: 13, lineHeight: 1.6 }}>
                  Ask me about your vehicle's maintenance schedule, service history,
                  or OEM recommendations.
                </div>
                <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {[
                    'When is my next oil change due?',
                    'Has my cabin air filter been replaced?',
                    'What does severe driving condition mean?',
                  ].map(prompt => (
                    <button
                      key={prompt}
                      onClick={() => setInput(prompt)}
                      style={{
                        background: C.white, border: `1px solid ${C.border}`,
                        borderRadius: 10, padding: '7px 12px',
                        fontSize: 12, color: C.blue, cursor: 'pointer',
                        textAlign: 'left', fontFamily: 'inherit',
                      }}
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map(msg => (
              <MessageBubble key={msg.id} msg={msg} />
            ))}

            {loading && (
              <div style={{
                alignSelf: 'flex-start',
                background: C.white, border: `1px solid ${C.border}`,
                borderRadius: '14px 14px 14px 4px',
              }}>
                <TypingDots />
              </div>
            )}

            {error && (
              <div style={{
                fontSize: 11, color: C.red, padding: '6px 10px',
                background: C.redLt, borderRadius: 8, marginTop: 4,
              }}>
                {error}
              </div>
            )}

            <div ref={bottomRef} />
          </div>

          {/* Input area */}
          <div style={{
            padding: '10px 12px 12px',
            borderTop: `1px solid ${C.border}`,
            background: C.white, flexShrink: 0,
          }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
              <textarea
                ref={inputRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKey}
                placeholder="Ask about your vehicle maintenance…"
                rows={1}
                disabled={loading}
                style={{
                  flex: 1, resize: 'none', border: `1px solid ${C.border}`,
                  borderRadius: 12, padding: '9px 12px',
                  fontSize: 13, fontFamily: 'DM Sans, sans-serif',
                  color: C.text, outline: 'none',
                  minHeight: 38, maxHeight: 100,
                  lineHeight: 1.5,
                }}
              />
              <button
                onClick={handleSend}
                disabled={!input.trim() || loading}
                style={{
                  background: input.trim() && !loading
                    ? `linear-gradient(135deg, ${C.navy}, ${C.blue})`
                    : '#E2E8F0',
                  color: input.trim() && !loading ? C.white : C.muted,
                  border: 'none', borderRadius: 12, padding: '9px 14px',
                  cursor: input.trim() && !loading ? 'pointer' : 'default',
                  fontSize: 16, fontWeight: 700, lineHeight: 1,
                  flexShrink: 0,
                  transition: 'background 0.15s',
                }}
              >
                ↑
              </button>
            </div>
            <div style={{ fontSize: 10, color: C.muted, marginTop: 5, textAlign: 'center' }}>
              ARIA answers from your vehicle's OEM data and service history only
            </div>
          </div>

        </div>
      )}
    </>
  );
}
