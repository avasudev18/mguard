/**
 * frontend/src/admin/main-admin.jsx
 * Entry point for the admin console (loaded by index-admin.html).
 * Completely separate React root from the user-facing app.
 */

import React from 'react'
import ReactDOM from 'react-dom/client'
import AdminApp from './AdminApp'

ReactDOM.createRoot(document.getElementById('admin-root')).render(
  <React.StrictMode>
    <AdminApp />
  </React.StrictMode>
)
