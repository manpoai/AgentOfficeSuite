'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import dynamic from 'next/dynamic';
import 'katex/dist/katex.min.css';
import { commentHighlightPlugin, updateCommentHighlights } from './comment-highlight-plugin';
import { ContentLinkPicker } from '../shared/ContentLink/ContentLinkPicker';
import { DiagramPicker } from '../shared/EmbeddedDiagram/DiagramPicker';
import { DiagramEditorDialog } from '../shared/EmbeddedDiagram/DiagramEditorDialog';
import { FloatingToolbar } from '../shared/FloatingToolbar';
import { getDocsTextItems, getDocsTableItems, getDocsImageItems } from '../shared/FloatingToolbar/presets';
import { createDocsTextHandler, createDocsTableHandler, createDocsImageHandler } from './docs-toolbar-handler';
import type { SelectionInfo } from './floating-toolbar';
import { showError } from '@/lib/utils/error';
import { getT } from '@/lib/i18n';
import { EditorSkeleton } from '@/components/shared/Skeleton';
import type { TableToolbarInfo } from './table-menu-plugin';

interface EditorProps {
  defaultValue: string;
  /** ProseMirror JSON to initialize from (takes priority over defaultValue markdown) */
  defaultDocJson?: Record<string, unknown> | null;
  onChange?: (markdown: string) => void;
  /** Callback with ProseMirror JSON on every doc change (for rich-content persistence) */
  onDocJson?: (json: Record<string, unknown>) => void;
  readOnly?: boolean;
  autoFocus?: boolean;
  placeholder?: string;
  className?: string;
  documentId?: string;
  /** Callback when Cmd+F or Cmd+H is pressed */
  onSearchOpen?: (withReplace: boolean) => void;
  /** Comment quotes to highlight in the editor */
  commentQuotes?: { id: string; text: string }[];
}

/**
 * ProseMirror editor — Outline-style UX:
 * - Always editable (no separate view/edit modes)
 * - "/" slash command menu for block types
 * - Floating toolbar on text selection for inline formatting
 * - No top toolbar
 */
function EditorInner({ defaultValue, defaultDocJson, onChange, onDocJson, readOnly = false, autoFocus = false, placeholder, className, documentId, onSearchOpen, commentQuotes }: EditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [contentLinkPicker, setContentLinkPicker] = useState<{ top: number; left: number } | null>(null);
  const [diagramPicker, setDiagramPicker] = useState<{ top: number; left: number } | null>(null);
  const [editingDiagramId, setEditingDiagramId] = useState<string | null>(null);
  const [selectionInfo, setSelectionInfo] = useState<SelectionInfo | null>(null);
  const [tableToolbarInfo, setTableToolbarInfo] = useState<TableToolbarInfo | null>(null);
  const [imageToolbarInfo, setImageToolbarInfo] = useState<{
    anchor: { top: number; left: number; width: number };
    nodePos: number;
    view: any;
  } | null>(null);

  useEffect(() => {
    if (!editorRef.current) return;

    let view: any = null;
    let destroyed = false;
    let contentLinkPickerHandler: ((e: Event) => void) | null = null;
    let imageToolbarHandler: ((e: Event) => void) | null = null;
    let diagramPickerHandler: ((e: Event) => void) | null = null;
    let diagramEditorHandler: ((e: Event) => void) | null = null;

    (async () => {
      try {
        const [
          { EditorState, TextSelection, Plugin: PMPlugin },
          { EditorView },
          { history },
          { dropCursor },
          { gapCursor },
          { columnResizing, tableEditing },
          { schema },
          { parseMarkdown, markdownSerializer, serializeMarkdown },
          { buildInputRules },
          { buildKeymap, buildBaseKeymap },
          { slashMenuPlugin },
          { floatingToolbarPlugin },
          { createNodeViews },
          { imageUploadPlugin },
          { placeholderPlugin },
          { blockHandlePlugin },
          { tableMenuPlugin },
          { searchPlugin },
          { listNumberingPlugin },
          { contentLinkPastePlugin },
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
          import('./block-handle-plugin'),
          import('./table-menu-plugin'),
          import('./search-plugin'),
          import('./list-numbering-plugin'),
          import('./content-link-node'),
        ]);

        if (destroyed) return;

        let doc;
        if (defaultDocJson) {
          // Use ProseMirror JSON directly (preserves images, tables, formatting)
          try {
            const { Node } = await import('prosemirror-model');
            doc = Node.fromJSON(schema, defaultDocJson);
          } catch {
            doc = parseMarkdown(defaultValue || '');
          }
        } else {
          doc = parseMarkdown(defaultValue || '');
        }
        if (!doc) {
          setError(getT()('errors.parseDocumentFailed'));
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
          searchPlugin(),
          listNumberingPlugin(),
          contentLinkPastePlugin(),
        ];

        // Add interactive plugins only when not read-only
        if (!readOnly) {
          plugins.push(slashMenuPlugin(() => documentId));
          plugins.push(floatingToolbarPlugin((info) => setSelectionInfo(info)));
          plugins.push(imageUploadPlugin(() => documentId));
          plugins.push(placeholderPlugin(placeholder || ''));
          plugins.push(blockHandlePlugin());
          plugins.push(tableMenuPlugin((info) => setTableToolbarInfo(info)));
        }

        // Comment highlight decorations — highlights text matching comment quotes
        plugins.push(commentHighlightPlugin(commentQuotes || []));

        // Image selection highlight + comment mark indicator
        plugins.push(new PMPlugin({
          view() {
            return {
              update(editorView: any) {
                const { from, to, empty } = editorView.state.selection;
                const wrappers = editorView.dom.querySelectorAll('.image-node-wrapper');
                let hasImageInSelection = false;
                wrappers.forEach((w: HTMLElement) => {
                  if (empty) { w.classList.remove('image-in-selection'); return; }
                  const pos = editorView.posAtDOM(w, 0);
                  if (pos >= from && pos <= to) {
                    w.classList.add('image-in-selection');
                    hasImageInSelection = true;
                  } else {
                    w.classList.remove('image-in-selection');
                  }
                });
                // When a NodeSelection targets an image, clear native browser selection
                // to prevent the blue overlay from appearing
                if (editorView.state.selection.node?.type.name === 'image') {
                  const sel = window.getSelection();
                  if (sel && sel.rangeCount > 0) sel.removeAllRanges();
                }

                // Comment mark indicator on images:
                // ProseMirror doesn't render mark DOM wrappers for atom NodeViews,
                // so we scan image nodes and apply a CSS class based on their marks.
                const imageType = editorView.state.schema.nodes.image;
                editorView.state.doc.descendants((node: any, pos: number) => {
                  if (node.type !== imageType) return true;
                  const dom = editorView.nodeDOM(pos) as HTMLElement | null;
                  if (!dom) return false;
                  const hasComment = node.marks.some((m: any) => m.type.name === 'comment' && !m.attrs.resolved);
                  if (hasComment) {
                    dom.classList.add('image-commented');
                  } else {
                    dom.classList.remove('image-commented');
                  }
                  return false;
                });
              },
            };
          },
        }));

        const state = EditorState.create({ doc, plugins });

        // Capture onSearchOpen ref for use in handleKeyDown
        const searchOpenRef = { current: onSearchOpen };

        view = new EditorView(editorRef.current!, {
          state,
          editable: () => !readOnly,
          nodeViews: createNodeViews(() => documentId),
          clipboardTextSerializer(slice) {
            // Serialize tables as tab-separated text for plain-text clipboard
            const parts: string[] = [];
            slice.content.forEach((node: any) => {
              if (node.type.name === 'table') {
                const rows: string[] = [];
                node.forEach((row: any) => {
                  const cells: string[] = [];
                  row.forEach((cell: any) => {
                    cells.push(cell.textContent);
                  });
                  rows.push(cells.join('\t'));
                });
                parts.push(rows.join('\n'));
              } else {
                parts.push(node.textContent);
              }
            });
            return parts.join('\n\n');
          },
          handleKeyDown(_view, event) {
            const mod = event.metaKey || event.ctrlKey;
            if (mod && event.key === 'f') {
              event.preventDefault();
              searchOpenRef.current?.(false);
              return true;
            }
            if (mod && event.key === 'h') {
              event.preventDefault();
              searchOpenRef.current?.(true);
              return true;
            }
            return false;
          },
          dispatchTransaction(transaction) {
            if (!view || destroyed) return;
            const newState = view.state.apply(transaction);
            view.updateState(newState);
            if (transaction.docChanged) {
              if (onChange) {
                const md = serializeMarkdown(newState.doc);
                onChange(md);
              }
              if (onDocJson) {
                onDocJson(newState.doc.toJSON());
              }
            }
          },
          attributes: {
            class: 'outline-editor-content',
          },
        });

        viewRef.current = view;
        // Expose view on DOM for testing/debugging
        (editorRef.current as any).__pmView = view;

        // Listen for content link picker trigger from slash menu
        contentLinkPickerHandler = (e: Event) => {
          const { top, left } = (e as CustomEvent).detail;
          setContentLinkPicker({ top, left });
        };
        editorRef.current!.addEventListener('open-content-link-picker', contentLinkPickerHandler);

        // Image toolbar event from ImageNodeView
        imageToolbarHandler = (e: Event) => {
          const detail = (e as CustomEvent).detail;
          if (detail) {
            setImageToolbarInfo({ anchor: detail.anchor, nodePos: detail.nodePos, view: detail.view });
          } else {
            setImageToolbarInfo(null);
          }
        };
        editorRef.current!.addEventListener('image-toolbar', imageToolbarHandler);

        // Diagram picker trigger from slash menu
        diagramPickerHandler = (e: Event) => {
          const { top, left } = (e as CustomEvent).detail;
          setDiagramPicker({ top, left });
        };
        editorRef.current!.addEventListener('open-diagram-picker', diagramPickerHandler);

        // Diagram editor trigger from node view click
        diagramEditorHandler = (e: Event) => {
          const { diagramId } = (e as CustomEvent).detail;
          setEditingDiagramId(diagramId);
        };
        editorRef.current!.addEventListener('open-diagram-editor', diagramEditorHandler);

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
        showError(getT()('editor.initFailed'), e);
        setError(e.message || getT()('editor.initFailed'));
      }
    })();

    return () => {
      destroyed = true;
      if (contentLinkPickerHandler) {
        editorRef.current?.removeEventListener('open-content-link-picker', contentLinkPickerHandler);
      }
      if (imageToolbarHandler) {
        editorRef.current?.removeEventListener('image-toolbar', imageToolbarHandler);
      }
      if (diagramPickerHandler) {
        editorRef.current?.removeEventListener('open-diagram-picker', diagramPickerHandler);
      }
      if (diagramEditorHandler) {
        editorRef.current?.removeEventListener('open-diagram-editor', diagramEditorHandler);
      }
      if (view) {
        view.destroy();
      }
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readOnly]);

  // Update comment highlights when quotes change
  useEffect(() => {
    if (viewRef.current && commentQuotes) {
      updateCommentHighlights(viewRef.current, commentQuotes);
    }
  }, [commentQuotes]);

  if (error) {
    return (
      <div className={`outline-editor ${className || ''}`}>
        <div className="p-4 text-sm text-destructive">{getT()('editor.error')}: {error}</div>
      </div>
    );
  }

  /** Content Link Picker: insert content_link node when user selects an item */
  const handleContentLinkSelect = useCallback((contentId: string, item: any) => {
    const view = viewRef.current;
    if (!view) return;
    const schema = view.state.schema;
    const node = schema.nodes.content_link.create({
      contentId,
      title: item.title || contentId,
    });
    const { from, to } = view.state.selection;
    view.dispatch(view.state.tr.replaceWith(from, to, node).scrollIntoView());
    setContentLinkPicker(null);
    view.focus();
  }, []);

  const handleContentLinkCancel = useCallback(() => {
    setContentLinkPicker(null);
    viewRef.current?.focus();
  }, []);

  const handleDiagramSelect = useCallback((diagramId: string, item: any) => {
    setDiagramPicker(null);
    const view = viewRef.current;
    if (!view) return;
    try {
      const schema = view.state.schema;
      // Use raw_id (UUID without prefix) for API calls
      const rawId = item.raw_id || diagramId.replace(/^diagram:/, '');
      const node = schema.nodes.diagram_embed.create({
        diagramId: rawId,
        title: item.title || getT()('diagram.untitledDiagram'),
      });
      const { from, to } = view.state.selection;
      view.dispatch(view.state.tr.replaceWith(from, to, node).scrollIntoView());
      view.focus();
    } catch (err) {
      showError(getT()('editor.insertDiagramEmbedFailed'), err);
    }
  }, []);

  const handleDiagramPickerCancel = useCallback(() => {
    setDiagramPicker(null);
    viewRef.current?.focus();
  }, []);

  /** Item 8: Click below last content → cursor at end of last line */
  const handleWrapperClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const view = viewRef.current;
    if (!view || readOnly) return;
    const target = e.target as HTMLElement;
    // Only handle clicks on the wrapper itself or the mount div, not on editor content
    if (target.closest('.ProseMirror')) return;
    // Check if click is below the editor content
    const pmDom = view.dom as HTMLElement;
    const pmRect = pmDom.getBoundingClientRect();
    if (e.clientY > pmRect.bottom) {
      e.preventDefault();
      view.focus();
      const endPos = view.state.doc.content.size;
      const sel = view.state.selection.constructor.create(view.state.doc, endPos);
      view.dispatch(view.state.tr.setSelection(sel));
    }
  }, [readOnly]);

  return (
    <div className={`outline-editor ${className || ''}`} onClick={handleWrapperClick}>
      <div ref={editorRef} className="outline-editor-mount" />
      {selectionInfo && !readOnly && (
        <FloatingToolbar
          items={getDocsTextItems()}
          handler={createDocsTextHandler(selectionInfo.view)}
          anchor={selectionInfo.anchor}
          visible={true}
          onHover={(hovering) => {
            const el = editorRef.current?.closest('.outline-editor') as any;
            el?.__toolbarHover?.(hovering);
            el?.__toolbarInteracting?.(hovering);
          }}
        />
      )}
      {tableToolbarInfo && !readOnly && (
        <FloatingToolbar
          items={getDocsTableItems()}
          handler={createDocsTableHandler(tableToolbarInfo.view)}
          anchor={tableToolbarInfo.anchor}
          visible={true}
          onHover={(hovering) => {
            const el = editorRef.current?.closest('.outline-editor') as any;
            el?.__toolbarHover?.(hovering);
            el?.__toolbarInteracting?.(hovering);
          }}
        />
      )}
      {imageToolbarInfo && !readOnly && (
        <FloatingToolbar
          items={getDocsImageItems()}
          handler={createDocsImageHandler(imageToolbarInfo.view, imageToolbarInfo.nodePos, () => documentId)}
          anchor={imageToolbarInfo.anchor}
          visible={true}
        />
      )}
      {contentLinkPicker && createPortal(
        <div
          style={{
            position: 'fixed',
            top: contentLinkPicker.top,
            left: contentLinkPicker.left,
            zIndex: 1001,
          }}
        >
          <ContentLinkPicker
            onSelect={handleContentLinkSelect}
            onCancel={handleContentLinkCancel}
          />
        </div>,
        document.body,
      )}
      {diagramPicker && createPortal(
        <div
          style={{
            position: 'fixed',
            top: diagramPicker.top,
            left: diagramPicker.left,
            zIndex: 1001,
          }}
        >
          <DiagramPicker
            onSelect={handleDiagramSelect}
            onCancel={handleDiagramPickerCancel}
            embedded
          />
        </div>,
        document.body,
      )}
      {editingDiagramId && (
        <DiagramEditorDialog
          diagramId={editingDiagramId}
          onClose={() => setEditingDiagramId(null)}
        />
      )}
    </div>
  );
}

/**
 * Exported Editor — uses next/dynamic with ssr:false to prevent
 * any server-side rendering of ProseMirror code.
 */
export const Editor = dynamic(() => Promise.resolve(EditorInner), {
  ssr: false,
  loading: () => <EditorSkeleton />,
});
