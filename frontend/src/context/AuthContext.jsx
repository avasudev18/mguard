import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { authLogin, authSignup, authGetMe } from '../services/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser]       = useState(null);
  const [loading, setLoading] = useState(true); // true while verifying stored token on mount

  // Restore session from localStorage on app load.
  // Priority: impersonation token > regular user token.
  // When an admin is impersonating, the impersonation token is used for all
  // API calls (see api.js interceptor), so authGetMe() returns the impersonated
  // user's profile automatically — no special handling needed here.
  useEffect(() => {
    const impToken = localStorage.getItem('mg_impersonation_token');
    const token    = impToken || localStorage.getItem('mg_token');

    if (!token) { setLoading(false); return; }

    authGetMe()
      .then((res) => setUser(res.data))
      .catch(() => {
        // If the active token is invalid, clear only that token
        if (impToken) {
          localStorage.removeItem('mg_impersonation_token');
          localStorage.removeItem('mg_impersonation_meta');
        } else {
          localStorage.removeItem('mg_token');
        }
      })
      .finally(() => setLoading(false));
  }, []);

  const signup = useCallback(async ({ email, password, full_name }) => {
    const res = await authSignup({ email, password, full_name });
    localStorage.setItem('mg_token', res.data.access_token);
    setUser(res.data.user);
    return res.data;
  }, []);

  const login = useCallback(async ({ email, password }) => {
    const res = await authLogin({ email, password });
    localStorage.setItem('mg_token', res.data.access_token);
    setUser(res.data.user);
    return res.data;
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem('mg_token');
    localStorage.removeItem('mg_impersonation_token');
    localStorage.removeItem('mg_impersonation_meta');
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, signup, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
