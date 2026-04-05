'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import type { Node } from '@antv/x6';
import type { FlowchartShape } from '../constants';
import { SHAPE_MAP } from '@/components/shared/ShapeSet/shapes';

interface FlowchartNodeData {
  label: string;
  flowchartShape: FlowchartShape;
  bgColor: string;
  borderColor: string;
  textColor: string;
  fontSize: number;
  fontWeight: string;
  fontStyle: string;
}

const defaultData: FlowchartNodeData = {
  label: '',
  flowchartShape: 'rounded-rect',
  bgColor: '#ffffff',
  borderColor: '#374151',
  textColor: '#1f2937',
  fontSize: 14,
  fontWeight: 'normal',
  fontStyle: 'normal',
};

export function FlowchartNode({ node }: { node: Node }) {
  const raw = node.getData() || {};
  const d: FlowchartNodeData = { ...defaultData, ...raw };
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(d.label);
  const inputRef = useRef<HTMLDivElement>(null);
  const editingRef = useRef(false);
  const isMinimapRef = useRef<boolean | null>(null);

  // Sync external data changes
  useEffect(() => {
    const onChange = () => {
      const newData = node.getData() || {};
      setText(newData.label ?? '');
    };
    node.on('change:data', onChange);
    return () => { node.off('change:data', onChange); };
  }, [node]);

  const commitEdit = useCallback(() => {
    if (!editingRef.current) return;
    editingRef.current = false;
    const newText = inputRef.current?.textContent ?? text;
    setText(newText);
    setEditing(false);
    node.setData({ ...node.getData(), label: newText }, { silent: false });
    node.trigger('edit:end');
  }, [node, text]);

  const cancelEdit = useCallback(() => {
    if (!editingRef.current) return;
    editingRef.current = false;
    setText(d.label);
    if (inputRef.current) inputRef.current.textContent = d.label;
    setEditing(false);
    node.trigger('edit:end');
  }, [d.label, node]);

  const focusAndSelect = useCallback((args?: { initialKey?: string }) => {
    const initialKey = args?.initialKey;
    editingRef.current = true;
    setEditing(true);

    const deadline = Date.now() + 500;
    const tryFocus = () => {
      const el = inputRef.current;
      if (!el || !editingRef.current) return;

      if (isMinimapRef.current === null) {
        isMinimapRef.current = !!el.closest('.x6-widget-minimap');
      }
      if (isMinimapRef.current) {
        editingRef.current = false;
        setEditing(false);
        return;
      }

      el.focus();
      if (document.activeElement === el) {
        if (el.textContent) {
          const range = document.createRange();
          range.selectNodeContents(el);
          const sel = window.getSelection();
          sel?.removeAllRanges();
          sel?.addRange(range);
        }
        if (initialKey) {
          document.execCommand('insertText', false, initialKey);
        }
        return;
      }

      if (Date.now() < deadline) {
        requestAnimationFrame(tryFocus);
      }
    };
    setTimeout(tryFocus, 16);
  }, []);

  useEffect(() => {
    node.on('edit:start', focusAndSelect);
    node.on('edit:commit', commitEdit);
    return () => {
      node.off('edit:start', focusAndSelect);
      node.off('edit:commit', commitEdit);
    };
  }, [node, focusAndSelect, commitEdit]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      commitEdit();
    }
    if (e.key === 'Escape') {
      cancelEdit();
    }
  }, [commitEdit, cancelEdit]);

  const size = node.getSize();
  const w = size.width;
  const h = size.height;
  const s = 2; // stroke inset

  const baseStyle: React.CSSProperties = {
    width: w,
    height: h,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: d.fontSize,
    fontWeight: d.fontWeight,
    fontStyle: d.fontStyle,
    color: d.textColor,
    overflow: 'hidden',
    cursor: 'default',
    userSelect: 'none',
  };

  const textStyle: React.CSSProperties = {
    fontSize: d.fontSize,
    fontWeight: d.fontWeight,
    fontStyle: d.fontStyle,
    color: d.textColor,
    lineHeight: 1.25,
    wordBreak: 'break-word',
    textAlign: 'center' as const,
    padding: '4px 8px',
    maxWidth: w - 4,
    cursor: editing ? 'text' : 'default',
  };

  const textEl = editing ? (
    <div
      ref={inputRef}
      contentEditable
      suppressContentEditableWarning
      onKeyDown={handleKeyDown}
      onMouseDown={(e) => e.stopPropagation()}
      style={{ ...textStyle, outline: 'none', userSelect: 'text' }}
    >
      {text}
    </div>
  ) : (
    <span className="pointer-events-none select-none" style={textStyle}>
      {d.label || '\u00A0'}
    </span>
  );

  const stroke = d.borderColor === 'transparent' ? 'none' : d.borderColor;
  const svgAbsolute: React.CSSProperties = { position: 'absolute', top: 0, left: 0 };
  const textOverlay = (padding?: string) => (
    <div style={{ position: 'relative', zIndex: 1, padding: padding || '0 16px' }}>{textEl}</div>
  );

  // ─── Render shape using shared ShapeSet ───
  const shapeDef = SHAPE_MAP.get(d.flowchartShape);

  // CSS-only shapes (rect, circle/ellipse, stadium, rounded-rect) for pixel-perfect rendering
  if (d.flowchartShape === 'rect') {
    return (
      <div
        style={{
          ...baseStyle,
          backgroundColor: d.bgColor,
          border: d.borderColor === 'transparent' ? 'none' : `2px solid ${d.borderColor}`,
        }}
      >
        {textEl}
      </div>
    );
  }

  if (d.flowchartShape === 'circle' || d.flowchartShape === 'ellipse') {
    return (
      <div
        style={{
          ...baseStyle,
          borderRadius: '50%',
          backgroundColor: d.bgColor,
          border: d.borderColor === 'transparent' ? 'none' : `2px solid ${d.borderColor}`,
        }}
      >
        {textEl}
      </div>
    );
  }

  if (d.flowchartShape === 'stadium') {
    return (
      <div
        style={{
          ...baseStyle,
          borderRadius: h / 2,
          backgroundColor: d.bgColor,
          border: d.borderColor === 'transparent' ? 'none' : `2px solid ${d.borderColor}`,
        }}
      >
        {textEl}
      </div>
    );
  }

  if (d.flowchartShape === 'rounded-rect') {
    return (
      <div
        style={{
          ...baseStyle,
          borderRadius: 8,
          backgroundColor: d.bgColor,
          border: d.borderColor === 'transparent' ? 'none' : `2px solid ${d.borderColor}`,
        }}
      >
        {textEl}
      </div>
    );
  }

  // Brace shapes: stroke-only (no fill)
  if (d.flowchartShape === 'brace-left' || d.flowchartShape === 'brace-right') {
    const pathData = shapeDef?.renderPath(w, h) ?? '';
    return (
      <div style={{ ...baseStyle, position: 'relative' }}>
        <svg width={w} height={h} style={svgAbsolute}>
          <path d={pathData} fill="none" stroke={stroke} strokeWidth={2} />
        </svg>
        {textOverlay()}
      </div>
    );
  }

  // Cylinder: special multi-element SVG (ellipse cap + body)
  if (d.flowchartShape === 'cylinder') {
    return (
      <div style={{ ...baseStyle, position: 'relative' }}>
        <svg width={w} height={h} style={svgAbsolute}>
          <ellipse cx={w / 2} cy={h * 0.15} rx={w / 2 - s} ry={h * 0.15 - s}
            fill={d.bgColor} stroke={stroke} strokeWidth={2} />
          <path
            d={`M${s},${h * 0.15} v${h * 0.7} a${w / 2 - s},${h * 0.15 - s} 0 0,0 ${w - 2 * s},0 v-${h * 0.7}`}
            fill={d.bgColor} stroke={stroke} strokeWidth={2}
          />
        </svg>
        <div style={{ position: 'relative', zIndex: 1, paddingTop: h * 0.15 }}>{textEl}</div>
      </div>
    );
  }

  // All other shapes: use shared renderPath
  // Inset the path by half strokeWidth to avoid clipping at SVG edges
  if (shapeDef) {
    const sw = 2; // strokeWidth
    const inset = sw / 2;
    const iw = w - sw; // inner width after inset
    const ih = h - sw; // inner height after inset
    const pathData = shapeDef.renderPath(iw, ih);
    return (
      <div style={{ ...baseStyle, position: 'relative' }}>
        <svg width={w} height={h} style={svgAbsolute}>
          <g transform={`translate(${inset},${inset})`}>
            <path d={pathData} fill={d.bgColor} stroke={stroke} strokeWidth={sw} strokeLinejoin="round" />
          </g>
        </svg>
        {textOverlay()}
      </div>
    );
  }

  // Fallback: rounded-rect (CSS for pixel-perfect rendering)
  return (
    <div
      style={{
        ...baseStyle,
        borderRadius: 8,
        backgroundColor: d.bgColor,
        border: d.borderColor === 'transparent' ? 'none' : `2px solid ${d.borderColor}`,
      }}
    >
      {textEl}
    </div>
  );
}
