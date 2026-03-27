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

// ── Option C: Gradient Command Header ────────────────────────────────────────
function Header() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const isAuth = location.pathname === '/login' || location.pathname === '/signup';
  if (isAuth) return null;

  const handleLogout = () => { logout(); navigate('/login'); };

  return (
    <header style={{
      background: 'linear-gradient(135deg, #1E3A8A 0%, #1D4ED8 55%, #2563EB 100%)',
      position: 'sticky', top: 0, zIndex: 50,
      boxShadow: '0 4px 20px rgba(29,78,216,0.4)',
    }}>
      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '0 40px', height: 64, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>

        {/* Logo + Brand */}
        <Link to="/" style={{ display: 'flex', alignItems: 'center', gap: 12, textDecoration: 'none' }}>
          <div style={{
            width: 42, height: 42,
            background: 'rgba(255,255,255,0.15)',
            border: '1.5px solid rgba(255,255,255,0.35)',
            borderRadius: 11,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            backdropFilter: 'blur(8px)',
            flexShrink: 0,
          }}>
            <img src={logo} alt="MG" style={{ height: 28, width: 28, objectFit: 'contain' }} />
          </div>
          <span style={{ fontFamily: 'DM Sans, sans-serif', fontWeight: 800, fontSize: 18, color: '#fff', letterSpacing: '-0.02em' }}>
            MaintenanceGuard
          </span>
        </Link>

        {/* Nav */}
        <nav style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          {user ? (
            <>
              <Link to="/" style={{
                padding: '7px 16px', borderRadius: 8, fontSize: 13, fontWeight: 500,
                color: 'rgba(255,255,255,0.85)', textDecoration: 'none',
                background: 'rgba(255,255,255,0.12)',
              }}>
                Dashboard
              </Link>
              <div style={{ width: 1, height: 20, background: 'rgba(255,255,255,0.2)', margin: '0 12px' }} />
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{
                  width: 34, height: 34, borderRadius: '50%',
                  background: 'rgba(255,255,255,0.2)',
                  border: '2px solid rgba(255,255,255,0.4)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 13, fontWeight: 700, color: '#fff',
                }}>
                  {(user.full_name || user.email)[0].toUpperCase()}
                </div>
                <span style={{ fontSize: 13, fontWeight: 500, color: 'rgba(255,255,255,0.9)' }}>
                  {user.full_name || user.email}
                </span>
              </div>
              <button onClick={handleLogout} style={{
                marginLeft: 8,
                padding: '7px 16px', borderRadius: 8,
                border: '1.5px solid rgba(255,255,255,0.35)',
                background: 'transparent',
                fontSize: 13, fontWeight: 600, color: '#fff',
                cursor: 'pointer', fontFamily: 'DM Sans, sans-serif',
                transition: 'background 0.15s',
              }}
              onMouseEnter={e => e.target.style.background = 'rgba(255,255,255,0.12)'}
              onMouseLeave={e => e.target.style.background = 'transparent'}
              >
                Sign Out
              </button>
            </>
          ) : (
            <>
              <Link to="/login" style={{ padding: '7px 16px', borderRadius: 8, fontSize: 13, fontWeight: 500, color: 'rgba(255,255,255,0.75)', textDecoration: 'none' }}>
                Sign In
              </Link>
              <Link to="/signup" style={{
                padding: '8px 18px', borderRadius: 8,
                background: 'rgba(255,255,255,0.18)',
                border: '1.5px solid rgba(255,255,255,0.4)',
                color: '#fff', fontSize: 13, fontWeight: 700, textDecoration: 'none',
                backdropFilter: 'blur(4px)',
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

// ── Option C: Footer ──────────────────────────────────────────────────────────
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
