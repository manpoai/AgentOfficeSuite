'use client';

import { useCallback, useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';

const terminalDataHandlers = new Map<string, (data: string) => void>();

let globalListenerAttached = false;
function ensureGlobalListener() {
  if (globalListenerAttached) return;
  globalListenerAttached = true;
  const api = (window as any).electronAPI;
  if (!api) return;
  api.onTerminalData((agentId: string, data: string) => {
    const handler = terminalDataHandlers.get(agentId);
    if (handler) handler(data);
  });
}

interface AgentTerminalTabProps {
  agentId: string;
  isActive: boolean;
  welcomeMessage?: string;
}

export function AgentTerminalTab({ agentId, isActive, welcomeMessage }: AgentTerminalTabProps) {
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
      theme: {
        background: '#1a1a2e',
        foreground: '#e0e0e0',
        cursor: '#ffffff',
        selectionBackground: '#3a3a5e',
      },
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

  return (
    <div
      ref={containerRef}
      className="h-full w-full"
      style={{ display: isActive ? 'block' : 'none' }}
    />
  );
}
