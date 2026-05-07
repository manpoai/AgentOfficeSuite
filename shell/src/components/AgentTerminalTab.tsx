'use client';

import { useCallback, useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';

const TERMINAL_THEMES = {
  light: {
    background: '#ffffff',
    foreground: '#1a1a1a',
    cursor: '#333333',
    selectionBackground: '#d0d0d0',
    selectionForeground: '#1a1a1a',
  },
  dark: {
    background: '#1a1a2e',
    foreground: '#e0e0e0',
    cursor: '#ffffff',
    selectionBackground: '#3a3a5e',
  },
};

const terminalDataHandlers = new Map<string, (data: string) => void>();

export function ensureGlobalListener() {
  if ((window as any).__aoseTerminalListenerAttached) return;
  (window as any).__aoseTerminalListenerAttached = true;
  const api = (window as any).electronAPI;
  if (!api) return;
  api.onTerminalData((agentId: string, data: string) => {
    const handler = terminalDataHandlers.get(agentId);
    if (handler) handler(data);
  });
}

export function resetGlobalListener() {
  (window as any).__aoseTerminalListenerAttached = false;
}

interface AgentTerminalTabProps {
  agentId: string;
  isActive: boolean;
  welcomeMessage?: string;
  colorTheme?: 'light' | 'dark';
}

export function AgentTerminalTab({ agentId, isActive, welcomeMessage, colorTheme = 'dark' }: AgentTerminalTabProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const initializedRef = useRef(false);
  const isActiveRef = useRef(isActive);
  isActiveRef.current = isActive;

  const fitAndSync = useCallback(() => {
    if (!fitAddonRef.current || !terminalRef.current) return;
    if (!isActiveRef.current) return;
    fitAddonRef.current.fit();
    const api = (window as any).electronAPI;
    if (api && terminalRef.current) {
      const { cols, rows } = terminalRef.current;
      if (cols > 1 && rows > 1) {
        api.resizeTerminal(agentId, cols, rows);
      }
    }
  }, [agentId]);

  useEffect(() => {
    if (!containerRef.current || initializedRef.current) return;
    initializedRef.current = true;

    const terminal = new Terminal({
      fontSize: 13,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      cursorBlink: true,
      theme: TERMINAL_THEMES[colorTheme],
    });

    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.loadAddon(new WebLinksAddon());

    terminal.open(containerRef.current);

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    if (isActiveRef.current) {
      requestAnimationFrame(() => fitAndSync());
    }

    if (welcomeMessage) {
      terminal.write(welcomeMessage);
    }

    ensureGlobalListener();
    terminalDataHandlers.set(agentId, (data: string) => {
      terminal.write(data);
    });

    const api = (window as any).electronAPI;
    if (api) {
      api.createTerminal(agentId).then((result: any) => {
        requestAnimationFrame(() => {
          fitAndSync();
          if (result?.reconnected && result.bufferedData) {
            terminal.write(result.bufferedData);
          }
          if (result?.reconnected) {
            const { cols, rows } = terminal;
            if (cols > 1 && rows > 1) {
              api.resizeTerminal(agentId, cols - 1, rows);
              setTimeout(() => api.resizeTerminal(agentId, cols, rows), 50);
            }
          }
        });
      });

      terminal.onData((data: string) => {
        api.writeTerminal(agentId, data);
      });
    }

    const resizeObserver = new ResizeObserver(() => {
      if (isActiveRef.current) {
        fitAndSync();
      }
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
      terminalDataHandlers.delete(agentId);
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
      initializedRef.current = false;
    };
  }, [agentId, fitAndSync]);

  useEffect(() => {
    if (isActive) {
      requestAnimationFrame(() => {
        fitAndSync();
        setTimeout(() => fitAndSync(), 50);
      });
    }
  }, [isActive, fitAndSync]);

  useEffect(() => {
    const refit = () => fitAndSync();
    window.addEventListener('terminal:refit', refit);
    return () => window.removeEventListener('terminal:refit', refit);
  }, [fitAndSync]);

  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.options.theme = TERMINAL_THEMES[colorTheme];
    }
  }, [colorTheme]);

  return (
    <div
      ref={containerRef}
      className="h-full w-full"
      style={{ display: isActive ? 'block' : 'none' }}
    />
  );
}
