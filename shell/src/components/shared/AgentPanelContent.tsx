'use client';

import { useState, useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bot, Plus, Copy, X, Check, Key, Pencil, Trash2, Camera } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatRelativeTime } from '@/lib/utils/time';
import { useT } from '@/lib/i18n';
import * as gw from '@/lib/api/gateway';
import { resolveAvatarUrl } from '@/lib/api/gateway';

function PlatformIcon({ name }: { name: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <div className="w-10 h-10 rounded-lg bg-sidebar-primary/10 flex items-center justify-center">
        <Bot className="h-5 w-5 text-sidebar-primary" />
      </div>
    );
  }
  return (
    <img
      src={`/icons/platform-${name.toLowerCase()}.jpg`}
      alt={name}
      className="w-10 h-10 rounded-lg object-cover"
      onError={() => setFailed(true)}
    />
  );
}

export interface AgentPanelContentProps {
  variant: 'popover' | 'bottomsheet';
}

export function AgentPanelContent({ variant }: AgentPanelContentProps) {
  const { t } = useT();
  const queryClient = useQueryClient();
  const [showOnboardingPrompt, setShowOnboardingPrompt] = useState(false);
  const [selectedPlatform, setSelectedPlatform] = useState<string | null>(null);
  const [promptText, setPromptText] = useState('');
  const [resetTokenConfirmId, setResetTokenConfirmId] = useState<string | null>(null);
  const [resetTokenResult, setResetTokenResult] = useState<{ agentId: string; token: string } | null>(null);
  const [editingAgentId, setEditingAgentId] = useState<string | null>(null);
  const [nameValue, setNameValue] = useState('');
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const [uploadingAgentId, setUploadingAgentId] = useState<string | null>(null);

  // Agents data
  const { data: allAgents } = useQuery({
    queryKey: ['admin-agents'],
    queryFn: gw.listAllAgents,
    refetchInterval: 10_000,
  });

  // Available platforms (data-driven)
  const { data: platformsData } = useQuery({
    queryKey: ['admin-platforms'],
    queryFn: gw.listPlatforms,
    staleTime: 60_000,
  });
  const platforms = platformsData?.platforms || ['openclaw', 'zylos'];

  const isCompact = variant === 'bottomsheet';
  const styles = {
    wrapper:     isCompact ? 'px-4 pb-4' : 'p-4',
    avatar:      isCompact ? 'w-10 h-10' : 'w-12 h-12',
    avatarIcon:  isCompact ? 'h-4 w-4'  : 'h-5 w-5',
    promptWidth: isCompact ? 'w-[320px]' : 'w-[360px]',
    promptMaxH:  isCompact ? 'max-h-[200px]' : 'max-h-[300px]',
    connectedPy: isCompact ? 'py-3' : 'py-2',
    pendingMb:   isCompact ? 'mb-3' : 'mb-4',
  };

  const connected = allAgents?.filter(a => !a.pending_approval) || [];
  const pending   = allAgents?.filter(a => a.pending_approval)  || [];

  async function handleAvatarUpload(agentId: string, e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingAgentId(agentId);
    try {
      await gw.adminUploadAgentAvatar(agentId, file);
      queryClient.invalidateQueries({ queryKey: ['admin-agents'] });
    } catch {}
    setUploadingAgentId(null);
    e.target.value = '';
  }

  async function handleNameSave(agentId: string, currentName: string) {
    const trimmed = nameValue.trim();
    if (!trimmed || trimmed === currentName) {
      setEditingAgentId(null);
      return;
    }
    try {
      await gw.adminUpdateAgent(agentId, { display_name: trimmed });
      queryClient.invalidateQueries({ queryKey: ['admin-agents'] });
    } catch {}
    setEditingAgentId(null);
  }

  function startEditing(agent: gw.Agent) {
    setEditingAgentId(agent.agent_id || agent.name);
    setNameValue(agent.display_name || agent.name);
  }

  function renderAvatar(agent: gw.Agent) {
    const agentId = agent.agent_id || agent.name;
    const avatarUrl = resolveAvatarUrl(agent.avatar_url);
    return (
      <div
        className={cn(styles.avatar, 'rounded-full bg-muted overflow-hidden shrink-0 border border-black/10 relative group cursor-pointer')}
        onClick={() => {
          avatarInputRef.current?.setAttribute('data-agent-id', agentId);
          avatarInputRef.current?.click();
        }}
      >
        {avatarUrl
          ? <img src={avatarUrl} alt="" className="w-full h-full object-cover" />
          : <div className="w-full h-full flex items-center justify-center"><Bot className={cn(styles.avatarIcon, 'text-sidebar-primary')} /></div>}
        <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity rounded-full">
          {uploadingAgentId === agentId ? (
            <span className="text-white text-[10px]">...</span>
          ) : (
            <Camera className={cn(isCompact ? 'h-3 w-3' : 'h-3.5 w-3.5', 'text-white')} />
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={styles.wrapper}>
      {/* Hidden file input shared by all agents */}
      <input
        ref={avatarInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const agentId = avatarInputRef.current?.getAttribute('data-agent-id');
          if (agentId) handleAvatarUpload(agentId, e);
        }}
      />

      {/* Header: Add Agent */}
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium text-foreground">{t('actions.agentMembers')}</h3>
        <button
          onClick={() => { setShowOnboardingPrompt(v => !v); setSelectedPlatform(null); }}
          className="flex items-center gap-1 px-2 py-0.5 text-xs font-medium text-sidebar-primary hover:bg-sidebar-primary/10 rounded transition-colors"
        >
          <Plus className="h-3 w-3" />
          {t('actions.addAgent')}
        </button>
      </div>

      {/* Step 1: platform selection — inline expand */}
      {showOnboardingPrompt && !selectedPlatform && (
        <div className="mb-3 p-3 bg-black/[0.02] dark:bg-white/[0.03] border border-black/[0.06] dark:border-border rounded-lg">
          <p className="text-xs font-medium text-foreground mb-1">{t('actions.selectPlatform')}</p>
          <p className="text-[11px] text-muted-foreground mb-3">{t('actions.platformDescription')}</p>
          <div className="grid grid-cols-2 gap-2">
            {platforms.map(p => (
              <button
                key={p}
                onClick={async () => {
                  setSelectedPlatform(p);
                  try {
                    const data = await gw.getOnboardingPrompt(p);
                    setPromptText(data.prompt);
                  } catch {}
                }}
                className="flex flex-col items-center gap-2 p-3 rounded-lg border border-black/10 dark:border-border hover:border-sidebar-primary hover:bg-sidebar-primary/5 transition-colors"
              >
                <PlatformIcon name={p} />
                <span className="text-xs font-medium">{p}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Step 2: show prompt for selected platform — inline expand */}
      {showOnboardingPrompt && selectedPlatform && (
        <div className="mb-3 p-3 bg-black/[0.02] dark:bg-white/[0.03] border border-black/[0.06] dark:border-border rounded-lg">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <button onClick={() => setSelectedPlatform(null)} className="text-xs text-muted-foreground hover:text-foreground">←</button>
              <span className="text-xs font-medium text-foreground">{selectedPlatform} — {t('actions.sendToAgent')}</span>
            </div>
            <button onClick={() => navigator.clipboard.writeText(promptText)} className="flex items-center gap-1 px-2 py-0.5 text-xs text-sidebar-primary hover:bg-sidebar-primary/10 rounded transition-colors">
              <Copy className="h-3 w-3" />{t('actions.copyPrompt')}
            </button>
          </div>
          <pre className={cn('text-[11px] text-muted-foreground bg-black/[0.03] dark:bg-white/[0.05] rounded p-2 overflow-y-auto whitespace-pre-wrap font-mono leading-relaxed', styles.promptMaxH)}>
            {promptText}
          </pre>
        </div>
      )}

      {/* Pending */}
      {pending.length > 0 && (
        <div className={styles.pendingMb}>
          <p className="text-xs font-medium text-foreground/50 mb-2">{t('sidebar.pendingApproved')}</p>
          {pending.map(agent => (
            <div key={agent.agent_id || agent.name} className="flex items-center gap-3 py-2">
              {renderAvatar(agent)}
              <div className="flex-1 min-w-0">
                <span className="text-sm font-medium text-foreground truncate block">{agent.display_name || agent.name}</span>
                <span className="text-xs text-foreground/50">
                  {agent.name}
                  {agent.platform && <span className="ml-1.5 px-1.5 py-0.5 bg-sidebar-primary/10 text-sidebar-primary rounded text-[10px]">{agent.platform}</span>}
                </span>
              </div>
              <button onClick={async () => { try { await gw.rejectAgent(agent.agent_id || agent.name); queryClient.invalidateQueries({ queryKey: ['admin-agents'] }); } catch {} }} className="w-8 h-8 rounded-full bg-red-50 dark:bg-red-900/20 flex items-center justify-center shrink-0 hover:bg-red-100 transition-colors">
                <X className="h-4 w-4 text-red-500" />
              </button>
              <button
                onClick={async () => { try { await gw.approveAgent(agent.agent_id || agent.name); queryClient.invalidateQueries({ queryKey: ['admin-agents'] }); } catch {} }}
                className="w-8 h-8 rounded-full bg-sidebar-primary flex items-center justify-center shrink-0 hover:opacity-90 transition-colors"
              >
                <Check className="h-4 w-4 text-white" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Connected */}
      {connected.length === 0 && pending.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
          <Bot className="h-10 w-10 mb-3 opacity-30" />
          <p className="text-sm">{t('sidebar.noAgents')}</p>
        </div>
      ) : connected.length > 0 ? (
        <div>
          <p className="text-xs font-medium text-foreground/50 mb-2">{t('sidebar.connected')}</p>
          {connected.map(agent => {
            const agentId = agent.agent_id || agent.name;
            const isEditing = editingAgentId === agentId;
            return (
              <div key={agentId} className={cn('flex items-center gap-3 group rounded-lg transition-colors', styles.connectedPy, !isCompact && 'hover:bg-black/[0.05] dark:hover:bg-white/[0.05] px-2 -mx-2')}>
                <div className="relative">
                  {renderAvatar(agent)}
                  <div className={cn('absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-white dark:border-card', agent.online ? 'bg-green-500' : 'bg-gray-300')} />
                </div>
                <div className="flex-1 min-w-0">
                  {isEditing ? (
                    <input
                      className="text-sm font-medium text-foreground bg-background border border-border rounded px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-primary w-full"
                      value={nameValue}
                      onChange={e => setNameValue(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') handleNameSave(agentId, agent.display_name || agent.name); if (e.key === 'Escape') setEditingAgentId(null); }}
                      onBlur={() => handleNameSave(agentId, agent.display_name || agent.name)}
                      autoFocus
                    />
                  ) : (
                    <span className="text-sm font-medium text-foreground truncate block">{agent.display_name || agent.name}</span>
                  )}
                  <span className="text-xs text-foreground/50">
                    {agent.name}
                    {agent.platform && <span className="ml-1.5 px-1.5 py-0.5 bg-sidebar-primary/10 text-sidebar-primary rounded text-[10px]">{agent.platform}</span>}
                    {!agent.online && agent.last_seen_at && (
                      <span className="text-[10px] text-foreground/30 ml-1">{formatRelativeTime(agent.last_seen_at)}</span>
                    )}
                  </span>
                </div>
                {/* Delete button — visible on all screen sizes */}
                {deleteConfirmId === agentId ? (
                  <div className="flex items-center gap-1 ml-1">
                    <span className="text-[10px] text-foreground/60">{t('actions.confirmDelete')}</span>
                    <button onClick={async () => { try { await gw.deleteAgent(agentId); queryClient.invalidateQueries({ queryKey: ['admin-agents'] }); } catch {} setDeleteConfirmId(null); }} className="px-1.5 py-0.5 text-[10px] font-medium text-white bg-red-500 rounded hover:bg-red-600 transition-colors shrink-0">{t('actions.delete')}</button>
                    <button onClick={() => setDeleteConfirmId(null)} className="px-1.5 py-0.5 text-[10px] font-medium text-foreground/60 bg-black/[0.05] rounded hover:bg-black/[0.1] transition-colors shrink-0">{t('common.cancel')}</button>
                  </div>
                ) : (
                  <button onClick={() => setDeleteConfirmId(agentId)} className="w-8 h-8 rounded flex items-center justify-center hover:bg-black/[0.05] opacity-0 group-hover:opacity-100 transition-opacity"><Trash2 className="h-3.5 w-3.5 text-foreground/40" /></button>
                )}
                {/* Edit and reset token — desktop only */}
                {!isCompact && (
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={() => startEditing(agent)} className="w-8 h-8 rounded flex items-center justify-center hover:bg-black/[0.05]"><Pencil className="h-3.5 w-3.5 text-foreground/40" /></button>
                    {resetTokenConfirmId === agentId ? (
                      <div className="flex items-center gap-1 ml-1">
                        <span className="text-[10px] text-foreground/60">{t('actions.resetTokenConfirm')}</span>
                        <button onClick={async () => { try { const r = await gw.resetAgentToken(agentId); setResetTokenResult({ agentId, token: r.token }); } catch {} setResetTokenConfirmId(null); }} className="px-1.5 py-0.5 text-[10px] font-medium text-white bg-red-500 rounded hover:bg-red-600 transition-colors shrink-0">{t('common.confirm')}</button>
                        <button onClick={() => setResetTokenConfirmId(null)} className="px-1.5 py-0.5 text-[10px] font-medium text-foreground/60 bg-black/[0.05] rounded hover:bg-black/[0.1] transition-colors shrink-0">{t('common.cancel')}</button>
                      </div>
                    ) : (
                      <button onClick={() => setResetTokenConfirmId(agentId)} className="w-8 h-8 rounded flex items-center justify-center hover:bg-black/[0.05] text-[10px] text-foreground/40" title={t('actions.resetToken')}>
                        <Key className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : null}

      {/* New token display */}
      {resetTokenResult && (
        <div className="mt-3 border border-amber-200 dark:border-amber-700 rounded-lg p-3 bg-amber-50 dark:bg-amber-900/20">
          <p className="text-xs font-medium text-amber-700 dark:text-amber-400 mb-2">{t('actions.newTokenWarning')}</p>
          <div className="flex items-center gap-2 bg-black/[0.04] dark:bg-white/[0.05] rounded p-2">
            <code className="text-xs font-mono flex-1 break-all">{resetTokenResult.token}</code>
            <button onClick={() => navigator.clipboard.writeText(resetTokenResult.token)} className="shrink-0 p-1 rounded hover:bg-black/[0.08] transition-colors"><Copy className="h-3.5 w-3.5" /></button>
          </div>
          <button onClick={() => setResetTokenResult(null)} className="mt-2 w-full py-1 text-xs font-medium text-sidebar-primary hover:underline">{t('common.close')}</button>
        </div>
      )}
    </div>
  );
}
