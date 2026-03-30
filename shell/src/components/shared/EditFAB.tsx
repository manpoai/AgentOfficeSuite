'use client';
import React from 'react';
import { Pencil, Undo2, Redo2, X } from 'lucide-react';

interface EditFABProps {
  onEdit: () => void;
  onSave: () => void;
  onUndo?: () => void;
  onRedo?: () => void;
  onCancel: () => void;
  isEditing: boolean;
  canUndo?: boolean;
  canRedo?: boolean;
  className?: string;
}

export function EditFAB({ onEdit, onSave, onUndo, onRedo, onCancel, isEditing, canUndo = false, canRedo = false }: EditFABProps) {
  if (isEditing) {
    // Top edit toolbar
    return (
      <div className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-3 py-2 bg-card border-b border-border safe-area-top md:hidden">
        <button onClick={onCancel} className="p-2 rounded-lg hover:bg-muted">
          <X className="w-5 h-5" />
        </button>
        <div className="flex items-center gap-1">
          <button onClick={onUndo} disabled={!canUndo} className="p-2 rounded-lg hover:bg-muted disabled:opacity-30">
            <Undo2 className="w-5 h-5" />
          </button>
          <button onClick={onRedo} disabled={!canRedo} className="p-2 rounded-lg hover:bg-muted disabled:opacity-30">
            <Redo2 className="w-5 h-5" />
          </button>
        </div>
        <button onClick={onSave} className="px-4 py-1.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium">
          Save
        </button>
      </div>
    );
  }

  // FAB button
  return (
    <button
      onClick={onEdit}
      className="fixed z-50 flex items-center justify-center w-14 h-14 rounded-full bg-primary text-primary-foreground shadow-lg active:scale-95 transition-transform md:hidden"
      style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 80px)', right: '16px' }}
    >
      <Pencil className="w-6 h-6" />
    </button>
  );
}
