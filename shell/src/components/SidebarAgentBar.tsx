'use client';

import { useRef, useState, useEffect } from 'react';
import { AtSign, Bot, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useT } from '@/lib/i18n';
import { resolveAvatarUrl } from '@/lib/api/gateway';

interface Agent {
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
}

export function SidebarAgentBar({
  agents,
  selectedAgentId,
  onSelectAgent,
  onDeselectAgent,
  onOpenAgentsPanel,
  onOpenConnectAgents,
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
              if (isSelected) {
                onDeselectAgent();
              } else {
                onSelectAgent(agent.name);
              }
            }}
            className={cn(
              'w-8 h-8 rounded-full overflow-hidden shrink-0 border-2 transition-colors',
              isSelected ? 'border-sidebar-primary' : 'border-transparent hover:border-sidebar-primary/30',
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
      <div className="ml-auto flex h-8 shrink-0 rounded-lg overflow-hidden border border-black/10 dark:border-white/10" style={{ width: 104, backgroundColor: 'hsl(var(--sidebar-primary))' }}>
        <button
          onClick={onOpenAgentsPanel}
          className="flex items-center justify-center gap-1.5 flex-1 text-xs font-medium transition-all active:brightness-90"
          style={{ color: 'hsl(var(--sidebar-primary-foreground))' }}
          onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.1)')}
          onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
        >
          <AtSign className="h-4 w-4" />
          {t('toolbar.agents')}
        </button>
        <div className="w-px self-stretch" style={{ backgroundColor: 'rgba(0,0,0,0.1)' }} />
        <button
          onClick={() => onOpenConnectAgents?.()}
          className="flex items-center justify-center transition-all active:brightness-90 rounded-r-lg"
          style={{ width: 32, color: 'hsl(var(--sidebar-primary-foreground))', backgroundColor: 'rgba(0,0,0,0.1)' }}
          onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'rgba(0,0,0,0.18)')}
          onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'rgba(0,0,0,0.1)')}
          title={t('actions.addAgent') || 'Add Agent'}
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
