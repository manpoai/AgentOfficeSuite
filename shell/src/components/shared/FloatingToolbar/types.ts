import type { ReactNode } from 'react';

/** A single button/control in the toolbar */
export interface ToolbarItem {
  /** Unique identifier: 'bold', 'italic', 'fillColor', etc. */
  key: string;
  /** Rendering type */
  type: 'toggle' | 'color' | 'dropdown' | 'action' | 'custom';
  /** Lucide icon element */
  icon: ReactNode;
  /** Tooltip text */
  label: string;
  /** Group name — separators inserted between different groups */
  group: string;
  /** For 'dropdown' type: selectable options */
  options?: { value: string; label: string; icon?: ReactNode }[];
  /** For 'color' type: preset color swatches */
  colors?: { name: string; value: string }[];
  /** Whether to show a "clear/remove" button in the color picker */
  colorClearable?: boolean;
  /** For 'custom' type: render function receiving current value and onSelect callback */
  renderCustom?: (value: string | undefined, onSelect: (value: string) => void) => ReactNode;
}

/** Current state of toolbar buttons (active flags, selected values) */
export interface ToolbarState {
  [key: string]: boolean | string | undefined;
}

/** Engine-specific action dispatcher */
export interface ToolbarHandler {
  /** Get current active/selected state for all buttons */
  getState(): ToolbarState;
  /** Execute a toolbar action */
  execute(key: string, value?: unknown): void;
}
