import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import logo from '../assets/logo.png';

function parseApiError(err) {
  const status = err?.response?.status;
  const detail = err?.response?.data?.detail;
  if (!err?.response) return 'Unable to reach the server. Please check your connection and try again.';
  if (Array.isArray(detail)) {
    const messages = detail.map((d) => {
      const field = d.loc?.[d.loc.length - 1] ?? '';
      const msg = d.msg ?? 'Invalid value';
      const fieldLabel = { full_name: 'Full Name', email: 'Email', password: 'Password' }[field] || field;
      return fieldLabel ? `${fieldLabel}: ${msg}` : msg;
    });
    return messages.join(' · ');
  }
  if (typeof detail === 'string') return detail;
  if (status === 409) return 'An account with this email already exists. Try signing in instead.';
  if (status === 422) return 'Please check your details — one or more fields are invalid.';
  if (status === 500) return 'Server error. Please try again in a moment.';
  return 'Signup failed. Please check your details and try again.';
}

const inp = (err) => ({
  width: '100%', padding: '10px 14px', paddingRight: 42,
  fontFamily: 'DM Sans, sans-serif',
  fontSize: 14, color: '#0F172A', background: err ? '#FFF1F2' : '#F8FAFC',
  border: `1.5px solid ${err ? '#FCA5A5' : '#E2E8F0'}`,
  borderRadius: 9, outline: 'none', boxSizing: 'border-box',
  transition: 'border-color 0.15s, box-shadow 0.15s',
});

function EyeOpen() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
      <circle cx="12" cy="12" r="3"/>
    </svg>
  );
}

function EyeOff() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
      <line x1="1" y1="1" x2="23" y2="23"/>
    </svg>
  );
}

// Field defined OUTSIDE Signup to prevent remount on every keystroke (focus loss bug)
function Field({ name, label, type = 'text', placeholder, form, errors, onChange, showToggle, showPw, onToggle }) {
  const isPassword = type === 'password';
  return (
    <div>
      <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 6 }}>
        {label} <span style={{ color: '#EF4444' }}>*</span>
      </label>
      <div style={{ position: 'relative' }}>
        <input
          type={isPassword && showToggle ? (showPw ? 'text' : 'password') : type}
          name={name} value={form[name]} onChange={onChange}
          placeholder={placeholder} autoComplete={name}
          style={inp(errors[name])}
          onFocus={e => { if (!errors[name]) { e.target.style.borderColor = '#3B82F6'; e.target.style.boxShadow = '0 0 0 3px rgba(59,130,246,0.12)'; } }}
          onBlur={e => { if (!errors[name]) { e.target.style.borderColor = '#E2E8F0'; e.target.style.boxShadow = 'none'; } }}
        />
        {isPassword && showToggle && (
          <button
            type="button"
            onClick={onToggle}
            tabIndex={-1}
            aria-label={showPw ? 'Hide password' : 'Show password'}
            style={{
              position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)',
              background: 'none', border: 'none', cursor: 'pointer', padding: 0,
              color: '#94A3B8', display: 'flex', alignItems: 'center',
            }}
          >
            {showPw ? <EyeOff /> : <EyeOpen />}
          </button>
        )}
      </div>
      {errors[name] && <p style={{ fontSize: 12, color: '#DC2626', margin: '4px 0 0', fontWeight: 500 }}>⚠ {errors[name]}</p>}
    </div>
  );
}

export default function Signup() {
  const { signup } = useAuth();
  const navigate   = useNavigate();

  const [form, setForm]         = useState({ full_name: '', email: '', password: '', confirm: '' });
  const [errors, setErrors]     = useState({});
  const [apiError, setApiError] = useState('');
  const [loading, setLoading]   = useState(false);
  const [showPw, setShowPw]     = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const handleChange = (e) => {
    setForm((p) => ({ ...p, [e.target.name]: e.target.value }));
    setErrors((p) => ({ ...p, [e.target.name]: '' }));
    setApiError('');
  };

  const validate = () => {
    const errs = {};
    if (!form.full_name.trim())                                   errs.full_name = 'Full name is required.';
    if (!form.email.trim())                                       errs.email     = 'Email is required.';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email))    errs.email     = 'Enter a valid email address.';
    if (!form.password)                                           errs.password  = 'Password is required.';
    else if (form.password.length < 8)                            errs.password  = 'Must be at least 8 characters.';
    else if (!/\d/.test(form.password))                           errs.password  = 'Must contain at least one number.';
    if (!form.confirm)                                            errs.confirm   = 'Please confirm your password.';
    else if (form.password !== form.confirm)                      errs.confirm   = 'Passwords do not match.';
    return errs;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length) { setErrors(errs); return; }
    setLoading(true); setApiError('');
    try {
      await signup({ email: form.email, password: form.password, full_name: form.full_name });
      navigate('/');
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
        width: 380, flexShrink: 0,
        background: 'linear-gradient(160deg, #1E3A8A 0%, #1D4ED8 50%, #2563EB 100%)',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        padding: '48px 36px', position: 'relative', overflow: 'hidden',
      }}>
        <div style={{ position: 'absolute', left: -40, top: -40, width: 200, height: 200, background: 'rgba(255,255,255,0.05)', borderRadius: '50%' }} />
        <div style={{ position: 'absolute', right: -20, bottom: -60, width: 240, height: 240, background: 'rgba(255,255,255,0.04)', borderRadius: '50%' }} />
        <div style={{ position: 'relative', textAlign: 'center' }}>
          <div style={{
            width: 68, height: 68, background: 'rgba(255,255,255,0.15)',
            border: '2px solid rgba(255,255,255,0.3)',
            borderRadius: 17, display: 'flex', alignItems: 'center', justifyContent: 'center',
            margin: '0 auto 18px', backdropFilter: 'blur(4px)',
          }}>
            <img src={logo} alt="MG" style={{ height: 44, width: 44, objectFit: 'contain' }} />
          </div>
          <h1 style={{ fontFamily: 'DM Sans, sans-serif', fontWeight: 800, fontSize: 20, color: '#fff', margin: '0 0 10px', letterSpacing: '-0.02em' }}>
            MaintenanceGuard
          </h1>
          <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.65)', lineHeight: 1.7, maxWidth: 240 }}>
            Join thousands of car owners protecting themselves from unnecessary service upsells.
          </p>
          <div style={{ marginTop: 28, textAlign: 'left' }}>
            {[
              'Free to use — no credit card',
              'AI-powered invoice analysis',
              'Real-time upsell detection',
              'Dispute resolution toolkit',
            ].map(f => (
              <div key={f} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                <div style={{ width: 18, height: 18, borderRadius: '50%', background: 'rgba(255,255,255,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
                    <path d="M2 6l3 3 5-5" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </div>
                <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.8)', fontWeight: 500 }}>{f}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Right panel — form */}
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px 48px', overflowY: 'auto' }}>
        <div style={{ width: '100%', maxWidth: 400 }}>
          <h2 style={{ fontFamily: 'DM Sans, sans-serif', fontSize: 24, fontWeight: 800, color: '#0F172A', margin: '0 0 6px', letterSpacing: '-0.02em' }}>
            Create your account
          </h2>
          <p style={{ fontSize: 14, color: '#64748B', margin: '0 0 28px' }}>Start protecting your vehicle today.</p>

          {apiError && (
            <div style={{ background: '#FFF1F2', border: '1px solid #FECDD3', borderRadius: 9, padding: '10px 14px', fontSize: 13, color: '#BE123C', marginBottom: 20, display: 'flex', gap: 8, alignItems: 'flex-start' }}>
              <span style={{ marginTop: 1 }}>⚠️</span> {apiError}
            </div>
          )}

          <form onSubmit={handleSubmit} noValidate style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <Field name="full_name" label="Full Name" placeholder="Jane Doe"
              form={form} errors={errors} onChange={handleChange} />
            <Field name="email" label="Email Address" type="email" placeholder="you@example.com"
              form={form} errors={errors} onChange={handleChange} />
            <Field name="password" label="Password" type="password"
              placeholder="Min 8 chars, at least 1 number"
              form={form} errors={errors} onChange={handleChange}
              showToggle showPw={showPw} onToggle={() => setShowPw(v => !v)} />
            <Field name="confirm" label="Confirm Password" type="password"
              placeholder="Repeat your password"
              form={form} errors={errors} onChange={handleChange}
              showToggle showPw={showConfirm} onToggle={() => setShowConfirm(v => !v)} />

            <button type="submit" disabled={loading} style={{
              width: '100%', marginTop: 4,
              background: loading ? '#93C5FD' : 'linear-gradient(135deg, #1E3A8A, #2563EB)',
              color: '#fff', border: 'none', borderRadius: 10,
              padding: '13px', fontSize: 14, fontWeight: 700, cursor: loading ? 'default' : 'pointer',
              fontFamily: 'DM Sans, sans-serif',
              boxShadow: loading ? 'none' : '0 4px 14px rgba(29,78,216,0.35)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            }}>
              {loading ? (
                <>
                  <svg style={{ animation: 'spin 0.8s linear infinite', width: 16, height: 16 }} viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="10" stroke="rgba(255,255,255,0.3)" strokeWidth="3"/>
                    <path d="M12 2a10 10 0 0 1 10 10" stroke="#fff" strokeWidth="3" strokeLinecap="round"/>
                  </svg>
                  Creating account…
                </>
              ) : 'Create Account'}
            </button>
          </form>

          <p style={{ textAlign: 'center', fontSize: 13, color: '#64748B', marginTop: 22 }}>
            Already have an account?{' '}
            <Link to="/login" style={{ color: '#1D4ED8', fontWeight: 700, textDecoration: 'none' }}>Sign in</Link>
          </p>
        </div>
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
