'use client';

import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Copy, Check, X, ArrowLeft } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useT } from '@/lib/i18n';
import * as gw from '@/lib/api/gateway';
import { useIsMobile } from '@/lib/hooks/use-mobile';
import { BottomSheet } from '@/components/shared/BottomSheet';

const PLATFORM_LABELS: Record<string, string> = {
  zylos: 'Zylos',
  openclaw: 'OpenClaw',
  'claude-code': 'Claude Code',
  codex: 'Codex CLI',
  'gemini-cli': 'Gemini CLI',
  'claude.ai': 'Claude.ai',
  chatgpt: 'ChatGPT',
};

const CONNECTOR_PLATFORMS = ['claude.ai', 'chatgpt'] as const;

const LOCAL_PLATFORMS = ['claude-code'];

type PermissionMode = 'always' | 'ask';

interface ToolCategory {
  id: string;
  label: string;
  description: string;
  tools: string[];
  default: PermissionMode;
}

const CLAUDE_CODE_TOOL_CATEGORIES: ToolCategory[] = [
  { id: 'aose', label: 'AOSE Workspace', description: 'Docs, tables, comments, events', tools: ['mcp__aose__*'], default: 'always' },
  { id: 'files', label: 'File Operations', description: 'Read, edit, write files', tools: ['Read', 'Edit', 'Write'], default: 'always' },
  { id: 'shell', label: 'Shell Commands', description: 'Terminal commands (bash)', tools: ['Bash'], default: 'always' },
  { id: 'web', label: 'Web Access', description: 'Fetch URLs, web search', tools: ['WebFetch', 'WebSearch'], default: 'always' },
];

function defaultPermissions(): Record<string, PermissionMode> {
  const defaults: Record<string, PermissionMode> = {};
  CLAUDE_CODE_TOOL_CATEGORIES.forEach(cat => { defaults[cat.id] = cat.default; });
  return defaults;
}

function platformLabel(name: string) {
  return PLATFORM_LABELS[name] || name;
}

function getVisiblePlatforms(isElectron: boolean, hasCloudSync: boolean, remotePlatforms: string[]) {
  if (!isElectron) {
    return { local: [] as string[], remote: remotePlatforms };
  }
  if (hasCloudSync) {
    return { local: LOCAL_PLATFORMS, remote: remotePlatforms };
  }
  return { local: LOCAL_PLATFORMS, remote: [] as string[] };
}

function PlatformLogo({ name, size = 'lg' }: { name: string; size?: 'sm' | 'lg' }) {
  const [imgSrc, setImgSrc] = useState(`/icons/platform-${name}.png`);
  const [failed, setFailed] = useState(false);
  const sizeClass = size === 'lg' ? 'w-12 h-12' : 'w-8 h-8';

  if (failed) {
    return (
      <div className={cn(sizeClass, 'rounded-xl bg-sidebar-primary/10 flex items-center justify-center text-sidebar-primary font-bold text-lg')}>
        {(PLATFORM_LABELS[name] || name).charAt(0)}
      </div>
    );
  }
  return (
    <img
      src={imgSrc}
      alt={name}
      className={cn(sizeClass, 'rounded-xl object-cover')}
      onError={() => {
        if (imgSrc.endsWith('.png')) {
          setImgSrc(`/icons/platform-${name}.jpg`);
        } else {
          setFailed(true);
        }
      }}
    />
  );
}

interface ConnectAgentsOverlayProps {
  open: boolean;
  onClose: () => void;
}

export function ConnectAgentsOverlay({ open, onClose }: ConnectAgentsOverlayProps) {
  const { t } = useT();
  const isMobile = useIsMobile();
  const [selectedPlatform, setSelectedPlatform] = useState<string | null>(null);
  const [promptText, setPromptText] = useState('');
  const [copied, setCopied] = useState(false);
  const [loadingPrompt, setLoadingPrompt] = useState(false);
  const [permissions, setPermissions] = useState<Record<string, PermissionMode>>(defaultPermissions);
  const [showPermissions, setShowPermissions] = useState(false);

  const isElectron = typeof window !== 'undefined' && (window as any).electronAPI?.isElectron;

  const { data: syncStatus } = useQuery({
    queryKey: ['sync-status'],
    queryFn: gw.getSyncStatus,
    staleTime: 30_000,
    enabled: !!isElectron,
  });
  const hasCloudSync = !!syncStatus?.sync_enabled;

  const { data: platformsData } = useQuery({
    queryKey: ['admin-platforms'],
    queryFn: gw.listPlatforms,
    staleTime: 60_000,
  });
  const remotePlatformsFromGateway = platformsData?.platforms || ['openclaw', 'zylos'];

  const { local: localPlatforms, remote: remotePlatforms } = getVisiblePlatforms(
    !!isElectron, hasCloudSync, remotePlatformsFromGateway
  );

  useEffect(() => {
    if (!open) {
      setSelectedPlatform(null);
      setPromptText('');
      setCopied(false);
      setShowPermissions(false);
      setShowConnectorTutorial(false);
      setPermissions(defaultPermissions());
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  async function doProvision(p: string, perms?: Record<string, PermissionMode>) {
    setLoadingPrompt(true);
    try {
      const api = (window as any).electronAPI;
      const result = await api.provisionAgent(p, perms || null);
      const panel = (window as any).__aoseTerminalPanel;
      if (panel) {
        const welcome =
          `\x1b[1;32m✓ Agent provisioned successfully\x1b[0m\r\n\r\n` +
          `  Agent:     ${result.agentName}\r\n` +
          `  Platform:  ${platformLabel(p)}\r\n` +
          `  Directory: ${result.agentDir}\r\n` +
          `  Config:    ${result.agentDir}/.mcp.json\r\n\r\n` +
          `\x1b[1mReady.\x1b[0m Open this directory in ${platformLabel(p)} to start working.\r\n\r\n`;
        panel.addTab({
          agentId: result.agentName,
          agentName: result.agentName,
          platform: p,
          welcomeMessage: welcome,
          autoStartCommand: p === 'claude-code' ? 'claude' : undefined,
        });
      }
      onClose();
    } catch (err: any) {
      setPromptText(`Error: ${err.message || 'Failed to provision agent'}`);
    }
    setLoadingPrompt(false);
  }

  const isConnectorPlatform = (p: string) => (CONNECTOR_PLATFORMS as readonly string[]).includes(p);
  const [showConnectorTutorial, setShowConnectorTutorial] = useState(false);

  async function handleSelectPlatform(p: string, isLocal: boolean) {
    if (isConnectorPlatform(p)) {
      setSelectedPlatform(p);
      setShowConnectorTutorial(true);
      return;
    }

    if (isLocal && isElectron) {
      setSelectedPlatform(p);
      if (p === 'claude-code') {
        setShowPermissions(true);
        return;
      }
      await doProvision(p);
      return;
    }

    setSelectedPlatform(p);
    setLoadingPrompt(true);
    setCopied(false);
    try {
      const data = await gw.getOnboardingPrompt(p, isLocal ? 'local' : 'remote');
      setPromptText(data.prompt);
    } catch {
      setPromptText('Failed to load prompt.');
    }
    setLoadingPrompt(false);
  }

  function handleCopy() {
    navigator.clipboard.writeText(promptText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function handleCopyText(text: string) {
    navigator.clipboard.writeText(text);
  }

  const mcpUrl = typeof window !== 'undefined'
    ? `${window.location.origin}/mcp`
    : 'https://your-server.com/mcp';

  if (!open) return null;

  const platformGrid = (platforms: string[], isLocal: boolean) => (
    <div className={cn('grid gap-3', isMobile ? 'grid-cols-2' : 'grid-cols-2 sm:grid-cols-3')}>
      {platforms.map(p => (
        <button
          key={`${isLocal ? 'local' : 'remote'}-${p}`}
          onClick={() => handleSelectPlatform(p, isLocal)}
          className="flex flex-col items-center gap-3 p-4 rounded-xl border border-border hover:border-sidebar-primary hover:bg-sidebar-primary/5 transition-all hover:shadow-sm"
        >
          <PlatformLogo name={p} />
          <span className="text-sm font-medium">{platformLabel(p)}</span>
        </button>
      ))}
    </div>
  );

  const platformList = (
    <div className="space-y-6">
      {localPlatforms.length > 0 && (
        <div>
          <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">Local Agents</h3>
          {platformGrid(localPlatforms, true)}
        </div>
      )}
      {remotePlatforms.length > 0 && (
        <div>
          <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">Remote Agents</h3>
          {platformGrid(remotePlatforms, false)}
        </div>
      )}
      <div>
        <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">Connectors</h3>
        {platformGrid([...CONNECTOR_PLATFORMS], false)}
      </div>
    </div>
  );

  const connectorTutorialView = selectedPlatform && isConnectorPlatform(selectedPlatform) ? (() => {
    const isClaude = selectedPlatform === 'claude.ai';
    const steps = isClaude
      ? [
          { text: 'Open Claude.ai → Settings → Connectors' },
          { text: 'Click "Add custom connector"' },
        ]
      : [
          { text: 'Open ChatGPT → Settings → Apps & Connectors' },
          { text: 'Click "New App"' },
        ];
    return (
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          {isClaude
            ? 'Follow these steps to connect Claude.ai to your workspace:'
            : 'Follow these steps to connect ChatGPT to your workspace:'}
        </p>
        <ol className="space-y-2 text-sm">
          {steps.map((s, i) => (
            <li key={i} className="flex gap-2">
              <span className="shrink-0 w-5 h-5 rounded-full bg-sidebar-primary/10 text-sidebar-primary text-xs flex items-center justify-center font-medium">{i + 1}</span>
              <span>{s.text}</span>
            </li>
          ))}
          <li className="flex gap-2">
            <span className="shrink-0 w-5 h-5 rounded-full bg-sidebar-primary/10 text-sidebar-primary text-xs flex items-center justify-center font-medium">{steps.length + 1}</span>
            <span>Fill in the following:</span>
          </li>
        </ol>
        <div className="space-y-3 bg-black/[0.03] dark:bg-white/[0.05] rounded-lg p-4 border border-border">
          <div>
            <div className="text-xs text-muted-foreground mb-1">Name</div>
            <div className="flex items-center gap-2">
              <code className="text-sm flex-1 font-mono">AgentOffice</code>
              <button onClick={() => handleCopyText('AgentOffice')} className="text-xs px-2 py-1 rounded bg-sidebar-primary/10 hover:bg-sidebar-primary/20 transition-colors">
                <Copy className="h-3 w-3" />
              </button>
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground mb-1">MCP Server URL</div>
            <div className="flex items-center gap-2">
              <code className="text-sm flex-1 font-mono break-all">{mcpUrl}</code>
              <button onClick={() => handleCopyText(mcpUrl)} className="text-xs px-2 py-1 rounded bg-sidebar-primary/10 hover:bg-sidebar-primary/20 transition-colors">
                <Copy className="h-3 w-3" />
              </button>
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground mb-1">Authentication</div>
            <code className="text-sm font-mono">OAuth</code>
          </div>
        </div>
        <ol start={steps.length + 2} className="space-y-2 text-sm">
          <li className="flex gap-2">
            <span className="shrink-0 w-5 h-5 rounded-full bg-sidebar-primary/10 text-sidebar-primary text-xs flex items-center justify-center font-medium">{steps.length + 2}</span>
            <span>Click {isClaude ? '"Add"' : '"Create"'}, then log in and authorize on the page that opens</span>
          </li>
          <li className="flex gap-2">
            <span className="shrink-0 w-5 h-5 rounded-full bg-sidebar-primary/10 text-sidebar-primary text-xs flex items-center justify-center font-medium">{steps.length + 3}</span>
            <span>Once authorized, the agent will appear in your Agents list automatically</span>
          </li>
        </ol>
      </div>
    );
  })() : null;

  const promptView = (
    <div>
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm text-muted-foreground">{t('actions.sendToAgent')}</p>
        {!loadingPrompt && promptText && (
          <button
            onClick={handleCopy}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors shrink-0',
              copied ? 'bg-green-500 text-white' : 'bg-sidebar-primary text-white hover:opacity-90'
            )}
          >
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? t('actions.copied') : t('actions.copyPrompt')}
          </button>
        )}
      </div>
      {loadingPrompt ? (
        <div className="flex items-center justify-center py-12">
          <div className="w-6 h-6 border-2 border-sidebar-primary/30 border-t-sidebar-primary rounded-full animate-spin" />
        </div>
      ) : (
        <pre className="text-xs text-foreground/80 bg-black/[0.03] dark:bg-white/[0.05] rounded-lg p-4 overflow-y-auto whitespace-pre-wrap font-mono leading-relaxed max-h-[50vh] border border-border">
          {promptText}
        </pre>
      )}
    </div>
  );

  const permissionsView = (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Configure which tools auto-execute and which require confirmation.
      </p>
      {CLAUDE_CODE_TOOL_CATEGORIES.map(cat => (
        <div key={cat.id} className="flex items-center justify-between py-2">
          <div>
            <div className="text-sm font-medium">{cat.label}</div>
            <div className="text-xs text-muted-foreground">{cat.description}</div>
          </div>
          <select
            value={permissions[cat.id]}
            onChange={e => setPermissions(prev => ({ ...prev, [cat.id]: e.target.value as PermissionMode }))}
            className="text-xs px-2 py-1 rounded-md border border-border bg-background"
          >
            <option value="always">Always</option>
            <option value="ask">Ask</option>
          </select>
        </div>
      ))}
      <button
        onClick={() => doProvision('claude-code', permissions)}
        disabled={loadingPrompt}
        className="w-full py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
        style={{ backgroundColor: 'hsl(var(--sidebar-primary))', color: 'hsl(var(--sidebar-primary-foreground))' }}
      >
        {loadingPrompt ? 'Creating...' : 'Create Agent'}
      </button>
    </div>
  );

  if (isMobile) {
    return (
      <BottomSheet open={open} onClose={onClose} title={selectedPlatform ? undefined : t('toolbar.connectAgents')} initialHeight="full">
        <div className="flex flex-col h-full">
          {selectedPlatform && (
            <div className="flex items-center gap-2 px-4 py-2 border-b border-border shrink-0">
              <button onClick={() => { setSelectedPlatform(null); setPromptText(''); setCopied(false); setShowPermissions(false); setShowConnectorTutorial(false); }} className="p-1 text-muted-foreground">
                <ArrowLeft className="h-4 w-4" />
              </button>
              <span className="text-sm font-semibold">{platformLabel(selectedPlatform)}</span>
            </div>
          )}
          <div className="flex-1 overflow-y-auto px-4 py-3">
            {!selectedPlatform ? platformList : showConnectorTutorial ? connectorTutorialView : showPermissions ? permissionsView : promptView}
          </div>
        </div>
      </BottomSheet>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40" />
      <div
        className="relative z-10 bg-background rounded-xl shadow-xl w-full max-w-lg max-h-[70vh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex flex-col h-full">
          <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
            <div className="flex items-center gap-2">
              {selectedPlatform && (
                <button
                  onClick={() => { setSelectedPlatform(null); setPromptText(''); setCopied(false); setShowPermissions(false); setShowConnectorTutorial(false); }}
                  className="p-1 -ml-1 rounded-lg hover:bg-black/[0.05] dark:hover:bg-white/[0.1] transition-colors"
                >
                  <ArrowLeft className="h-4 w-4 text-foreground/60" />
                </button>
              )}
              <h2 className="text-base font-semibold text-foreground">
                {selectedPlatform ? platformLabel(selectedPlatform) : t('toolbar.connectAgents')}
              </h2>
            </div>
            <button
              onClick={onClose}
              className="p-1 rounded-lg hover:bg-black/[0.05] dark:hover:bg-white/[0.1] transition-colors"
            >
              <X className="h-4 w-4 text-foreground/60" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-5 py-4">
            {!selectedPlatform ? platformList : showConnectorTutorial ? connectorTutorialView : showPermissions ? permissionsView : promptView}
          </div>
        </div>
      </div>
    </div>
  );
}
