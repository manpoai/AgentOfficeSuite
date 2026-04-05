'use client';

import { getObjType } from './types';
import { SlideToolbar } from './SlideToolbar';
import { ZoomBar } from './SlideToolbar';
import { PPTTableOverlay } from './PPTTableOverlay';
import { FloatingToolbar } from '@/components/shared/FloatingToolbar';
import { getPptTextItems, getPptImageItems, getPptShapeItems } from '@/components/shared/FloatingToolbar/presets';
import { createPPTTextHandler, createPPTImageHandler, createPPTShapeHandler } from './ppt-toolbar-handler';
import type { ShapeType } from '@/components/shared/ShapeSet/shapes';

// ─── Slide Canvas Area (center panel) ───────────────
export interface SlideCanvasProps {
  canvasRef: React.RefObject<any>;
  canvasHostRef: React.RefObject<HTMLDivElement | null>;
  canvasContainerRef: React.RefObject<HTMLDivElement | null>;
  selectedObj: any;
  propVersion: number;
  tableObjects: any[];
  showPropertyPanel: boolean;
  onTogglePropertyPanel: () => void;
  onAddTextbox: () => void;
  onAddShape: (shapeType: ShapeType) => void;
  onAddImage: () => void;
  onAddTable: () => void;
  onInsertDiagram: () => void;
}

export function SlideCanvas({
  canvasRef,
  canvasHostRef,
  canvasContainerRef,
  selectedObj,
  propVersion,
  tableObjects,
  showPropertyPanel,
  onTogglePropertyPanel,
  onAddTextbox,
  onAddShape,
  onAddImage,
  onAddTable,
  onInsertDiagram,
}: SlideCanvasProps) {
  return (
    <div ref={canvasContainerRef} className="flex-1 min-w-0 overflow-hidden bg-[#F5F7F5] dark:bg-zinc-900 relative">
      {/* Floating Toolbar */}
      <SlideToolbar
        onAddTextbox={onAddTextbox}
        onAddShape={onAddShape}
        onAddImage={onAddImage}
        onAddTable={onAddTable}
        onInsertDiagram={onInsertDiagram}
        showPropertyPanel={showPropertyPanel}
        onTogglePropertyPanel={onTogglePropertyPanel}
      />

      <div className="canvas-wrapper absolute">
        <div ref={canvasHostRef} className="shadow-xl rounded-sm" />
      </div>

      {/* Floating toolbar adapts to selected object type */}
      {selectedObj && canvasRef.current && canvasContainerRef.current && (() => {
        const objType = getObjType(selectedObj);
        if (objType === 'table') return null; // table handled by PPTTableOverlay

        const canvas = canvasRef.current!;
        const container = canvasContainerRef.current!;
        const zoom = canvas.getZoom() || 1;
        const wrapper = container.querySelector('.canvas-wrapper') as HTMLElement;
        const containerRect = container.getBoundingClientRect();
        const wrapperLeft = wrapper ? parseFloat(wrapper.style.marginLeft || '0') : 0;
        const wrapperTop = wrapper ? parseFloat(wrapper.style.marginTop || '0') : 0;
        const objLeft = (selectedObj.left || 0) * zoom + wrapperLeft;
        const objTop = (selectedObj.top || 0) * zoom + wrapperTop;
        const objWidth = (selectedObj.width || 0) * (selectedObj.scaleX || 1) * zoom;
        const anchor = {
          top: containerRect.top + objTop,
          left: containerRect.left + objLeft,
          width: objWidth,
        };

        let items, handler;
        if (objType === 'textbox') {
          items = getPptTextItems();
          handler = createPPTTextHandler({ obj: selectedObj, canvas });
        } else if (objType === 'image') {
          items = getPptImageItems();
          handler = createPPTImageHandler({ obj: selectedObj, canvas });
        } else if (objType === 'rect' || objType === 'circle' || objType === 'ellipse' || objType === 'triangle' || objType === 'shape') {
          items = getPptShapeItems();
          handler = createPPTShapeHandler({ obj: selectedObj, canvas });
        } else {
          return null;
        }

        return (
          <FloatingToolbar
            items={items}
            handler={handler}
            anchor={anchor}
            visible={true}
          />
        );
      })()}

      {/* Table DOM overlays */}
      {tableObjects.map((tObj, idx) => (
        <PPTTableOverlay
          key={tObj.__uid || idx}
          obj={tObj}
          canvas={canvasRef.current}
          containerRef={canvasContainerRef}
          propVersion={propVersion}
          isSelected={selectedObj === tObj}
        />
      ))}

      {/* Zoom Bar */}
      <ZoomBar canvasRef={canvasRef} canvasContainerRef={canvasContainerRef} />
    </div>
  );
}
