'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import type { Node } from '@antv/x6';
import type { FlowchartShape } from '../constants';

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
  const inputRef = useRef<HTMLTextAreaElement>(null);

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
    setEditing(false);
    node.setData({ ...node.getData(), label: text }, { silent: false });
  }, [node, text]);

  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setEditing(true);
    setTimeout(() => inputRef.current?.focus(), 0);
  }, []);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      commitEdit();
    }
    if (e.key === 'Escape') {
      setText(d.label);
      setEditing(false);
    }
  }, [commitEdit, d.label]);

  const size = node.getSize();
  const w = size.width;
  const h = size.height;

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

  const textEl = editing ? (
    <textarea
      ref={inputRef}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commitEdit}
      onKeyDown={handleKeyDown}
      className="bg-transparent border-none outline-none resize-none text-center w-full h-full"
      style={{ fontSize: d.fontSize, fontWeight: d.fontWeight, fontStyle: d.fontStyle, color: d.textColor }}
    />
  ) : (
    <span className="px-2 py-1 break-words text-center leading-tight pointer-events-none select-none"
      style={{ maxWidth: w - 8, wordBreak: 'break-word' }}>
      {d.label || ' '}
    </span>
  );

  // Shape-specific rendering
  switch (d.flowchartShape) {
    case 'diamond':
      return (
        <div style={{ ...baseStyle, position: 'relative' }} onDoubleClick={handleDoubleClick}>
          <svg width={w} height={h} style={{ position: 'absolute', top: 0, left: 0 }}>
            <polygon
              points={`${w / 2},2 ${w - 2},${h / 2} ${w / 2},${h - 2} 2,${h / 2}`}
              fill={d.bgColor}
              stroke={d.borderColor}
              strokeWidth={2}
            />
          </svg>
          <div style={{ position: 'relative', zIndex: 1, padding: '0 16px' }}>{textEl}</div>
        </div>
      );

    case 'circle':
      return (
        <div
          style={{
            ...baseStyle,
            borderRadius: '50%',
            backgroundColor: d.bgColor,
            border: `2px solid ${d.borderColor}`,
          }}
          onDoubleClick={handleDoubleClick}
        >
          {textEl}
        </div>
      );

    case 'ellipse':
      return (
        <div
          style={{
            ...baseStyle,
            borderRadius: '50%',
            backgroundColor: d.bgColor,
            border: `2px solid ${d.borderColor}`,
          }}
          onDoubleClick={handleDoubleClick}
        >
          {textEl}
        </div>
      );

    case 'parallelogram':
      return (
        <div style={{ ...baseStyle, position: 'relative' }} onDoubleClick={handleDoubleClick}>
          <svg width={w} height={h} style={{ position: 'absolute', top: 0, left: 0 }}>
            <polygon
              points={`${w * 0.15},${h - 2} 2,2 ${w * 0.85},2 ${w - 2},${h - 2}`}
              fill={d.bgColor}
              stroke={d.borderColor}
              strokeWidth={2}
            />
          </svg>
          <div style={{ position: 'relative', zIndex: 1, padding: '0 20px' }}>{textEl}</div>
        </div>
      );

    case 'triangle':
      return (
        <div style={{ ...baseStyle, position: 'relative' }} onDoubleClick={handleDoubleClick}>
          <svg width={w} height={h} style={{ position: 'absolute', top: 0, left: 0 }}>
            <polygon
              points={`${w / 2},2 ${w - 2},${h - 2} 2,${h - 2}`}
              fill={d.bgColor}
              stroke={d.borderColor}
              strokeWidth={2}
            />
          </svg>
          <div style={{ position: 'relative', zIndex: 1, paddingTop: h * 0.3 }}>{textEl}</div>
        </div>
      );

    case 'stadium':
      return (
        <div
          style={{
            ...baseStyle,
            borderRadius: h / 2,
            backgroundColor: d.bgColor,
            border: `2px solid ${d.borderColor}`,
          }}
          onDoubleClick={handleDoubleClick}
        >
          {textEl}
        </div>
      );

    case 'rect':
      return (
        <div
          style={{
            ...baseStyle,
            borderRadius: 0,
            backgroundColor: d.bgColor,
            border: `2px solid ${d.borderColor}`,
          }}
          onDoubleClick={handleDoubleClick}
        >
          {textEl}
        </div>
      );

    case 'rounded-rect':
    default:
      return (
        <div
          style={{
            ...baseStyle,
            borderRadius: 8,
            backgroundColor: d.bgColor,
            border: `2px solid ${d.borderColor}`,
          }}
          onDoubleClick={handleDoubleClick}
        >
          {textEl}
        </div>
      );
  }
}
