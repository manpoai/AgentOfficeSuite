'use client';
import { useAuth } from '@/lib/auth';
import { AppShell } from '@/components/AppShell';
import { useEffect } from 'react';

export default function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  const { actor, loading } = useAuth();

  useEffect(() => {
    if (!loading && !actor) {
      window.location.href = '/login';
    }
  }, [loading, actor]);

  if (loading) {
    return (
      <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0f0f1a', color: '#aaa' }}>
        Loading...
      </div>
    );
  }

  if (!actor) return null;

  return <AppShell>{children}</AppShell>;
}
