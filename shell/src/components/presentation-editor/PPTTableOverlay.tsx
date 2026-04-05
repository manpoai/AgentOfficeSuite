'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { RichTable } from '@/components/shared/RichTable';
import type { RichTableHandle } from '@/components/shared/RichTable';
import { FloatingToolbar } from '@/components/shared/FloatingToolbar';
import { getSimpleTableItems } from '@/components/shared/FloatingToolbar/presets';
import { createDocsTableHandler } from '@/components/editor/docs-toolbar-handler';

// ─── PPT Table Overlay — RichTable positioned over Fabric.js table rect ────
export interface PPTTableOverlayProps {
  obj: any;
  canvas: any;
  containerRef: React.RefObject<HTMLDivElement | null>;
  propVersion: number;
  isSelected?: boolean;
}

export function PPTTableOverlay({ obj, canvas, containerRef, propVersion, isSelected }: PPTTableOverlayProps) {
  const [pos, setPos] = useState({ left: 0, top: 0, width: 200, height: 100, zoom: 1 });
  const [editing, setEditing] = useState(false);
  const [tableToolbarInfo, setTableToolbarInfo] = useState<{
    anchor: { top: number; left: number; width: number };
    view: any;
  } | null>(null);

  // Get or create default table JSON
  const getTableJSON = useCallback(() => {
    if (obj.__tableJSON) return obj.__tableJSON;
    // Migrate from old string[][] format if present
    const oldData: string[][] = obj.__tableData;
    if (oldData && Array.isArray(oldData) && oldData.length > 0) {
      const rows = oldData.map((row, rowIdx) => ({
        type: 'table_row',
        content: row.map((cell) => ({
          type: rowIdx === 0 ? 'table_header' : 'table_cell',
          attrs: { colspan: 1, rowspan: 1, alignment: null, colwidth: null, background: null },
          content: [{ type: 'paragraph', content: cell ? [{ type: 'text', text: cell }] : undefined }],
        })),
      }));
      return { type: 'doc', content: [{ type: 'table', content: rows }] };
    }
    // Default 3x3 table
    const cols = 3;
    const headerCells = Array.from({ length: cols }, () => ({
      type: 'table_header',
      attrs: { colspan: 1, rowspan: 1, alignment: null, colwidth: null, background: null },
      content: [{ type: 'paragraph' }],
    }));
    const bodyRow = () => ({
      type: 'table_row',
      content: Array.from({ length: cols }, () => ({
        type: 'table_cell',
        attrs: { colspan: 1, rowspan: 1, alignment: null, colwidth: null, background: null },
        content: [{ type: 'paragraph' }],
      })),
    });
    return {
      type: 'doc',
      content: [{ type: 'table', content: [
        { type: 'table_row', content: headerCells },
        bodyRow(),
        bodyRow(),
      ]}],
    };
  }, [obj]);

  const [tableJSON, setTableJSON] = useState<Record<string, unknown>>(() => getTableJSON());

  // Sync when object changes externally
  useEffect(() => {
    setTableJSON(getTableJSON());
  }, [obj, propVersion, getTableJSON]);

  // Compute position relative to canvas container
  const updatePos = useCallback(() => {
    const container = containerRef.current;
    if (!container || !canvas) return;
    const zoom = canvas.getZoom() || 1;
    const wrapper = container.querySelector('.canvas-wrapper') as HTMLElement;
    const wrapperLeft = wrapper ? parseFloat(wrapper.style.marginLeft || '0') : 0;
    const wrapperTop = wrapper ? parseFloat(wrapper.style.marginTop || '0') : 0;
    const objW = (obj.width || 200) * (obj.scaleX || 1);
    const objH = (obj.height || 100) * (obj.scaleY || 1);
    setPos({
      left: (obj.left || 0) * zoom + wrapperLeft,
      top: (obj.top || 0) * zoom + wrapperTop,
      width: objW,
      height: objH,
      zoom,
    });
  }, [obj, canvas, containerRef]);

  useEffect(() => {
    updatePos();
    if (!canvas) return;
    const handler = () => updatePos();
    canvas.on('after:render', handler);
    return () => { canvas.off('after:render', handler); };
  }, [canvas, updatePos]);

  const handleProsemirrorChange = useCallback((json: Record<string, unknown>) => {
    setTableJSON(json);
    obj.__tableJSON = json;
    delete obj.__tableData;
    delete obj.__tableRows;
    delete obj.__tableCols;
    canvas?.fire('object:modified', { target: obj });
  }, [obj, canvas]);

  // Click on non-selected table overlay -> select the Fabric.js object
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (!isSelected && canvas) {
      canvas.setActiveObject(obj);
      canvas.renderAll();
    }
  }, [isSelected, canvas, obj]);

  // Double-click to enter edit mode
  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (isSelected) {
      setEditing(true);
    }
  }, [isSelected]);

  // Exit edit mode on click outside
  useEffect(() => {
    if (!editing) return;
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('.ppt-table-overlay') || target.closest('[data-floating-toolbar]')) return;
      setEditing(false);
      setTableToolbarInfo(null);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [editing]);

  // Escape to exit edit mode
  useEffect(() => {
    if (!editing) return;
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setEditing(false);
        setTableToolbarInfo(null);
      }
    };
    document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  }, [editing]);

  const overlayRef = useRef<HTMLDivElement>(null);
  const richTableRef = useRef<RichTableHandle>(null);

  // When overlay dimensions change, force ProseMirror to re-run plugin update
  useEffect(() => {
    const view = richTableRef.current?.getView() as any;
    if (view && !view.isDestroyed) {
      requestAnimationFrame(() => {
        try { view.dispatch(view.state.tr); } catch {}
      });
    }
  }, [pos.width, pos.height]);

  return (
    <>
      <div
        ref={overlayRef}
        className="ppt-table-overlay absolute overflow-visible"
        style={{
          left: pos.left,
          top: pos.top,
          width: pos.width,
          height: pos.height,
          transform: `scale(${pos.zoom})`,
          transformOrigin: 'top left',
          zIndex: editing ? 50 : isSelected ? 30 : 10,
          pointerEvents: editing ? 'auto' : isSelected ? 'auto' : 'none',
        }}
        onMouseDown={handleMouseDown}
        onDoubleClick={handleDoubleClick}
      >
        <RichTable
          ref={richTableRef}
          prosemirrorJSON={tableJSON}
          onProsemirrorChange={editing ? handleProsemirrorChange : undefined}
          onCellToolbar={editing ? (info) => setTableToolbarInfo(info) : undefined}
          config={{
            cellMinWidth: 40,
            showToolbar: false,
            showContextMenu: editing,
            readonly: !editing,
            columnResizing: false,
          }}
          width="100%"
          height="100%"
        />
        {!editing && isSelected && (
          <div className="absolute inset-0 border-2 border-sidebar-primary/50 rounded pointer-events-none" />
        )}
      </div>
      {tableToolbarInfo && editing && (
        <FloatingToolbar
          items={getSimpleTableItems()}
          handler={createDocsTableHandler(tableToolbarInfo.view)}
          anchor={tableToolbarInfo.anchor}
          visible={true}
        />
      )}
    </>
  );
}
