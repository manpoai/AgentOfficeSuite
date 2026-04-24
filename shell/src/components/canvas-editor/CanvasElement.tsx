'use client';

import { useRef, useEffect, useCallback } from 'react';
import type { CanvasElement as CanvasElementType } from './types';

interface CanvasElementProps {
  element: CanvasElementType;
  selected: boolean;
  scale: number;
  editing?: boolean;
  onSelect: (id: string, e: React.MouseEvent | React.TouchEvent) => void;
  onDragStart: (id: string, e: React.MouseEvent | React.TouchEvent) => void;
  onResizeStart: (id: string, handle: string, e: React.MouseEvent | React.TouchEvent) => void;
  onDoubleClick?: (id: string) => void;
  onHtmlChange?: (html: string) => void;
  onContextMenu?: (id: string, e: React.MouseEvent) => void;
}

interface EditingOverlayProps {
  element: CanvasElementType;
  scale: number;
  panX: number;
  panY: number;
  onHtmlChange: (html: string) => void;
  onDone: () => void;
}

const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const;

const HANDLE_CURSORS: Record<string, string> = {
  nw: 'nwse-resize', n: 'ns-resize', ne: 'nesw-resize',
  e: 'ew-resize', se: 'nwse-resize', s: 'ns-resize',
  sw: 'nesw-resize', w: 'ew-resize',
};

const HANDLE_POS: Record<string, { top: string; left: string; transform: string }> = {
  nw: { top: '0', left: '0', transform: 'translate(-50%, -50%)' },
  n:  { top: '0', left: '50%', transform: 'translate(-50%, -50%)' },
  ne: { top: '0', left: '100%', transform: 'translate(-50%, -50%)' },
  e:  { top: '50%', left: '100%', transform: 'translate(-50%, -50%)' },
  se: { top: '100%', left: '100%', transform: 'translate(-50%, -50%)' },
  s:  { top: '100%', left: '50%', transform: 'translate(-50%, -50%)' },
  sw: { top: '100%', left: '0', transform: 'translate(-50%, -50%)' },
  w:  { top: '50%', left: '0', transform: 'translate(-50%, -50%)' },
};

function getClientPos(e: React.MouseEvent | React.TouchEvent | MouseEvent | TouchEvent) {
  if ('touches' in e) {
    const t = e.touches[0] || (e as TouchEvent).changedTouches?.[0];
    return t ? { clientX: t.clientX, clientY: t.clientY } : null;
  }
  return { clientX: (e as MouseEvent).clientX, clientY: (e as MouseEvent).clientY };
}

export { getClientPos };

export function EditingOverlay({ element, scale, panX, panY, onHtmlChange, onDone }: EditingOverlayProps) {
  const editRef = useRef<HTMLDivElement>(null);
  const savedRef = useRef(false);
  const onHtmlChangeRef = useRef(onHtmlChange);
  const onDoneRef = useRef(onDone);
  onHtmlChangeRef.current = onHtmlChange;
  onDoneRef.current = onDone;

  useEffect(() => {
    const el = editRef.current;
    if (!el) return;
    el.innerHTML = element.html;
    el.focus();
    const sel = window.getSelection();
    if (sel && el.childNodes.length > 0) {
      sel.selectAllChildren(el);
      sel.collapseToEnd();
    }
    return () => {
      if (!savedRef.current && el) {
        onHtmlChangeRef.current(el.innerHTML);
      }
    };
  }, []);

  const finish = useCallback(() => {
    if (savedRef.current || !editRef.current) return;
    savedRef.current = true;
    onHtmlChangeRef.current(editRef.current.innerHTML);
    onDoneRef.current();
  }, []);

  const handleBlur = useCallback(() => {
    finish();
  }, [finish]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      finish();
    }
  }, [finish]);

  return (
    <div
      style={{
        position: 'absolute',
        left: panX + element.x * scale,
        top: panY + element.y * scale,
        width: element.w * scale,
        height: element.h * scale,
        zIndex: 10000,
        outline: '2px solid #10b981',
        outlineOffset: -1,
        borderRadius: 2,
        overflow: 'hidden',
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div
        ref={editRef}
        contentEditable
        suppressContentEditableWarning
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        style={{
          width: element.w,
          height: element.h,
          zoom: scale,
          outline: 'none',
          cursor: 'text',
        }}
      />
    </div>
  );
}

export function CanvasElementView({ element, selected, scale, editing, onSelect, onDragStart, onResizeStart, onDoubleClick, onContextMenu }: CanvasElementProps) {
  const shadowHostRef = useRef<HTMLDivElement>(null);
  const shadowRootRef = useRef<ShadowRoot | null>(null);

  useEffect(() => {
    const host = shadowHostRef.current;
    if (!host) return;
    if (!shadowRootRef.current) {
      shadowRootRef.current = host.attachShadow({ mode: 'open' });
    }
    const sr = shadowRootRef.current;
    const needsOverflow = element.html.includes('data-stroke-align="outside"');
    sr.innerHTML = `<style>:host { display: block; width: 100%; height: 100%; overflow: ${needsOverflow ? 'visible' : 'hidden'}; }</style>${element.html}`;
  }, [element.html]);

  const handlePointerDown = (e: React.MouseEvent | React.TouchEvent) => {
    if (editing) return;
    e.stopPropagation();
    onSelect(element.id, e);
    if (!element.locked) {
      onDragStart(element.id, e);
    }
  };

  const handleDblClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onDoubleClick?.(element.id);
  };

  const handleSize = Math.max(10, 10 / scale);

  if (element.visible === false) return null;

  return (
    <div
      style={{
        position: 'absolute',
        left: element.x,
        top: element.y,
        width: element.w,
        height: element.h,
        zIndex: element.z_index ?? 0,
        cursor: editing ? 'text' : element.locked ? 'default' : 'move',
        opacity: editing ? 0.3 : 1,
      }}
      onMouseDown={handlePointerDown}
      onTouchStart={handlePointerDown}
      onDoubleClick={handleDblClick}
      onContextMenu={onContextMenu ? (e) => { e.stopPropagation(); onContextMenu(element.id, e); } : undefined}
    >
      <div ref={shadowHostRef} style={{ width: '100%', height: '100%', pointerEvents: 'none' }} />
      {selected && !editing && (
        <div
          style={{
            position: 'absolute',
            inset: -1,
            border: '2px solid #3b82f6',
            pointerEvents: 'none',
            borderRadius: 2,
          }}
        />
      )}
      {selected && !element.locked && !editing && HANDLES.map(h => (
        <div
          key={h}
          style={{
            position: 'absolute',
            ...HANDLE_POS[h],
            width: handleSize,
            height: handleSize,
            background: '#fff',
            border: '2px solid #3b82f6',
            borderRadius: 2,
            cursor: HANDLE_CURSORS[h],
            zIndex: 10,
            pointerEvents: 'auto',
            touchAction: 'none',
          }}
          onMouseDown={(e) => {
            e.stopPropagation();
            onResizeStart(element.id, h, e);
          }}
          onTouchStart={(e) => {
            e.stopPropagation();
            onResizeStart(element.id, h, e);
          }}
        />
      ))}
    </div>
  );
}
