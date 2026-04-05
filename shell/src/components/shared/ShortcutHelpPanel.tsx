'use client';

import { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { KeyboardManager } from '@/lib/keyboard';
import { useT } from '@/lib/i18n';

function formatKey(shortcut: { key: string; modifiers?: { meta?: boolean; ctrl?: boolean; shift?: boolean; alt?: boolean } }): string {
  const parts: string[] = [];
  const mod = shortcut.modifiers || {};
  if (mod.ctrl) parts.push('Ctrl');
  if (mod.alt) parts.push('Alt');
  if (mod.shift) parts.push('\u21e7');
  if (mod.meta) parts.push('\u2318');

  const keyDisplay = shortcut.key.length === 1
    ? shortcut.key.toUpperCase()
    : shortcut.key;
  parts.push(keyDisplay);

  return parts.join('');
}

export function ShortcutHelpPanel() {
  const { t } = useT();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const handler = () => setOpen((v) => !v);
    window.addEventListener('toggle-shortcut-help', handler);
    return () => window.removeEventListener('toggle-shortcut-help', handler);
  }, []);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setOpen(false);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open]);

  if (!open) return null;

  const manager = KeyboardManager.getInstance();
  const allShortcuts = manager.getAllShortcuts();

  // Group by category
  const grouped = new Map<string, { key: string; label: string; modifiers?: { meta?: boolean; ctrl?: boolean; shift?: boolean; alt?: boolean } }[]>();

  for (const { shortcuts } of allShortcuts) {
    for (const s of shortcuts) {
      const category = s.category || 'Other';
      const list = grouped.get(category) || [];
      // Deduplicate by id
      if (!list.some((item) => item.label === s.label && item.key === s.key)) {
        list.push({ key: s.key, label: s.label, modifiers: s.modifiers });
      }
      grouped.set(category, list);
    }
  }

  // Sort categories: Global first, then alphabetical
  const sortedCategories = Array.from(grouped.keys()).sort((a, b) => {
    if (a === 'Global') return -1;
    if (b === 'Global') return 1;
    return a.localeCompare(b);
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={() => setOpen(false)}
      />

      {/* Modal */}
      <div className="relative w-full max-w-md bg-card border border-border rounded-xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="text-sm font-semibold text-foreground">{t('shortcuts.title')}</h2>
          <button
            onClick={() => setOpen(false)}
            className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Content */}
        <div className="max-h-[60vh] overflow-y-auto px-5 py-3">
          {sortedCategories.map((category) => (
            <div key={category} className="mb-4 last:mb-0">
              <h3 className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-2">
                {category}
              </h3>
              <div className="space-y-1">
                {grouped.get(category)!.map((item, i) => (
                  <div
                    key={`${category}-${i}`}
                    className="flex items-center justify-between py-1.5"
                  >
                    <span className="text-sm text-foreground">{item.label}</span>
                    <kbd
                      className={cn(
                        'inline-flex items-center gap-0.5 px-2 py-0.5 rounded',
                        'text-xs font-mono text-muted-foreground',
                        'bg-muted border border-border/50',
                      )}
                    >
                      {formatKey(item)}
                    </kbd>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
