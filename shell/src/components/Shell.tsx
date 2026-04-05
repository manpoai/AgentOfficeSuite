'use client';
import { useState, useEffect, useRef } from 'react';
import { useT } from '@/lib/i18n';

type Module = 'im' | 'tasks' | 'docs' | 'data';

interface ServiceTokens {
  mm?: { token: string; userId: string } | null;
  noco?: { token: string } | null;
}

const MODULE_LIST: { id: Module; labelKey: string; fallback: string; icon: string }[] = [
  { id: 'im',    labelKey: '',              fallback: 'IM',    icon: '💬' },
  { id: 'tasks', labelKey: 'shell.tasks',   fallback: 'Tasks', icon: '✅' },
  { id: 'docs',  labelKey: 'shell.docs',    fallback: 'Docs',  icon: '📄' },
  { id: 'data',  labelKey: 'shell.database', fallback: 'DB',   icon: '🗄��' },
];

function buildUrl(mod: Module, tokens: ServiceTokens): string {
  // All services use sso-inject — sets auth cookies server-side then redirects to /
  if (mod === 'im') return 'https://mm.gridtabs.com/sso-inject';
  if (mod === 'docs') return 'https://asuite.gridtabs.com/content';
  if (mod === 'tasks') return 'https://plane.gridtabs.com/sso-inject';
  if (mod === 'data') return 'https://noco.gridtabs.com/sso-inject';
  return 'https://noco.gridtabs.com';
}

export function Shell() {
  const { t } = useT();
  const [active, setActive] = useState<Module>('im');
  const [urls, setUrls] = useState<Record<Module, string> | null>(null);
  const fetchedRef = useRef(false);

  useEffect(() => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;
    const token = localStorage.getItem('asuite_token');
    fetch('/api/auth/service-tokens', {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then(r => r.json())
      .then((data: ServiceTokens) => {
        setUrls({
          im:    buildUrl('im', data),
          tasks: buildUrl('tasks', data),
          docs:  buildUrl('docs', data),
          data:  buildUrl('data', data),
        });
      })
      .catch(() => {
        // Fallback: load without SSO
        setUrls({
          im:    'https://mm.gridtabs.com',
          tasks: 'https://plane.gridtabs.com',
          docs:  'https://asuite.gridtabs.com/content',
          data:  'https://noco.gridtabs.com',
        });
      });
  }, []);

  return (
    <div style={{ display: 'flex', height: '100vh', width: '100vw', background: '#0f0f1a' }}>
      {/* Sidebar */}
      <nav style={{
        width: 64,
        background: '#16213e',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        paddingTop: 16,
        gap: 8,
        borderRight: '1px solid #1e2a45',
        flexShrink: 0,
      }}>
        {MODULE_LIST.map(m => {
          const label = m.labelKey ? t(m.labelKey) : m.fallback;
          return (
          <button
            key={m.id}
            onClick={() => setActive(m.id)}
            title={label}
            style={{
              width: 48,
              height: 48,
              borderRadius: 12,
              border: 'none',
              background: active === m.id ? '#0f3460' : 'transparent',
              color: active === m.id ? '#e94560' : '#7a8ba0',
              cursor: 'pointer',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 20,
              transition: 'background 0.15s',
            }}
          >
            <span>{m.icon}</span>
            <span style={{ fontSize: 9, marginTop: 2, letterSpacing: 0.5 }}>{label}</span>
          </button>
          );
        })}
        <div style={{ flex: 1 }} />
        <button
          title={t('shell.settings')}
          style={{
            width: 48, height: 48, borderRadius: 12, border: 'none',
            background: 'transparent', color: '#7a8ba0', cursor: 'pointer',
            fontSize: 20, marginBottom: 16,
          }}
        >
          ⚙️
        </button>
      </nav>

      {/* Main content — iframes, only rendered after URLs are ready */}
      <main style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        {!urls ? (
          <div style={{
            position: 'absolute', inset: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#7a8ba0', fontSize: 14,
          }}>
            {t('shell.initializing')}
          </div>
        ) : (
          MODULE_LIST.map(m => (
            <iframe
              key={m.id}
              src={urls[m.id]}
              style={{
                position: 'absolute',
                inset: 0,
                width: '100%',
                height: '100%',
                border: 'none',
                display: active === m.id ? 'block' : 'none',
              }}
              allow="fullscreen"
            />
          ))
        )}
      </main>
    </div>
  );
}
