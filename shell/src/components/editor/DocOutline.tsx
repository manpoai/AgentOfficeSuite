'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { ListTree } from 'lucide-react';
import { TextSelection } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import type { Node as ProseMirrorNode } from 'prosemirror-model';
import { cn } from '@/lib/utils';
import { useT } from '@/lib/i18n';

export interface HeadingItem {
  level: number;
  text: string;
  pos: number;
}

export function extractHeadings(doc: ProseMirrorNode): HeadingItem[] {
  const headings: HeadingItem[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name === 'heading') {
      headings.push({ level: node.attrs.level as number, text: node.textContent, pos });
    }
  });
  return headings;
}

export function scrollToHeading(view: EditorView | null, pos: number) {
  if (!view) return;
  try {
    const resolvedPos = view.state.doc.resolve(pos);
    const targetPos = resolvedPos.nodeAfter ? pos + 1 : pos;
    const tr = view.state.tr.setSelection(TextSelection.create(view.state.doc, targetPos));
    view.dispatch(tr);
    const domAtPos = view.domAtPos(targetPos);
    const node = domAtPos.node instanceof Element ? domAtPos.node : domAtPos.node.parentElement;
    if (node) node.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch {
    try {
      view.dispatch(view.state.tr.scrollIntoView());
    } catch { /* position entirely invalid, ignore */ }
  }
}

interface DocOutlineListProps {
  headings: HeadingItem[];
  onSelect: (pos: number) => void;
}

export function DocOutlineList({ headings, onSelect }: DocOutlineListProps) {
  const { t } = useT();
  if (headings.length === 0) {
    return <p className="text-sm text-muted-foreground px-3 py-4 text-center">{t('editor.outlineNoHeadings')}</p>;
  }
  return (
    <div className="py-1">
      {headings.map((h, i) => (
        <button
          key={i}
          onClick={() => onSelect(h.pos)}
          className="w-full text-left px-3 py-1.5 text-sm hover:bg-accent transition-colors rounded truncate"
          style={{ paddingLeft: `${(h.level - 1) * 12 + 12}px` }}
          title={h.text}
        >
          <span className="text-muted-foreground text-xs mr-1.5">H{h.level}</span>
          <span className="text-foreground">{h.text || <em className="text-muted-foreground">{t('editor.outlineEmptyText')}</em>}</span>
        </button>
      ))}
    </div>
  );
}

interface DocOutlineProps {
  getView: () => EditorView | null;
}

export function DocOutline({ getView }: DocOutlineProps) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const [headings, setHeadings] = useState<HeadingItem[]>([]);
  const panelRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(() => {
    const view = getView();
    if (!view) return;
    setHeadings(extractHeadings(view.state.doc));
  }, [getView]);

  // Refresh on open
  useEffect(() => {
    if (open) refresh();
  }, [open, refresh]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div ref={panelRef} className="absolute top-[30vh] right-4 z-30">
      <button
        onClick={() => setOpen(v => !v)}
        className={cn(
          'flex items-center justify-center w-7 h-7 rounded-lg transition-colors',
          open ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-accent'
        )}
        title={t('editor.outline')}
      >
        <ListTree className="h-4 w-4" />
      </button>

      {open && (
        <div className="absolute top-9 right-0 w-56 max-h-[60vh] overflow-y-auto bg-card border border-border rounded-xl shadow-2xl">
          <DocOutlineList
            headings={headings}
            onSelect={(pos) => {
              scrollToHeading(getView(), pos);
            }}
          />
        </div>
      )}
    </div>
  );
}
