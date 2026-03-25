'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import {
  X, ChevronLeft, ChevronRight, Trash2, Plus, Star, CheckSquare,
  Type, Hash, Calendar, Mail, AlignLeft, Link, Phone, Clock, DollarSign,
  Percent, List, Tags, Braces, Paperclip, User, Sigma, Link2, Search, GitBranch,
  MessageSquare, Upload, X as XIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import * as nc from '@/lib/api/nocodb';
import * as gw from '@/lib/api/gateway';
import { Comments } from '@/components/comments/Comments';

// ── Shared constants (kept in sync with TableEditor) ──

const SELECT_COLORS = [
  '#d4e5ff', '#d1f0e0', '#fde2cc', '#fdd8d8', '#e8d5f5',
  '#d5e8f5', '#fff3bf', '#f0d5e8', '#d5f5e8', '#e8e8d5',
];

function getOptionColor(color?: string, idx?: number) {
  if (color) return color;
  return SELECT_COLORS[(idx || 0) % SELECT_COLORS.length];
}

const READONLY_TYPES = new Set(['ID', 'AutoNumber', 'CreatedTime', 'LastModifiedTime', 'CreatedBy', 'LastModifiedBy', 'Formula', 'Rollup', 'Lookup', 'Count', 'Links']);

/** Resolve NocoDB attachment path to a proxied URL */
function ncAttachmentUrl(a: { signedPath?: string; path?: string }): string {
  const p = a.signedPath || a.path || '';
  if (!p) return '';
  if (p.startsWith('http://') || p.startsWith('https://')) return p;
  if (p.startsWith('/api/')) return p;
  return `/api/gateway/data/download${p.startsWith('/') ? '' : '/'}${p}`;
}

function getColIcon(uidt: string) {
  const map: Record<string, React.ComponentType<{ className?: string }>> = {
    SingleLineText: Type, LongText: AlignLeft, Email: Mail, URL: Link, PhoneNumber: Phone,
    Number: Hash, Decimal: Hash, Currency: DollarSign, Percent: Percent, Rating: Star,
    Date: Calendar, DateTime: Calendar, Time: Clock, Year: Calendar,
    Checkbox: CheckSquare, SingleSelect: List, MultiSelect: Tags,
    Links: Link2, Lookup: Search, Rollup: Sigma, Formula: GitBranch,
    Attachment: Paperclip, JSON: Braces, User: User,
  };
  return map[uidt] || Type;
}

// ── Row Detail Panel ──

interface RowDetailPanelProps {
  row: Record<string, unknown>;
  columns: nc.NCColumn[];
  tableId: string;
  rowIndex: number;
  totalRows: number;
  onClose: () => void;
  onNavigate: (direction: 'prev' | 'next') => void;
  onRefresh: () => void;
  onDeleteRow: (rowId: number) => void;
  initialShowComments?: boolean;
  onCommentChange?: () => void;
}

export function RowDetailPanel({
  row, columns, tableId, rowIndex, totalRows,
  onClose, onNavigate, onRefresh, onDeleteRow,
  initialShowComments, onCommentChange,
}: RowDetailPanelProps) {
  const rowId = row.Id as number;
  const rowIdStr = String(rowId);
  const displayCols = columns.filter(c => c.title !== 'created_by');
  const titleCol = displayCols.find(c => c.primary_key);
  const titleValue = titleCol ? String(row[titleCol.title] || '') : `#${rowId}`;
  const [showComments, setShowComments] = useState(initialShowComments ?? false);

  // Keyboard navigation
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return; }
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
      if (e.key === 'ArrowUp' || e.key === 'k') onNavigate('prev');
      if (e.key === 'ArrowDown' || e.key === 'j') onNavigate('next');
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose, onNavigate]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className={cn(
          "bg-card border border-border rounded-xl shadow-2xl max-h-[85vh] flex flex-col",
          showComments ? "w-full max-w-5xl" : "w-full max-w-2xl"
        )}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border shrink-0">
          <div className="flex items-center gap-1">
            <button
              onClick={() => onNavigate('prev')}
              disabled={rowIndex <= 0}
              className="p-1 text-muted-foreground hover:text-foreground disabled:opacity-30"
              title="上一行 (↑)"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="text-xs text-muted-foreground tabular-nums">{rowIndex + 1} / {totalRows}</span>
            <button
              onClick={() => onNavigate('next')}
              disabled={rowIndex >= totalRows - 1}
              className="p-1 text-muted-foreground hover:text-foreground disabled:opacity-30"
              title="下一行 (↓)"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
          <h3 className="flex-1 text-sm font-semibold text-foreground truncate">{titleValue}</h3>
          <button
            onClick={() => setShowComments(v => !v)}
            className={cn('p-1.5 rounded transition-colors', showComments ? 'text-sidebar-primary bg-sidebar-primary/10' : 'text-muted-foreground hover:text-foreground')}
            title="行评论"
          >
            <MessageSquare className="h-4 w-4" />
          </button>
          <button
            onClick={() => { onDeleteRow(rowId); onClose(); }}
            className="p-1.5 text-muted-foreground hover:text-destructive"
            title="删除行"
          >
            <Trash2 className="h-4 w-4" />
          </button>
          <button onClick={onClose} className="p-1.5 text-muted-foreground hover:text-foreground" title="关闭 (Esc)">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Content: Fields + Comments */}
        <div className="flex flex-1 min-h-0 overflow-hidden">
          {/* Fields */}
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-0.5 min-w-0">
            {displayCols.map(col => (
              <FieldRow
                key={col.column_id}
                col={col}
                value={row[col.title]}
                rowId={rowId}
                tableId={tableId}
                onSaved={onRefresh}
              />
            ))}
          </div>

          {/* Comments sidebar */}
          {showComments && (
            <div className="w-80 border-l border-border flex flex-col shrink-0 overflow-hidden">
              <Comments
                queryKey={['row-comments', tableId, rowIdStr]}
                fetchComments={() => gw.listTableComments(tableId, rowIdStr)}
                postComment={(text, parentId) => gw.commentOnTable(tableId, text, parentId, rowIdStr).then(() => { onCommentChange?.(); })}
                editComment={(id, text) => gw.editTableComment(id, text)}
                deleteComment={(id) => gw.deleteTableComment(id).then(() => { onCommentChange?.(); })}
                resolveComment={(id) => gw.resolveTableComment(id)}
                unresolveComment={(id) => gw.unresolveTableComment(id)}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Individual field row ──

function FieldRow({ col, value, rowId, tableId, onSaved }: {
  col: nc.NCColumn;
  value: unknown;
  rowId: number;
  tableId: string;
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [editVal, setEditVal] = useState('');
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);
  const isReadonly = col.primary_key || READONLY_TYPES.has(col.type);
  const ColIcon = getColIcon(col.type);

  const startEdit = useCallback(() => {
    if (isReadonly || col.type === 'Checkbox' || col.type === 'Rating' || col.type === 'Attachment') return;
    setEditVal(value == null ? '' : String(value));
    setEditing(true);
  }, [isReadonly, col.type, value]);

  useEffect(() => {
    if (editing && inputRef.current) inputRef.current.focus();
  }, [editing]);

  const save = async () => {
    if (!editing) return;
    setSaving(true);
    try {
      let saveVal: unknown = editVal;
      if (col.type === 'Number' || col.type === 'Decimal' || col.type === 'Currency' || col.type === 'Percent' || col.type === 'Year') {
        saveVal = editVal === '' ? null : Number(editVal);
      }
      await nc.updateRow(tableId, rowId, { [col.title]: saveVal });
      onSaved();
    } catch (e) {
      console.error('Save failed:', e);
    } finally {
      setSaving(false);
      setEditing(false);
    }
  };

  const toggleCheckbox = async () => {
    try {
      const newVal = value ? 0 : 1;
      await nc.updateRow(tableId, rowId, { [col.title]: newVal });
      onSaved();
    } catch (e) {
      console.error('Toggle failed:', e);
    }
  };

  const setRating = async (v: number) => {
    try {
      await nc.updateRow(tableId, rowId, { [col.title]: v });
      onSaved();
    } catch (e) {
      console.error('Set rating failed:', e);
    }
  };

  const setSelectVal = async (v: string) => {
    try {
      await nc.updateRow(tableId, rowId, { [col.title]: v });
      onSaved();
    } catch (e) {
      console.error('Set select failed:', e);
    }
  };

  const toggleMulti = async (option: string) => {
    const currentStr = value ? String(value) : '';
    const items = currentStr ? currentStr.split(',').map(s => s.trim()) : [];
    const newItems = items.includes(option) ? items.filter(i => i !== option) : [...items, option];
    try {
      await nc.updateRow(tableId, rowId, { [col.title]: newItems.join(',') });
      onSaved();
    } catch (e) {
      console.error('Toggle multi failed:', e);
    }
  };

  // Use text input for all — avoid browser native date/time pickers
  const getInputType = () => {
    switch (col.type) {
      case 'Number': case 'Decimal': case 'Currency': case 'Percent': case 'Year': return 'text';
      case 'Email': return 'email';
      case 'URL': return 'url';
      case 'PhoneNumber': return 'tel';
      default: return 'text';
    }
  };

  const meta = col.meta as Record<string, unknown> | undefined;

  return (
    <div className="flex items-start gap-3 py-2.5 border-b border-border/50 last:border-0">
      {/* Label */}
      <div className="w-40 shrink-0 flex items-center gap-1.5 pt-1">
        <ColIcon className="h-3.5 w-3.5 text-muted-foreground/60 shrink-0" />
        <span className="text-xs text-muted-foreground truncate">{col.title}</span>
      </div>

      {/* Value */}
      <div className="flex-1 min-w-0">
        {/* Checkbox — aligned with grid: HTML checkbox */}
        {col.type === 'Checkbox' ? (
          <div className="flex items-center py-1">
            <input
              type="checkbox"
              checked={!!value}
              onChange={toggleCheckbox}
              className="w-4 h-4 accent-sidebar-primary cursor-pointer"
              disabled={isReadonly}
            />
          </div>
        ) : /* Rating — read meta.max and meta.iconIdx like grid */
        col.type === 'Rating' && !isReadonly ? (
          <div className="flex items-center gap-0.5 py-0.5">
            {(() => {
              const max = (meta?.max as number) || 5;
              const iconType = (meta?.iconIdx as string) || 'star';
              const iconMap: Record<string, [string, string]> = {
                star: ['★', '☆'], heart: ['❤', '♡'], thumb: ['👍', '·'], flag: ['🚩', '·'],
                fire: ['🔥', '·'], smile: ['😊', '·'], flower: ['🌸', '·'],
                bolt: ['⚡', '·'], puzzle: ['🧩', '·'], number: ['🔢', '·'],
              };
              const [filled, empty] = iconMap[iconType] || iconMap.star;
              const current = typeof value === 'number' ? value : 0;
              return Array.from({ length: max }, (_, i) => (
                <button
                  key={i}
                  onClick={() => setRating(i + 1 === current ? 0 : i + 1)}
                  className="text-base leading-none hover:scale-125 transition-transform"
                >
                  {i < current ? filled : empty}
                </button>
              ));
            })()}
          </div>
        ) : /* SingleSelect */
        col.type === 'SingleSelect' && !isReadonly ? (
          <SelectField value={value} col={col} onSelect={setSelectVal} />
        ) : /* MultiSelect */
        col.type === 'MultiSelect' && !isReadonly ? (
          <MultiSelectField value={value} col={col} onToggle={toggleMulti} />
        ) : /* Editing state */
        editing ? (
          col.type === 'LongText' || col.type === 'JSON' ? (
            <textarea
              ref={inputRef as React.RefObject<HTMLTextAreaElement>}
              value={editVal}
              onChange={e => setEditVal(e.target.value)}
              onBlur={save}
              onKeyDown={e => {
                if (e.key === 'Escape') { setEditing(false); return; }
                if (e.key === 'Enter' && e.metaKey) { e.preventDefault(); save(); }
              }}
              className={cn(
                'w-full bg-muted/50 rounded-md px-2 py-1.5 text-sm text-foreground outline-none ring-1 ring-sidebar-primary resize-none min-h-[100px]',
                col.type === 'JSON' && 'font-mono text-xs'
              )}
            />
          ) : (
            <input
              ref={inputRef as React.RefObject<HTMLInputElement>}
              value={editVal}
              onChange={e => setEditVal(e.target.value)}
              onBlur={save}
              onKeyDown={e => {
                if (e.key === 'Escape') { setEditing(false); return; }
                if (e.key === 'Enter') { e.preventDefault(); save(); }
              }}
              type={getInputType()}
              inputMode={['Number', 'Decimal', 'Currency', 'Percent', 'Year'].includes(col.type) ? 'decimal' : undefined}
              className="w-full bg-muted/50 rounded-md px-2 py-1.5 text-sm text-foreground outline-none ring-1 ring-sidebar-primary"
            />
          )
        ) : /* Display state */
        (
          <div
            onClick={!isReadonly ? startEdit : undefined}
            className={cn(
              'text-sm py-0.5 min-h-[28px] flex items-center',
              !isReadonly && 'cursor-pointer rounded-md hover:bg-muted/50 px-2 -mx-2',
              isReadonly && 'text-foreground/60'
            )}
          >
            <FieldDisplay value={value} col={col} />
          </div>
        )}
      </div>
    </div>
  );
}

// ── Field display — aligned with grid CellDisplay ──

function FieldDisplay({ value, col }: { value: unknown; col: nc.NCColumn }) {
  if (value == null || value === '') {
    return <span className="text-muted-foreground/30">空</span>;
  }
  const str = String(value);
  const { type } = col;
  const meta = col.meta as Record<string, unknown> | undefined;

  if (type === 'SingleSelect') {
    const opt = col.options?.find(o => o.title === str);
    return (
      <span className="inline-block px-2 py-0.5 rounded text-xs" style={{ backgroundColor: getOptionColor(opt?.color, 0), color: '#1a1a2e' }}>
        {str}
      </span>
    );
  }
  if (type === 'MultiSelect') {
    const items = str.split(',').map(s => s.trim()).filter(Boolean);
    return (
      <div className="flex flex-wrap gap-1">
        {items.map((item, i) => {
          const opt = col.options?.find(o => o.title === item);
          return (
            <span key={i} className="inline-block px-1.5 py-0.5 rounded text-[11px]" style={{ backgroundColor: getOptionColor(opt?.color, i), color: '#1a1a2e' }}>
              {item}
            </span>
          );
        })}
      </div>
    );
  }
  if (type === 'URL') {
    return <a href={str} target="_blank" rel="noopener noreferrer" className="text-sidebar-primary hover:underline break-all">{str}</a>;
  }
  if (type === 'Email') {
    return <a href={`mailto:${str}`} className="text-sidebar-primary hover:underline">{str}</a>;
  }
  if (type === 'PhoneNumber') {
    return <a href={`tel:${str}`} className="text-sidebar-primary hover:underline">{str}</a>;
  }
  // Date / DateTime / CreatedTime / LastModifiedTime — aligned with grid (use meta.date_format)
  if (type === 'Date' || type === 'DateTime' || type === 'CreatedTime' || type === 'LastModifiedTime') {
    const d = new Date(str);
    if (isNaN(d.getTime())) return <span className="text-foreground/70">{str}</span>;
    const fmt = (meta?.date_format as string) || 'YYYY-MM-DD';
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    let datePart = fmt
      .replace('YYYY', String(y))
      .replace('MM', m)
      .replace('DD', day);
    const showTime = type !== 'Date';
    const timePart = showTime ? ` ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` : '';
    return <span className="text-foreground/70">{datePart}{timePart}</span>;
  }
  // Number / Decimal / Currency / Percent / AutoNumber — aligned with grid (use meta formatting)
  if (type === 'Number' || type === 'Decimal' || type === 'AutoNumber' || type === 'Currency' || type === 'Percent') {
    const num = parseFloat(str);
    if (isNaN(num)) return <span className="tabular-nums">{str}</span>;
    const decimals = (meta?.decimals as number) ?? (type === 'Decimal' || type === 'Currency' ? 2 : type === 'Percent' ? 1 : 0);
    const thousands = meta?.thousands ?? (type === 'Currency');
    const prefix = (meta?.prefix as string) || (type === 'Currency' ? '$' : '');
    const suffix = (meta?.suffix as string) || (type === 'Percent' ? '%' : '');
    const formatted = thousands
      ? num.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
      : num.toFixed(decimals);
    return <span className="tabular-nums">{prefix}{formatted}{suffix}</span>;
  }
  if (type === 'Checkbox') {
    return (
      <div className="flex items-center">
        <input type="checkbox" checked={!!value} readOnly className="w-4 h-4 accent-sidebar-primary" />
      </div>
    );
  }
  // Rating — aligned with grid (use meta.max and meta.iconIdx)
  if (type === 'Rating') {
    const n = typeof value === 'number' ? value : parseInt(str) || 0;
    const max = (meta?.max as number) || 5;
    const iconType = (meta?.iconIdx as string) || 'star';
    const iconMap: Record<string, [string, string]> = {
      star: ['★', '☆'], heart: ['❤', '♡'], thumb: ['👍', '·'], flag: ['🚩', '·'],
      fire: ['🔥', '·'], smile: ['😊', '·'], flower: ['🌸', '·'],
      bolt: ['⚡', '·'], puzzle: ['🧩', '·'], number: ['🔢', '·'],
    };
    const [filled, empty] = iconMap[iconType] || iconMap.star;
    return <span>{filled.repeat(n)}{empty.repeat(Math.max(0, max - n))}</span>;
  }
  if (type === 'JSON') {
    let display = str;
    try { display = JSON.stringify(JSON.parse(str), null, 2); } catch {}
    return <pre className="font-mono text-xs whitespace-pre-wrap text-foreground/70 max-h-[200px] overflow-auto">{display}</pre>;
  }
  if (type === 'LongText') {
    return <div className="whitespace-pre-wrap break-words">{str}</div>;
  }
  // Attachment — aligned with grid (parse JSON, show thumbnails + delete)
  if (type === 'Attachment') {
    let attachments: any[] = [];
    try {
      attachments = Array.isArray(value) ? value : JSON.parse(str);
    } catch {}
    if (!Array.isArray(attachments) || attachments.length === 0) {
      return <span className="text-muted-foreground/30">空</span>;
    }
    const isImage = (a: any) => a.mimetype?.startsWith('image/');
    const handleDeleteAttachment = async (idx: number) => {
      const updated = attachments.filter((_: any, i: number) => i !== idx);
      try {
        await nc.updateRow(tableId, rowId, { [col.title]: updated });
        onSaved();
      } catch (e) { console.error('Delete attachment failed:', e); }
    };
    return (
      <div className="flex flex-wrap gap-2 py-1">
        {attachments.map((a: any, i: number) => (
          <div key={i} className="relative group">
            {isImage(a) ? (
              <img src={ncAttachmentUrl(a)} className="h-16 w-16 rounded object-cover border border-border" alt={a.title} title={a.title || a.path} />
            ) : (
              <div className="h-16 w-16 rounded border border-border flex flex-col items-center justify-center bg-muted/30" title={a.title || a.path}>
                <Paperclip className="h-4 w-4 text-muted-foreground" />
                <span className="text-[9px] text-muted-foreground mt-1 truncate max-w-[56px] px-1">{a.title || `附件${i + 1}`}</span>
              </div>
            )}
            <button
              onClick={() => handleDeleteAttachment(i)}
              className="absolute -top-1.5 -right-1.5 hidden group-hover:flex h-4 w-4 items-center justify-center rounded-full bg-destructive text-destructive-foreground text-[10px] shadow-sm"
              title="删除附件"
            >
              <X className="h-2.5 w-2.5" />
            </button>
          </div>
        ))}
      </div>
    );
  }
  // User / Collaborator
  if (type === 'User' || type === 'Collaborator') {
    return (
      <span className="flex items-center gap-1 text-foreground/70">
        <User className="h-3.5 w-3.5 text-muted-foreground" />
        {str}
      </span>
    );
  }
  // CreatedBy / LastModifiedBy
  if (type === 'CreatedBy' || type === 'LastModifiedBy') {
    return (
      <span className="flex items-center gap-1 text-foreground/70">
        <User className="h-3.5 w-3.5 text-muted-foreground" />
        {str}
      </span>
    );
  }
  // Links — show count or empty, not "0"
  if (type === 'Links' || type === 'LinkToAnotherRecord') {
    const num = parseInt(str);
    if (!num || num === 0) return <span className="text-muted-foreground/30">空</span>;
    return <span className="text-sidebar-primary">{num} 条关联</span>;
  }
  // Formula / Rollup / Lookup / Count
  if (READONLY_TYPES.has(type)) {
    return <span className="text-foreground/50 italic">{str}</span>;
  }

  return <span className="break-words">{str}</span>;
}

// ── Select field (inline dropdown) ──

function SelectField({ value, col, onSelect }: { value: unknown; col: nc.NCColumn; onSelect: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const str = value == null ? '' : String(value);
  const opt = col.options?.find(o => o.title === str);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 text-sm py-0.5 px-2 -mx-2 rounded-md hover:bg-muted/50 min-h-[28px]"
      >
        {str ? (
          <span className="inline-block px-2 py-0.5 rounded text-xs" style={{ backgroundColor: getOptionColor(opt?.color, 0), color: '#1a1a2e' }}>
            {str}
          </span>
        ) : (
          <span className="text-muted-foreground/30">选择...</span>
        )}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full mt-1 z-20 bg-card border border-border rounded-lg shadow-xl py-1 w-48 max-h-48 overflow-y-auto">
            <button
              onClick={() => { onSelect(''); setOpen(false); }}
              className="w-full px-3 py-1 text-xs text-muted-foreground hover:bg-accent text-left"
            >
              清除
            </button>
            {(col.options || []).map((o, i) => (
              <button
                key={o.title}
                onClick={() => { onSelect(o.title); setOpen(false); }}
                className={cn('w-full flex items-center gap-2 px-3 py-1 text-xs hover:bg-accent', str === o.title && 'font-medium')}
              >
                <span className="px-1.5 py-0.5 rounded text-[11px]" style={{ backgroundColor: getOptionColor(o.color, i), color: '#1a1a2e' }}>
                  {o.title}
                </span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ── MultiSelect field ──

function MultiSelectField({ value, col, onToggle }: { value: unknown; col: nc.NCColumn; onToggle: (option: string) => void }) {
  const [open, setOpen] = useState(false);
  const currentStr = value ? String(value) : '';
  const currentItems = currentStr ? currentStr.split(',').map(s => s.trim()) : [];

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 flex-wrap text-sm py-0.5 px-2 -mx-2 rounded-md hover:bg-muted/50 min-h-[28px]"
      >
        {currentItems.length > 0 ? (
          currentItems.map((item, i) => {
            const opt = col.options?.find(o => o.title === item);
            return (
              <span key={i} className="inline-block px-1.5 py-0.5 rounded text-[11px]" style={{ backgroundColor: getOptionColor(opt?.color, i), color: '#1a1a2e' }}>
                {item}
              </span>
            );
          })
        ) : (
          <span className="text-muted-foreground/30">选择...</span>
        )}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full mt-1 z-20 bg-card border border-border rounded-lg shadow-xl py-1 w-48 max-h-48 overflow-y-auto">
            {(col.options || []).map((o, i) => {
              const isSelected = currentItems.includes(o.title);
              return (
                <button
                  key={o.title}
                  onClick={(e) => { e.stopPropagation(); onToggle(o.title); }}
                  className="w-full flex items-center gap-2 px-3 py-1 text-xs hover:bg-accent"
                >
                  <span className={cn('w-3.5 h-3.5 rounded border flex items-center justify-center text-[9px]',
                    isSelected ? 'bg-sidebar-primary border-sidebar-primary text-white' : 'border-border'
                  )}>
                    {isSelected && '✓'}
                  </span>
                  <span className="px-1.5 py-0.5 rounded text-[11px]" style={{ backgroundColor: getOptionColor(o.color, i), color: '#1a1a2e' }}>
                    {o.title}
                  </span>
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
