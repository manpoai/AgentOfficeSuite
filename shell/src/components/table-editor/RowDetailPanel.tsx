'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import {
  X, ChevronLeft, ChevronRight, Trash2, Plus, Star, CheckSquare, MoreHorizontal,
  Type, Hash, Calendar, Mail, AlignLeft, Link, Phone, Clock, DollarSign,
  Percent, List, Tags, Braces, Paperclip, User, Sigma, Link2, Search, GitBranch,
  MessageSquare, Upload, Download, Loader2, X as XIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { showError } from '@/lib/utils/error';
import { useT } from '@/lib/i18n';
import * as br from '@/lib/api/baserow';
import * as gw from '@/lib/api/gateway';
import { CommentPanel } from '@/components/shared/CommentPanel';
import { MobileCommentBar } from '@/components/shared/MobileCommentBar';
import { BottomSheet } from '@/components/shared/BottomSheet';
import { useIsMobile } from '@/lib/hooks/use-mobile';
import { LinkRecordPicker } from './LinkRecordPicker';
import { DndContext, closestCenter, DragEndEvent, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { restrictToParentElement } from '@dnd-kit/modifiers';
import { SortableContext, useSortable, rectSortingStrategy, arrayMove } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

import { SELECT_COLORS, getOptionColor } from './types';

// ── Shared constants from types.ts ──

const READONLY_TYPES = new Set(['ID', 'AutoNumber', 'CreatedTime', 'LastModifiedTime', 'CreatedBy', 'LastModifiedBy', 'Formula', 'Rollup', 'Lookup', 'Count']);

/** Resolve attachment path to a proxied URL */
function attachmentUrl(a: { signedPath?: string; path?: string }): string {
  const p = a.signedPath || a.path || '';
  if (!p) return '';
  if (p.startsWith('/api/')) return p;
  // Proxy all URLs (including http://localhost Baserow URLs) through gateway
  return `/api/gateway/data/dl?path=${encodeURIComponent(p)}`;
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
  columns: br.BRColumn[];
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
  const { t } = useT();
  const rowId = row.Id as number;
  const rowIdStr = String(rowId);
  const displayCols = columns.filter(c => c.title !== 'created_by' && c.type !== 'ID' && !(c.title === 'Id' && c.primary_key));
  const titleCol = displayCols.find(c => c.primary_key);
  const titleValue = titleCol ? String(row[titleCol.title] || '') : `#${rowId}`;
  const [showComments, setShowComments] = useState(initialShowComments ?? false);
  const [showMobileMenu, setShowMobileMenu] = useState(false);
  const isMobile = useIsMobile();

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

  // ─── Mobile: Full-screen detail page (rendered inline, replaces table grid) ───
  if (isMobile) {
    return (
      <div className="flex-1 flex flex-col min-h-0 bg-card">
        {/* Header: < back | title | ... more — matches design spec */}
        <div className="flex items-center gap-2 px-3 h-12 border-b border-border shrink-0 bg-card">
          <button onClick={onClose} className="p-1.5 -ml-1 text-foreground/70">
            <ChevronLeft className="h-5 w-5" />
          </button>
          <h3 className="flex-1 text-sm font-semibold text-foreground truncate">{titleValue}</h3>
          <div className="relative">
            <button onClick={() => setShowMobileMenu(v => !v)} className="p-1.5 text-foreground/70">
              {showMobileMenu
                ? <X className="h-5 w-5" />
                : <MoreHorizontal className="h-5 w-5" />
              }
            </button>
            {showMobileMenu && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowMobileMenu(false)} />
                <div className="absolute right-0 top-full mt-1 z-50 bg-white dark:bg-card border border-black/10 dark:border-border rounded-lg shadow-[0px_2px_10px_0px_rgba(0,0,0,0.05)] py-1 w-44">
                  <button
                    onClick={() => { onDeleteRow(rowId); onClose(); setShowMobileMenu(false); }}
                    className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-destructive hover:bg-destructive/5"
                  >
                    <Trash2 className="h-4 w-4" />
                    {t('rowDetail.deleteRow') || 'Delete'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Fields — scrollable, white background */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-0.5 min-w-0 bg-card">
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

        {/* Bottom comment bar */}
        <MobileCommentBar
          targetType="table"
          targetId={tableId}
        />

        {/* Comments BottomSheet */}
        {showComments && (
          <BottomSheet open={true} onClose={() => setShowComments(false)} title={t('content.comments')} initialHeight="full">
            <CommentPanel
              targetType="table"
              targetId={tableId}
              rowId={rowIdStr}
              onClose={() => setShowComments(false)}
            />
          </BottomSheet>
        )}
      </div>
    );
  }

  // ─── Desktop: Centered modal ───
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
              title={`${t('rowDetail.prevRow')} (↑)`}
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="text-xs text-muted-foreground tabular-nums">{rowIndex + 1} / {totalRows}</span>
            <button
              onClick={() => onNavigate('next')}
              disabled={rowIndex >= totalRows - 1}
              className="p-1 text-muted-foreground hover:text-foreground disabled:opacity-30"
              title={`${t('rowDetail.nextRow')} (↓)`}
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
          <h3 className="flex-1 text-sm font-semibold text-foreground truncate">{titleValue}</h3>
          <button
            onClick={() => setShowComments(v => !v)}
            className={cn('p-1.5 rounded transition-colors', showComments ? 'text-sidebar-primary bg-sidebar-primary/10' : 'text-muted-foreground hover:text-foreground')}
            title={t('rowDetail.rowComments')}
          >
            <MessageSquare className="h-4 w-4" />
          </button>
          <button
            onClick={() => { onDeleteRow(rowId); onClose(); }}
            className="p-1.5 text-muted-foreground hover:text-destructive"
            title={t('rowDetail.deleteRow')}
          >
            <Trash2 className="h-4 w-4" />
          </button>
          <button onClick={onClose} className="p-1.5 text-muted-foreground hover:text-foreground" title={`${t('rowDetail.closeEsc')}`}>
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
              <CommentPanel
                targetType="table"
                targetId={tableId}
                rowId={rowIdStr}
                onClose={() => setShowComments(false)}
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
  col: br.BRColumn;
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
    if (isReadonly || col.type === 'Checkbox' || col.type === 'Rating' || col.type === 'Attachment' || col.type === 'Date' || col.type === 'DateTime') return;
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
      await br.updateRow(tableId, rowId, { [col.title]: saveVal });
      onSaved();
    } catch (e) {
      showError('Save failed', e);
    } finally {
      setSaving(false);
      setEditing(false);
    }
  };

  const toggleCheckbox = async () => {
    try {
      const newVal = !value;
      // PostgreSQL requires boolean values, not integers
      await br.updateRow(tableId, rowId, { [col.title]: newVal });
      onSaved();
    } catch (e) {
      showError('Toggle failed', e);
    }
  };

  const setRating = async (v: number) => {
    try {
      await br.updateRow(tableId, rowId, { [col.title]: v });
      onSaved();
    } catch (e) {
      showError('Set rating failed', e);
    }
  };

  const setSelectVal = async (v: string) => {
    try {
      await br.updateRow(tableId, rowId, { [col.title]: v });
      onSaved();
    } catch (e) {
      showError('Set select failed', e);
    }
  };

  const toggleMulti = async (option: string) => {
    const currentStr = value ? String(value) : '';
    const items = currentStr ? currentStr.split(',').map(s => s.trim()) : [];
    const newItems = items.includes(option) ? items.filter(i => i !== option) : [...items, option];
    try {
      await br.updateRow(tableId, rowId, { [col.title]: newItems.join(',') });
      onSaved();
    } catch (e) {
      showError('Toggle multi failed', e);
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
        ) : /* Date/DateTime — calendar picker */
        (col.type === 'Date' || col.type === 'DateTime') && !isReadonly ? (
          <DateField value={value} col={col} rowId={rowId} tableId={tableId} onSaved={onSaved} />
        ) : /* Links — open LinkRecordPicker */
        (col.type === 'Links' || col.type === 'LinkToAnotherRecord') ? (
          <LinksField value={value} col={col} rowId={rowId} tableId={tableId} onSaved={onSaved} />
        ) : /* Attachment — inline upload + display with delete */
        col.type === 'Attachment' && !isReadonly ? (
          <AttachmentField value={value} col={col} rowId={rowId} tableId={tableId} onSaved={onSaved} />
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

function FieldDisplay({ value, col }: { value: unknown; col: br.BRColumn }) {
  const { t } = useT();
  if (value == null || value === '') {
    return <span className="text-muted-foreground/30">{t('dataTable.empty')}</span>;
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
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    const formatted = fmt
      .replace('YYYY', String(y))
      .replace('MM', m)
      .replace('DD', day)
      .replace('HH', hh)
      .replace('mm', mm);
    const needsTime = type !== 'Date' && !fmt.includes('HH');
    const timePart = needsTime ? ` ${hh}:${mm}` : '';
    return <span className="text-foreground/70">{formatted}{timePart}</span>;
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
      return <span className="text-muted-foreground/30">{t('dataTable.empty')}</span>;
    }
    const isImage = (a: any) => a.mimetype?.startsWith('image/');
    const handleDeleteAttachment = async (idx: number) => {
      const updated = attachments.filter((_: any, i: number) => i !== idx);
      try {
        await br.updateRow(tableId, rowId, { [col.title]: updated });
        onSaved();
      } catch (e) { showError('Delete attachment failed', e); }
    };
    return (
      <div className="flex flex-wrap gap-2 py-1">
        {attachments.map((a: any, i: number) => (
          <div key={i} className="relative group">
            {isImage(a) ? (
              <img src={attachmentUrl(a)} className="h-16 w-16 rounded object-cover border border-border" alt={a.title} title={a.title || a.path} />
            ) : (
              <div className="h-16 w-16 rounded border border-border flex flex-col items-center justify-center bg-muted/30" title={a.title || a.path}>
                <Paperclip className="h-4 w-4 text-muted-foreground" />
                <span className="text-[9px] text-muted-foreground mt-1 truncate max-w-[56px] px-1">{a.title || t('dataTable.attachmentName', { n: i + 1 })}</span>
              </div>
            )}
            <button
              onClick={() => handleDeleteAttachment(i)}
              className="absolute -top-1.5 -right-1.5 hidden group-hover:flex h-4 w-4 items-center justify-center rounded-full bg-destructive text-destructive-foreground text-[10px] shadow-sm"
              title={t('dataTable.deleteAttachment')}
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
  // Links — show count or empty
  if (type === 'Links' || type === 'LinkToAnotherRecord') {
    let num = 0;
    if (typeof value === 'number') num = value;
    else if (Array.isArray(value)) num = value.length;
    else num = parseInt(str) || 0;
    if (!num) return <span className="text-muted-foreground/30">{t('dataTable.empty')}</span>;
    return <span className="text-sidebar-primary">{t('dataTable.nLinkedRecords', { n: num })}</span>;
  }
  // Formula / Rollup / Lookup / Count
  if (READONLY_TYPES.has(type)) {
    return <span className="text-foreground/50 italic">{str}</span>;
  }

  return <span className="break-words">{str}</span>;
}

// ── Links field (with LinkRecordPicker) ──

function LinksField({ value, col, rowId, tableId, onSaved }: {
  value: unknown; col: br.BRColumn; rowId: number; tableId: string; onSaved: () => void;
}) {
  const { t } = useT();
  const [showPicker, setShowPicker] = useState(false);

  // value is typically a number (count) or an array
  const count = typeof value === 'number' ? value : (Array.isArray(value) ? value.length : (parseInt(String(value || '0')) || 0));

  return (
    <div>
      <button
        onClick={() => setShowPicker(true)}
        className="text-sm py-0.5 min-h-[28px] flex items-center cursor-pointer rounded-md hover:bg-muted/50 px-2 -mx-2 gap-1"
      >
        <Link2 className="h-3 w-3 text-sidebar-primary" />
        {count > 0 ? (
          <span className="text-sidebar-primary">{t('dataTable.nLinkedRecords', { n: count })}</span>
        ) : (
          <span className="text-muted-foreground/40">{t('dataTable.empty')}</span>
        )}
      </button>
      {showPicker && (
        <LinkRecordPicker
          tableId={tableId}
          rowId={rowId}
          column={col}
          onClose={() => setShowPicker(false)}
          onRefresh={onSaved}
        />
      )}
    </div>
  );
}

// ── Date field (calendar picker) ──

function DateField({ value, col, rowId, tableId, onSaved }: {
  value: unknown; col: br.BRColumn; rowId: number; tableId: string; onSaved: () => void;
}) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const str = value == null ? '' : String(value);
  const showTime = col.type === 'DateTime';
  const meta = col.meta as Record<string, unknown> | undefined;
  const fmt = (meta?.date_format as string) || 'YYYY-MM-DD';

  const formatDisplay = (dateStr: string) => {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0'), mm = String(d.getMinutes()).padStart(2, '0');
    return fmt.replace('YYYY', String(y)).replace('MM', m).replace('DD', day).replace('HH', hh).replace('mm', mm) + (showTime && !fmt.includes('HH') ? ` ${hh}:${mm}` : '');
  };

  const handleSelect = async (dateStr: string) => {
    setOpen(false);
    try {
      await br.updateRow(tableId, rowId, { [col.title]: dateStr || null });
      onSaved();
    } catch (e) { showError('Date update failed', e); }
  };

  return (
    <div className="relative">
      <div
        onClick={() => setOpen(!open)}
        className="text-sm py-0.5 min-h-[28px] flex items-center cursor-pointer rounded-md hover:bg-muted/50 px-2 -mx-2"
      >
        {str ? (
          <span className="text-foreground/70">{formatDisplay(str)}</span>
        ) : (
          <span className="text-muted-foreground/40 flex items-center gap-1"><Calendar className="h-3 w-3" /> {t('dataTable.selectDate')}</span>
        )}
      </div>
      {open && <DatePickerInline value={str} showTime={showTime} onSelect={handleSelect} onClose={() => setOpen(false)} />}
    </div>
  );
}

function DatePickerInline({ value, showTime, onSelect, onClose }: {
  value: string; showTime: boolean; onSelect: (dateStr: string) => void; onClose: () => void;
}) {
  const { t } = useT();
  const initDate = value ? new Date(value) : new Date();
  const validInit = isNaN(initDate.getTime()) ? new Date() : initDate;
  const [viewYear, setViewYear] = useState(validInit.getFullYear());
  const [viewMonth, setViewMonth] = useState(validInit.getMonth());
  const [timeStr, setTimeStr] = useState(
    value && !isNaN(new Date(value).getTime())
      ? `${String(new Date(value).getHours()).padStart(2, '0')}:${String(new Date(value).getMinutes()).padStart(2, '0')}`
      : '00:00'
  );
  const selectedDate = value && !isNaN(new Date(value).getTime()) ? new Date(value) : null;
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const firstDow = new Date(viewYear, viewMonth, 1).getDay();
  const weeks: (number | null)[][] = [];
  let wk: (number | null)[] = Array(firstDow).fill(null);
  for (let d = 1; d <= daysInMonth; d++) { wk.push(d); if (wk.length === 7) { weeks.push(wk); wk = []; } }
  if (wk.length > 0) { while (wk.length < 7) wk.push(null); weeks.push(wk); }

  const handleDay = (day: number) => {
    const [hh, mm] = timeStr.split(':').map(Number);
    const yy = String(viewYear);
    const mo = String(viewMonth + 1).padStart(2, '0');
    const dd = String(day).padStart(2, '0');
    if (showTime) {
      const h = String(hh || 0).padStart(2, '0');
      const m = String(mm || 0).padStart(2, '0');
      onSelect(`${yy}-${mo}-${dd}T${h}:${m}:00`);
    } else {
      onSelect(`${yy}-${mo}-${dd}`);
    }
  };
  const prevMonth = () => { if (viewMonth === 0) { setViewYear(y => y - 1); setViewMonth(11); } else setViewMonth(m => m - 1); };
  const nextMonth = () => { if (viewMonth === 11) { setViewYear(y => y + 1); setViewMonth(0); } else setViewMonth(m => m + 1); };
  const isToday = (d: number) => { const now = new Date(); return viewYear === now.getFullYear() && viewMonth === now.getMonth() && d === now.getDate(); };
  const isSel = (d: number) => selectedDate ? viewYear === selectedDate.getFullYear() && viewMonth === selectedDate.getMonth() && d === selectedDate.getDate() : false;

  useEffect(() => {
    const handler = (e: MouseEvent) => { if (!(e.target as HTMLElement).closest('[data-date-picker-detail]')) onClose(); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  return (
    <div data-date-picker-detail className="mt-1 bg-card border border-border rounded-lg shadow-xl w-64 select-none">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <button onClick={prevMonth} className="p-0.5 text-muted-foreground hover:text-foreground"><ChevronLeft className="h-4 w-4" /></button>
        <span className="text-xs font-medium">{t('dataTable.yearMonth', { year: viewYear, month: viewMonth + 1 })}</span>
        <button onClick={nextMonth} className="p-0.5 text-muted-foreground hover:text-foreground"><ChevronRight className="h-4 w-4" /></button>
      </div>
      <div className="grid grid-cols-7 px-2 pt-1">
        {((t('dataTable.weekdays', { returnObjects: true }) as unknown as string[]) || ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']).map(w => <div key={w} className="text-center text-[10px] text-muted-foreground py-0.5">{w}</div>)}
      </div>
      <div className="px-2 pb-2">
        {weeks.map((w, wi) => (
          <div key={wi} className="grid grid-cols-7">
            {w.map((day, di) => (
              <button key={di} disabled={!day} onClick={() => day && handleDay(day)} className={cn(
                'h-7 w-full text-xs rounded transition-colors',
                !day && 'invisible',
                day && !isSel(day) && !isToday(day) && 'hover:bg-accent',
                day && isToday(day) && !isSel(day) && 'text-sidebar-primary font-medium',
                day && isSel(day) && 'bg-sidebar-primary text-sidebar-primary-foreground font-medium',
              )}>{day}</button>
            ))}
          </div>
        ))}
      </div>
      {showTime && (
        <div className="px-3 pb-2 pt-1 border-t border-border flex items-center gap-2">
          <Clock className="h-3 w-3 text-muted-foreground" />
          <input type="time" value={timeStr} onChange={e => setTimeStr(e.target.value)} className="bg-muted rounded px-2 py-1 text-xs outline-none" />
        </div>
      )}
      <div className="px-3 pb-2 flex items-center justify-between">
        <button onClick={() => onSelect('')} className="text-[10px] text-muted-foreground hover:text-foreground">{t('dataTable.clear')}</button>
        <button onClick={() => { const now = new Date(); setViewYear(now.getFullYear()); setViewMonth(now.getMonth()); handleDay(now.getDate()); }} className="text-[10px] text-sidebar-primary">{t('dataTable.today')}</button>
      </div>
    </div>
  );
}

// ── Sortable attachment thumbnail ──

function SortableThumb({ id, children }: { id: number; children: React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };
  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      {children}
    </div>
  );
}

// ── Attachment field (upload + thumbnails + delete) ──

function AttachmentField({ value, col, rowId, tableId, onSaved }: {
  value: unknown; col: br.BRColumn; rowId: number; tableId: string; onSaved: () => void;
}) {
  const { t } = useT();
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [localAttachments, setLocalAttachments] = useState<any[] | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const dndSensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  let parsedAttachments: any[] = [];
  try {
    parsedAttachments = Array.isArray(value) ? value : JSON.parse(String(value || '[]'));
  } catch {}
  if (!Array.isArray(parsedAttachments)) parsedAttachments = [];

  const attachments = localAttachments ?? parsedAttachments;

  // Sync local state when server data changes
  useEffect(() => { setLocalAttachments(null); }, [value]);

  const isImage = (a: any) => a.mimetype?.startsWith('image/');

  const uploadFiles = async (files: FileList | File[]) => {
    if (!files.length) return;
    setUploading(true);
    try {
      const formData = new FormData();
      Array.from(files).forEach(f => formData.append('files', f));
      const res = await fetch('/api/gateway/data/upload', { method: 'POST', headers: gw.gwAuthHeaders(), body: formData });
      if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
      const uploaded = await res.json();
      const merged = [...attachments, ...uploaded];
      await br.updateRow(tableId, rowId, { [col.title]: merged });
      onSaved();
    } catch (e) { showError('Attachment upload failed', e); }
    finally { setUploading(false); }
  };

  const handleDelete = async (idx: number) => {
    const updated = attachments.filter((_: any, i: number) => i !== idx);
    try {
      await br.updateRow(tableId, rowId, { [col.title]: updated });
      onSaved();
    } catch (e) { showError('Delete attachment failed', e); }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDragging(false);
    if (e.dataTransfer.files.length > 0) uploadFiles(e.dataTransfer.files);
  };

  return (
    <div
      className={cn('py-1 rounded-md', dragging && 'bg-sidebar-primary/10 ring-1 ring-sidebar-primary')}
      onDragOver={e => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
    >
      {/* Thumbnails with drag-sort */}
      {attachments.length > 0 && (
        <DndContext
          sensors={dndSensors}
          collisionDetection={closestCenter}
          modifiers={[restrictToParentElement]}
          onDragEnd={async (event: DragEndEvent) => {
            const { active, over } = event;
            if (!over || active.id === over.id) return;
            const reordered = arrayMove([...attachments], Number(active.id), Number(over.id));
            setLocalAttachments(reordered);
            try {
              await br.updateRow(tableId, rowId, { [col.title]: reordered });
              onSaved();
            } catch (e) { showError('Reorder failed', e); onSaved(); }
          }}
        >
        <SortableContext items={attachments.map((_: any, i: number) => i)} strategy={rectSortingStrategy}>
        <div className="flex flex-wrap gap-2 mb-2">
          {attachments.map((a: any, i: number) => (
            <SortableThumb key={i} id={i}>
            <div className="relative group cursor-grab">
              {isImage(a) ? (
                <img src={attachmentUrl(a)} className="h-16 w-16 rounded object-cover border border-border" alt={a.title} />
              ) : (
                <div className="h-16 w-16 rounded border border-border flex flex-col items-center justify-center bg-muted/30" title={a.title || a.path}>
                  <Paperclip className="h-4 w-4 text-muted-foreground" />
                  <span className="text-[9px] text-muted-foreground mt-1 truncate max-w-[56px] px-1">{a.title || t('dataTable.attachmentName', { n: i + 1 })}</span>
                </div>
              )}
              <a
                href={attachmentUrl(a)}
                download={a.title || a.path?.split('/').pop() || 'file'}
                onClick={e => e.stopPropagation()}
                className="absolute -top-1.5 -left-1.5 hidden group-hover:flex h-4 w-4 items-center justify-center rounded-full bg-sidebar-primary text-white text-[10px] shadow-sm"
                title={t('common.download')}
              >
                <Download className="h-2.5 w-2.5" />
              </a>
              <button
                onClick={() => handleDelete(i)}
                className="absolute -top-1.5 -right-1.5 hidden group-hover:flex h-4 w-4 items-center justify-center rounded-full bg-destructive text-destructive-foreground text-[10px] shadow-sm"
                title={t('common.delete')}
              >
                <X className="h-2.5 w-2.5" />
              </button>
            </div>
            </SortableThumb>
          ))}
        </div>
        </SortableContext>
        </DndContext>
      )}
      {/* Upload area */}
      <div
        className="border border-dashed border-border/60 rounded-lg px-3 py-2 text-center cursor-pointer hover:bg-muted/30 transition-colors"
        onClick={() => fileRef.current?.click()}
      >
        <input ref={fileRef} type="file" multiple className="hidden" onChange={e => e.target.files && uploadFiles(e.target.files)} />
        {uploading ? (
          <span className="text-xs text-muted-foreground flex items-center justify-center gap-1.5"><Loader2 className="h-3 w-3 animate-spin" /> {t('dataTable.uploading')}</span>
        ) : (
          <span className="text-xs text-muted-foreground">
            <Upload className="h-3 w-3 inline mr-1" />
            {t('dataTable.clickOrDragUpload')}
          </span>
        )}
      </div>
    </div>
  );
}

// ── Select field (inline dropdown) ──

function SelectField({ value, col, onSelect }: { value: unknown; col: br.BRColumn; onSelect: (v: string) => void }) {
  const { t } = useT();
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
          <span className="text-muted-foreground/30">{t('dataTable.selectPlaceholder')}</span>
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
              {t('dataTable.clear')}
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

function MultiSelectField({ value, col, onToggle }: { value: unknown; col: br.BRColumn; onToggle: (option: string) => void }) {
  const { t } = useT();
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
          <span className="text-muted-foreground/30">{t('dataTable.selectPlaceholder')}</span>
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
