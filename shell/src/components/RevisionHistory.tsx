'use client';

import { useState, useEffect, useCallback } from 'react';
import { X, RotateCcw, Clock, ChevronRight } from 'lucide-react';
import * as ol from '@/lib/api/outline';
import type { OLRevision, OLDocument } from '@/lib/api/outline';
import { useT } from '@/lib/i18n';

interface Props {
  doc: OLDocument;
  onClose: () => void;
  onRestored: () => void | Promise<void>;
}

export default function RevisionHistory({ doc, onClose, onRestored }: Props) {
  const { t } = useT();
  const [revisions, setRevisions] = useState<OLRevision[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [previewContent, setPreviewContent] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    ol.listRevisions(doc.id)
      .then((revs) => {
        if (!cancelled) {
          setRevisions(revs);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err.message);
          setLoading(false);
        }
      });
    return () => { cancelled = true; };
  }, [doc.id]);

  const selectRevision = useCallback((rev: OLRevision) => {
    setSelectedId(rev.id);
    // Extract text preview from ProseMirror JSON data
    const text = extractTextFromPMData(rev.data);
    setPreviewContent(text);
  }, []);

  const handleRestore = useCallback(async () => {
    if (!selectedId) return;
    setRestoring(true);
    try {
      await ol.restoreRevision(doc.id, selectedId);
      await onRestored();
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Restore failed');
      setRestoring(false);
    }
  }, [selectedId, doc.id, onRestored, onClose]);

  const formatTime = (iso: string) => {
    const d = new Date(iso);
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    const mins = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (mins < 1) return t('content.justNow') || 'Just now';
    if (mins < 60) return `${mins} ${t('content.minutesAgo') || 'min ago'}`;
    if (hours < 24) return `${hours} ${t('content.hoursAgo') || 'hours ago'}`;
    if (days < 7) return `${days} ${t('content.daysAgo') || 'days ago'}`;

    return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="fixed inset-0 z-50 flex">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />

      {/* Panel */}
      <div className="relative ml-auto flex h-full w-full max-w-[900px] bg-background shadow-2xl">
        {/* Preview area */}
        <div className="flex-1 overflow-auto p-8">
          <div className="mx-auto max-w-[48rem]">
            {selectedId && previewContent ? (
              <div className="prose prose-sm dark:prose-invert max-w-none whitespace-pre-wrap font-mono text-sm leading-relaxed text-foreground/80">
                {previewContent}
              </div>
            ) : (
              <div className="flex h-full items-center justify-center text-muted-foreground">
                <p>{t('content.selectRevision') || 'Select a version to preview'}</p>
              </div>
            )}
          </div>
        </div>

        {/* Sidebar: revision list */}
        <div className="w-72 flex-shrink-0 border-l border-border bg-card">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Clock size={16} />
              {t('content.versionHistory') || 'Version History'}
            </div>
            <button
              onClick={onClose}
              className="rounded-md p-1 hover:bg-accent"
            >
              <X size={16} />
            </button>
          </div>

          {/* Current version */}
          <div className="border-b border-border px-4 py-3">
            <div className="text-xs font-medium text-muted-foreground uppercase">
              {t('content.currentVersion') || 'Current'}
            </div>
            <div className="mt-1 text-sm">{doc.title}</div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              {doc.updatedBy?.name} · {formatTime(doc.updatedAt)}
            </div>
          </div>

          {/* Revision list */}
          <div className="overflow-y-auto" style={{ maxHeight: 'calc(100vh - 160px)' }}>
            {loading && (
              <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                {t('content.loading') || 'Loading...'}
              </div>
            )}
            {error && (
              <div className="px-4 py-4 text-sm text-destructive">{error}</div>
            )}
            {!loading && revisions.length === 0 && (
              <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                {t('content.noRevisions') || 'No previous versions'}
              </div>
            )}
            {revisions.map((rev) => (
              <button
                key={rev.id}
                onClick={() => selectRevision(rev)}
                className={`w-full border-b border-border px-4 py-3 text-left transition-colors hover:bg-accent/50 ${
                  selectedId === rev.id ? 'bg-accent' : ''
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">
                    {formatTime(rev.createdAt)}
                  </span>
                  <ChevronRight size={14} className="text-muted-foreground" />
                </div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  {rev.createdBy?.name || 'Unknown'}
                </div>
              </button>
            ))}
          </div>

          {/* Restore button */}
          {selectedId && (
            <div className="border-t border-border p-4">
              <button
                onClick={handleRestore}
                disabled={restoring}
                className="flex w-full items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                <RotateCcw size={14} />
                {restoring
                  ? (t('content.restoring') || 'Restoring...')
                  : (t('content.restoreVersion') || 'Restore this version')}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** Extract plain text from ProseMirror JSON data for preview */
function extractTextFromPMData(data: Record<string, unknown>): string {
  const lines: string[] = [];

  function walk(node: Record<string, unknown>, depth = 0) {
    const type = node.type as string;
    const content = node.content as Record<string, unknown>[] | undefined;
    const attrs = node.attrs as Record<string, unknown> | undefined;

    // Block-level formatting
    if (type === 'heading') {
      const level = (attrs?.level as number) || 1;
      const prefix = '#'.repeat(level) + ' ';
      const text = extractInlineText(content);
      lines.push(prefix + text);
      lines.push('');
      return;
    }

    if (type === 'paragraph') {
      const text = extractInlineText(content);
      lines.push(text);
      lines.push('');
      return;
    }

    if (type === 'bullet_list' || type === 'ordered_list' || type === 'checkbox_list') {
      if (content) {
        content.forEach((child, i) => {
          const prefix = type === 'ordered_list' ? `${i + 1}. ` : type === 'checkbox_list' ? '☐ ' : '• ';
          const text = extractBlockText(child);
          lines.push('  '.repeat(depth) + prefix + text);
        });
      }
      lines.push('');
      return;
    }

    if (type === 'blockquote') {
      if (content) {
        content.forEach((child) => {
          const text = extractBlockText(child);
          lines.push('> ' + text);
        });
      }
      lines.push('');
      return;
    }

    if (type === 'code_block') {
      lines.push('```');
      const text = extractInlineText(content);
      lines.push(text);
      lines.push('```');
      lines.push('');
      return;
    }

    if (type === 'horizontal_rule') {
      lines.push('---');
      lines.push('');
      return;
    }

    if (type === 'image') {
      const src = (attrs?.src as string) || '';
      const alt = (attrs?.alt as string) || '';
      lines.push(`[Image: ${alt || src.substring(0, 40)}]`);
      lines.push('');
      return;
    }

    // Recurse into children
    if (content) {
      content.forEach((child) => walk(child, depth));
    }
  }

  function extractInlineText(content?: Record<string, unknown>[]): string {
    if (!content) return '';
    return content.map((node) => {
      if (node.type === 'text') return (node.text as string) || '';
      if (node.type === 'hard_break') return '\n';
      if (node.type === 'image') return `[Image]`;
      if (node.content) return extractInlineText(node.content as Record<string, unknown>[]);
      return '';
    }).join('');
  }

  function extractBlockText(node: Record<string, unknown>): string {
    const content = node.content as Record<string, unknown>[] | undefined;
    if (!content) return '';
    return content.map((child) => {
      if (child.type === 'paragraph') return extractInlineText(child.content as Record<string, unknown>[]);
      if (child.type === 'text') return (child.text as string) || '';
      return extractBlockText(child);
    }).join(' ');
  }

  if (data.content) {
    (data.content as Record<string, unknown>[]).forEach((node) => walk(node));
  }

  return lines.join('\n').trim();
}
