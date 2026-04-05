export type ShortcutHandler = (e: KeyboardEvent) => void;

export interface ShortcutModifiers {
  meta?: boolean;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
}

export interface ShortcutDef {
  id: string;
  /** The key to match (e.g. 'k', 'Enter', 'Delete') */
  key: string;
  modifiers?: ShortcutModifiers;
  handler: ShortcutHandler;
  /** Human-readable label for the help panel */
  label: string;
  /** Category for grouping in the help panel (e.g. 'Global', 'Document', 'Table') */
  category?: string;
  /** Higher priority shortcuts are matched first (default: 0) */
  priority?: number;
}

/** @deprecated Use ShortcutDef instead */
export type ShortcutRegistration = ShortcutDef;
