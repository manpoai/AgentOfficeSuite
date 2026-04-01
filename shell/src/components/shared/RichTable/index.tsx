'use client';

/**
 * RichTable — Shared table component powered by ProseMirror.
 *
 * Provides a standalone, embeddable rich table editor that can be used across
 * Docs (via ProseMirrorAdapter), Presentation (via FabricOverlay), and
 * Diagram (via X6Overlay).
 *
 * Features:
 * - Cell editing with inline content
 * - Row/column add/delete
 * - Cell merge/split
 * - Column resize
 * - Row/column drag reorder
 * - Header row toggle
 * - Cell background colors
 * - CSV export
 * - Sort by column
 */

import {
  useEffect,
  useRef,
  useState,
  useCallback,
  useImperativeHandle,
  forwardRef,
  useMemo,
} from 'react';
import { cn } from '@/lib/utils';
import type {
  RichTableProps,
  RichTableData,
  RichTableActions,
  RichTableConfig,
  CellAlignment,
  SortDirection,
} from './types';

// Default config
const DEFAULT_CONFIG: Required<RichTableConfig> = {
  readonly: false,
  cellMinWidth: 50,
  toolbar: {
    addRow: true,
    addColumn: true,
    deleteRow: true,
    deleteColumn: true,
    mergeCells: true,
    splitCell: true,
    sort: true,
    cellBackground: true,
    exportCSV: true,
    toggleHeader: true,
  },
  showToolbar: true,
  showContextMenu: true,
  columnResizing: true,
  dragReorder: false, // Not yet implemented — requires custom ProseMirror plugin
};

/** Ref handle exposed by RichTable */
export interface RichTableHandle {
  /** Access the ProseMirror EditorView (for advanced integrations) */
  getView: () => unknown | null;
  /** Get current table data */
  getData: () => RichTableData | null;
  /** Table action methods */
  actions: RichTableActions | null;
}

/**
 * Creates a minimal ProseMirror schema for standalone table editing.
 * Only includes nodes needed for tables: doc, paragraph, text, table nodes.
 */
async function createTableSchema() {
  const [{ Schema }, { tableNodes }] = await Promise.all([
    import('prosemirror-model'),
    import('prosemirror-tables'),
  ]);

  const tNodes = tableNodes({
    tableGroup: 'block',
    cellContent: 'block+',
    cellAttributes: {
      alignment: {
        default: null,
        getFromDOM(dom: HTMLElement) {
          return dom.style.textAlign || null;
        },
        setDOMAttr(value: unknown, attrs: Record<string, unknown>) {
          if (value) {
            attrs.style =
              ((attrs.style as string) || '') + `text-align: ${value};`;
          }
        },
      },
      background: {
        default: null,
        getFromDOM(dom: HTMLElement) {
          return dom.style.backgroundColor || null;
        },
        setDOMAttr(value: unknown, attrs: Record<string, unknown>) {
          if (value) {
            attrs.style =
              ((attrs.style as string) || '') +
              `background-color: ${value};`;
          }
        },
      },
    },
  });

  return new Schema({
    nodes: {
      doc: { content: 'table' },
      paragraph: {
        content: 'inline*',
        group: 'block',
        parseDOM: [{ tag: 'p' }],
        toDOM() {
          return ['p', 0];
        },
      },
      text: { group: 'inline' },
      hard_break: {
        inline: true,
        group: 'inline',
        selectable: false,
        parseDOM: [{ tag: 'br' }],
        toDOM() {
          return ['br'];
        },
      },
      ...tNodes,
    },
    marks: {
      strong: {
        parseDOM: [
          { tag: 'strong' },
          { tag: 'b' },
          {
            style: 'font-weight',
            getAttrs: (value: unknown) =>
              /^(bold|[7-9]\d{2,})$/.test(value as string) && null,
          },
        ],
        toDOM() {
          return ['strong', 0];
        },
      },
      em: {
        parseDOM: [{ tag: 'em' }, { tag: 'i' }, { style: 'font-style=italic' }],
        toDOM() {
          return ['em', 0];
        },
      },
      underline: {
        parseDOM: [{ tag: 'u' }, { style: 'text-decoration=underline' }],
        toDOM() {
          return ['u', 0];
        },
      },
      strikethrough: {
        parseDOM: [{ tag: 's' }, { tag: 'del' }, { style: 'text-decoration=line-through' }],
        toDOM() {
          return ['s', 0];
        },
      },
      highlight: {
        attrs: { color: { default: null } },
        parseDOM: [
          {
            tag: 'mark',
            getAttrs(dom: HTMLElement) {
              return { color: dom.getAttribute('data-color') || dom.style.backgroundColor || null };
            },
          },
        ],
        toDOM(mark: any) {
          const attrs: Record<string, string> = {};
          if (mark.attrs.color) {
            attrs.style = `background-color: ${mark.attrs.color}`;
            attrs['data-color'] = mark.attrs.color;
          }
          return ['mark', attrs, 0];
        },
      },
    },
  });
}

/**
 * Converts simplified RichTableData to ProseMirror JSON document.
 */
function dataToProsemirrorJSON(
  data: RichTableData,
  schemaRef: { current: unknown }
): Record<string, unknown> {
  const rows = data.rows.map((row, rowIdx) => {
    const cellType =
      data.hasHeader && rowIdx === 0 ? 'table_header' : 'table_cell';
    const cells = row.cells.map((cell) => ({
      type: cellType,
      attrs: {
        colspan: cell.colspan ?? 1,
        rowspan: cell.rowspan ?? 1,
        alignment: cell.alignment ?? null,
        colwidth: cell.colwidth ?? null,
        background: cell.background ?? null,
      },
      content: [
        {
          type: 'paragraph',
          content: cell.content
            ? [{ type: 'text', text: cell.content }]
            : undefined,
        },
      ],
    }));
    return { type: 'table_row', content: cells };
  });

  return {
    type: 'doc',
    content: [{ type: 'table', content: rows }],
  };
}

/**
 * Converts ProseMirror document JSON to simplified RichTableData.
 */
function prosemirrorJSONToData(json: Record<string, unknown>): RichTableData {
  const content = json.content as Array<Record<string, unknown>>;
  if (!content || content.length === 0) {
    return { hasHeader: true, rows: [{ cells: [{ content: '' }] }] };
  }

  const table = content[0];
  const tableContent = table.content as Array<Record<string, unknown>>;
  if (!tableContent) {
    return { hasHeader: true, rows: [{ cells: [{ content: '' }] }] };
  }

  let hasHeader = false;
  const rows = tableContent.map((row) => {
    const rowContent = row.content as Array<Record<string, unknown>>;
    const cells = (rowContent || []).map((cell) => {
      if (cell.type === 'table_header') hasHeader = true;
      const attrs = (cell.attrs || {}) as Record<string, unknown>;
      const cellContent = cell.content as Array<Record<string, unknown>>;
      // Extract text from cell content (paragraph → text)
      let textContent = '';
      if (cellContent) {
        cellContent.forEach((block) => {
          const blockContent = block.content as
            | Array<Record<string, unknown>>
            | undefined;
          if (blockContent) {
            blockContent.forEach((inline) => {
              if (inline.type === 'text') {
                textContent += (inline.text as string) || '';
              }
            });
          }
        });
      }
      return {
        content: textContent,
        colspan: (attrs.colspan as number) ?? 1,
        rowspan: (attrs.rowspan as number) ?? 1,
        alignment: (attrs.alignment as CellAlignment) ?? null,
        colwidth: (attrs.colwidth as number[] | null) ?? null,
        background: (attrs.background as string) ?? undefined,
      };
    });
    return { cells };
  });

  return { hasHeader, rows };
}

/**
 * Creates a default 3x3 table document.
 */
function createDefaultTable(): Record<string, unknown> {
  const headerCells = Array.from({ length: 3 }, () => ({
    type: 'table_header',
    attrs: {
      colspan: 1,
      rowspan: 1,
      alignment: null,
      colwidth: null,
      background: null,
    },
    content: [{ type: 'paragraph' }],
  }));

  const bodyRow = () => ({
    type: 'table_row',
    content: Array.from({ length: 3 }, () => ({
      type: 'table_cell',
      attrs: {
        colspan: 1,
        rowspan: 1,
        alignment: null,
        colwidth: null,
        background: null,
      },
      content: [{ type: 'paragraph' }],
    })),
  });

  return {
    type: 'doc',
    content: [
      {
        type: 'table',
        content: [
          { type: 'table_row', content: headerCells },
          bodyRow(),
          bodyRow(),
        ],
      },
    ],
  };
}

export const RichTable = forwardRef<RichTableHandle, RichTableProps>(
  function RichTable(
    {
      data,
      prosemirrorJSON,
      onChange,
      onProsemirrorChange,
      onCellToolbar,
      config: userConfig,
      className,
      width,
      height,
    },
    ref
  ) {
    const editorRef = useRef<HTMLDivElement>(null);
    const viewRef = useRef<any>(null);
    const schemaRef = useRef<any>(null);
    const [ready, setReady] = useState(false);
    const onChangeRef = useRef(onChange);
    const onPmChangeRef = useRef(onProsemirrorChange);
    const onCellToolbarRef = useRef(onCellToolbar);
    onChangeRef.current = onChange;
    onPmChangeRef.current = onProsemirrorChange;
    onCellToolbarRef.current = onCellToolbar;

    const config = useMemo(
      () => ({
        ...DEFAULT_CONFIG,
        ...userConfig,
        toolbar: { ...DEFAULT_CONFIG.toolbar, ...userConfig?.toolbar },
      }),
      [userConfig]
    );

    // Initialize ProseMirror
    useEffect(() => {
      if (!editorRef.current) return;
      let destroyed = false;

      (async () => {
        const [
          { EditorState },
          { EditorView },
          { columnResizing, tableEditing },
          { history },
          { keymap },
          { baseKeymap },
        ] = await Promise.all([
          import('prosemirror-state'),
          import('prosemirror-view'),
          import('prosemirror-tables'),
          import('prosemirror-history'),
          import('prosemirror-keymap'),
          import('prosemirror-commands'),
        ]);

        if (destroyed) return;

        const schema = await createTableSchema();
        schemaRef.current = schema;

        // Determine initial document
        let docJSON: Record<string, unknown>;
        if (prosemirrorJSON) {
          docJSON = prosemirrorJSON;
        } else if (data) {
          docJSON = dataToProsemirrorJSON(data, schemaRef);
        } else {
          docJSON = createDefaultTable();
        }

        const doc = schema.nodeFromJSON(docJSON);

        const { tableMenuPlugin } = await import('@/components/editor/table-menu-plugin');

        const plugins = [
          history(),
          keymap(baseKeymap),
        ];

        if (config.columnResizing) {
          plugins.unshift(columnResizing({ cellMinWidth: config.cellMinWidth }));
        }
        plugins.push(tableEditing());

        // Add table menu plugin for grip bars, insertion dots, context menus
        if (!config.readonly) {
          plugins.push(tableMenuPlugin(
            onCellToolbarRef.current
              ? (info: any) => onCellToolbarRef.current?.(info)
              : undefined
          ));
        }

        const state = EditorState.create({ doc, plugins });

        const view = new EditorView(editorRef.current!, {
          state,
          editable: () => !config.readonly,
          dispatchTransaction(tr) {
            const newState = view.state.apply(tr);
            view.updateState(newState);

            if (tr.docChanged) {
              const json = newState.doc.toJSON();
              onPmChangeRef.current?.(json);
              if (onChangeRef.current) {
                onChangeRef.current(prosemirrorJSONToData(json));
              }
            }
          },
        });

        viewRef.current = view;
        setReady(true);
      })();

      return () => {
        destroyed = true;
        if (viewRef.current) {
          viewRef.current.destroy();
          viewRef.current = null;
        }
        setReady(false);
      };
      // Only re-init when config fundamentals change
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [config.readonly, config.cellMinWidth, config.columnResizing]);

    // Build actions object
    const actions = useMemo<RichTableActions | null>(() => {
      if (!ready || !viewRef.current) return null;

      const execCommand = (cmd: any) => {
        const view = viewRef.current;
        if (!view) return;
        cmd(view.state, view.dispatch, view);
      };

      // Cache prosemirror-tables module to avoid repeated imports
      let pmTables: typeof import('prosemirror-tables') | null = null;
      const getPmTables = async () => {
        if (!pmTables) pmTables = await import('prosemirror-tables');
        return pmTables;
      };

      return {
        addRowBefore: () => {
          getPmTables().then(({ addRow, selectedRect, isInTable }) => {
            const view = viewRef.current;
            if (!view || !isInTable(view.state)) return;
            const rect = selectedRect(view.state);
            view.dispatch(addRow(view.state.tr, rect, rect.top));
          });
        },
        addRowAfter: () => {
          getPmTables().then(({ addRowAfter: cmd }) => execCommand(cmd));
        },
        addColumnBefore: () => {
          getPmTables().then(({ addColumnBefore: cmd }) => execCommand(cmd));
        },
        addColumnAfter: () => {
          getPmTables().then(({ addColumnAfter: cmd }) => execCommand(cmd));
        },
        deleteRow: () => {
          getPmTables().then(({ deleteRow: cmd }) => execCommand(cmd));
        },
        deleteColumn: () => {
          getPmTables().then(({ deleteColumn: cmd }) => execCommand(cmd));
        },
        deleteTable: () => {
          getPmTables().then(({ deleteTable: cmd }) => execCommand(cmd));
        },
        mergeCells: () => {
          getPmTables().then(({ mergeCells: cmd }) => execCommand(cmd));
        },
        splitCell: () => {
          getPmTables().then(({ splitCell: cmd }) => execCommand(cmd));
        },
        sort: (columnIndex: number, direction: SortDirection) => {
          const view = viewRef.current;
          if (!view) return;
          const data = prosemirrorJSONToData(view.state.doc.toJSON());
          if (!data.rows.length) return;

          // Separate header (if any) from body rows
          const startIdx = data.hasHeader ? 1 : 0;
          const headerRows = data.rows.slice(0, startIdx);
          const bodyRows = data.rows.slice(startIdx);

          // Sort body rows by the specified column
          bodyRows.sort((a, b) => {
            const aVal = a.cells[columnIndex]?.content ?? '';
            const bVal = b.cells[columnIndex]?.content ?? '';
            // Try numeric comparison first
            const aNum = parseFloat(aVal);
            const bNum = parseFloat(bVal);
            let cmp: number;
            if (!isNaN(aNum) && !isNaN(bNum)) {
              cmp = aNum - bNum;
            } else {
              cmp = aVal.localeCompare(bVal);
            }
            return direction === 'desc' ? -cmp : cmp;
          });

          const sortedData: RichTableData = {
            hasHeader: data.hasHeader,
            rows: [...headerRows, ...bodyRows],
          };

          // Rebuild ProseMirror document from sorted data
          const schema = schemaRef.current;
          if (!schema) return;
          const newDocJSON = dataToProsemirrorJSON(sortedData, schemaRef);
          const newDoc = schema.nodeFromJSON(newDocJSON);
          const tr = view.state.tr.replaceWith(0, view.state.doc.content.size, newDoc.content);
          view.dispatch(tr);
        },
        toggleHeader: () => {
          getPmTables().then(({ toggleHeader }) =>
            execCommand(toggleHeader('row'))
          );
        },
        setCellBackground: (color: string) => {
          getPmTables().then(({ CellSelection: CS }) => {
            const view = viewRef.current;
            if (!view) return;
            const { state, dispatch } = view;
            const { selection } = state;
            if (selection instanceof CS) {
              let tr = state.tr;
              selection.forEachCell((node: any, pos: number) => {
                tr = tr.setNodeMarkup(pos, null, {
                  ...node.attrs,
                  background: color,
                });
              });
              dispatch(tr);
            }
          });
        },
        exportCSV: (fileName?: string) => {
          const view = viewRef.current;
          if (!view) return;
          const data = prosemirrorJSONToData(view.state.doc.toJSON());
          const rows = data.rows.map((r) =>
            r.cells.map((c) => {
              let val = c.content;
              // Formula injection protection: prefix dangerous chars with single quote
              if (/^[=+\-@\t\r]/.test(val)) {
                val = "'" + val;
              }
              // Escape CSV values
              if (val.includes(',') || val.includes('"') || val.includes('\n')) {
                val = `"${val.replace(/"/g, '""')}"`;
              }
              return val;
            }).join(',')
          );
          const csv = rows.join('\n');
          const blob = new Blob([csv], { type: 'text/csv' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = (fileName || 'table') + '.csv';
          a.click();
          URL.revokeObjectURL(url);
        },
        selectRow: (index: number) => {
          getPmTables().then(({ CellSelection: CS, TableMap, isInTable }) => {
            const view = viewRef.current;
            if (!view || !isInTable(view.state)) return;
            const { state, dispatch } = view;
            const table = state.doc.firstChild;
            if (!table) return;
            const map = TableMap.get(table);
            if (index < 0 || index >= map.height) return;
            const firstCell = map.map[index * map.width];
            const lastCell = map.map[index * map.width + map.width - 1];
            const $first = state.doc.resolve(2 + firstCell);
            const $last = state.doc.resolve(2 + lastCell);
            dispatch(state.tr.setSelection(CS.create(state.doc, $first.pos, $last.pos)));
          });
        },
        selectColumn: (index: number) => {
          getPmTables().then(({ CellSelection: CS, TableMap, isInTable }) => {
            const view = viewRef.current;
            if (!view || !isInTable(view.state)) return;
            const { state, dispatch } = view;
            const table = state.doc.firstChild;
            if (!table) return;
            const map = TableMap.get(table);
            if (index < 0 || index >= map.width) return;
            const firstCell = map.map[index];
            const lastCell = map.map[(map.height - 1) * map.width + index];
            const $first = state.doc.resolve(2 + firstCell);
            const $last = state.doc.resolve(2 + lastCell);
            dispatch(state.tr.setSelection(CS.create(state.doc, $first.pos, $last.pos)));
          });
        },
        selectAll: () => {
          // Select all cells in the table via CellSelection
          getPmTables().then(({ CellSelection: CS, TableMap, isInTable }) => {
            const view = viewRef.current;
            if (!view || !isInTable(view.state)) return;
            const { state, dispatch } = view;
            const table = state.doc.firstChild;
            if (!table) return;
            const map = TableMap.get(table);
            const $first = state.doc.resolve(2 + map.map[0]);
            const $last = state.doc.resolve(2 + map.map[map.map.length - 1]);
            dispatch(state.tr.setSelection(CS.create(state.doc, $first.pos, $last.pos)));
          });
        },
      };
    }, [ready]);

    // Expose ref handle
    useImperativeHandle(
      ref,
      () => ({
        getView: () => viewRef.current,
        getData: () => {
          if (!viewRef.current) return null;
          return prosemirrorJSONToData(viewRef.current.state.doc.toJSON());
        },
        actions,
      }),
      [actions]
    );

    const containerStyle = useMemo(
      () => ({
        width: width ?? '100%',
        height: height ?? 'auto',
      }),
      [width, height]
    );

    return (
      <div
        className={cn(
          'rich-table-container',
          'relative overflow-visible',
          config.readonly && 'rich-table-readonly',
          className
        )}
        style={containerStyle}
      >
        <div
          ref={editorRef}
          className={cn(
            'rich-table-editor',
            'relative prose prose-sm max-w-none',
            '[&_table]:w-full [&_table]:border-collapse',
            '[&_td]:border [&_td]:border-border [&_td]:p-2 [&_td]:text-sm [&_td]:text-foreground',
            '[&_th]:border [&_th]:border-border [&_th]:p-2 [&_th]:text-sm [&_th]:font-semibold [&_th]:text-foreground [&_th]:bg-muted',
            '[&_td:focus-within]:outline-none [&_td:focus-within]:ring-2 [&_td:focus-within]:ring-sidebar-primary/30',
            '[&_th:focus-within]:outline-none [&_th:focus-within]:ring-2 [&_th:focus-within]:ring-sidebar-primary/30',
            '[&_p]:m-0 [&_p]:leading-normal',
            '[&_.ProseMirror]:outline-none',
            '[&_.column-resize-handle]:absolute [&_.column-resize-handle]:right-[-2px] [&_.column-resize-handle]:top-0 [&_.column-resize-handle]:bottom-[-2px] [&_.column-resize-handle]:w-[4px] [&_.column-resize-handle]:bg-sidebar-primary/40 [&_.column-resize-handle]:cursor-col-resize',
            '[&_.selectedCell]:bg-sidebar-primary/10'
          )}
        />
      </div>
    );
  }
);

export type { RichTableProps, RichTableData, RichTableActions } from './types';
export type { RichTableConfig, RichTableCell, RichTableRow } from './types';
