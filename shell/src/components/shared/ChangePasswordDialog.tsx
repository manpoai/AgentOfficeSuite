'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { BottomSheet } from '@/components/shared/BottomSheet';
import { useIsMobile } from '@/lib/hooks/use-mobile';
import { useT } from '@/lib/i18n';
import * as gw from '@/lib/api/gateway';

interface ChangePasswordDialogProps {
  open: boolean;
  onClose: () => void;
}

function PasswordForm({ onClose }: { onClose: () => void }) {
  const { t } = useT();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    if (next.length < 6) {
      setError(t('settings.passwordTooShort'));
      return;
    }
    if (next !== confirm) {
      setError(t('settings.passwordMismatch'));
      return;
    }

    setLoading(true);
    try {
      await gw.changePassword(current, next);
      toast.success(t('settings.passwordChanged'));
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '';
      if (msg.toLowerCase().includes('incorrect') || msg.toLowerCase().includes('wrong') || msg.toLowerCase().includes('invalid') || msg.toLowerCase().includes('unauthorized')) {
        setError(t('settings.wrongPassword'));
      } else {
        setError(msg || t('settings.passwordChanged'));
      }
    } finally {
      setLoading(false);
    }
  }

  const inputClass = 'w-full px-3 py-2 text-sm rounded-lg border border-input bg-background focus:outline-none focus:ring-2 focus:ring-ring';

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3 p-4">
      <div className="flex flex-col gap-1">
        <label className="text-xs text-muted-foreground">{t('settings.currentPassword')}</label>
        <input
          type="password"
          value={current}
          onChange={e => setCurrent(e.target.value)}
          className={inputClass}
          autoComplete="current-password"
          required
        />
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-xs text-muted-foreground">{t('settings.newPassword')}</label>
        <input
          type="password"
          value={next}
          onChange={e => setNext(e.target.value)}
          className={inputClass}
          autoComplete="new-password"
          required
        />
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-xs text-muted-foreground">{t('settings.confirmPassword')}</label>
        <input
          type="password"
          value={confirm}
          onChange={e => setConfirm(e.target.value)}
          className={inputClass}
          autoComplete="new-password"
          required
        />
      </div>
      {error && (
        <p className="text-xs text-destructive">{error}</p>
      )}
      <button
        type="submit"
        disabled={loading}
        className="mt-1 w-full py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
      >
        {loading ? '…' : t('settings.changePassword')}
      </button>
    </form>
  );
}

export function ChangePasswordDialog({ open, onClose }: ChangePasswordDialogProps) {
  const { t } = useT();
  const isMobile = useIsMobile();

  if (!open) return null;

  if (isMobile) {
    return (
      <BottomSheet open={open} onClose={onClose} title={t('settings.changePassword')}>
        <PasswordForm onClose={onClose} />
      </BottomSheet>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40" />
      <div
        className="relative z-10 bg-background rounded-xl shadow-xl w-full max-w-sm overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <h2 className="text-sm font-semibold">{t('settings.changePassword')}</h2>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground transition-colors text-lg leading-none"
          >
            ×
          </button>
        </div>
        <PasswordForm onClose={onClose} />
      </div>
    </div>
  );
}
