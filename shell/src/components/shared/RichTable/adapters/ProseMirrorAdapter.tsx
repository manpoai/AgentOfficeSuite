'use client';

/**
 * ProseMirrorAdapter — Bridges RichTable into ProseMirror documents.
 *
 * In the Docs editor, tables are already native ProseMirror nodes managed by
 * editor-core's Table/TableView/TableCell/TableHeader/TableRow classes.
 * This adapter provides:
 *
 * 1. A thin wrapper that the existing ProseMirror table NodeView can delegate to
 *    for shared toolbar and context menu rendering.
 * 2. A way for the Docs editor to use RichTable's TableToolbar and
 *    TableContextMenu alongside the existing table editing experience.
 *
 * The existing editor-core table implementation remains the source of truth
 * for ProseMirror table editing in Docs. This adapter does NOT replace it —
 * it supplements it with shared UI components.
 */

import { useEffect, useRef, useCallback } from 'react';
import type { EditorView } from 'prosemirror-view';
import type { RichTableActions, SortDirection } from '../types';

interface ProseMirrorAdapterProps {
  /** The ProseMirror EditorView instance from the Docs editor */
  view: EditorView;
  /** Whether to show the shared toolbar */
  showToolbar?: boolean;
  /** Whether to enable shared context menu */
  showContextMenu?: boolean;
}

/**
 * Creates RichTableActions that delegate to the existing ProseMirror table
 * commands. This bridges the gap between the shared RichTable action interface
 * and the Docs editor's ProseMirror-native table commands.
 */
export function createProseMirrorActions(view: EditorView): RichTableActions {
  const execCmd = (cmdFn: any) => {
    if (typeof cmdFn === 'function') {
      cmdFn(view.state, view.dispatch, view);
    }
  };

  return {
    addRowBefore: () => {
      import('prosemirror-tables').then(({ addRow, selectedRect, isInTable }) => {
        if (!isInTable(view.state)) return;
        const rect = selectedRect(view.state);
        view.dispatch(addRow(view.state.tr, rect, rect.top));
      });
    },
    addRowAfter: () => {
      import('prosemirror-tables').then(({ addRowAfter }) => execCmd(addRowAfter));
    },
    addColumnBefore: () => {
      import('prosemirror-tables').then(({ addColumnBefore }) =>
        execCmd(addColumnBefore)
      );
    },
    addColumnAfter: () => {
      import('prosemirror-tables').then(({ addColumnAfter }) =>
        execCmd(addColumnAfter)
      );
    },
    deleteRow: () => {
      import('prosemirror-tables').then(({ deleteRow }) => execCmd(deleteRow));
    },
    deleteColumn: () => {
      import('prosemirror-tables').then(({ deleteColumn }) => execCmd(deleteColumn));
    },
    deleteTable: () => {
      import('prosemirror-tables').then(({ deleteTable }) => execCmd(deleteTable));
    },
    mergeCells: () => {
      import('prosemirror-tables').then(({ mergeCells }) => execCmd(mergeCells));
    },
    splitCell: () => {
      import('prosemirror-tables').then(({ splitCell }) => execCmd(splitCell));
    },
    sort: (columnIndex: number, direction: SortDirection) => {
      // Find the first table and sort its body rows by the specified column
      view.state.doc.descendants((node, pos) => {
        if (node.type.name !== 'table') return;

        // Extract rows: separate header from body
        const rows: { node: any; pos: number }[] = [];
        let hasHeader = false;
        node.forEach((row, offset) => {
          rows.push({ node: row, pos: pos + 1 + offset });
          row.forEach((cell) => {
            if (cell.type.name === 'table_header') hasHeader = true;
          });
        });

        const startIdx = hasHeader ? 1 : 0;
        if (rows.length <= startIdx) return false;

        const bodyRows = rows.slice(startIdx);

        // Sort by text content of the specified column
        bodyRows.sort((a, b) => {
          const aCell = a.node.child(Math.min(columnIndex, a.node.childCount - 1));
          const bCell = b.node.child(Math.min(columnIndex, b.node.childCount - 1));
          const aVal = aCell.textContent;
          const bVal = bCell.textContent;
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

        // Rebuild the table with sorted rows
        const schema = view.state.schema;
        const headerRows = rows.slice(0, startIdx).map((r) => r.node);
        const sortedRows = [...headerRows, ...bodyRows.map((r) => r.node)];
        const newTable = schema.nodes.table.create(node.attrs, sortedRows);
        const tr = view.state.tr.replaceWith(pos, pos + node.nodeSize, newTable);
        view.dispatch(tr);
        return false; // Only sort the first table
      });
    },
    toggleHeader: () => {
      import('prosemirror-tables').then(({ toggleHeader }) =>
        execCmd(toggleHeader('row'))
      );
    },
    setCellBackground: (color: string) => {
      import('prosemirror-tables').then(({ CellSelection }) => {
        const { state, dispatch } = view;
        if (state.selection instanceof CellSelection) {
          let tr = state.tr;
          (state.selection as any).forEachCell((node: any, pos: number) => {
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
      const { doc } = view.state;
      const rows: string[] = [];
      doc.descendants((node) => {
        if (node.type.name === 'table') {
          node.forEach((row) => {
            const cells: string[] = [];
            row.forEach((cell) => {
              let val = cell.textContent;
              // Formula injection protection
              if (/^[=+\-@\t\r]/.test(val)) {
                val = "'" + val;
              }
              if (val.includes(',') || val.includes('"') || val.includes('\n')) {
                val = `"${val.replace(/"/g, '""')}"`;
              }
              cells.push(val);
            });
            rows.push(cells.join(','));
          });
          return false; // Only export the first table
        }
      });
      if (rows.length === 0) return;
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
      import('prosemirror-tables').then(({ CellSelection, TableMap, isInTable }) => {
        if (!isInTable(view.state)) return;
        // Find the first table in the doc
        let tableStart = 0;
        view.state.doc.descendants((node, pos) => {
          if (node.type.name === 'table' && !tableStart) {
            tableStart = pos + 1; // +1 for inside table node
            const map = TableMap.get(node);
            if (index < 0 || index >= map.height) return false;
            const firstCell = map.map[index * map.width];
            const lastCell = map.map[index * map.width + map.width - 1];
            const $first = view.state.doc.resolve(tableStart + firstCell);
            const $last = view.state.doc.resolve(tableStart + lastCell);
            view.dispatch(view.state.tr.setSelection(CellSelection.create(view.state.doc, $first.pos, $last.pos)));
            return false;
          }
        });
      });
    },
    selectColumn: (index: number) => {
      import('prosemirror-tables').then(({ CellSelection, TableMap, isInTable }) => {
        if (!isInTable(view.state)) return;
        let tableStart = 0;
        view.state.doc.descendants((node, pos) => {
          if (node.type.name === 'table' && !tableStart) {
            tableStart = pos + 1;
            const map = TableMap.get(node);
            if (index < 0 || index >= map.width) return false;
            const firstCell = map.map[index];
            const lastCell = map.map[(map.height - 1) * map.width + index];
            const $first = view.state.doc.resolve(tableStart + firstCell);
            const $last = view.state.doc.resolve(tableStart + lastCell);
            view.dispatch(view.state.tr.setSelection(CellSelection.create(view.state.doc, $first.pos, $last.pos)));
            return false;
          }
        });
      });
    },
    selectAll: () => {
      import('prosemirror-tables').then(({ CellSelection, TableMap, isInTable }) => {
        if (!isInTable(view.state)) return;
        let tableStart = 0;
        view.state.doc.descendants((node, pos) => {
          if (node.type.name === 'table' && !tableStart) {
            tableStart = pos + 1;
            const map = TableMap.get(node);
            const $first = view.state.doc.resolve(tableStart + map.map[0]);
            const $last = view.state.doc.resolve(tableStart + map.map[map.map.length - 1]);
            view.dispatch(view.state.tr.setSelection(CellSelection.create(view.state.doc, $first.pos, $last.pos)));
            return false;
          }
        });
      });
    },
  };
}

/**
 * React hook that provides RichTableActions for a ProseMirror EditorView.
 * Use this in components that need to trigger table operations on the Docs editor.
 */
export function useProseMirrorTableActions(
  view: EditorView | null
): RichTableActions | null {
  const viewRef = useRef(view);
  viewRef.current = view;

  if (!view) return null;
  return createProseMirrorActions(view);
}
