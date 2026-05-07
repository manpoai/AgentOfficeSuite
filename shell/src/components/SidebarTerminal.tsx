'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { MessageSquare, Terminal } from 'lucide-react';
import { cn } from '@/lib/utils';
import { AgentTerminalTab, ensureGlobalListener, resetGlobalListener } from './AgentTerminalTab';
import { AgentChatView } from './AgentChatView';

type ViewMode = 'chat' | 'terminal';

interface AgentTerminal {
  agentId: string;
  agentName: string;
  platform: string;
  status: 'running' | 'exited' | 'connecting';
  autoStartCommand?: string;
}

interface SidebarTerminalProps {
  agents: AgentTerminal[];
  selectedAgentId: string | null;
  terminalHeight: number;
  onTerminalHeightChange: (h: number) => void;
  onAgentExit: (agentId: string) => void;
  colorTheme?: 'light' | 'dark';
  isElectron?: boolean;
}

export function SidebarTerminal({
  agents,
  selectedAgentId,
  terminalHeight,
  onTerminalHeightChange,
  onAgentExit,
  colorTheme = 'dark',
  isElectron = false,
}: SidebarTerminalProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('chat');
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

  const selectedAgent = agents.find(a => a.agentId === selectedAgentId);
  const isDark = colorTheme === 'dark';

  return (
    <div className="flex flex-col shrink-0" style={{ height: terminalHeight }}>
      <div
        className="h-1 cursor-row-resize hover:bg-sidebar-primary/30 transition-colors shrink-0"
        onMouseDown={onResizeMouseDown}
      />

      {/* View toggle bar */}
      <div className={cn(
        'flex items-center h-7 px-2 shrink-0 gap-1 border-b',
        isDark ? 'bg-[#1e1e1e] border-[#333]' : 'bg-white border-border'
      )}>
        <button
          onClick={() => setViewMode('chat')}
          className={cn(
            'flex items-center gap-1 px-2 py-0.5 rounded text-[11px] transition-colors',
            viewMode === 'chat'
              ? isDark ? 'bg-[#333] text-[#d4d4d4]' : 'bg-gray-200 text-foreground'
              : isDark ? 'text-[#808080] hover:text-[#d4d4d4]' : 'text-muted-foreground hover:text-foreground'
          )}
        >
          <MessageSquare className="h-3 w-3" />
          Chat
        </button>
        {isElectron && (
          <button
            onClick={() => {
              setViewMode('terminal');
              setTimeout(() => window.dispatchEvent(new Event('terminal:refit')), 50);
            }}
            className={cn(
              'flex items-center gap-1 px-2 py-0.5 rounded text-[11px] transition-colors',
              viewMode === 'terminal'
                ? isDark ? 'bg-[#333] text-[#d4d4d4]' : 'bg-gray-200 text-foreground'
                : isDark ? 'text-[#808080] hover:text-[#d4d4d4]' : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <Terminal className="h-3 w-3" />
            Terminal
          </button>
        )}
      </div>

      {/* Content area */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {viewMode === 'chat' && (
          <AgentChatView
            agentId={selectedAgentId}
            agentName={selectedAgent?.agentName || selectedAgentId}
            isActive={true}
            colorTheme={colorTheme}
          />
        )}
        {viewMode === 'terminal' && isElectron && agents.map(agent => (
          <AgentTerminalTab
            key={agent.agentId}
            agentId={agent.agentId}
            isActive={selectedAgentId === agent.agentId}
            colorTheme={colorTheme}
            autoStartCommand={agent.autoStartCommand}
          />
        ))}
      </div>
    </div>
  );
}
