'use client';

import { useState, useEffect, useCallback } from 'react';
import { X, Monitor, Loader2, Unplug } from 'lucide-react';
import { gwAuthHeaders } from '@/lib/api/gateway';
import { API_BASE } from '@/lib/api/config';
import { useT } from '@/lib/i18n';

interface SyncToken {
  id: string;
  device_name: string;
  created_at: number;
  last_used_at: number | null;
  revoked_at: number | null;
}

export function ConnectionsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useT();
  const [tokens, setTokens] = useState<SyncToken[]>([]);
  const [loading, setLoading] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);

  const fetchTokens = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/auth/sync-tokens`, {
        headers: gwAuthHeaders(),
      });
      if (res.ok) {
        const data = await res.json();
        setTokens(data.tokens || []);
      }
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => {
    if (open) fetchTokens();
  }, [open, fetchTokens]);

  const handleRevoke = async (id: string) => {
    setRevoking(id);
    try {
      const res = await fetch(`${API_BASE}/auth/sync-tokens/${id}`, {
        method: 'DELETE',
        headers: gwAuthHeaders(),
      });
      if (res.ok) {
        await fetchTokens();
      }
    } catch {}
    setRevoking(null);
  };

  if (!open) return null;

  const activeTokens = tokens.filter(t => !t.revoked_at);
  const revokedTokens = tokens.filter(t => t.revoked_at);

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/30" onClick={onClose} />
      <div className="fixed z-50 top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-white dark:bg-card border border-black/10 dark:border-border rounded-xl shadow-xl w-[480px] max-h-[80vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 pt-5 pb-3">
          <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
            <Monitor className="h-5 w-5" />
            {t('settings.connections')}
          </h2>
          <button onClick={onClose} className="p-1 hover:bg-black/5 rounded transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-5 pb-5">
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-black/50 py-4">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading...
            </div>
          ) : activeTokens.length === 0 ? (
            <div className="text-sm text-black/40 dark:text-white/40 py-6 text-center">
              {t('connections.noDevices')}
            </div>
          ) : (
            <div className="space-y-2">
              {activeTokens.map((tk) => (
                <div
                  key={tk.id}
                  className="flex items-center justify-between p-3 rounded-lg border border-black/[0.06] dark:border-white/[0.06] bg-black/[0.02] dark:bg-white/[0.02]"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <Monitor className="h-4 w-4 text-sidebar-primary shrink-0" />
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-foreground truncate">{tk.device_name}</div>
                      <div className="text-xs text-black/40 dark:text-white/40">
                        {t('connections.connected')} {new Date(tk.created_at).toLocaleDateString()}
                        {tk.last_used_at && (
                          <> · {t('connections.lastActive')} {new Date(tk.last_used_at).toLocaleDateString()}</>
                        )}
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={() => handleRevoke(tk.id)}
                    disabled={revoking === tk.id}
                    className="flex items-center gap-1.5 px-2.5 py-1 text-xs text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-md transition-colors shrink-0 ml-3"
                  >
                    {revoking === tk.id ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Unplug className="h-3 w-3" />
                    )}
                    {t('connections.disconnect')}
                  </button>
                </div>
              ))}
            </div>
          )}

          {revokedTokens.length > 0 && (
            <div className="mt-4 pt-3 border-t border-black/[0.06] dark:border-white/[0.06]">
              <div className="text-xs text-black/30 dark:text-white/30 mb-2">{t('connections.revoked')}</div>
              {revokedTokens.map((tk) => (
                <div key={tk.id} className="flex items-center gap-3 py-1.5 opacity-50">
                  <Monitor className="h-3.5 w-3.5 text-black/30 dark:text-white/30 shrink-0" />
                  <span className="text-xs text-black/40 dark:text-white/40 line-through truncate">{tk.device_name}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
