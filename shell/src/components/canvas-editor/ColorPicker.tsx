'use client';

import { useState, useRef, useEffect } from 'react';
import { Ban } from 'lucide-react';

interface ColorPickerProps {
  value: string;
  onChange: (color: string) => void;
  allowNone?: boolean;
  onClear?: () => void;
}

export function ColorPicker({ value, onChange, allowNone, onClear }: ColorPickerProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const isNone = !value || value === 'none' || value === 'transparent';

  return (
    <button
      className="w-6 h-6 rounded border border-border shrink-0 relative overflow-hidden"
      style={isNone ? undefined : { backgroundColor: value }}
      onClick={() => inputRef.current?.click()}
      title={isNone ? 'No color' : value}
    >
      {isNone && (
        <Ban className="w-3 h-3 text-muted-foreground/40 absolute inset-0 m-auto" />
      )}
      <input
        ref={inputRef}
        type="color"
        value={isNone ? '#000000' : value}
        onChange={e => onChange(e.target.value)}
        className="sr-only"
      />
    </button>
  );
}
