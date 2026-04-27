import React from 'react';
import type { CanvasPage, CanvasElement } from './types';

const ELEMENT_STYLE = `svg path, svg rect, svg circle, svg ellipse, svg line, svg polygon, svg polyline { vector-effect: non-scaling-stroke; }`;

function ExportElement({ el }: { el: CanvasElement }) {
  if (el.visible === false) return null;

  if (el.type === 'group' && el.children) {
    return (
      <div
        style={{
          position: 'absolute',
          left: el.x,
          top: el.y,
          width: el.w,
          height: el.h,
          zIndex: el.z_index ?? 0,
          pointerEvents: 'none',
        }}
      >
        {el.children
          .filter(c => c.visible !== false)
          .sort((a, b) => (a.z_index ?? 0) - (b.z_index ?? 0))
          .map(child => <ExportElement key={child.id} el={child} />)}
      </div>
    );
  }

  return (
    <div
      style={{
        position: 'absolute',
        left: el.x,
        top: el.y,
        width: el.w,
        height: el.h,
        zIndex: el.z_index ?? 0,
        overflow: 'hidden',
        pointerEvents: 'none',
      }}
      dangerouslySetInnerHTML={{ __html: `<style>${ELEMENT_STYLE}</style>${el.html}` }}
    />
  );
}

interface Props {
  frame: CanvasPage;
}

export const CanvasFrameExportView = React.forwardRef<HTMLDivElement, Props>(
  ({ frame }, ref) => {
    const sorted = frame.elements.filter(el => el.visible !== false).sort((a, b) => (a.z_index ?? 0) - (b.z_index ?? 0));
    return (
      <div
        ref={ref}
        style={{
          position: 'relative',
          width: frame.width,
          height: frame.height,
          backgroundColor: frame.background_color || '#ffffff',
          backgroundImage: frame.background_image ? `url(${frame.background_image})` : undefined,
          backgroundSize: 'cover',
          overflow: 'hidden',
        }}
      >
        {sorted.map(el => <ExportElement key={el.id} el={el} />)}
      </div>
    );
  }
);
CanvasFrameExportView.displayName = 'CanvasFrameExportView';

interface ElementExportProps {
  elements: CanvasElement[];
}

export const ElementExportView = React.forwardRef<HTMLDivElement, ElementExportProps>(
  ({ elements }, ref) => {
    const visible = elements.filter(el => el.visible !== false);
    if (visible.length === 0) return <div ref={ref} />;

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const el of visible) {
      minX = Math.min(minX, el.x);
      minY = Math.min(minY, el.y);
      maxX = Math.max(maxX, el.x + el.w);
      maxY = Math.max(maxY, el.y + el.h);
    }
    const w = maxX - minX;
    const h = maxY - minY;

    const sorted = [...visible].sort((a, b) => (a.z_index ?? 0) - (b.z_index ?? 0));

    return (
      <div
        ref={ref}
        style={{
          position: 'relative',
          width: w,
          height: h,
          overflow: 'hidden',
          backgroundColor: 'transparent',
        }}
      >
        {sorted.map(el => (
          <ExportElement key={el.id} el={{ ...el, x: el.x - minX, y: el.y - minY }} />
        ))}
      </div>
    );
  }
);
ElementExportView.displayName = 'ElementExportView';
