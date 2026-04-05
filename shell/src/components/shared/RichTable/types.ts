/**
 * Type definitions for the shared RichTable component.
 *
 * RichTable wraps the ProseMirror table engine into a standalone React component
 * that can be used across Docs, Presentation, and Diagram editors.
 */

/** Alignment options for table cell content */
export type CellAlignment = 'left' | 'center' | 'right' | null;

/** A single cell in the table data model */
export interface RichTableCell {
  /** Cell content as HTML string */
  content: string;
  /** Number of columns this cell spans */
  colspan?: number;
  /** Number of rows this cell spans */
  rowspan?: number;
  /** Text alignment within the cell */
  alignment?: CellAlignment;
  /** Column width in pixels (null = auto) */
  colwidth?: number[] | null;
  /** Background color hex string */
  background?: string;
}

/** A row in the table data model */
export interface RichTableRow {
  cells: RichTableCell[];
}

/** Complete table data model */
export interface RichTableData {
  /** Whether the first row is a header row */
  hasHeader: boolean;
  /** All rows including header */
  rows: RichTableRow[];
}

/** Toolbar item visibility configuration */
export interface RichTableToolbarConfig {
  addRow?: boolean;
  addColumn?: boolean;
  deleteRow?: boolean;
  deleteColumn?: boolean;
  mergeCells?: boolean;
  splitCell?: boolean;
  sort?: boolean;
  cellBackground?: boolean;
  exportCSV?: boolean;
  toggleHeader?: boolean;
}

/** Configuration for RichTable behavior */
export interface RichTableConfig {
  /** Whether the table is read-only */
  readonly?: boolean;
  /** Minimum cell width in pixels */
  cellMinWidth?: number;
  /** Which toolbar items to show (all visible by default) */
  toolbar?: RichTableToolbarConfig;
  /** Whether to show the toolbar at all */
  showToolbar?: boolean;
  /** Whether to show context menu on right-click */
  showContextMenu?: boolean;
  /** Whether to enable column resizing */
  columnResizing?: boolean;
  /** Whether to enable row/column drag reordering */
  dragReorder?: boolean;
}

/** Sort direction */
export type SortDirection = 'asc' | 'desc';

/** Sort configuration */
export interface SortConfig {
  columnIndex: number;
  direction: SortDirection;
}

/** Props for the RichTable React component */
export interface RichTableProps {
  /** Table data (ProseMirror JSON or simplified data model) */
  data?: RichTableData;
  /** ProseMirror document JSON — used when embedding in ProseMirror documents */
  prosemirrorJSON?: Record<string, unknown>;
  /** Called when table content changes */
  onChange?: (data: RichTableData) => void;
  /** Called when ProseMirror doc changes (for ProseMirror adapter) */
  onProsemirrorChange?: (json: Record<string, unknown>) => void;
  /** Table configuration */
  config?: RichTableConfig;
  /** Additional CSS class name */
  className?: string;
  /** Width of the table container */
  width?: number | string;
  /** Height of the table container */
  height?: number | string;
  /** Callback for FloatingToolbar integration — emits cell selection info */
  onCellToolbar?: (info: { anchor: { top: number; left: number; width: number }; view: any } | null) => void;
}

/** Context menu item for table operations */
export interface TableContextMenuItem {
  id: string;
  label: string;
  icon?: React.ReactNode;
  shortcut?: string;
  action: () => void;
  disabled?: boolean;
  danger?: boolean;
  separator?: boolean;
}

/** Context menu context — what was right-clicked */
export interface TableContextMenuContext {
  type: 'cell' | 'header' | 'row' | 'column';
  rowIndex: number;
  colIndex: number;
}

/** Toolbar action callback types */
export interface RichTableActions {
  addRowBefore: (index?: number) => void;
  addRowAfter: (index?: number) => void;
  addColumnBefore: (index?: number) => void;
  addColumnAfter: (index?: number) => void;
  deleteRow: () => void;
  deleteColumn: () => void;
  deleteTable: () => void;
  mergeCells: () => void;
  splitCell: () => void;
  sort: (columnIndex: number, direction: SortDirection) => void;
  toggleHeader: () => void;
  setCellBackground: (color: string) => void;
  exportCSV: (fileName?: string) => void;
  selectRow: (index: number) => void;
  selectColumn: (index: number) => void;
  selectAll: () => void;
}
