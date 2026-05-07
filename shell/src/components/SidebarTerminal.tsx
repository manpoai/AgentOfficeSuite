'use client';

import { useEffect, useRef, useCallback } from 'react';
import { AgentTerminalTab, ensureGlobalListener, resetGlobalListener } from './AgentTerminalTab';

interface AgentTerminal {
  agentId: string;
  agentName: string;
  platform: string;
  status: 'running' | 'exited' | 'connecting';
}

interface SidebarTerminalProps {
  agents: AgentTerminal[];
  selectedAgentId: string | null;
  terminalHeight: number;
  onTerminalHeightChange: (h: number) => void;
  onAgentExit: (agentId: string) => void;
  colorTheme?: 'light' | 'dark';
}

export function SidebarTerminal({
  agents,
  selectedAgentId,
  terminalHeight,
  onTerminalHeightChange,
  onAgentExit,
  colorTheme = 'dark',
}: SidebarTerminalProps) {
  const resizeRef = useRef<{ startY: number; startHeight: number } | null>(null);

  useEffect(() => {
    const api = (window as any).electronAPI;
    if (!api) return;

    ensureGlobalListener();

    api.onTerminalExit((agentId: string) => {
      onAgentExit(agentId);
    });

    return () => {
      api.removeTerminalListeners();
      resetGlobalListener();
    };
  }, [onAgentExit]);

  const onResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    resizeRef.current = { startY: e.clientY, startHeight: terminalHeight };

    const onMouseMove = (ev: MouseEvent) => {
      if (!resizeRef.current) return;
      const delta = resizeRef.current.startY - ev.clientY;
      const newHeight = Math.min(Math.max(resizeRef.current.startHeight + delta, 120), window.innerHeight * 0.5);
      onTerminalHeightChange(newHeight);
    };

    const onMouseUp = () => {
      resizeRef.current = null;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [terminalHeight, onTerminalHeightChange]);

  if (!selectedAgentId) return null;

  return (
    <div className="flex flex-col shrink-0" style={{ height: terminalHeight }}>
      <div
        className="h-1 cursor-row-resize hover:bg-sidebar-primary/30 transition-colors shrink-0"
        onMouseDown={onResizeMouseDown}
      />
      <div className="flex-1 min-h-0 overflow-hidden">
        {agents.map(agent => (
          <AgentTerminalTab
            key={agent.agentId}
            agentId={agent.agentId}
            isActive={selectedAgentId === agent.agentId}
            colorTheme={colorTheme}
          />
        ))}
      </div>
    </div>
  );
}
