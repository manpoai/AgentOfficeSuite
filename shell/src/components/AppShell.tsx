'use client';
import { useEffect } from 'react';
import { CommandPalette } from './CommandPalette';
import { ShortcutHelpPanel } from './shared/ShortcutHelpPanel';
import { ContextMenuProvider } from './shared/ContextMenuProvider';
import { registerGlobalShortcuts } from '@/lib/keyboard';

export function AppShell({ children }: { children: React.ReactNode }) {
  // Register global keyboard shortcuts once
  useEffect(() => {
    const unregister = registerGlobalShortcuts();
    return unregister;
  }, []);

  return (
    <div className="flex h-screen w-screen flex-col md:flex-row bg-background text-foreground">
      {/* Main content area — fills remaining space */}
      <main className="flex-1 overflow-hidden min-h-0">
        {children}
      </main>

      {/* Global command palette (Cmd+K) */}
      <CommandPalette />

      {/* Keyboard shortcut help panel */}
      <ShortcutHelpPanel />

      {/* Global context menu (right-click / long-press) */}
      <ContextMenuProvider />
    </div>
  );
}
