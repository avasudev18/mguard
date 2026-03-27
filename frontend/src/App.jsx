import { BrowserRouter as Router, Routes, Route, Link, useNavigate, useLocation } from 'react-router-dom';
import logo from './assets/logo.png';
import Dashboard from './pages/Dashboard';
import VehicleDetail from './pages/VehicleDetail';
import UploadInvoice from './pages/UploadInvoice';
import Recommendations from './pages/Recommendations';
import DisputeResolution from './pages/DisputeResolution';
import Login from './pages/Login';
import Signup from './pages/Signup';
import ProtectedRoute from './components/ProtectedRoute';
import { AuthProvider, useAuth } from './context/AuthContext';
import ImpersonationBanner from './admin/ImpersonationBanner';

// ── Redesigned Header — white frosted glass nav ───────────────────────────────
function Header() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const isAuth = location.pathname === '/login' || location.pathname === '/signup';
  if (isAuth) return null;

  const handleLogout = () => { logout(); navigate('/login'); };

  // Personalised time-of-day greeting
  const hour = new Date().getHours();
  const timeGreeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const displayName = user ? (user.full_name || user.email).split(' ')[0] : '';

  return (
    <header style={{
      background: 'rgba(255,255,255,0.97)',
      backdropFilter: 'blur(12px)',
      borderBottom: '1px solid rgba(37,99,235,0.08)',
      position: 'sticky', top: 0, zIndex: 50,
    }}>
      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '0 40px', height: 56, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>

        {/* Logo + shortened brand */}
        <Link to="/" style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none' }}>
          <div style={{
            width: 34, height: 34,
            background: 'linear-gradient(135deg, #1E3A8A, #2563EB)',
            borderRadius: 9,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
          }}>
            <img src={logo} alt="MG" style={{ height: 22, width: 22, objectFit: 'contain' }} />
          </div>
          <span style={{ fontFamily: 'DM Sans, sans-serif', fontWeight: 800, fontSize: 16, color: '#0F172A', letterSpacing: '-0.02em' }}>
            Guard
          </span>
          <span style={{
            fontSize: 10, fontWeight: 700, letterSpacing: '0.05em',
            background: '#EFF6FF', color: '#2563EB',
            padding: '2px 8px', borderRadius: 99,
          }}>
            BETA
          </span>
        </Link>

        {/* Centre: personalised greeting when logged in */}
        {user && (
          <span style={{ fontSize: 13, color: '#64748B', fontWeight: 500 }}>
            {timeGreeting}, <strong style={{ color: '#0F172A', fontWeight: 700 }}>{displayName}</strong> 👋
          </span>
        )}

        {/* Nav */}
        <nav style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {user ? (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{
                  width: 30, height: 30, borderRadius: 8,
                  background: 'linear-gradient(135deg, #1E3A8A, #2563EB)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 12, fontWeight: 800, color: '#fff',
                }}>
                  {(user.full_name || user.email)[0].toUpperCase()}
                </div>
                <span style={{ fontSize: 13, fontWeight: 500, color: '#374151' }}>
                  {user.full_name || user.email}
                </span>
              </div>
              <button onClick={handleLogout} style={{
                marginLeft: 4,
                padding: '7px 16px', borderRadius: 8,
                border: '1px solid #E2E8F0',
                background: 'transparent',
                fontSize: 13, fontWeight: 600, color: '#374151',
                cursor: 'pointer', fontFamily: 'DM Sans, sans-serif',
                transition: 'background 0.15s',
              }}
              onMouseEnter={e => e.currentTarget.style.background = '#F8FAFC'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
              >
                Sign Out
              </button>
            </>
          ) : (
            <>
              <Link to="/login" style={{ padding: '7px 16px', borderRadius: 8, fontSize: 13, fontWeight: 500, color: '#475569', textDecoration: 'none' }}>
                Sign In
              </Link>
              <Link to="/signup" style={{
                padding: '8px 18px', borderRadius: 8,
                background: 'linear-gradient(135deg, #1E3A8A, #2563EB)',
                color: '#fff', fontSize: 13, fontWeight: 700, textDecoration: 'none',
                boxShadow: '0 2px 8px rgba(37,99,235,0.3)',
              }}>
                Get Started
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}

// ── Footer ────────────────────────────────────────────────────────────────────
function Footer() {
  const location = useLocation();
  const isAuth = location.pathname === '/login' || location.pathname === '/signup';
  if (isAuth) return null;

  return (
    <footer style={{ background: '#0F172A', color: '#94A3B8', marginTop: 64, borderTop: '1px solid #1E293B' }}>
      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '40px 40px 28px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr 1fr', gap: 48, marginBottom: 32 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
              <div style={{
                width: 34, height: 34,
                background: 'linear-gradient(135deg, #1E3A8A, #2563EB)',
                borderRadius: 9,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <img src={logo} alt="MG" style={{ height: 22, width: 22, objectFit: 'contain' }} />
              </div>
              <span style={{ fontWeight: 800, fontSize: 15, color: '#F1F5F9', letterSpacing: '-0.01em' }}>MaintenanceGuard</span>
            </div>
            <p style={{ fontSize: 13, lineHeight: 1.8, color: '#475569', maxWidth: 260 }}>
              Evidence-based vehicle maintenance with AI-powered upsell detection and dispute resolution.
            </p>
          </div>
          <div>
            <p style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#334155', marginBottom: 14 }}>Features</p>
            {['Invoice OCR & Parsing', 'AI Recommendations', 'Upsell Detection', 'Dispute Resolution'].map(f => (
              <p key={f} style={{ fontSize: 13, color: '#475569', marginBottom: 8, lineHeight: 1.4 }}>{f}</p>
            ))}
          </div>
          <div>
            <p style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#334155', marginBottom: 14 }}>Built With</p>
            {['React + Tailwind CSS', 'Python FastAPI', 'PostgreSQL + pgvector', 'Anthropic Claude API'].map(t => (
              <p key={t} style={{ fontSize: 13, color: '#475569', marginBottom: 8, lineHeight: 1.4 }}>{t}</p>
            ))}
          </div>
        </div>
        <div style={{ borderTop: '1px solid #1E293B', paddingTop: 20, textAlign: 'center', fontSize: 12, color: '#334155' }}>
          © {new Date().getFullYear()} MaintenanceGuard — Empowering vehicle owners with data-driven maintenance intelligence.
        </div>
      </div>
    </footer>
  );
}

function App() {
  return (
    <Router>
      <AuthProvider>
        <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: '#EEF2FF' }}>
          {/* Phase 2: Impersonation banner — only visible when mg_impersonation_token is active */}
          <ImpersonationBanner />
          <Header />
          <main style={{ flex: 1 }}>
            <Routes>
              <Route path="/login"  element={<Login />} />
              <Route path="/signup" element={<Signup />} />
              <Route path="/" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
              <Route path="/vehicle/:id" element={<ProtectedRoute><VehicleDetail /></ProtectedRoute>} />
              <Route path="/vehicle/:id/upload" element={<ProtectedRoute><UploadInvoice /></ProtectedRoute>} />
              <Route path="/vehicle/:id/recommendations" element={<ProtectedRoute><Recommendations /></ProtectedRoute>} />
              <Route path="/invoice/:invoiceId/dispute" element={<ProtectedRoute><DisputeResolution /></ProtectedRoute>} />
            </Routes>
          </main>
          <Footer />
        </div>
      </AuthProvider>
    </Router>
  );
}

export default App;
