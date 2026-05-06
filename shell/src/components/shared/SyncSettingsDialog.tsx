'use client';

import { useState, useEffect, useCallback } from 'react';
import { X, Cloud, CloudOff, Loader2, Check, AlertCircle, RefreshCw } from 'lucide-react';
import { API_BASE } from '@/lib/api/config';
import { useT } from '@/lib/i18n';

interface SyncStatus {
  protocol_version: string;
  sync_enabled: boolean;
  pending_changes: number;
  last_sync: number | null;
}

export function SyncSettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useT();
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [serverUrl, setServerUrl] = useState('');
  const [serverToken, setServerToken] = useState('');

  const token = typeof window !== 'undefined' ? localStorage.getItem('aose_token') : null;

  const fetchStatus = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/sync/status`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        setStatus(await res.json());
        setError(null);
      }
    } catch (err: any) {
      setError(err.message);
    }
    setLoading(false);
  }, [token]);

  useEffect(() => {
    if (open) fetchStatus();
  }, [open, fetchStatus]);

  const handleConnect = async () => {
    if (!serverUrl.trim() || !serverToken.trim()) return;
    setConnecting(true);
    setError(null);

    try {
      const cleanUrl = serverUrl.trim().replace(/\/+$/, '');

      const healthRes = await fetch(`${cleanUrl}/health`);
      if (!healthRes.ok) throw new Error('Cannot reach server');
      const health = await healthRes.json();
      if (!health.ok) throw new Error('Server health check failed');

      const res = await fetch(`${API_BASE}/sync/connect`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          remote_url: cleanUrl,
          remote_token: serverToken.trim(),
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Connection failed');
      }

      await fetchStatus();
      setServerUrl('');
      setServerToken('');
    } catch (err: any) {
      setError(err.message);
    }
    setConnecting(false);
  };

  const handleDisconnect = async () => {
    try {
      await fetch(`${API_BASE}/sync/disconnect`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });
      await fetchStatus();
    } catch (err: any) {
      setError(err.message);
    }
  };

  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/30" onClick={onClose} />
      <div className="fixed z-50 top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-white dark:bg-card border border-black/10 dark:border-border rounded-xl shadow-xl w-[440px] max-h-[80vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 pt-5 pb-3">
          <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
            <Cloud className="h-5 w-5" />
            {t('settings.cloudSync')}
          </h2>
          <button onClick={onClose} className="p-1 hover:bg-black/5 rounded transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-5 pb-5 space-y-4">
          {/* Status */}
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-black/50">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading...
            </div>
          ) : status?.sync_enabled ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400">
                <Check className="h-4 w-4" />
                Connected
              </div>
              <div className="text-xs text-black/50 dark:text-white/50 space-y-1">
                <div>Pending changes: {status.pending_changes}</div>
                {status.last_sync && (
                  <div>Last sync: {new Date(status.last_sync).toLocaleString()}</div>
                )}
              </div>
              <button
                onClick={handleDisconnect}
                className="flex items-center gap-2 px-3 py-1.5 text-sm bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-md hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors"
              >
                <CloudOff className="h-4 w-4" />
                Disconnect
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-sm text-black/50 dark:text-white/50">
                <CloudOff className="h-4 w-4" />
                Not connected
              </div>

              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-black/60 dark:text-white/60 mb-1">
                    Server URL
                  </label>
                  <input
                    type="url"
                    value={serverUrl}
                    onChange={(e) => setServerUrl(e.target.value)}
                    placeholder="https://your-server.com/api/gateway"
                    className="w-full px-3 py-2 text-sm bg-black/[0.03] dark:bg-white/[0.05] border border-black/10 dark:border-white/10 rounded-md outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-black/60 dark:text-white/60 mb-1">
                    Admin Token
                  </label>
                  <input
                    type="password"
                    value={serverToken}
                    onChange={(e) => setServerToken(e.target.value)}
                    placeholder="Your server's admin token"
                    className="w-full px-3 py-2 text-sm bg-black/[0.03] dark:bg-white/[0.05] border border-black/10 dark:border-white/10 rounded-md outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>
                <button
                  onClick={handleConnect}
                  disabled={connecting || !serverUrl.trim() || !serverToken.trim()}
                  className="flex items-center gap-2 px-4 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {connecting ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Cloud className="h-4 w-4" />
                  )}
                  Connect
                </button>
              </div>
            </div>
          )}

          {error && (
            <div className="flex items-start gap-2 text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 px-3 py-2 rounded-md">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              {error}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
