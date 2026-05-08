'use client';

import { useRef, useState, useEffect } from 'react';
import { AtSign, Bot, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useT } from '@/lib/i18n';
import { resolveAvatarUrl } from '@/lib/api/gateway';

interface Agent {
  id: number;
  name: string;
  display_name?: string;
  avatar_url?: string;
  platform: string;
  status: string;
}

interface SidebarAgentBarProps {
  agents: Agent[];
  selectedAgentId: string | null;
  onSelectAgent: (agentName: string) => void;
  onDeselectAgent: () => void;
  onOpenAgentsPanel: () => void;
  onOpenConnectAgents?: () => void;
  isElectron: boolean;
}

export function SidebarAgentBar({
  agents,
  selectedAgentId,
  onSelectAgent,
  onDeselectAgent,
  onOpenAgentsPanel,
  onOpenConnectAgents,
  isElectron,
  colorTheme = 'light',
}: SidebarAgentBarProps & { colorTheme?: 'light' | 'dark' }) {
  const { t } = useT();
  const containerRef = useRef<HTMLDivElement>(null);
  const [visibleCount, setVisibleCount] = useState(agents.length);

  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver(() => {
      if (!containerRef.current) return;
      const containerWidth = containerRef.current.clientWidth;
      const avatarSize = 36;
      const agentsButtonWidth = 120;
      const available = containerWidth - agentsButtonWidth;
      setVisibleCount(Math.max(0, Math.floor(available / avatarSize)));
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  const visibleAgents = agents.slice(0, visibleCount);
  const overflowCount = Math.max(0, agents.length - visibleCount);

  return (
    <div ref={containerRef} className="flex items-center gap-1 px-2 py-2 shrink-0" style={{ backgroundColor: colorTheme === 'dark' ? '#1a1a2e' : '#EBEFEB' }}>
      {visibleAgents.map((agent) => {
        const isSelected = selectedAgentId === agent.name;
        const avatarUrl = resolveAvatarUrl(agent.avatar_url);
        const platformFallback = agent.platform ? `/icons/platform-${agent.platform}.png` : null;
        return (
          <button
            key={agent.name}
            onClick={() => {
              if (!isElectron) return;
              if (isSelected) {
                onDeselectAgent();
              } else {
                onSelectAgent(agent.name);
              }
            }}
            className={cn(
              'w-8 h-8 rounded-full overflow-hidden shrink-0 border-2 transition-colors',
              isSelected ? 'border-sidebar-primary' : 'border-transparent hover:border-sidebar-primary/30',
              !isElectron && 'cursor-default'
            )}
            title={agent.display_name || agent.name}
          >
            {avatarUrl ? (
              <img src={avatarUrl} alt="" className="w-full h-full object-cover" />
            ) : platformFallback ? (
              <img
                src={platformFallback}
                alt=""
                className="w-full h-full object-cover"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = 'none';
                  (e.target as HTMLImageElement).parentElement!.querySelector('.avatar-fallback')?.classList.remove('hidden');
                }}
              />
            ) : null}
            {!avatarUrl && (
              <div className={cn('avatar-fallback w-full h-full bg-muted flex items-center justify-center', platformFallback ? 'hidden' : '')}>
                <Bot className="h-4 w-4 text-sidebar-primary" />
              </div>
            )}
          </button>
        );
      })}

      {/* Two-segment button: @ Agents | + */}
      <div className="ml-auto flex items-center shrink-0 rounded-lg overflow-hidden" style={{ height: 32 }}>
        <button
          onClick={onOpenAgentsPanel}
          className="flex items-center gap-1.5 px-3 h-full text-xs font-medium transition-colors"
          style={{
            backgroundColor: '#22C55E',
            color: '#fff',
          }}
        >
          <AtSign className="h-3.5 w-3.5" />
          {t('toolbar.agents')}
          {overflowCount > 0 && (
            <span className="ml-0.5">({overflowCount})</span>
          )}
        </button>
        <button
          onClick={() => onOpenConnectAgents?.()}
          className="flex items-center justify-center h-full transition-colors"
          style={{
            backgroundColor: '#1a1a2e',
            color: '#fff',
            width: 32,
          }}
          title={t('actions.addAgent') || 'Add Agent'}
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
