'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Pencil, Trash2, Key, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useT } from '@/lib/i18n';
import { AgentTerminalTab, ensureGlobalListener, resetGlobalListener } from './AgentTerminalTab';
import { AgentChatView } from './AgentChatView';

type ViewMode = 'chat' | 'terminal';

const THEME_COLORS = {
  light: { bg: '#EBEFEB', border: '#d4d6d4', text: '#1a1a1a', textMuted: '#666', textDim: '#999', hover: '#dddedd', active: '#ccceca', input: '#f5f5f3', inputBorder: '#bbb', separator: '#D4DBD4' },
  dark: { bg: '#1a1a2e', border: '#333', text: '#e0e0e0', textMuted: '#808080', textDim: '#666', hover: '#2a2a4e', active: '#3a3a5e', input: '#12122a', inputBorder: '#444', separator: '#333' },
};

function ChatBubbleIcon({ className }: { className?: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
      <g clipPath="url(#clip_cb)">
        <path d="M1.99462 10.8951C2.09265 11.1424 2.11447 11.4133 2.05729 11.6731L1.34729 13.8664C1.32441 13.9777 1.33033 14.0929 1.36447 14.2012C1.39862 14.3095 1.45987 14.4073 1.5424 14.4853C1.62494 14.5633 1.72603 14.6189 1.83609 14.6469C1.94615 14.6749 2.06153 14.6742 2.17129 14.6451L4.44662 13.9798C4.69177 13.9312 4.94564 13.9524 5.17929 14.0411C6.60288 14.7059 8.21553 14.8466 9.73272 14.4383C11.2499 14.0299 12.5741 13.0989 13.4718 11.8094C14.3694 10.5198 14.7827 8.95472 14.6388 7.39015C14.4949 5.82557 13.8031 4.36209 12.6853 3.25791C11.5676 2.15373 10.0958 1.47981 8.52955 1.35504C6.96333 1.23028 5.40338 1.6627 4.12492 2.57601C2.84646 3.48931 1.93164 4.82481 1.54189 6.34687C1.15213 7.86894 1.31247 9.47975 1.99462 10.8951Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      </g>
      <defs><clipPath id="clip_cb"><rect width="16" height="16" fill="white"/></clipPath></defs>
    </svg>
  );
}

function TerminalIcon({ className }: { className?: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
      <path d="M4.6665 7.33366L5.99984 6.00033L4.6665 4.66699" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M7.3335 8.66699H10.0002" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M12.6667 2H3.33333C2.59695 2 2 2.59695 2 3.33333V12.6667C2 13.403 2.59695 14 3.33333 14H12.6667C13.403 14 14 13.403 14 12.6667V3.33333C14 2.59695 13.403 2 12.6667 2Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

function ChatSettingsIcon({ className }: { className?: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
      <path d="M6.66699 9.25C7.08098 9.25026 7.41699 9.58595 7.41699 10C7.41699 10.4141 7.08098 10.7497 6.66699 10.75H4.00098C3.49276 10.75 3.00493 10.9522 2.64551 11.3115C2.28606 11.671 2.08398 12.1587 2.08398 12.667V14C2.08398 14.4141 1.74797 14.7497 1.33398 14.75C0.919771 14.75 0.583008 14.4142 0.583008 14V12.667C0.583008 11.7608 0.944212 10.8917 1.58496 10.251C2.22569 9.61038 3.09493 9.25 4.00098 9.25H6.66699ZM12.3281 7.25C12.4869 6.86753 12.9261 6.686 13.3086 6.84473C13.6905 7.00365 13.8721 7.44199 13.7139 7.82422L13.7051 7.84473C13.8723 7.97716 14.0229 8.12868 14.1553 8.2959L14.1777 8.28711C14.5603 8.12887 14.9987 8.30992 15.1572 8.69238C15.3156 9.07475 15.1341 9.51305 14.752 9.67188L14.7295 9.68066C14.7416 9.78551 14.75 9.8919 14.75 10C14.75 10.1078 14.7416 10.2138 14.7295 10.3184L14.752 10.3281C15.1342 10.4869 15.3156 10.9262 15.1572 11.3086C14.9985 11.6907 14.5601 11.8719 14.1777 11.7139L14.1553 11.7041C14.0229 11.8714 13.8713 12.0218 13.7041 12.1543L13.7139 12.1768C13.8719 12.5594 13.6891 12.9989 13.3066 13.1572C12.924 13.3152 12.4854 13.1326 12.3271 12.75L12.3184 12.7295C12.2138 12.7416 12.1078 12.75 12 12.75C11.8919 12.75 11.7855 12.7416 11.6807 12.7295L11.6719 12.751C11.5132 13.1334 11.0749 13.3148 10.6924 13.1562C10.3098 12.9976 10.1286 12.5594 10.2871 12.1768L10.2949 12.1553C10.1276 12.0227 9.97623 11.8715 9.84375 11.7041L9.82422 11.7129C9.44155 11.8713 9.00221 11.6893 8.84375 11.3066C8.68576 10.9241 8.86758 10.4855 9.25 10.3271L9.26953 10.3184C9.25748 10.2139 9.25 10.1077 9.25 10C9.25 9.89161 9.25733 9.78481 9.26953 9.67969L9.25 9.67188C8.86747 9.51314 8.6861 9.07493 8.84473 8.69238C9.00352 8.30997 9.44173 8.1285 9.82422 8.28711L9.84375 8.29492C9.97624 8.1276 10.1276 7.97624 10.2949 7.84375L10.2871 7.82422C10.1285 7.44167 10.3099 7.00346 10.6924 6.84473C11.0749 6.6861 11.5131 6.86747 11.6719 7.25L11.6797 7.26953C11.7848 7.25733 11.8916 7.25 12 7.25C12.1081 7.25 12.2145 7.25741 12.3193 7.26953L12.3281 7.25ZM12 8.75C11.3096 8.75 10.75 9.30964 10.75 10C10.75 10.6904 11.3096 11.25 12 11.25C12.6904 11.25 13.25 10.6904 13.25 10C13.25 9.30964 12.6904 8.75 12 8.75ZM6.00098 1.25C7.88758 1.25044 9.41699 2.78029 9.41699 4.66699C9.41682 6.55354 7.88747 8.08257 6.00098 8.08301C4.11411 8.08301 2.58416 6.55382 2.58398 4.66699C2.58398 2.78002 4.114 1.25 6.00098 1.25ZM6.00098 2.75C4.94243 2.75 4.08398 3.60845 4.08398 4.66699C4.08416 5.72539 4.94254 6.58301 6.00098 6.58301C7.05904 6.58257 7.91682 5.72512 7.91699 4.66699C7.91699 3.60872 7.05915 2.75044 6.00098 2.75Z" fill="currentColor" fillOpacity="0.7"/>
    </svg>
  );
}

interface AgentTerminal {
  agentId: string;
  agentName: string;
  displayName?: string;
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
  onDeleteAgent?: (agentId: string) => void;
  onRenameAgent?: (agentId: string, newName: string) => void;
  onResetToken?: (agentId: string) => void;
  colorTheme?: 'light' | 'dark';
  isElectron?: boolean;
}

export function SidebarTerminal({
  agents,
  selectedAgentId,
  terminalHeight,
  onTerminalHeightChange,
  onAgentExit,
  onDeleteAgent,
  onRenameAgent,
  onResetToken,
  colorTheme = 'light',
  isElectron = false,
}: SidebarTerminalProps) {
  const { t } = useT();
  const c = THEME_COLORS[colorTheme];
  const [viewMode, setViewMode] = useState<ViewMode>('chat');
  const [showSettings, setShowSettings] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameValue, setNameValue] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmResetToken, setConfirmResetToken] = useState(false);
  const settingsRef = useRef<HTMLDivElement>(null);
  const resizeRef = useRef<{ startY: number; startHeight: number } | null>(null);

  useEffect(() => {
    const api = (window as any).electronAPI;
    if (!api) return;
    ensureGlobalListener();
    api.onTerminalExit((agentId: string) => { onAgentExit(agentId); });
    return () => { api.removeTerminalListeners(); resetGlobalListener(); };
  }, [onAgentExit]);

  useEffect(() => {
    if (!showSettings) return;
    const handler = (e: MouseEvent) => {
      if (settingsRef.current && !settingsRef.current.contains(e.target as Node)) {
        setShowSettings(false);
        setConfirmDelete(false);
        setConfirmResetToken(false);
        setEditingName(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showSettings]);

  const onResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    resizeRef.current = { startY: e.clientY, startHeight: terminalHeight };
    const onMouseMove = (ev: MouseEvent) => {
      if (!resizeRef.current) return;
      const delta = resizeRef.current.startY - ev.clientY;
      const newHeight = Math.min(Math.max(resizeRef.current.startHeight + delta, 120), window.innerHeight * 0.85);
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
  const agentLabel = selectedAgent?.displayName || selectedAgent?.agentName || selectedAgentId;

  return (
    <div className="flex flex-col shrink-0" style={{ height: terminalHeight, backgroundColor: c.bg }}>
      {/* Top separator bar */}
      <div style={{ height: 2, backgroundColor: c.separator, flexShrink: 0 }} />

      <div
        className="h-1 cursor-row-resize hover:bg-sidebar-primary/30 transition-colors shrink-0"
        onMouseDown={onResizeMouseDown}
      />

      {/* Title bar */}
      <div
        className="flex items-center h-8 px-2 shrink-0 gap-1"
        style={{ borderBottom: `1px solid ${c.border}` }}
      >
        <span className="text-[12px] font-medium truncate flex-1 pl-1" style={{ color: c.text }}>
          {agentLabel}
        </span>

        <div className="flex items-center gap-0.5">
          <button
            onClick={() => setViewMode('chat')}
            className="p-1 rounded transition-colors"
            style={{
              color: viewMode === 'chat' ? c.text : c.textMuted,
              backgroundColor: viewMode === 'chat' ? c.active : 'transparent',
            }}
            title="Chat"
          >
            <ChatBubbleIcon className="h-3.5 w-3.5" />
          </button>
          {isElectron && (
            <button
              onClick={() => {
                setViewMode('terminal');
                setTimeout(() => window.dispatchEvent(new Event('terminal:refit')), 50);
              }}
              className="p-1 rounded transition-colors"
              style={{
                color: viewMode === 'terminal' ? c.text : c.textMuted,
                backgroundColor: viewMode === 'terminal' ? c.active : 'transparent',
              }}
              title="Terminal"
            >
              <TerminalIcon className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        <div className="relative" ref={settingsRef}>
          <button
            onClick={() => {
              setShowSettings(v => !v);
              setConfirmDelete(false);
              setConfirmResetToken(false);
              setEditingName(false);
            }}
            className="p-1 rounded transition-colors"
            style={{ color: c.textMuted }}
            title="Settings"
          >
            <ChatSettingsIcon className="h-3.5 w-3.5" />
          </button>

          {showSettings && (
            <div
              className="absolute right-0 top-full mt-1 z-50 rounded-lg shadow-lg py-1 min-w-[160px]"
              style={{ backgroundColor: c.hover, border: `1px solid ${c.border}` }}
            >
              {editingName ? (
                <div className="px-2 py-1.5 flex items-center gap-1">
                  <input
                    className="flex-1 text-[11px] px-1.5 py-0.5 rounded outline-none min-w-0"
                    style={{ backgroundColor: c.input, border: `1px solid ${c.inputBorder}`, color: c.text }}
                    value={nameValue}
                    onChange={e => setNameValue(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' && nameValue.trim()) {
                        onRenameAgent?.(selectedAgentId, nameValue.trim());
                        setEditingName(false);
                        setShowSettings(false);
                      }
                      if (e.key === 'Escape') setEditingName(false);
                    }}
                    autoFocus
                  />
                  <button
                    onClick={() => {
                      if (nameValue.trim()) {
                        onRenameAgent?.(selectedAgentId, nameValue.trim());
                        setEditingName(false);
                        setShowSettings(false);
                      }
                    }}
                    style={{ color: c.text }}
                    className="p-0.5"
                  >
                    <Check className="h-3 w-3" />
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => { setNameValue(agentLabel); setEditingName(true); }}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-[11px] transition-colors text-left"
                  style={{ color: c.text }}
                >
                  <Pencil className="h-3 w-3" style={{ color: c.textMuted }} />
                  {t('actions.rename') || 'Rename'}
                </button>
              )}

              {confirmResetToken ? (
                <div className="px-3 py-1.5 flex items-center gap-1">
                  <span className="text-[10px] flex-1" style={{ color: c.textDim }}>{t('actions.resetTokenConfirm') || 'Reset token?'}</span>
                  <button onClick={() => { onResetToken?.(selectedAgentId); setConfirmResetToken(false); setShowSettings(false); }}
                    className="px-1.5 py-0.5 text-[10px] font-medium text-white bg-red-500 rounded hover:bg-red-600">
                    {t('common.confirm') || 'Confirm'}
                  </button>
                  <button onClick={() => setConfirmResetToken(false)}
                    className="px-1.5 py-0.5 text-[10px] font-medium rounded"
                    style={{ color: c.textDim, backgroundColor: c.active }}>
                    {t('common.cancel') || 'Cancel'}
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setConfirmResetToken(true)}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-[11px] transition-colors text-left"
                  style={{ color: c.text }}
                >
                  <Key className="h-3 w-3" style={{ color: c.textMuted }} />
                  {t('actions.resetToken') || 'Reset Token'}
                </button>
              )}

              <div className="my-0.5" style={{ borderTop: `1px solid ${c.border}` }} />

              {confirmDelete ? (
                <div className="px-3 py-1.5 flex items-center gap-1">
                  <span className="text-[10px] flex-1" style={{ color: c.textDim }}>{t('actions.confirmDelete') || 'Delete?'}</span>
                  <button onClick={() => { onDeleteAgent?.(selectedAgentId); setConfirmDelete(false); setShowSettings(false); }}
                    className="px-1.5 py-0.5 text-[10px] font-medium text-white bg-red-500 rounded hover:bg-red-600">
                    {t('actions.delete') || 'Delete'}
                  </button>
                  <button onClick={() => setConfirmDelete(false)}
                    className="px-1.5 py-0.5 text-[10px] font-medium rounded"
                    style={{ color: c.textDim, backgroundColor: c.active }}>
                    {t('common.cancel') || 'Cancel'}
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setConfirmDelete(true)}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-[11px] text-red-400 transition-colors text-left"
                >
                  <Trash2 className="h-3 w-3" />
                  {t('actions.delete') || 'Delete'}
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Content area */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {viewMode === 'chat' && (
          <AgentChatView
            agentId={selectedAgentId}
            agentName={agentLabel}
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
