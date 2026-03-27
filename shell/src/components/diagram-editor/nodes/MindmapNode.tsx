'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import type { Node } from '@antv/x6';

interface MindmapNodeData {
  label: string;
  isRoot: boolean;
  bgColor: string;
  borderColor: string;
  textColor: string;
  fontSize: number;
  fontWeight: string;
  collapsed: boolean;
  childCount: number;
}

const defaultData: MindmapNodeData = {
  label: '',
  isRoot: false,
  bgColor: '#ffffff',
  borderColor: '#3b82f6',
  textColor: '#1f2937',
  fontSize: 14,
  fontWeight: 'normal',
  collapsed: false,
  childCount: 0,
};

export function MindmapNode({ node }: { node: Node }) {
  const raw = node.getData() || {};
  const d: MindmapNodeData = { ...defaultData, ...raw };
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(d.label);
  const inputRef = useRef<HTMLInputElement>(null);

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
    if (e.key === 'Enter') { e.preventDefault(); commitEdit(); }
    if (e.key === 'Escape') { setText(d.label); setEditing(false); }
    // Stop propagation so graph keyboard handler doesn't fire
    e.stopPropagation();
  }, [commitEdit, d.label]);

  const size = node.getSize();
  const w = size.width;
  const h = size.height;

  const isRoot = d.isRoot || node.shape === 'mindmap-root';

  return (
    <div
      style={{
        width: w,
        height: h,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: isRoot ? 12 : 6,
        backgroundColor: d.bgColor,
        border: `2px solid ${d.borderColor}`,
        fontSize: isRoot ? 16 : d.fontSize,
        fontWeight: isRoot ? 'bold' : d.fontWeight,
        color: d.textColor,
        cursor: 'default',
        userSelect: 'none',
        position: 'relative',
        padding: '0 12px',
      }}
      onDoubleClick={handleDoubleClick}
    >
      {editing ? (
        <input
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={commitEdit}
          onKeyDown={handleKeyDown}
          className="bg-transparent border-none outline-none text-center w-full"
          style={{ fontSize: isRoot ? 16 : d.fontSize, fontWeight: isRoot ? 'bold' : d.fontWeight, color: d.textColor }}
        />
      ) : (
        <span className="truncate select-none pointer-events-none">{d.label || ' '}</span>
      )}

      {/* Collapse/expand indicator */}
      {d.childCount > 0 && (
        <div
          style={{
            position: 'absolute',
            right: -12,
            top: '50%',
            transform: 'translateY(-50%)',
            width: 18,
            height: 18,
            borderRadius: 9,
            backgroundColor: '#e5e7eb',
            border: '1px solid #9ca3af',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 10,
            color: '#6b7280',
            cursor: 'pointer',
            zIndex: 10,
          }}
          data-action="toggle-collapse"
        >
          {d.collapsed ? d.childCount : '−'}
        </div>
      )}
    </div>
  );
}
