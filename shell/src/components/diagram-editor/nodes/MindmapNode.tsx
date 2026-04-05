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
  const editingRef = useRef(false);
  const isMinimapRef = useRef<boolean | null>(null);

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
    setEditing(false);
    node.setData({ ...node.getData(), label: text }, { silent: false });
    node.trigger('edit:end');
  }, [node, text]);

  const cancelEdit = useCallback(() => {
    if (!editingRef.current) return;
    editingRef.current = false;
    setText(d.label);
    setEditing(false);
    node.trigger('edit:end');
  }, [d.label, node]);

  const focusEditor = useCallback((args?: { initialKey?: string }) => {
    const initialKey = args?.initialKey;
    editingRef.current = true;
    setEditing(true);

    const deadline = Date.now() + 500;
    const tryFocus = () => {
      const el = inputRef.current;
      if (!el || !editingRef.current) return;

      // Detect if we're in the minimap — abort if so
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
        el.select();
        // If a key was provided (keyboard-initiated edit), replace content
        if (initialKey) {
          el.value = initialKey;
          // Move cursor to end
          el.setSelectionRange(initialKey.length, initialKey.length);
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
    node.on('edit:start', focusEditor);
    node.on('edit:commit', commitEdit);
    return () => {
      node.off('edit:start', focusEditor);
      node.off('edit:commit', commitEdit);
    };
  }, [node, focusEditor, commitEdit]);

  // Double-click is handled by X6DiagramEditor at the DOM level.
  // The node component should NOT start editing on its own — that causes
  // state desync with editingNode tracking in the parent.

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') { e.preventDefault(); commitEdit(); }
    if (e.key === 'Escape') { cancelEdit(); }
    // Stop React synthetic propagation
    e.stopPropagation();
    // Also stop the native event from reaching document-level listeners
    // (the graph keyboard handler is on document, not inside React's tree)
    e.nativeEvent.stopImmediatePropagation();
  }, [commitEdit, cancelEdit]);

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
    >
      {editing ? (
        <input
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          onMouseDown={(e) => e.stopPropagation()}
          className="bg-transparent border-none outline-none text-center w-full"
          style={{ fontSize: isRoot ? 16 : d.fontSize, fontWeight: isRoot ? 'bold' : d.fontWeight, color: d.textColor }}
        />
      ) : (
        <span className="truncate select-none pointer-events-none" style={{ cursor: 'default' }}>{d.label || ' '}</span>
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
          onMouseDown={(e) => {
            e.stopPropagation();
            // Signal collapse toggle via data — picked up by cell:change:data handler
            node.setData({ ...node.getData(), _collapseToggle: Date.now() });
          }}
        >
          {d.collapsed ? d.childCount : '−'}
        </div>
      )}
    </div>
  );
}
