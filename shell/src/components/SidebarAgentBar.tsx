'use client';

import { useRef, useState, useEffect } from 'react';
import { AtSign } from 'lucide-react';
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
  isElectron: boolean;
}

export function SidebarAgentBar({
  agents,
  selectedAgentId,
  onSelectAgent,
  onDeselectAgent,
  onOpenAgentsPanel,
  isElectron,
}: SidebarAgentBarProps) {
  const { t } = useT();
  const containerRef = useRef<HTMLDivElement>(null);
  const [visibleCount, setVisibleCount] = useState(agents.length);

  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver(() => {
      if (!containerRef.current) return;
      const containerWidth = containerRef.current.clientWidth;
      const avatarSize = 36;
      const agentsButtonWidth = 100;
      const available = containerWidth - agentsButtonWidth;
      setVisibleCount(Math.max(0, Math.floor(available / avatarSize)));
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  const visibleAgents = agents.slice(0, visibleCount);
  const overflowCount = Math.max(0, agents.length - visibleCount);

  return (
    <div ref={containerRef} className="flex items-center gap-1 px-2 py-2 shrink-0 border-t border-border">
      {visibleAgents.map((agent) => {
        const isSelected = selectedAgentId === agent.name;
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
            {resolveAvatarUrl(agent.avatar_url) ? (
              <img src={resolveAvatarUrl(agent.avatar_url)!} alt="" className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full bg-muted flex items-center justify-center text-xs font-medium text-muted-foreground">
                {(agent.display_name || agent.name).charAt(0).toUpperCase()}
              </div>
            )}
          </button>
        );
      })}

      <button
        onClick={onOpenAgentsPanel}
        className="ml-auto flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium shrink-0 transition-colors"
        style={{
          backgroundColor: 'hsl(var(--sidebar-primary))',
          color: 'hsl(var(--sidebar-primary-foreground))',
        }}
      >
        <AtSign className="h-3.5 w-3.5" />
        {t('toolbar.agents')}
        {overflowCount > 0 && (
          <span className="ml-0.5">({overflowCount})</span>
        )}
      </button>
    </div>
  );
}
