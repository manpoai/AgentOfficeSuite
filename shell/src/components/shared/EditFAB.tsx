'use client';
import React from 'react';
import { Pencil, X } from 'lucide-react';

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

export function EditFAB({ onEdit, onSave, onCancel, isEditing }: EditFABProps) {
  if (isEditing) {
    // Top edit toolbar — Figma: X on left, Save button on right (no Undo/Redo)
    return (
      <div className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-4 py-2 bg-card border-b border-border safe-area-top md:hidden">
        <button onClick={onCancel} className="p-2 rounded-lg hover:bg-muted">
          <X className="w-5 h-5" />
        </button>
        <button
          onClick={onSave}
          className="px-6 py-2 rounded-full bg-card text-foreground text-[18px] font-medium shadow-[0px_0px_10px_0px_rgba(0,0,0,0.08)] border border-border"
        >
          Save
        </button>
      </div>
    );
  }

  // FAB button — Figma: 64x64 white circle with pen icon + shadow
  return (
    <button
      onClick={onEdit}
      className="flex items-center justify-center w-16 h-16 rounded-full bg-card text-foreground shadow-[0px_0px_20px_0px_rgba(0,0,0,0.08)] border border-border active:scale-95 transition-transform md:hidden"
    >
      <Pencil className="w-5 h-5" />
    </button>
  );
}
