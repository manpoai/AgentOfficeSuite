'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import dynamic from 'next/dynamic';
import 'katex/dist/katex.min.css';

interface EditorProps {
  defaultValue: string;
  onChange?: (markdown: string) => void;
  readOnly?: boolean;
  autoFocus?: boolean;
  placeholder?: string;
  className?: string;
  documentId?: string;
}

/**
 * ProseMirror editor — Outline-style UX:
 * - Always editable (no separate view/edit modes)
 * - "/" slash command menu for block types
 * - Floating toolbar on text selection for inline formatting
 * - No top toolbar
 */
function EditorInner({ defaultValue, onChange, readOnly = false, autoFocus = false, placeholder, className, documentId }: EditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<any>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!editorRef.current) return;

    let view: any = null;
    let destroyed = false;

    (async () => {
      try {
        const [
          { EditorState, TextSelection },
          { EditorView },
          { history },
          { dropCursor },
          { gapCursor },
          { columnResizing, tableEditing },
          { schema },
          { parseMarkdown, markdownSerializer },
          { buildInputRules },
          { buildKeymap, buildBaseKeymap },
          { slashMenuPlugin },
          { floatingToolbarPlugin },
          { createNodeViews },
          { imageUploadPlugin },
          { placeholderPlugin },
        ] = await Promise.all([
          import('prosemirror-state'),
          import('prosemirror-view'),
          import('prosemirror-history'),
          import('prosemirror-dropcursor'),
          import('prosemirror-gapcursor'),
          import('prosemirror-tables'),
          import('./schema'),
          import('./markdown'),
          import('./input-rules'),
          import('./keymap'),
          import('./slash-menu'),
          import('./floating-toolbar'),
          import('./node-views'),
          import('./image-plugin'),
          import('./placeholder-plugin'),
        ]);

        if (destroyed) return;

        const doc = parseMarkdown(defaultValue || '');
        if (!doc) {
          setError('Failed to parse document content');
          return;
        }

        const plugins = [
          buildInputRules(),
          buildKeymap(),
          buildBaseKeymap(),
          history(),
          dropCursor(),
          gapCursor(),
          columnResizing(),
          tableEditing(),
        ];

        // Add interactive plugins only when not read-only
        if (!readOnly) {
          plugins.push(slashMenuPlugin());
          plugins.push(floatingToolbarPlugin());
          plugins.push(imageUploadPlugin(() => documentId));
          plugins.push(placeholderPlugin(placeholder || ''));
        }

        const state = EditorState.create({ doc, plugins });

        view = new EditorView(editorRef.current!, {
          state,
          editable: () => !readOnly,
          nodeViews: createNodeViews(),
          dispatchTransaction(transaction) {
            if (!view || destroyed) return;
            const newState = view.state.apply(transaction);
            view.updateState(newState);
            if (transaction.docChanged && onChange) {
              const md = markdownSerializer.serialize(newState.doc);
              onChange(md);
            }
          },
          attributes: {
            class: 'outline-editor-content',
          },
        });

        viewRef.current = view;
        // Expose view on DOM for testing/debugging
        (editorRef.current as any).__pmView = view;

        if (autoFocus) {
          setTimeout(() => {
            if (!view || destroyed) return;
            view.focus();
            const end = view.state.doc.content.size;
            const tr = view.state.tr.setSelection(TextSelection.create(view.state.doc, end));
            view.dispatch(tr);
          }, 50);
        }
      } catch (e: any) {
        console.error('Editor init error:', e);
        setError(e.message || 'Editor initialization failed');
      }
    })();

    return () => {
      destroyed = true;
      if (view) {
        view.destroy();
      }
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readOnly]);

  if (error) {
    return (
      <div className={`outline-editor ${className || ''}`}>
        <div className="p-4 text-sm text-destructive">Editor error: {error}</div>
      </div>
    );
  }

  return (
    <div className={`outline-editor ${className || ''}`}>
      <div ref={editorRef} className="outline-editor-mount" />
    </div>
  );
}

/**
 * Exported Editor — uses next/dynamic with ssr:false to prevent
 * any server-side rendering of ProseMirror code.
 */
export const Editor = dynamic(() => Promise.resolve(EditorInner), {
  ssr: false,
  loading: () => <div className="p-4 text-sm text-muted-foreground">加载编辑器...</div>,
});
