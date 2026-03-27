import { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import logo from '../assets/logo.png';

function parseApiError(err) {
  const status = err?.response?.status;
  const detail = err?.response?.data?.detail;
  if (!err?.response) return 'Unable to reach the server. Please check your connection and try again.';
  if (Array.isArray(detail)) return detail.map((d) => d.msg ?? 'Invalid value').join(' · ');
  if (typeof detail === 'string') return detail;
  if (status === 401) return 'Incorrect email or password. Please try again.';
  if (status === 403) return 'This account has been disabled. Please contact support.';
  if (status === 500) return 'Server error. Please try again in a moment.';
  return 'Login failed. Please check your credentials and try again.';
}

const inp = (err) => ({
  width: '100%', padding: '10px 14px', paddingRight: 42,
  fontFamily: 'DM Sans, sans-serif',
  fontSize: 14, color: '#0F172A', background: err ? '#FFF1F2' : '#F8FAFC',
  border: `1.5px solid ${err ? '#FCA5A5' : '#E2E8F0'}`,
  borderRadius: 9, outline: 'none', boxSizing: 'border-box',
  transition: 'border-color 0.15s, box-shadow 0.15s',
});

// Eye icon — open (password visible)
function EyeOpen() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
      <circle cx="12" cy="12" r="3"/>
    </svg>
  );
}

// Eye icon — closed (password hidden)
function EyeOff() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
      <line x1="1" y1="1" x2="23" y2="23"/>
    </svg>
  );
}

export default function Login() {
  const { login }  = useAuth();
  const navigate   = useNavigate();
  const location   = useLocation();
  const from       = location.state?.from?.pathname || '/';

  const [form, setForm]         = useState({ email: '', password: '' });
  const [errors, setErrors]     = useState({});
  const [apiError, setApiError] = useState('');
  const [loading, setLoading]   = useState(false);
  const [showPw, setShowPw]     = useState(false);

  const handleChange = (e) => {
    setForm((p) => ({ ...p, [e.target.name]: e.target.value }));
    setErrors((p) => ({ ...p, [e.target.name]: '' }));
    setApiError('');
  };

  const validate = () => {
    const errs = {};
    if (!form.email.trim()) errs.email = 'Email is required.';
    if (!form.password)     errs.password = 'Password is required.';
    return errs;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length) { setErrors(errs); return; }
    setLoading(true); setApiError('');
    try {
      await login({ email: form.email, password: form.password });
      navigate(from, { replace: true });
    } catch (err) {
      setApiError(parseApiError(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', background: '#EEF2FF' }}>

      {/* Left panel */}
      <div style={{
        width: 420, flexShrink: 0,
        background: 'linear-gradient(160deg, #1E3A8A 0%, #1D4ED8 50%, #2563EB 100%)',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        padding: '48px 40px', position: 'relative', overflow: 'hidden',
      }}>
        <div style={{ position: 'absolute', left: -40, top: -40, width: 200, height: 200, background: 'rgba(255,255,255,0.05)', borderRadius: '50%' }} />
        <div style={{ position: 'absolute', right: -20, bottom: -60, width: 240, height: 240, background: 'rgba(255,255,255,0.04)', borderRadius: '50%' }} />
        <div style={{ position: 'relative', textAlign: 'center' }}>
          <div style={{
            width: 72, height: 72,
            background: 'rgba(255,255,255,0.15)',
            border: '2px solid rgba(255,255,255,0.3)',
            borderRadius: 18, display: 'flex', alignItems: 'center', justifyContent: 'center',
            margin: '0 auto 20px', backdropFilter: 'blur(4px)',
          }}>
            <img src={logo} alt="MG" style={{ height: 46, width: 46, objectFit: 'contain' }} />
          </div>
          <h1 style={{ fontFamily: 'DM Sans, sans-serif', fontWeight: 800, fontSize: 22, color: '#fff', margin: '0 0 10px', letterSpacing: '-0.02em' }}>
            MaintenanceGuard
          </h1>
          <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.65)', lineHeight: 1.7, maxWidth: 260 }}>
            Protect your vehicle and your wallet with AI-powered maintenance intelligence.
          </p>
          <div style={{ marginTop: 36, display: 'flex', flexDirection: 'column', gap: 12 }}>
            {[
              { icon: '📄', text: 'Invoice OCR & AI analysis' },
              { icon: '🚨', text: 'Upsell detection & alerts' },
              { icon: '🛡️', text: 'Dispute resolution tools' },
            ].map(f => (
              <div key={f.text} style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'rgba(255,255,255,0.08)', borderRadius: 9, padding: '10px 14px' }}>
                <span style={{ fontSize: 16 }}>{f.icon}</span>
                <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.82)', fontWeight: 500 }}>{f.text}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Right panel — form */}
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px 48px' }}>
        <div style={{ width: '100%', maxWidth: 400 }}>
          <h2 style={{ fontFamily: 'DM Sans, sans-serif', fontSize: 26, fontWeight: 800, color: '#0F172A', margin: '0 0 6px', letterSpacing: '-0.02em' }}>
            Welcome back
          </h2>
          <p style={{ fontSize: 14, color: '#64748B', margin: '0 0 32px' }}>Sign in to your account to continue.</p>

          {location.state?.from && !apiError && (
            <div style={{ background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 9, padding: '10px 14px', fontSize: 13, color: '#92400E', marginBottom: 20, display: 'flex', gap: 8 }}>
              🔒 Please sign in to continue.
            </div>
          )}

          {apiError && (
            <div style={{ background: '#FFF1F2', border: '1px solid #FECDD3', borderRadius: 9, padding: '10px 14px', fontSize: 13, color: '#BE123C', marginBottom: 20, display: 'flex', gap: 8, alignItems: 'flex-start' }}>
              <span style={{ marginTop: 1 }}>⚠️</span> {apiError}
            </div>
          )}

          <form onSubmit={handleSubmit} noValidate style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>

            {/* Email */}
            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 6 }}>
                Email Address <span style={{ color: '#EF4444' }}>*</span>
              </label>
              <input type="email" name="email" value={form.email} onChange={handleChange}
                placeholder="you@example.com" autoComplete="email"
                style={inp(errors.email)}
                onFocus={e => { if (!errors.email) { e.target.style.borderColor = '#3B82F6'; e.target.style.boxShadow = '0 0 0 3px rgba(59,130,246,0.12)'; } }}
                onBlur={e => { if (!errors.email) { e.target.style.borderColor = '#E2E8F0'; e.target.style.boxShadow = 'none'; } }}
              />
              {errors.email && <p style={{ fontSize: 12, color: '#DC2626', margin: '4px 0 0', fontWeight: 500 }}>⚠ {errors.email}</p>}
            </div>

            {/* Password with show/hide toggle */}
            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 6 }}>
                Password <span style={{ color: '#EF4444' }}>*</span>
              </label>
              <div style={{ position: 'relative' }}>
                <input
                  type={showPw ? 'text' : 'password'}
                  name="password" value={form.password} onChange={handleChange}
                  placeholder="Your password" autoComplete="current-password"
                  style={inp(errors.password)}
                  onFocus={e => { if (!errors.password) { e.target.style.borderColor = '#3B82F6'; e.target.style.boxShadow = '0 0 0 3px rgba(59,130,246,0.12)'; } }}
                  onBlur={e => { if (!errors.password) { e.target.style.borderColor = '#E2E8F0'; e.target.style.boxShadow = 'none'; } }}
                />
                <button
                  type="button"
                  onClick={() => setShowPw(v => !v)}
                  style={{
                    position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)',
                    background: 'none', border: 'none', cursor: 'pointer', padding: 0,
                    color: '#94A3B8', display: 'flex', alignItems: 'center',
                  }}
                  tabIndex={-1}
                  aria-label={showPw ? 'Hide password' : 'Show password'}
                >
                  {showPw ? <EyeOff /> : <EyeOpen />}
                </button>
              </div>
              {errors.password && <p style={{ fontSize: 12, color: '#DC2626', margin: '4px 0 0', fontWeight: 500 }}>⚠ {errors.password}</p>}
            </div>

            <button type="submit" disabled={loading} style={{
              width: '100%',
              background: loading ? '#93C5FD' : 'linear-gradient(135deg, #1E3A8A, #2563EB)',
              color: '#fff', border: 'none', borderRadius: 10,
              padding: '13px', fontSize: 14, fontWeight: 700, cursor: loading ? 'default' : 'pointer',
              fontFamily: 'DM Sans, sans-serif',
              boxShadow: loading ? 'none' : '0 4px 14px rgba(29,78,216,0.35)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              transition: 'opacity 0.15s',
            }}>
              {loading ? (
                <>
                  <svg style={{ animation: 'spin 0.8s linear infinite', width: 16, height: 16 }} viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="10" stroke="rgba(255,255,255,0.3)" strokeWidth="3"/>
                    <path d="M12 2a10 10 0 0 1 10 10" stroke="#fff" strokeWidth="3" strokeLinecap="round"/>
                  </svg>
                  Signing in…
                </>
              ) : 'Sign In'}
            </button>
          </form>

          <p style={{ textAlign: 'center', fontSize: 13, color: '#64748B', marginTop: 24 }}>
            Don't have an account?{' '}
            <Link to="/signup" style={{ color: '#1D4ED8', fontWeight: 700, textDecoration: 'none' }}>Create one</Link>
          </p>
        </div>
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
