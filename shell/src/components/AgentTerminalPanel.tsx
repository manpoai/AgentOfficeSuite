'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Plus, X, ChevronDown, ChevronUp, Terminal as TerminalIcon, MessageSquare } from 'lucide-react';
import { cn } from '@/lib/utils';
import { AgentTerminalTab, ensureGlobalListener, resetGlobalListener } from './AgentTerminalTab';
import { AgentChatView } from './AgentChatView';

type ViewMode = 'chat' | 'terminal';

interface AgentTab {
  agentId: string;
  agentName: string;
  platform: string;
  status: 'running' | 'exited' | 'connecting';
  welcomeMessage?: string;
}

export function AgentTerminalPanel() {
  const [tabs, setTabs] = useState<AgentTab[]>([]);
  const [activeTab, setActiveTab] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(true);
  const [panelHeight, setPanelHeight] = useState(300);
  const [viewMode, setViewMode] = useState<ViewMode>('chat');
  const resizeRef = useRef<{ startY: number; startHeight: number } | null>(null);
  const isElectron = typeof window !== 'undefined' && !!(window as any).electronAPI;

  useEffect(() => {
    const api = (window as any).electronAPI;
    if (!api) return;

    ensureGlobalListener();

    api.onTerminalExit((agentId: string) => {
      setTabs(prev => prev.map(t =>
        t.agentId === agentId ? { ...t, status: 'exited' as const } : t
      ));
    });

    api.listLocalAgents().then((agents: any[]) => {
      if (agents.length > 0) {
        const newTabs = agents.map(a => ({
          agentId: a.agentName,
          agentName: a.agentName,
          platform: a.platform,
          status: 'running' as const,
        }));
        setTabs(newTabs);
        setActiveTab(newTabs[0].agentId);
        setCollapsed(false);
        setTimeout(() => window.dispatchEvent(new Event('terminal:refit')), 100);
      }
    });

    return () => {
      api.removeTerminalListeners();
      resetGlobalListener();
    };
  }, []);

  const addTab = useCallback((agent: { agentId: string; agentName: string; platform: string; welcomeMessage?: string }) => {
    setTabs(prev => [...prev, { ...agent, status: 'running' }]);
    setActiveTab(agent.agentId);
    setCollapsed(false);
  }, []);

  const removeTab = useCallback((agentId: string) => {
    const api = (window as any).electronAPI;
    if (api) api.destroyTerminal(agentId);
    setTabs(prev => {
      const next = prev.filter(t => t.agentId !== agentId);
      if (activeTab === agentId) {
        setActiveTab(next.length > 0 ? next[next.length - 1].agentId : null);
      }
      return next;
    });
  }, [activeTab]);

  const onResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    resizeRef.current = { startY: e.clientY, startHeight: panelHeight };

    const onMouseMove = (ev: MouseEvent) => {
      if (!resizeRef.current) return;
      const delta = resizeRef.current.startY - ev.clientY;
      const newHeight = Math.min(Math.max(resizeRef.current.startHeight + delta, 150), window.innerHeight * 0.6);
      setPanelHeight(newHeight);
    };

    const onMouseUp = () => {
      resizeRef.current = null;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [panelHeight]);

  // Expose addTab for ConnectAgentsOverlay
  useEffect(() => {
    (window as any).__aoseTerminalPanel = { addTab };
    return () => { delete (window as any).__aoseTerminalPanel; };
  }, [addTab]);

  if (tabs.length === 0 && collapsed) return null;

  const statusDot = (status: string) => {
    if (status === 'running') return 'bg-green-500';
    if (status === 'exited') return 'bg-gray-400';
    return 'bg-yellow-500';
  };

  const activeAgent = tabs.find(t => t.agentId === activeTab);

  return (
    <div
      className="border-t border-border bg-background flex flex-col shrink-0"
      style={{ height: collapsed ? 36 : panelHeight }}
    >
      {!collapsed && (
        <div
          className="h-1 cursor-row-resize hover:bg-sidebar-primary/30 transition-colors"
          onMouseDown={onResizeMouseDown}
        />
      )}

      <div className="flex items-center h-[35px] px-2 border-b border-border shrink-0 gap-1">
        <button
          onClick={() => {
            const next = !collapsed;
            setCollapsed(next);
            if (!next && viewMode === 'terminal') setTimeout(() => window.dispatchEvent(new Event('terminal:refit')), 50);
          }}
          className="p-1 rounded hover:bg-black/[0.05] dark:hover:bg-white/[0.1] transition-colors"
        >
          {collapsed ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </button>

        {/* View toggle */}
        <div className="flex items-center gap-0.5 ml-1">
          <button
            onClick={() => setViewMode('chat')}
            className={cn(
              'p-1 rounded transition-colors',
              viewMode === 'chat' ? 'text-sidebar-primary' : 'text-muted-foreground hover:text-foreground'
            )}
            title="Chat"
          >
            <MessageSquare className="h-3.5 w-3.5" />
          </button>
          {isElectron && (
            <button
              onClick={() => {
                setViewMode('terminal');
                setTimeout(() => window.dispatchEvent(new Event('terminal:refit')), 50);
              }}
              className={cn(
                'p-1 rounded transition-colors',
                viewMode === 'terminal' ? 'text-sidebar-primary' : 'text-muted-foreground hover:text-foreground'
              )}
              title="Terminal"
            >
              <TerminalIcon className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-0.5 overflow-x-auto flex-1 ml-2">
          {tabs.map(tab => (
            <button
              key={tab.agentId}
              onClick={() => { setActiveTab(tab.agentId); setCollapsed(false); }}
              className={cn(
                'flex items-center gap-1.5 px-2 py-1 rounded text-xs whitespace-nowrap transition-colors',
                activeTab === tab.agentId ? 'bg-sidebar-primary/10 text-sidebar-primary' : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <span className={cn('w-1.5 h-1.5 rounded-full', statusDot(tab.status))} />
              <span>{tab.agentName}</span>
              <X
                className="h-3 w-3 opacity-50 hover:opacity-100"
                onClick={(e) => { e.stopPropagation(); removeTab(tab.agentId); }}
              />
            </button>
          ))}
        </div>

        <button
          onClick={() => {
            const event = new CustomEvent('aose:open-connect-agents');
            window.dispatchEvent(event);
          }}
          className="p-1 rounded hover:bg-black/[0.05] dark:hover:bg-white/[0.1] transition-colors ml-auto"
          title="Connect Agent"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="flex-1 min-h-0" style={{ display: collapsed ? 'none' : undefined }}>
        {viewMode === 'chat' && activeTab && (
          <AgentChatView
            agentId={activeTab}
            agentName={activeAgent?.agentName || activeTab}
            isActive={true}
          />
        )}
        {viewMode === 'terminal' && isElectron && tabs.map(tab => (
          <AgentTerminalTab
            key={tab.agentId}
            agentId={tab.agentId}
            isActive={activeTab === tab.agentId}
            welcomeMessage={tab.welcomeMessage}
          />
        ))}
      </div>
    </div>
  );
}
