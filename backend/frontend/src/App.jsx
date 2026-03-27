import { BrowserRouter as Router, Routes, Route, Link } from 'react-router-dom';
import Dashboard from './pages/Dashboard';
import VehicleDetail from './pages/VehicleDetail';
import UploadInvoice from './pages/UploadInvoice';
import Recommendations from './pages/Recommendations';

function App() {
  return (
    <Router>
      <div className="min-h-screen bg-gray-50">
        {/* Header */}
        <header className="bg-blue-600 text-white shadow-lg">
          <div className="container mx-auto px-4 py-4">
            <div className="flex items-center justify-between">
              <Link to="/" className="flex items-center space-x-2">
                <svg className="w-8 h-8" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M8 16.5a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0zM15 16.5a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0z"/>
                  <path d="M3 4a1 1 0 00-1 1v10a1 1 0 001 1h1.05a2.5 2.5 0 014.9 0H10a1 1 0 001-1V5a1 1 0 00-1-1H3zM14 7a1 1 0 00-1 1v6.05A2.5 2.5 0 0115.95 16H17a1 1 0 001-1v-5a1 1 0 00-.293-.707l-2-2A1 1 0 0015 7h-1z"/>
                </svg>
                <span className="text-2xl font-bold">MaintenanceGuard</span>
              </Link>
              <nav className="hidden md:flex space-x-6">
                <Link to="/" className="hover:text-blue-200 transition">Dashboard</Link>
                <a href="#features" className="hover:text-blue-200 transition">Features</a>
                <a href="#about" className="hover:text-blue-200 transition">About</a>
              </nav>
            </div>
          </div>
        </header>

        {/* Main Content */}
        <main>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/vehicle/:id" element={<VehicleDetail />} />
            <Route path="/vehicle/:id/upload" element={<UploadInvoice />} />
            <Route path="/vehicle/:id/recommendations" element={<Recommendations />} />
          </Routes>
        </main>

        {/* Footer */}
        <footer className="bg-gray-800 text-white mt-12">
          <div className="container mx-auto px-4 py-8">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
              <div>
                <h3 className="font-bold text-lg mb-4">MaintenanceGuard</h3>
                <p className="text-gray-400">
                  Evidence-based vehicle maintenance recommendations with AI-powered upsell detection.
                </p>
              </div>
              <div>
                <h3 className="font-bold text-lg mb-4">Features</h3>
                <ul className="space-y-2 text-gray-400">
                  <li>📄 Invoice OCR & Parsing</li>
                  <li>🤖 AI-Powered Recommendations</li>
                  <li>🚨 Upsell Detection</li>
                  <li>📊 Maintenance Timeline</li>
                </ul>
              </div>
              <div>
                <h3 className="font-bold text-lg mb-4">Tech Stack</h3>
                <ul className="space-y-2 text-gray-400">
                  <li>React + Tailwind CSS</li>
                  <li>Python FastAPI</li>
                  <li>PostgreSQL + pgvector</li>
                  <li>Anthropic Claude API</li>
                </ul>
              </div>
            </div>
            <div className="border-t border-gray-700 mt-8 pt-8 text-center text-gray-400">
              <p>&copy; 2024 MaintenanceGuard MVP. Built with ❤️ for smarter vehicle maintenance.</p>
            </div>
          </div>
        </footer>
      </div>
    </Router>
  );
}

export default App;
