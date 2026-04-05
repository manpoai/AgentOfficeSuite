'use client';

import { useState, useEffect, useRef } from 'react';
import * as gw from '@/lib/api/gateway';
import { renderCellsToSVG } from '@/components/shared/EmbeddedDiagram/renderCellsToSVG';
import { createFabricShape } from '@/components/shared/ShapeSet/adapters/FabricShape';
import { SlideData, SLIDE_WIDTH, SLIDE_HEIGHT } from './types';
import { getFabricModule } from './useFabric';

// ─── Presenter Mode ─────────────────────────────────
export interface PresenterModeProps {
  slides: SlideData[];
  startIndex: number;
  onExit: () => void;
  loadSlideToCanvas: (slide: SlideData) => void;
}

export function PresenterMode({
  slides,
  startIndex,
  onExit,
  loadSlideToCanvas,
}: PresenterModeProps) {
  const fabricModule = getFabricModule();
  const [index, setIndex] = useState(startIndex);
  const canvasElRef = useRef<HTMLCanvasElement>(null);
  const canvasRef = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Fullscreen
  useEffect(() => {
    containerRef.current?.requestFullscreen?.().catch(() => {});
    const handler = () => {
      if (!document.fullscreenElement) onExit();
    };
    document.addEventListener('fullscreenchange', handler);
    return () => document.removeEventListener('fullscreenchange', handler);
  }, [onExit]);

  // Create canvas
  useEffect(() => {
    if (!canvasElRef.current || !fabricModule) return;
    const { Canvas } = fabricModule;
    const canvas = new Canvas(canvasElRef.current, {
      width: SLIDE_WIDTH,
      height: SLIDE_HEIGHT,
      selection: false,
      interactive: false,
    });
    canvasRef.current = canvas;

    // Table grid rendering for presenter mode
    canvas.on('after:render', () => {
      const ctx = canvas.getContext();
      if (!ctx) return;
      for (const o of canvas.getObjects()) {
        if (!(o as any).__isTable) continue;
        const tJSON = (o as any).__tableJSON;
        const tableContent = tJSON?.content?.[0]?.content || [];
        const tRows: number = tableContent.length || 3;
        const tCols: number = tableContent[0]?.content?.length || 3;
        const z = canvas.getZoom() || 1;
        const ox = (o.left || 0) * z;
        const oy = (o.top || 0) * z;
        const cw = 120 * z;
        const ch = 36 * z;
        ctx.save();
        ctx.strokeStyle = '#d1d5db';
        ctx.lineWidth = 1;
        for (let r = 0; r <= tRows; r++) { ctx.beginPath(); ctx.moveTo(ox, oy + r * ch); ctx.lineTo(ox + tCols * cw, oy + r * ch); ctx.stroke(); }
        for (let c = 0; c <= tCols; c++) { ctx.beginPath(); ctx.moveTo(ox + c * cw, oy); ctx.lineTo(ox + c * cw, oy + tRows * ch); ctx.stroke(); }
        ctx.fillStyle = '#f3f4f6';
        ctx.fillRect(ox, oy, tCols * cw, ch);
        ctx.strokeRect(ox, oy, tCols * cw, ch);
        ctx.fillStyle = '#1f2937';
        ctx.font = `${Math.max(10, 12 * z)}px Inter, system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        for (let r = 0; r < tRows; r++) {
          const rowCells = tableContent[r]?.content || [];
          for (let c = 0; c < tCols; c++) {
            const cell = rowCells[c];
            const text = cell?.content?.[0]?.content?.[0]?.text || '';
            if (text) ctx.fillText(text, ox + c * cw + cw / 2, oy + r * ch + ch / 2, cw - 8);
          }
        }
        ctx.restore();
      }
    });

    return () => {
      canvas.dispose();
      canvasRef.current = null;
    };
  }, []);

  // Load current slide
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !slides[index] || !fabricModule) return;

    const slide = slides[index];
    canvas.clear();
    canvas.backgroundColor = slide.background || '#ffffff';

    // Background image in presenter mode
    if (slide.backgroundImage && fabricModule.FabricImage) {
      const bgImg = new window.Image();
      bgImg.crossOrigin = 'anonymous';
      bgImg.onload = () => {
        const fImg = new fabricModule.FabricImage(bgImg, { originX: 'left', originY: 'top' });
        const scX = SLIDE_WIDTH / bgImg.width;
        const scY = SLIDE_HEIGHT / bgImg.height;
        const sc = Math.max(scX, scY);
        fImg.set({ scaleX: sc, scaleY: sc });
        canvas.backgroundImage = fImg;
        canvas.renderAll();
      };
      bgImg.src = slide.backgroundImage;
    } else {
      canvas.backgroundImage = null;
    }

    const { Textbox, Rect, Circle, Triangle, FabricImage } = fabricModule;
    for (const el of slide.elements) {
      let obj: any = null;
      const common = {
        left: el.left || 0, top: el.top || 0, width: el.width, height: el.height,
        fill: el.fill || '#333333', angle: el.angle || 0,
        scaleX: el.scaleX || 1, scaleY: el.scaleY || 1, opacity: el.opacity ?? 1,
        selectable: false, evented: false,
      };

      if (el.type === 'textbox') {
        obj = new Textbox(el.text || '', { ...common, fontSize: el.fontSize || 24, fontWeight: el.fontWeight || 'normal', fontStyle: el.fontStyle || 'normal', underline: el.underline || false, textAlign: el.textAlign || 'left', lineHeight: el.lineHeight || 1.3, fontFamily: el.fontFamily || 'Inter, system-ui, sans-serif' });
      } else if (el.type === 'rect') {
        obj = new Rect({ ...common, rx: el.rx || 0, ry: el.ry || 0, stroke: el.stroke || '', strokeWidth: el.strokeWidth || 0 });
      } else if (el.type === 'circle') {
        obj = new Circle({ ...common, radius: el.radius || 50, stroke: el.stroke || '', strokeWidth: el.strokeWidth || 0 });
      } else if (el.type === 'triangle') {
        obj = new Triangle({ ...common, stroke: el.stroke || '', strokeWidth: el.strokeWidth || 0 });
      } else if (el.type === 'ellipse') {
        obj = new fabricModule.Ellipse({ ...common, rx: el.rx || 50, ry: el.ry || 30, stroke: el.stroke || '', strokeWidth: el.strokeWidth || 0, selectable: false, evented: false });
      } else if (el.type === 'shape' && el.shapeType) {
        obj = createFabricShape(fabricModule, el.shapeType, {
          left: el.left || 0, top: el.top || 0, width: el.width || 120, height: el.height || 80,
          fill: el.fill || '#e2e8f0', stroke: el.stroke || '#94a3b8', strokeWidth: el.strokeWidth || 1,
        });
        if (obj) obj.set({ angle: el.angle || 0, scaleX: el.scaleX || 1, scaleY: el.scaleY || 1, opacity: el.opacity ?? 1, selectable: false, evented: false });
      } else if (el.type === 'image' && el.src) {
        const imgEl = new window.Image();
        imgEl.crossOrigin = 'anonymous';
        imgEl.onload = () => {
          const fi = new FabricImage(imgEl, {
            left: el.left || 0,
            top: el.top || 0,
            scaleX: el.scaleX || ((el.width || 200) / imgEl.width),
            scaleY: el.scaleY || ((el.height || 200) / imgEl.height),
            selectable: false,
            evented: false,
          });
          canvas.add(fi);
          canvas.renderAll();
        };
        imgEl.src = el.src;
        continue;
      } else if (el.type === 'table') {
        const { Rect: RectPres } = fabricModule;
        const tJSON = el.tableJSON;
        const tc = tJSON?.content?.[0]?.content || [];
        const tRows = tc.length || 3;
        const tCols = tc[0]?.content?.length || 3;
        obj = new RectPres({
          ...common,
          width: el.width || 120 * tCols,
          height: el.height || 36 * tRows,
          fill: '#ffffff',
          stroke: '#d1d5db',
          strokeWidth: 1,
        });
        (obj as any).__tableJSON = el.tableJSON || null;
        (obj as any).__isTable = true;
      }
      if (obj) canvas.add(obj);
    }
    canvas.renderAll();
  }, [index, slides]);

  // Resize canvas to fill screen
  useEffect(() => {
    const resize = () => {
      const el = containerRef.current;
      if (!el) return;
      const scale = Math.min(window.innerWidth / SLIDE_WIDTH, window.innerHeight / SLIDE_HEIGHT);
      const wrapper = el.querySelector('.presenter-canvas') as HTMLElement;
      if (wrapper) {
        wrapper.style.transform = `scale(${scale})`;
        wrapper.style.transformOrigin = 'center center';
      }
    };
    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);

  // Keyboard navigation
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'Enter') {
        setIndex(i => Math.min(i + 1, slides.length - 1));
      } else if (e.key === 'ArrowLeft') {
        setIndex(i => Math.max(i - 1, 0));
      } else if (e.key === 'Escape') {
        document.exitFullscreen?.().catch(() => {});
        onExit();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [slides.length, onExit]);

  return (
    <div ref={containerRef} className="fixed inset-0 bg-black z-50 flex items-center justify-center cursor-none" onClick={(e) => {
      if (e.clientX > window.innerWidth / 2) setIndex(i => Math.min(i + 1, slides.length - 1));
      else setIndex(i => Math.max(i - 1, 0));
    }}>
      <div className="presenter-canvas" style={{ width: SLIDE_WIDTH, height: SLIDE_HEIGHT }}>
        <canvas ref={canvasElRef} />
      </div>
      <div className="fixed bottom-4 right-4 text-white/50 text-sm z-50 cursor-default" onClick={(e) => e.stopPropagation()}>
        {index + 1} / {slides.length}
      </div>
      <button
        className="fixed top-4 right-4 text-white/30 hover:text-white/70 text-sm z-50"
        onClick={(e) => { e.stopPropagation(); document.exitFullscreen?.().catch(() => {}); onExit(); }}
      >
        ESC
      </button>
    </div>
  );
}
