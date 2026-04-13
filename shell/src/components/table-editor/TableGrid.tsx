/**
 * TableGrid — Grid view rendering: cell display, linked records, date picker,
 * rating stars, snapshot cell, compact cell, group rows, kanban/gallery/form/calendar views.
 * Extracted from TableEditor.tsx during refactoring — no behavior changes.
 */

'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Plus, Trash2, X, ChevronLeft, ChevronRight, ChevronDown,
  Upload, Paperclip, User, Columns, Clock, Download,
  GripVertical, CalendarDays, Loader2,
} from 'lucide-react';
import { DndContext, closestCenter, DragEndEvent, DragOverEvent, DragOverlay, DragStartEvent, PointerSensor, useSensor, useSensors, useDroppable } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { restrictToParentElement, restrictToVerticalAxis } from '@dnd-kit/modifiers';
import { CSS } from '@dnd-kit/utilities';
import { cn } from '@/lib/utils';
import { showError } from '@/lib/utils/error';
import { useT } from '@/lib/i18n';
import { formatDate } from '@/lib/utils/time';
import * as br from '@/lib/api/tables';
import { ContentLink } from '@/components/shared/ContentLink';
import {
  CONTENT_LINK_RE, CONTENT_LINK_RE_G, extractContentId,
  SELECT_COLORS, READONLY_TYPES, getColIcon, getOptionColor,
  attachmentUrl,
} from './types';

// ── Content link rendering ──

/** Split text into segments: plain text and content link chips */
export function renderTextWithContentLinks(text: string, className: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  CONTENT_LINK_RE_G.lastIndex = 0;
  while ((match = CONTENT_LINK_RE_G.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    const cid = decodeURIComponent(match[1]);
    parts.push(<ContentLink key={match.index} contentId={cid} inline showPreview={false} className={className} />);
    lastIndex = match.index + match[0].length;
  }
  if (parts.length === 0) return null;
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }
  return <>{parts}</>;
}

// ── Compact cell display for kanban/gallery views ──

export function CompactCellDisplay({ value, col }: { value: unknown; col: br.BRColumn }) {
  if (value == null || value === '') return null;
  const colType = col.type;

  if (colType === 'Attachment') {
    try {
      const arr = Array.isArray(value) ? value : JSON.parse(String(value));
      if (Array.isArray(arr) && arr.length > 0) {
        return (
          <div className="flex gap-1 py-0.5 items-center">
            {arr.slice(0, 3).map((a: any, i: number) => (
              a.mimetype?.startsWith('image/') ? (
                <img key={i} src={attachmentUrl(a)} className="h-5 w-5 rounded object-cover border border-border" alt="" />
              ) : (
                <span key={i} className="text-[9px] bg-muted px-1 py-0.5 rounded truncate max-w-[60px] flex items-center gap-0.5">
                  <Paperclip className="h-2 w-2 shrink-0" />{a.title || 'file'}
                </span>
              )
            ))}
            {arr.length > 3 && <span className="text-[9px] text-muted-foreground">+{arr.length - 3}</span>}
          </div>
        );
      }
    } catch {}
    return null;
  }

  if (colType === 'Links' || colType === 'LinkToAnotherRecord') {
    const arr = Array.isArray(value) ? value : [];
    const num = arr.length || parseInt(String(value)) || 0;
    return num > 0 ? <span className="text-[10px] text-sidebar-primary">{num}</span> : null;
  }

  if (colType === 'SingleSelect') {
    const str = String(value);
    const opt = col.options?.find(o => o.title === str);
    const color = opt?.color || SELECT_COLORS[0];
    return <span className="inline-block px-1.5 py-0.5 rounded text-[9px]" style={{ backgroundColor: color, color: '#1a1a2e' }}>{str}</span>;
  }

  if (colType === 'MultiSelect') {
    const items = String(value).split(',').map(s => s.trim()).filter(Boolean);
    return (
      <div className="flex flex-wrap gap-0.5">
        {items.map((item, i) => {
          const opt = col.options?.find(o => o.title === item);
          const color = opt?.color || SELECT_COLORS[i % SELECT_COLORS.length];
          return <span key={i} className="inline-block px-1 py-0.5 rounded text-[9px]" style={{ backgroundColor: color, color: '#1a1a2e' }}>{item}</span>;
        })}
      </div>
    );
  }

  if (colType === 'Checkbox') {
    return <span className="text-[10px]">{value ? '✓' : ''}</span>;
  }

  const str = typeof value === 'object' ? (Array.isArray(value) ? value.map(String).join(', ') : JSON.stringify(value)) : String(value);
  if (colType === 'SingleLineText' || colType === 'LongText' || colType === 'URL') {
    const rendered = renderTextWithContentLinks(str, 'text-[10px]');
    if (rendered) return <span className="text-[10px] text-foreground/80" onClick={e => e.stopPropagation()}>{rendered}</span>;
  }
  return <span className="text-[10px] text-foreground/80 truncate">{str}</span>;
}

// ── Snapshot cell value ──

export function SnapshotCellValue({ value, colType }: { value: unknown; colType: string }) {
  if (value == null || value === '') return null;

  if (colType === 'Checkbox') return <span>{value ? '✓' : ''}</span>;

  if (colType === 'SingleSelect') {
    return <span className="inline-block px-1.5 py-0.5 rounded text-[11px] leading-tight bg-muted text-foreground">{String(value)}</span>;
  }

  if (colType === 'MultiSelect') {
    const items = String(value).split(',').map(s => s.trim()).filter(Boolean);
    return (
      <span className="flex flex-wrap gap-0.5">
        {items.map((item, i) => (
          <span key={i} className="inline-block px-1.5 py-0.5 rounded text-[11px] leading-tight bg-muted text-foreground">{item}</span>
        ))}
      </span>
    );
  }

  if (colType === 'Date' || colType === 'DateTime' || colType === 'CreatedTime' || colType === 'CreateTime' || colType === 'LastModifiedTime') {
    try { return <span>{formatDate(String(value))}</span>; } catch { return <span>{String(value)}</span>; }
  }

  if (colType === 'Attachment') {
    const files = Array.isArray(value) ? value : [];
    if (files.length === 0) return null;
    return <span className="truncate">{files.map((f: any) => f.title || f.fileName || 'file').join(', ')}</span>;
  }

  if (colType === 'User' || colType === 'CreatedBy' || colType === 'LastModifiedBy' || colType === 'Collaborator') {
    if (typeof value === 'string') return <span>{value}</span>;
    if (Array.isArray(value)) return <span>{value.map((v: any) => v.display_name || v.email || String(v)).join(', ')}</span>;
    if (typeof value === 'object' && value !== null) return <span>{(value as any).display_name || (value as any).email || JSON.stringify(value)}</span>;
    return <span>{String(value)}</span>;
  }

  if (colType === 'Links' || colType === 'LinkToAnotherRecord') {
    const arr = Array.isArray(value) ? value : [];
    if (arr.length > 0) {
      return <span>{arr.map((v: any) => (typeof v === 'object' ? (v.Title || v.title || v.Name || v.name || JSON.stringify(v)) : String(v))).join(', ')}</span>;
    }
    const num = parseInt(String(value)) || 0;
    return <span className="text-muted-foreground">{num > 0 ? `${num} linked` : ''}</span>;
  }

  if (colType === 'Number' || colType === 'Decimal' || colType === 'Currency' || colType === 'Percent' || colType === 'Rating' || colType === 'AutoNumber') {
    return <span>{String(value)}</span>;
  }

  if (typeof value === 'boolean') return <span>{value ? 'Yes' : 'No'}</span>;

  if (Array.isArray(value)) {
    return <span className="truncate">{value.map(v => typeof v === 'object' ? ((v as any).title || (v as any).Title || JSON.stringify(v)) : String(v)).join(', ')}</span>;
  }

  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    return <span className="truncate text-muted-foreground">{obj.title || obj.Title || obj.display_name || JSON.stringify(value)}</span>;
  }

  return <span className="truncate">{String(value)}</span>;
}

// ── Rating stars ──

export function RatingStars({ value, onChange, max = 5, iconType = 'star' }: { value?: number; onChange: (v: number) => void; max?: number; iconType?: string }) {
  const current = typeof value === 'number' ? value : 0;
  const iconMap: Record<string, [string, string]> = {
    star: ['★', '☆'], heart: ['❤', '♡'], thumb: ['👍', '·'], flag: ['🚩', '·'],
    fire: ['🔥', '·'], smile: ['😊', '·'], flower: ['🌸', '·'],
    bolt: ['⚡', '·'], puzzle: ['🧩', '·'], number: ['🔢', '·'],
  };
  const [filled, empty] = iconMap[iconType] || iconMap.star;
  return (
    <div className="flex items-center gap-0.5 py-1">
      {Array.from({ length: max }, (_, i) => (
        <button
          key={i}
          onClick={(e) => { e.stopPropagation(); onChange(i + 1 === current ? 0 : i + 1); }}
          className="text-sm leading-none hover:scale-125 transition-transform"
        >
          {i < current ? filled : empty}
        </button>
      ))}
    </div>
  );
}

// ── Date picker dropdown ──

export function DatePickerDropdown({ value, showTime, onChange, onClose }: {
  value: string;
  showTime: boolean;
  onChange: (dateStr: string) => void;
  onClose: () => void;
}) {
  const { t } = useT();
  const parseValue = (v: string) => {
    if (!v) return null;
    const match = v.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/);
    if (!match) return null;
    return { year: parseInt(match[1]), month: parseInt(match[2]) - 1, day: parseInt(match[3]), hours: match[4] ? parseInt(match[4]) : 0, minutes: match[5] ? parseInt(match[5]) : 0 };
  };
  const parsed = parseValue(value);
  const now = new Date();
  const [viewYear, setViewYear] = useState(parsed?.year ?? now.getFullYear());
  const [viewMonth, setViewMonth] = useState(parsed?.month ?? now.getMonth());
  const [selectedDay, setSelectedDay] = useState<number | null>(parsed?.day ?? null);
  const [selectedMonth, setSelectedMonth] = useState(parsed?.month ?? now.getMonth());
  const [selectedYear, setSelectedYear] = useState(parsed?.year ?? now.getFullYear());
  const [timeStr, setTimeStr] = useState(
    parsed ? `${String(parsed.hours).padStart(2, '0')}:${String(parsed.minutes).padStart(2, '0')}` : '00:00'
  );

  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const firstDayOfWeek = new Date(viewYear, viewMonth, 1).getDay();
  const weeks: (number | null)[][] = [];
  let week: (number | null)[] = Array(firstDayOfWeek).fill(null);
  for (let d = 1; d <= daysInMonth; d++) {
    week.push(d);
    if (week.length === 7) { weeks.push(week); week = []; }
  }
  if (week.length > 0) { while (week.length < 7) week.push(null); weeks.push(week); }

  const buildDateStr = (year: number, month: number, day: number) => {
    const [hh, mm] = timeStr.split(':').map(Number);
    const y = year;
    const mo = String(month + 1).padStart(2, '0');
    const da = String(day).padStart(2, '0');
    if (showTime) {
      const hours = String(hh || 0).padStart(2, '0');
      const mins = String(mm || 0).padStart(2, '0');
      return `${y}-${mo}-${da} ${hours}:${mins}`;
    }
    return `${y}-${mo}-${da}`;
  };

  const handleDayClick = (day: number) => {
    setSelectedDay(day);
    setSelectedMonth(viewMonth);
    setSelectedYear(viewYear);
    onChange(buildDateStr(viewYear, viewMonth, day));
  };

  const handleClear = () => { onChange(''); onClose(); };

  const prevMonth = () => { if (viewMonth === 0) { setViewYear(y => y - 1); setViewMonth(11); } else setViewMonth(m => m - 1); };
  const nextMonth = () => { if (viewMonth === 11) { setViewYear(y => y + 1); setViewMonth(0); } else setViewMonth(m => m + 1); };

  const isToday = (day: number) => {
    const now = new Date();
    return viewYear === now.getFullYear() && viewMonth === now.getMonth() && day === now.getDate();
  };
  const isSelected = (day: number) => {
    if (selectedDay === null) return false;
    return viewYear === selectedYear && viewMonth === selectedMonth && day === selectedDay;
  };

  const WEEKDAYS = (t('dataTable.weekdays', { returnObjects: true }) as unknown as string[]) || ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('[data-date-picker]')) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  // Build currentParsed for time change handler
  const currentParsed = selectedDay !== null ? { year: selectedYear, month: selectedMonth, day: selectedDay } : null;

  return (
    <div data-date-picker className="absolute left-0 top-full mt-1 z-20 bg-card border border-border rounded-lg shadow-xl w-64 select-none">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <span className="text-xs font-medium text-foreground">{t('dataTable.monthNames', { returnObjects: true })?.[viewMonth] || `${viewMonth + 1}`} {viewYear}</span>
        <div className="flex items-center gap-1">
          <button onClick={() => { const now = new Date(); setViewYear(now.getFullYear()); setViewMonth(now.getMonth()); setSelectedDay(now.getDate()); setSelectedMonth(now.getMonth()); setSelectedYear(now.getFullYear()); onChange(buildDateStr(now.getFullYear(), now.getMonth(), now.getDate())); }} className="text-[10px] text-muted-foreground hover:text-foreground mr-1">{t('dataTable.today')}</button>
          <button onClick={prevMonth} className="p-0.5 text-muted-foreground hover:text-foreground"><ChevronLeft className="h-3.5 w-3.5" /></button>
          <button onClick={nextMonth} className="p-0.5 text-muted-foreground hover:text-foreground"><ChevronRight className="h-3.5 w-3.5" /></button>
        </div>
      </div>
      <div className="grid grid-cols-7 gap-0 px-2 pt-1">
        {WEEKDAYS.map(w => (
          <div key={w} className="text-center text-[10px] text-muted-foreground py-0.5">{w}</div>
        ))}
      </div>
      <div className="px-2 pb-2">
        {weeks.map((wk, wi) => (
          <div key={wi} className="grid grid-cols-7 gap-0">
            {wk.map((day, di) => (
              <button
                key={di}
                disabled={day === null}
                onClick={() => day && handleDayClick(day)}
                className={cn(
                  'h-7 w-full text-xs rounded transition-colors',
                  day === null && 'invisible',
                  day !== null && !isSelected(day) && !isToday(day) && 'hover:bg-accent text-foreground',
                  day !== null && isToday(day) && !isSelected(day) && 'text-sidebar-primary font-medium',
                  day !== null && isSelected(day) && 'bg-sidebar-primary text-sidebar-primary-foreground font-medium',
                )}
              >
                {day}
              </button>
            ))}
          </div>
        ))}
      </div>
      {showTime && (
        <div className="px-3 pb-2 pt-1 border-t border-border flex items-center gap-2">
          <Clock className="h-3 w-3 text-muted-foreground" />
          <input
            type="time"
            value={timeStr}
            onChange={e => {
              const newTime = e.target.value;
              setTimeStr(newTime);
              if (currentParsed) {
                const [hh, mm] = newTime.split(':').map(Number);
                const y = currentParsed.year;
                const mo = String(currentParsed.month + 1).padStart(2, '0');
                const da = String(currentParsed.day).padStart(2, '0');
                onChange(`${y}-${mo}-${da} ${String(hh || 0).padStart(2, '0')}:${String(mm || 0).padStart(2, '0')}`);
              }
            }}
            className="bg-muted rounded px-2 py-1 text-xs text-foreground outline-none"
          />
        </div>
      )}
      <div className="px-3 pb-2 flex items-center justify-between">
        <button onClick={handleClear} className="text-[10px] text-muted-foreground hover:text-foreground">{t('dataTable.clear')}</button>
        <button
          onClick={(e) => { e.stopPropagation(); onClose(); }}
          className="text-xs px-3 py-1 rounded transition-colors bg-sidebar-primary text-sidebar-primary-foreground hover:opacity-90"
        >{t('common.confirm')}</button>
      </div>
    </div>
  );
}

// ── Linked record chips ──

export function LinkedRecordChips({ tableId, rowId, column, value }: { tableId: string; rowId: number; column: br.BRColumn; value: unknown }) {
  const { t } = useT();
  const inlineRecords = Array.isArray(value) ? value as Record<string, unknown>[] : [];
  const num = inlineRecords.length || (parseInt(String(value)) || 0);

  const needsFetch = !Array.isArray(value) && num > 0;
  const { data: linkedData } = useQuery({
    queryKey: ['nc-linked-records', tableId, rowId, column.column_id],
    queryFn: () => br.listLinkedRecords(tableId, rowId, column.column_id, { limit: 10 }),
    enabled: needsFetch,
    staleTime: 60_000,
  });

  if (num === 0) {
    return (
      <span className="text-xs py-1.5 flex items-center gap-1 text-muted-foreground/40 hover:text-sidebar-primary cursor-pointer select-none">
        <Plus className="h-3 w-3" />
      </span>
    );
  }

  const records = inlineRecords.length > 0 ? inlineRecords : (linkedData?.list || []);

  if (records.length === 0) {
    return <span className="text-xs py-1.5 block text-sidebar-primary cursor-pointer">{t('dataTable.nLinkedRecords', { n: num })}</span>;
  }

  const getDisplayValue = (rec: Record<string, unknown>): string => {
    const tryKeys = ['value', 'Title', 'title', 'Name', 'name'];
    for (const k of tryKeys) {
      if (rec[k] && typeof rec[k] === 'string') return rec[k] as string;
    }
    for (const [k, v] of Object.entries(rec)) {
      if (k !== 'Id' && k !== 'id' && typeof v === 'string' && v.trim()) return v;
    }
    return `#${rec.Id || '?'}`;
  };

  const MAX_CHIPS = 2;
  const shown = records.slice(0, MAX_CHIPS);
  const remaining = num - MAX_CHIPS;

  return (
    <div className="flex flex-wrap gap-1 py-0.5 items-center">
      {shown.map((rec, i) => (
        <span
          key={i}
          className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-sidebar-primary/10 text-sidebar-primary text-[11px] leading-tight max-w-[120px] truncate"
          title={getDisplayValue(rec)}
        >
          {getDisplayValue(rec)}
        </span>
      ))}
      {remaining > 0 && (
        <span className="text-[10px] text-muted-foreground">+{remaining}</span>
      )}
    </div>
  );
}

// ── Cell display ──

export function CellDisplay({ value, col, onDeleteAttachment }: { value: unknown; col: br.BRColumn; onDeleteAttachment?: (idx: number) => void }) {
  const { t } = useT();
  const { type: colType, primary_key: isPK } = col;

  if (value == null || value === '') {
    if (colType === 'Attachment') {
      return <span className="text-xs py-1.5 block text-muted-foreground/40 flex items-center gap-1"><Upload className="h-3 w-3" /> {t('dataTable.clickToUpload')}</span>;
    }
    if (colType === 'User' || colType === 'Collaborator') {
      return <span className="text-xs py-1.5 block text-muted-foreground/40 flex items-center gap-1"><User className="h-3 w-3" /> {t('dataTable.selectMember')}</span>;
    }
    return <span className="text-xs py-1.5 block select-none">&nbsp;</span>;
  }

  const str = (typeof value === 'object' && value !== null)
    ? (Array.isArray(value) ? JSON.stringify(value) : JSON.stringify(value))
    : String(value);

  if (colType === 'Checkbox') {
    const checked = !!value;
    return (
      <div className="flex items-center justify-center py-1">
        <div className={cn(
          'w-4 h-4 rounded border flex items-center justify-center cursor-pointer',
          checked ? 'bg-sidebar-primary border-sidebar-primary' : 'border-border bg-transparent'
        )}>
          {checked && <svg className="w-3 h-3 text-white" viewBox="0 0 12 12" fill="none"><path d="M2.5 6L5 8.5L9.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>}
        </div>
      </div>
    );
  }

  if (colType === 'Rating') {
    const n = typeof value === 'number' ? value : parseInt(str) || 0;
    const meta = col.meta as Record<string, unknown> | undefined;
    const max = (meta?.max as number) || 5;
    const iconType = (meta?.iconIdx as string) || 'star';
    const iconMap: Record<string, [string, string]> = {
      star: ['★', '☆'], heart: ['❤', '♡'], thumb: ['👍', '·'], flag: ['🚩', '·'],
      fire: ['🔥', '·'], smile: ['😊', '·'], flower: ['🌸', '·'],
      bolt: ['⚡', '·'], puzzle: ['🧩', '·'], number: ['🔢', '·'],
    };
    const [filled, empty] = iconMap[iconType] || iconMap.star;
    return <span className="text-sm py-1 block select-none">{filled.repeat(n)}{empty.repeat(Math.max(0, max - n))}</span>;
  }

  if (colType === 'SingleSelect') {
    const opt = col.options?.find(o => o.title === str);
    const color = opt?.color || SELECT_COLORS[0];
    return <span className="inline-block px-2 py-0.5 rounded text-[11px] my-1" style={{ backgroundColor: color, color: '#1a1a2e' }}>{str}</span>;
  }

  if (colType === 'MultiSelect') {
    const items = str.split(',').map(s => s.trim()).filter(Boolean);
    return (
      <div className="flex flex-wrap gap-0.5 py-1">
        {items.map((item, i) => {
          const opt = col.options?.find(o => o.title === item);
          const color = opt?.color || SELECT_COLORS[i % SELECT_COLORS.length];
          return <span key={i} className="inline-block px-1.5 py-0.5 rounded text-[10px]" style={{ backgroundColor: color, color: '#1a1a2e' }}>{item}</span>;
        })}
      </div>
    );
  }

  if (colType === 'URL') {
    const cid = extractContentId(str);
    if (cid) {
      return <span className="py-1" onClick={e => e.stopPropagation()}><ContentLink contentId={cid} inline showPreview={false} className="text-xs" /></span>;
    }
    return (
      <a href={str} target="_blank" rel="noopener noreferrer"
        className="text-xs text-sidebar-primary hover:underline truncate block max-w-[200px] py-1.5"
        title={str} onClick={e => e.stopPropagation()}
      >
        {str.replace(/^https?:\/\//, '').slice(0, 40)}
      </a>
    );
  }

  if (colType === 'Email') {
    return (
      <a href={`mailto:${str}`} className="text-xs text-sidebar-primary hover:underline truncate block max-w-[200px] py-1.5" onClick={e => e.stopPropagation()}>
        {str}
      </a>
    );
  }

  if (colType === 'PhoneNumber') {
    return (
      <a href={`tel:${str}`} className="text-xs text-sidebar-primary hover:underline py-1.5 block" onClick={e => e.stopPropagation()}>
        {str}
      </a>
    );
  }

  if (colType === 'Date' || colType === 'DateTime' || colType === 'CreatedTime' || colType === 'LastModifiedTime') {
    const dateMatch = str.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/);
    if (!dateMatch) return <span className="text-xs py-1.5 block text-foreground/70">{str}</span>;
    const meta = col.meta as Record<string, unknown> | undefined;
    const fmt = (meta?.date_format as string) || 'YYYY-MM-DD';
    const y = dateMatch[1];
    const m = dateMatch[2];
    const day = dateMatch[3];
    const hh = dateMatch[4] || '00';
    const mm = dateMatch[5] || '00';
    const formatted = fmt
      .replace('YYYY', y)
      .replace('MM', m)
      .replace('DD', day)
      .replace('HH', hh)
      .replace('mm', mm);
    const needsTime = colType !== 'Date' && !fmt.includes('HH');
    const timePart = needsTime ? ` ${hh}:${mm}` : '';
    return <span className="text-xs py-1.5 block text-foreground/70" title={str}>{formatted}{timePart}</span>;
  }

  if (colType === 'Time') return <span className="text-xs py-1.5 block text-foreground/70">{str}</span>;

  if (colType === 'Year') return <span className="text-xs tabular-nums py-1.5 block">{str}</span>;

  if (colType === 'Number' || colType === 'Decimal' || colType === 'AutoNumber' || colType === 'Currency' || colType === 'Percent') {
    const num = parseFloat(str);
    if (isNaN(num)) return <span className="text-xs tabular-nums py-1.5 block text-right">{str}</span>;
    const meta = col.meta as Record<string, unknown> | undefined;
    let decimals: number, thousands: boolean, prefix: string, suffix: string;
    if (colType === 'Number' && meta?.prefix !== undefined) {
      decimals = (meta?.decimals as number) ?? 0;
      thousands = !!meta?.thousands;
      prefix = (meta?.prefix as string) || '';
      suffix = (meta?.suffix as string) || '';
    } else if (colType === 'Currency') {
      decimals = 2; thousands = true; prefix = (meta?.currency_code as string) || '$'; suffix = '';
    } else if (colType === 'Percent') {
      decimals = 1; thousands = false; prefix = ''; suffix = '%';
    } else if (colType === 'Decimal') {
      decimals = (meta?.precision as number) ?? 2; thousands = false; prefix = ''; suffix = '';
    } else {
      decimals = 0; thousands = false; prefix = ''; suffix = '';
    }
    const formatted = thousands
      ? num.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
      : num.toFixed(decimals);
    return <span className="text-xs tabular-nums py-1.5 block text-right">{prefix}{formatted}{suffix}</span>;
  }

  if (colType === 'Duration') {
    const seconds = parseFloat(str);
    if (isNaN(seconds)) return <span className="text-xs tabular-nums py-1.5 block text-right">{str}</span>;
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    return <span className="text-xs tabular-nums py-1.5 block text-right">{h}:{String(m).padStart(2, '0')}:{String(s).padStart(2, '0')}</span>;
  }

  if (colType === 'JSON') {
    let display = str;
    try { display = JSON.stringify(JSON.parse(str), null, 1); } catch {}
    return <span className="text-xs py-1.5 block font-mono truncate max-w-[200px] text-foreground/70" title={display}>{display}</span>;
  }

  if (colType === 'Attachment') {
    if (Array.isArray(value) && value.length === 0) {
      return <span className="text-xs py-1.5 block text-muted-foreground/40 flex items-center gap-1"><Upload className="h-3 w-3" /> {t('dataTable.clickToUpload')}</span>;
    }
    try {
      const attachments = Array.isArray(value) ? value : JSON.parse(str);
      if (Array.isArray(attachments) && attachments.length > 0) {
        const isImage = (a: any) => a.mimetype?.startsWith('image/');
        return (
          <div className="flex gap-1 py-1 items-center">
            {attachments.slice(0, 3).map((a: any, i: number) => (
              <span key={i} className="relative group/att inline-flex">
                {isImage(a) ? (
                  <img src={attachmentUrl(a)} className="h-6 w-6 rounded object-cover border border-border" alt={a.title} title={a.title || a.path} />
                ) : (
                  <span className="text-[10px] bg-muted px-1.5 py-0.5 rounded truncate max-w-[80px] flex items-center gap-0.5" title={a.title || a.path}>
                    <Paperclip className="h-2.5 w-2.5 shrink-0" />
                    {a.title || t('dataTable.attachmentName', { n: i + 1 })}
                  </span>
                )}
                {onDeleteAttachment && (
                  <button
                    className="absolute -top-1.5 -right-1.5 hidden group-hover/att:flex h-3.5 w-3.5 items-center justify-center rounded-full bg-destructive text-destructive-foreground shadow-sm"
                    onClick={(e) => { e.stopPropagation(); onDeleteAttachment(i); }}
                    title={t('common.delete')}
                  >
                    <X className="h-2 w-2" />
                  </button>
                )}
              </span>
            ))}
            {attachments.length > 3 && <span className="text-[10px] text-muted-foreground">+{attachments.length - 3}</span>}
          </div>
        );
      }
    } catch {}
    if (!str || str === '[]') {
      return <span className="text-xs py-1.5 block text-muted-foreground/40 flex items-center gap-1"><Upload className="h-3 w-3" /> {t('dataTable.clickToUpload')}</span>;
    }
    return <span className="text-xs py-1.5 block text-muted-foreground">{str.slice(0, 30)}</span>;
  }

  if (colType === 'User' || colType === 'Collaborator') {
    if (!str) return <span className="text-xs py-1.5 block text-muted-foreground/40 flex items-center gap-1"><User className="h-3 w-3" /> {t('dataTable.selectMember')}</span>;
    return <span className="text-xs py-1.5 flex items-center gap-1 text-foreground/70"><User className="h-3 w-3 text-muted-foreground" />{str}</span>;
  }

  if (colType === 'CreatedBy' || colType === 'LastModifiedBy') {
    return <span className="text-xs py-1.5 block text-foreground/70 flex items-center gap-1"><User className="h-3 w-3" />{str}</span>;
  }

  if (colType === 'Links' || colType === 'LinkToAnotherRecord') {
    const linked = Array.isArray(value) ? value : [];
    const num = linked.length || parseInt(str) || 0;
    if (num === 0) {
      return <span className="text-xs py-1.5 flex items-center gap-1 text-muted-foreground/40 hover:text-sidebar-primary cursor-pointer select-none"><Plus className="h-3 w-3" /></span>;
    }
    return <span className="text-xs py-1.5 block text-sidebar-primary cursor-pointer">{t('dataTable.nLinkedRecords', { n: num })}</span>;
  }

  if (READONLY_TYPES.has(colType)) {
    return <span className="text-xs py-1.5 block text-foreground/50 italic">{str}</span>;
  }

  if (colType === 'SingleLineText' || colType === 'LongText') {
    const rendered = renderTextWithContentLinks(str, 'text-xs');
    if (rendered) {
      return <span className={cn('text-xs py-1.5 block max-w-[300px]', isPK ? 'text-muted-foreground' : 'text-foreground')} onClick={e => e.stopPropagation()}>{rendered}</span>;
    }
  }

  return <span className={cn('text-xs py-1.5 block truncate max-w-[300px]', isPK ? 'text-muted-foreground' : 'text-foreground')} title={str}>{str}</span>;
}

// ── Group rows (collapsible) ──

export function GroupRows({ groupKey, count, colSpan, children }: {
  groupKey: string;
  count: number;
  colSpan: number;
  children: React.ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <>
      <tr className="border-b border-border bg-muted/40">
        <td colSpan={colSpan} className="px-3 py-1.5">
          <button
            onClick={() => setCollapsed(v => !v)}
            className="flex items-center gap-2 text-xs font-medium text-foreground hover:text-sidebar-primary"
          >
            <ChevronDown className={cn('h-3 w-3 transition-transform', collapsed && '-rotate-90')} />
            <span>{groupKey}</span>
            <span className="text-muted-foreground font-normal">({count})</span>
          </button>
        </td>
      </tr>
      {!collapsed && children}
    </>
  );
}

// ── Sortable attachment item ──

export function SortableAttachmentItem({ id, children }: { id: number; children: React.ReactNode }) {
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

// ── Kanban DnD helpers ──

export function KanbanColumn({ id, children, isOver }: { id: string; children: React.ReactNode; isOver?: boolean }) {
  const { setNodeRef } = useDroppable({ id });
  return (
    <div ref={setNodeRef} className={cn('w-64 shrink-0 flex flex-col rounded-lg transition-colors', isOver ? 'bg-sidebar-primary/10 ring-2 ring-sidebar-primary/30' : 'bg-muted/20')}>
      {children}
    </div>
  );
}

export function KanbanCard({ id, children, isDragging, onClick }: { id: number; children: React.ReactNode; isDragging?: boolean; onClick?: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: id });
  const style: React.CSSProperties = {
    transform: transform ? `translate3d(${Math.round(transform.x)}px, ${Math.round(transform.y)}px, 0)` : undefined,
    transition,
    opacity: isDragging ? 0.4 : 1,
  };
  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}
      className="bg-card border border-border rounded-lg p-3 shadow-sm hover:shadow-md transition-shadow space-y-1.5 cursor-grab active:cursor-grabbing"
      onClick={onClick}
    >
      {children}
    </div>
  );
}

// ── Kanban View ──

export function KanbanView({ rows, columns, activeView, isLoading, onUpdateRow, onAddRow, tableId, refreshMeta, hiddenCols, onExpandRow, onRefreshRows }: {
  rows: Record<string, unknown>[];
  columns: br.BRColumn[];
  activeView: br.BRView;
  isLoading: boolean;
  onUpdateRow: (rowId: number, fields: Record<string, unknown>) => Promise<void>;
  onAddRow: () => void;
  tableId: string;
  refreshMeta: () => void;
  hiddenCols: Set<string>;
  onExpandRow?: (rowId: number) => void;
  onRefreshRows?: () => void;
}) {
  const { t } = useT();
  const queryClient = useQueryClient();
  const [grpColPicker, setGrpColPicker] = useState(false);
  const [draggedRowId, setDraggedRowId] = useState<number | null>(null);
  const [dragOverGroup, setDragOverGroup] = useState<string | null>(null);
  const kanbanSensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  const grpColId = activeView.fk_grp_col_id;
  const grpCol = columns.find(c => c.column_id === grpColId);
  const titleCol = columns.find(c => c.primary_key) || columns[0];
  const coverColId = activeView.fk_cover_image_col_id;
  const coverCol = coverColId ? columns.find(c => c.column_id === coverColId) : null;

  if (!grpCol) {
    const selectCols = columns.filter(c => c.type === 'SingleSelect');
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="bg-card border border-border rounded-xl p-6 max-w-sm text-center space-y-3">
          <Columns className="h-8 w-8 mx-auto text-muted-foreground" />
          <h3 className="text-sm font-semibold text-foreground">{t('dataTable.kanbanNeedField')}</h3>
          <p className="text-xs text-muted-foreground">{t('dataTable.kanbanNeedFieldHint')}</p>
          {selectCols.length > 0 ? (
            <div className="space-y-1">
              {selectCols.map(c => (
                <button
                  key={c.column_id}
                  onClick={async () => {
                    await br.updateKanbanConfig(activeView.view_id, { fk_grp_col_id: c.column_id });
                    refreshMeta();
                  }}
                  className="w-full px-3 py-2 text-xs bg-muted hover:bg-accent rounded-lg text-foreground"
                >
                  {c.title}
                </button>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground/60">{t('dataTable.noSingleSelectField')}</p>
          )}
        </div>
      </div>
    );
  }

  const isSelectCol = grpCol.type === 'SingleSelect' || grpCol.type === 'MultiSelect';
  const options = isSelectCol ? (grpCol.options || []) : [];
  const groups: Record<string, Record<string, unknown>[]> = {};
  const uncategorized: Record<string, unknown>[] = [];

  if (isSelectCol) {
    for (const opt of options) {
      groups[opt.title] = [];
    }
  }
  for (const row of rows) {
    const val = row[grpCol.title] as string;
    if (val) {
      if (!groups[val]) groups[val] = [];
      groups[val].push(row);
    } else {
      uncategorized.push(row);
    }
  }
  const groupKeys: string[] = isSelectCol
    ? [...options.map(o => o.title), ...Object.keys(groups).filter(k => !options.some(o => o.title === k))]
    : Object.keys(groups).sort();

  if (isLoading) {
    return (
      <div className="flex-1 flex gap-4 p-4 overflow-x-auto">
        {[1, 2, 3].map(i => (
          <div key={i} className="w-64 shrink-0 space-y-2">
            <div className="h-6 rounded bg-muted/50 animate-pulse" />
            <div className="h-24 rounded bg-muted/30 animate-pulse" />
            <div className="h-24 rounded bg-muted/30 animate-pulse" />
          </div>
        ))}
      </div>
    );
  }

  const getOptColor = (title: string, idx?: number) => {
    if (isSelectCol) {
      const opt = options.find(o => o.title === title);
      return opt?.color || SELECT_COLORS[(idx ?? options.indexOf(opt!)) % SELECT_COLORS.length] || SELECT_COLORS[0];
    }
    return SELECT_COLORS[(idx ?? 0) % SELECT_COLORS.length];
  };

  const allGroupKeys = [...groupKeys, ...(uncategorized.length ? ['__uncategorized__'] : [])];

  const handleKanbanDragStart = (event: DragStartEvent) => { setDraggedRowId(event.active.id as number); };

  const handleKanbanDragOver = (event: DragOverEvent) => {
    const overId = event.over?.id as string | undefined;
    if (!overId) { setDragOverGroup(null); return; }
    if (allGroupKeys.includes(overId)) {
      setDragOverGroup(overId);
    } else {
      for (const gk of allGroupKeys) {
        const gRows = gk === '__uncategorized__' ? uncategorized : (groups[gk] || []);
        if (gRows.some(r => (r.Id as number) === Number(overId))) {
          setDragOverGroup(gk);
          break;
        }
      }
    }
  };

  const handleKanbanDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    setDraggedRowId(null);
    setDragOverGroup(null);
    if (!over || !grpCol) return;
    const rowId = active.id as number;
    const overId = String(over.id);

    let targetGroup: string | null = null;
    if (allGroupKeys.includes(overId)) {
      targetGroup = overId;
    } else {
      for (const gk of allGroupKeys) {
        const gRows = gk === '__uncategorized__' ? uncategorized : (groups[gk] || []);
        if (gRows.some(r => (r.Id as number) === Number(overId))) {
          targetGroup = gk;
          break;
        }
      }
    }
    if (!targetGroup) return;

    const draggedRow = rows.find(r => (r.Id as number) === rowId);
    if (!draggedRow) return;
    const currentVal = draggedRow[grpCol.title] as string || '';
    const currentGroup = currentVal || '__uncategorized__';
    if (currentGroup === targetGroup) return;

    const newVal = targetGroup === '__uncategorized__' ? '' : targetGroup;
    queryClient.setQueriesData({ queryKey: ['nc-rows', tableId] }, (old: unknown) => {
      const data = old as { list: Record<string, unknown>[]; pageInfo?: unknown } | undefined;
      if (!data) return old;
      return { ...data, list: data.list.map(r => (r.Id as number) === rowId ? { ...r, [grpCol.title]: newVal } : r) };
    });
    try {
      await br.updateRow(tableId, rowId, { [grpCol.title]: newVal });
    } catch {
      onRefreshRows?.();
    }
  };

  return (
    <DndContext sensors={kanbanSensors} onDragStart={handleKanbanDragStart} onDragOver={handleKanbanDragOver} onDragEnd={handleKanbanDragEnd}>
    <div className="flex-1 flex gap-3 p-3 overflow-x-auto">
      {allGroupKeys.map((groupKey, gIdx) => {
        const isUncat = groupKey === '__uncategorized__';
        const groupRows = isUncat ? uncategorized : (groups[groupKey] || []);
        return (
          <KanbanColumn key={groupKey} id={groupKey} isOver={dragOverGroup === groupKey}>
            <div className="px-3 py-2 flex items-center gap-2 border-b border-border">
              {!isUncat && (
                <span className="px-2 py-0.5 rounded text-[11px] font-medium" style={{ backgroundColor: getOptColor(groupKey, gIdx), color: '#1a1a2e' }}>{groupKey}</span>
              )}
              {isUncat && <span className="text-xs text-muted-foreground">{t('dataTable.uncategorized')}</span>}
              <span className="text-[10px] text-muted-foreground ml-auto">{groupRows.length}</span>
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-2">
              <SortableContext items={groupRows.map(r => r.Id as number)} strategy={verticalListSortingStrategy}>
              {groupRows.map((row, i) => {
                const rowId = row.Id as number;
                return (
                  <KanbanCard key={rowId ?? i} id={rowId} isDragging={draggedRowId === rowId} onClick={() => onExpandRow?.(rowId)}>
                    {coverCol && (() => {
                      const coverVal = row[coverCol.title];
                      if (!coverVal) return <div className="w-full h-24 bg-muted/60 rounded-t -m-3 mb-1.5" style={{ width: 'calc(100% + 24px)' }} />;
                      try {
                        const arr = Array.isArray(coverVal) ? coverVal : JSON.parse(String(coverVal));
                        const img = arr.find((a: any) => a.mimetype?.startsWith('image/'));
                        if (!img) return <div className="w-full h-24 bg-muted/60 rounded-t -m-3 mb-1.5" style={{ width: 'calc(100% + 24px)' }} />;
                        return <img src={attachmentUrl(img)} className="w-full h-24 object-cover rounded-t -m-3 mb-1.5" style={{ width: 'calc(100% + 24px)' }} alt="" />;
                      } catch { return <div className="w-full h-24 bg-muted/60 rounded-t -m-3 mb-1.5" style={{ width: 'calc(100% + 24px)' }} />; }
                    })()}
                    <div className="text-xs font-medium text-foreground truncate cursor-pointer" onClick={() => onExpandRow?.(rowId)}>
                      {titleCol ? String(row[titleCol.title] ?? '') : `#${rowId}`}
                    </div>
                    {columns.filter(c => c !== titleCol && !c.primary_key && c.title !== 'created_by' && !hiddenCols.has(c.column_id)).map(c => {
                      const val = row[c.title];
                      if (val == null || val === '') return null;
                      return (
                        <div key={c.column_id} className="flex items-start gap-1">
                          <span className="text-[10px] text-muted-foreground shrink-0">{c.title}:</span>
                          <CompactCellDisplay value={val} col={c} />
                        </div>
                      );
                    })}
                  </KanbanCard>
                );
              })}
              </SortableContext>
            </div>
          </KanbanColumn>
        );
      })}
    </div>
    <DragOverlay>
      {draggedRowId != null ? (() => {
        const row = rows.find(r => (r.Id as number) === draggedRowId);
        if (!row) return null;
        return (
          <div className="bg-card border border-sidebar-primary rounded-lg p-3 shadow-xl space-y-1.5 w-60 opacity-90">
            <div className="text-xs font-medium text-foreground truncate">
              {titleCol ? String(row[titleCol.title] ?? '') : `#${draggedRowId}`}
            </div>
          </div>
        );
      })() : null}
    </DragOverlay>
    </DndContext>
  );
}

// ── Gallery View ──

export function GalleryView({ rows, columns, activeView, isLoading, onAddRow, hiddenCols, onExpandRow }: {
  rows: Record<string, unknown>[];
  columns: br.BRColumn[];
  activeView?: br.BRView;
  isLoading: boolean;
  onAddRow: () => void;
  hiddenCols: Set<string>;
  onExpandRow?: (rowId: number) => void;
}) {
  const { t } = useT();
  const titleCol = columns.find(c => c.primary_key) || columns[0];
  const coverColId = activeView?.fk_cover_image_col_id;
  const coverCol = coverColId ? columns.find(c => c.column_id === coverColId) : null;
  const detailCols = columns.filter(c => c !== titleCol && !c.primary_key && c.title !== 'created_by' && !hiddenCols.has(c.column_id));

  if (isLoading) {
    return (
      <div className="flex-1 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 p-4">
        {[...Array(8)].map((_, i) => (
          <div key={i} className="h-40 rounded-lg bg-muted/50 animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-auto p-4">
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
        {rows.map((row, i) => {
          const rowId = row.Id as number;
          return (
            <div key={rowId ?? i} className="bg-card border border-border rounded-lg overflow-hidden hover:shadow-lg transition-shadow cursor-pointer" onClick={() => onExpandRow?.(rowId)}>
              {coverCol && (() => {
                const coverVal = row[coverCol.title];
                if (!coverVal) return <div className="w-full h-32 bg-muted/60" />;
                try {
                  const arr = Array.isArray(coverVal) ? coverVal : JSON.parse(String(coverVal));
                  const img = arr.find((a: any) => a.mimetype?.startsWith('image/'));
                  if (!img) return <div className="w-full h-32 bg-muted/60" />;
                  return <img src={attachmentUrl(img)} className="w-full h-32 object-cover" alt="" />;
                } catch { return <div className="w-full h-32 bg-muted/60" />; }
              })()}
              <div className="p-4 space-y-2">
              <div className="text-sm font-semibold text-foreground truncate">
                {titleCol ? String(row[titleCol.title] ?? '') : `#${rowId}`}
              </div>
              {detailCols.map(c => {
                const val = row[c.title];
                if (val == null || val === '') return null;
                const ColIcon = getColIcon(c.type);
                return (
                  <div key={c.column_id} className="flex items-start gap-1.5">
                    <ColIcon className="h-3 w-3 text-muted-foreground shrink-0 mt-0.5" />
                    <div className="min-w-0 flex-1">
                      <div className="text-[10px] text-muted-foreground">{c.title}</div>
                      <CompactCellDisplay value={val} col={c} />
                    </div>
                  </div>
                );
              })}
              </div>
            </div>
          );
        })}
        <button onClick={onAddRow} className="border-2 border-dashed border-border rounded-lg p-4 flex items-center justify-center text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors">
          <Plus className="h-5 w-5 mr-1" /> {t('dataTable.newRecord')}
        </button>
      </div>
    </div>
  );
}

// ── Form View ──

export function FormView({ columns, tableId, onSubmit }: {
  columns: br.BRColumn[];
  tableId: string;
  onSubmit: (data: Record<string, unknown>) => Promise<void>;
}) {
  const { t } = useT();
  const [formData, setFormData] = useState<Record<string, string>>({});
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      const typedData: Record<string, unknown> = {};
      for (const col of columns) {
        const raw = formData[col.title];
        if (raw === undefined || raw === '') continue;
        if (col.type === 'Checkbox') {
          typedData[col.title] = raw === 'true';
        } else if (col.type === 'Number' || col.type === 'Decimal' || col.type === 'AutoNumber' || col.type === 'Duration') {
          const n = Number(raw);
          typedData[col.title] = isNaN(n) ? null : n;
        } else {
          typedData[col.title] = raw;
        }
      }
      await onSubmit(typedData);
      setFormData({});
      setSubmitted(true);
      setTimeout(() => setSubmitted(false), 2000);
    } catch (e) { showError(t('dataTable.formSubmitFailed'), e); }
    setSubmitting(false);
  };

  return (
    <div className="flex-1 overflow-auto flex justify-center py-8">
      <div className="w-full max-w-lg space-y-4 px-4">
        <h3 className="text-lg font-semibold text-foreground">{t('dataTable.newRecordTitle')}</h3>
        {columns.map(col => {
          const ColIcon = getColIcon(col.type);
          return (
            <div key={col.column_id} className="space-y-1">
              <label className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <ColIcon className="h-3 w-3" />
                {col.title}
                {col.required && <span className="text-destructive">*</span>}
              </label>
              {col.type === 'LongText' ? (
                <textarea
                  value={formData[col.title] || ''}
                  onChange={e => setFormData(d => ({ ...d, [col.title]: e.target.value }))}
                  rows={3}
                  className="w-full bg-muted rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground outline-none resize-none"
                  placeholder={col.title}
                />
              ) : col.type === 'Checkbox' ? (
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData[col.title] === 'true'}
                    onChange={e => setFormData(d => ({ ...d, [col.title]: e.target.checked ? 'true' : '' }))}
                    className="rounded border-border"
                  />
                  <span className="text-xs text-foreground">{t('dataTable.yes')}</span>
                </label>
              ) : col.type === 'SingleSelect' && col.options?.length ? (
                <select
                  value={formData[col.title] || ''}
                  onChange={e => setFormData(d => ({ ...d, [col.title]: e.target.value }))}
                  className="w-full bg-muted rounded-lg px-3 py-2 text-sm text-foreground outline-none"
                >
                  <option value="">{t('dataTable.selectPlaceholder')}</option>
                  {col.options.map(o => <option key={o.title} value={o.title}>{o.title}</option>)}
                </select>
              ) : (
                <input
                  value={formData[col.title] || ''}
                  onChange={e => setFormData(d => ({ ...d, [col.title]: e.target.value }))}
                  className="w-full bg-muted rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground outline-none"
                  placeholder={col.title}
                  type={col.type === 'Email' ? 'email' : col.type === 'URL' ? 'url' : 'text'}
                  inputMode={['Number', 'Decimal', 'Currency', 'Percent'].includes(col.type) ? 'decimal' : undefined}
                />
              )}
            </div>
          );
        })}
        <div className="flex items-center gap-3 pt-2">
          <button onClick={handleSubmit} disabled={submitting} className="px-6 py-2 bg-sidebar-primary text-sidebar-primary-foreground text-sm rounded-lg hover:opacity-90 disabled:opacity-50">
            {submitting ? t('dataTable.submitting') : t('dataTable.submit')}
          </button>
          {submitted && <span className="text-xs text-green-500">{t('dataTable.submitted')}</span>}
        </div>
      </div>
    </div>
  );
}

// ── Calendar View ──

export function CalendarView({ rows, columns, isLoading }: {
  rows: Record<string, unknown>[];
  columns: br.BRColumn[];
  isLoading: boolean;
}) {
  const { t } = useT();
  const [currentMonth, setCurrentMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });

  const dateCol = columns.find(c => c.type === 'Date' || c.type === 'DateTime');
  const titleCol = columns.find(c => c.primary_key) || columns[0];

  if (!dateCol) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="bg-card border border-border rounded-xl p-6 max-w-sm text-center space-y-3">
          <CalendarDays className="h-8 w-8 mx-auto text-muted-foreground" />
          <h3 className="text-sm font-semibold text-foreground">{t('dataTable.needDateField')}</h3>
          <p className="text-xs text-muted-foreground">{t('dataTable.needDateFieldHint')}</p>
        </div>
      </div>
    );
  }

  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonthCount = new Date(year, month + 1, 0).getDate();
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

  const rowsByDate: Record<string, Record<string, unknown>[]> = {};
  for (const row of rows) {
    const dateVal = row[dateCol.title];
    if (!dateVal) continue;
    const dateStr = String(dateVal).slice(0, 10);
    if (!rowsByDate[dateStr]) rowsByDate[dateStr] = [];
    rowsByDate[dateStr].push(row);
  }

  const prevMonth = () => setCurrentMonth(new Date(year, month - 1, 1));
  const nextMonth = () => setCurrentMonth(new Date(year, month + 1, 1));

  const weekDaysRaw = t('dataTable.weekdays', { returnObjects: true });
  const weekDays = Array.isArray(weekDaysRaw) ? weekDaysRaw as string[] : ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

  if (isLoading) {
    return <div className="flex-1 p-4"><div className="h-full rounded bg-muted/50 animate-pulse" /></div>;
  }

  return (
    <div className="flex-1 overflow-auto p-4 flex flex-col">
      <div className="flex items-center justify-between mb-3">
        <button onClick={prevMonth} className="p-1 text-muted-foreground hover:text-foreground"><ChevronLeft className="h-4 w-4" /></button>
        <h3 className="text-sm font-semibold text-foreground">{t('dataTable.yearMonth', { year, month: month + 1 })}</h3>
        <button onClick={nextMonth} className="p-1 text-muted-foreground hover:text-foreground"><ChevronRight className="h-4 w-4" /></button>
      </div>
      <div className="grid grid-cols-7 gap-px bg-border rounded-lg overflow-hidden flex-1">
        {weekDays.map(d => (
          <div key={d} className="bg-muted/30 px-1 py-1.5 text-center text-[10px] text-muted-foreground font-medium">{d}</div>
        ))}
        {Array.from({ length: firstDay }, (_, i) => (
          <div key={`pad-${i}`} className="bg-card/50 min-h-[80px]" />
        ))}
        {Array.from({ length: daysInMonthCount }, (_, i) => {
          const day = i + 1;
          const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
          const dayRows = rowsByDate[dateStr] || [];
          const isTodayDate = dateStr === todayStr;
          return (
            <div key={day} className={cn('bg-card min-h-[80px] p-1', isTodayDate && 'ring-1 ring-sidebar-primary ring-inset')}>
              <div className={cn('text-[10px] mb-0.5', isTodayDate ? 'text-sidebar-primary font-bold' : 'text-muted-foreground')}>{day}</div>
              <div className="space-y-0.5">
                {dayRows.slice(0, 3).map((row, ri) => (
                  <div key={ri} className="text-[9px] px-1 py-0.5 rounded bg-sidebar-primary/10 text-sidebar-primary truncate" title={String(row[titleCol.title] ?? '')}>
                    {String(row[titleCol.title] ?? '')}
                  </div>
                ))}
                {dayRows.length > 3 && <div className="text-[9px] text-muted-foreground px-1">+{dayRows.length - 3}</div>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
