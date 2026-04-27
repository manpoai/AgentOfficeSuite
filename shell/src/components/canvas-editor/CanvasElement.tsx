'use client';

import { useRef, useEffect, useCallback } from 'react';
import type { CanvasElement as CanvasElementType } from './types';

interface CanvasElementProps {
  element: CanvasElementType;
  selected: boolean;
  hovered?: boolean;
  scale: number;
  editing?: boolean;
  vectorEditing?: boolean;
  onSelect: (id: string, e: React.MouseEvent | React.TouchEvent) => void;
  onDragStart: (id: string, e: React.MouseEvent | React.TouchEvent) => void;
  onResizeStart: (id: string, handle: string, e: React.MouseEvent | React.TouchEvent) => void;
  onRotateStart?: (id: string, e: React.MouseEvent | React.TouchEvent) => void;
  onDoubleClick?: (id: string) => void;
  onHtmlChange?: (html: string) => void;
  onShadowRootReady?: (id: string, shadowRoot: ShadowRoot) => void;
  onContextMenu?: (id: string, e: React.MouseEvent) => void;
  onMouseEnter?: (id: string) => void;
  onMouseLeave?: (id: string) => void;
  groupChildrenInteractive?: boolean;
  hideGroupChildren?: boolean;
  nonInteractive?: boolean;
}

interface EditingOverlayProps {
  element: CanvasElementType;
  scale: number;
  panX: number;
  panY: number;
  onHtmlChange: (html: string) => void;
  onDone: () => void;
}

export const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const;

export const HANDLE_CURSORS: Record<string, string> = {
  nw: 'nwse-resize', n: 'ns-resize', ne: 'nesw-resize',
  e: 'ew-resize', se: 'nwse-resize', s: 'ns-resize',
  sw: 'nesw-resize', w: 'ew-resize',
};

export const HANDLE_POS: Record<string, { top: string; left: string; transform: string }> = {
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

export function CanvasElementView({ element, selected, hovered, scale, editing, vectorEditing, onSelect, onDragStart, onResizeStart, onRotateStart, onDoubleClick, onContextMenu, onShadowRootReady, onMouseEnter, onMouseLeave, groupChildrenInteractive, hideGroupChildren, nonInteractive }: CanvasElementProps) {
  const shadowHostRef = useRef<HTMLDivElement>(null);
  const shadowRootRef = useRef<ShadowRoot | null>(null);

  useEffect(() => {
    const host = shadowHostRef.current;
    if (!host) return;
    if (!shadowRootRef.current) {
      shadowRootRef.current = host.attachShadow({ mode: 'open' });
      onShadowRootReady?.(element.id, shadowRootRef.current);
    }
    const sr = shadowRootRef.current;
    const isSvg = element.html.includes('<svg');
    const needsOverflow = isSvg || vectorEditing;
    const svgWrapperOverflow = isSvg ? ':host > div { overflow: visible !important; }' : '';
    sr.innerHTML = `<style>:host { display: block; width: 100%; height: 100%; overflow: ${needsOverflow ? 'visible' : 'hidden'}; } ${svgWrapperOverflow} svg path, svg rect, svg circle, svg ellipse, svg line, svg polygon, svg polyline { vector-effect: non-scaling-stroke; }</style>${element.html}`;
  }, [element.html, vectorEditing]);

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
        opacity: editing ? 0 : 1,
        pointerEvents: editing || nonInteractive ? 'none' : 'auto',
      }}
      onMouseDown={handlePointerDown}
      onTouchStart={handlePointerDown}
      onDoubleClick={handleDblClick}
      onContextMenu={onContextMenu ? (e) => { e.preventDefault(); e.stopPropagation(); onContextMenu(element.id, e); } : undefined}
      onMouseEnter={() => onMouseEnter?.(element.id)}
      onMouseLeave={() => onMouseLeave?.(element.id)}
    >
      {element.type === 'group' && element.children ? (
        hideGroupChildren ? null : (
        <div style={{ position: 'absolute', inset: 0, pointerEvents: groupChildrenInteractive ? 'auto' : 'none' }}>
          {element.children.map(child => (
            <CanvasElementView
              key={child.id}
              element={child}
              selected={false}
              scale={scale}
              onSelect={onSelect}
              onDragStart={onDragStart}
              onResizeStart={onResizeStart}
              onDoubleClick={onDoubleClick}
              nonInteractive={!groupChildrenInteractive}
            />
          ))}
        </div>
        )
      ) : (
        <div ref={shadowHostRef} style={{ width: '100%', height: '100%', pointerEvents: 'none' }} />
      )}
      {hovered && !selected && !editing && (
        <div style={{
          position: 'absolute', inset: -1,
          border: '2px solid rgba(59, 130, 246, 0.5)',
          pointerEvents: 'none', borderRadius: 2,
        }} />
      )}
      {selected && !editing && !vectorEditing && (
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
      {selected && !editing && !vectorEditing && (
        <div style={{
          position: 'absolute',
          top: '100%', left: '50%',
          transform: 'translateX(-50%)',
          marginTop: 4,
          fontSize: 10, lineHeight: '16px',
          padding: '0 6px',
          background: '#3b82f6', color: 'white',
          borderRadius: 3, pointerEvents: 'none', whiteSpace: 'nowrap',
          zIndex: 10,
        }}>
          {Math.round(element.w)} × {Math.round(element.h)}
        </div>
      )}
      {selected && !element.locked && !editing && !vectorEditing && HANDLES.map(h => (
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
      {selected && !element.locked && !editing && !vectorEditing && onRotateStart && (
        <div
          style={{
            position: 'absolute',
            top: -28 / scale,
            left: '50%',
            transform: `translateX(-50%) rotate(${-(element.rotation || 0)}deg)`,
            transformOrigin: 'center center',
            width: handleSize * 1.4,
            height: handleSize * 1.4,
            background: '#fff',
            border: '2px solid #3b82f6',
            borderRadius: '50%',
            cursor: 'grab',
            zIndex: 11,
            pointerEvents: 'auto',
            touchAction: 'none',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#3b82f6',
            fontSize: handleSize * 0.9,
            lineHeight: 1,
          }}
          onMouseDown={(e) => { e.stopPropagation(); onRotateStart(element.id, e); }}
          onTouchStart={(e) => { e.stopPropagation(); onRotateStart(element.id, e); }}
          title="Rotate"
        >
          <svg width={handleSize * 0.85} height={handleSize * 0.85} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 8a5 5 0 0 1 9-3M13 8a5 5 0 0 1-9 3" />
            <polyline points="12 2 12 5 9 5" />
            <polyline points="4 14 4 11 7 11" />
          </svg>
        </div>
      )}
    </div>
  );
}
