'use client';

import { useState, useEffect } from 'react';
import type { Graph } from '@antv/x6';
import { Minus, Plus, Maximize2 } from 'lucide-react';

interface ZoomBarProps {
  graph: Graph | null;
}

export function ZoomBar({ graph }: ZoomBarProps) {
  const [zoom, setZoom] = useState(100);

  useEffect(() => {
    if (!graph) return;
    const update = () => {
      const { sx } = graph.scale();
      setZoom(Math.round(sx * 100));
    };
    graph.on('scale', update);
    update();
    return () => { graph.off('scale', update); };
  }, [graph]);

  if (!graph) return null;

  const handleZoomIn = () => graph.zoom(0.1);
  const handleZoomOut = () => graph.zoom(-0.1);
  const handleFitView = () => {
    graph.zoomToFit({ padding: 60, maxScale: 1.5 });
  };

  return (
    <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-20 flex items-center gap-1 bg-white rounded-lg shadow-md border border-gray-200 px-2 py-1">
      <button
        className="w-7 h-7 flex items-center justify-center rounded hover:bg-gray-100 text-gray-600"
        onClick={handleZoomOut}
        title="缩小"
      >
        <Minus size={14} />
      </button>

      <span className="text-xs text-gray-500 w-10 text-center tabular-nums">{zoom}%</span>

      <button
        className="w-7 h-7 flex items-center justify-center rounded hover:bg-gray-100 text-gray-600"
        onClick={handleZoomIn}
        title="放大"
      >
        <Plus size={14} />
      </button>

      <div className="w-px h-4 bg-gray-200 mx-0.5" />

      <button
        className="w-7 h-7 flex items-center justify-center rounded hover:bg-gray-100 text-gray-600"
        onClick={handleFitView}
        title="适应屏幕"
      >
        <Maximize2 size={14} />
      </button>
    </div>
  );
}
