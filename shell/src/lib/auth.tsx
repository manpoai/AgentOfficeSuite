'use client';
import { createContext, useContext, useState, useEffect, useCallback } from 'react';

export interface Actor {
  id: string;
  type: 'human' | 'agent';
  username: string;
  display_name: string;
  role: string;
  avatar_url?: string;
}

interface AuthContextType {
  actor: Actor | null;
  token: string | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
  refreshActor: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  actor: null, token: null, loading: true,
  login: async () => {}, logout: () => {}, refreshActor: async () => {},
});

export function useAuth() { return useContext(AuthContext); }

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [actor, setActor] = useState<Actor | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // On mount, check for stored token
  useEffect(() => {
    const stored = localStorage.getItem('aose_token');
    if (stored) {
      setToken(stored);
      // Verify token
      fetch('/api/gateway/auth/me', {
        headers: { Authorization: `Bearer ${stored}` },
      }).then(res => {
        if (res.ok) return res.json();
        throw new Error('Invalid token');
      }).then(data => {
        setActor(data);
        setLoading(false);
      }).catch(() => {
        localStorage.removeItem('aose_token');
        setToken(null);
        setLoading(false);
      });
    } else {
      setLoading(false);
    }
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const res = await fetch('/api/gateway/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Login failed');
    }
    const data = await res.json();
    localStorage.setItem('aose_token', data.token);
    setToken(data.token);
    setActor(data.actor);
  }, []);

  const refreshActor = useCallback(async () => {
    const stored = localStorage.getItem('aose_token');
    if (!stored) return;
    try {
      const res = await fetch('/api/gateway/auth/me', {
        headers: { Authorization: `Bearer ${stored}` },
      });
      if (res.ok) {
        const data = await res.json();
        setActor(data);
      }
    } catch {}
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem('aose_token');
    setToken(null);
    setActor(null);
  }, []);

  return (
    <AuthContext.Provider value={{ actor, token, loading, login, logout, refreshActor }}>
      {children}
    </AuthContext.Provider>
  );
}
