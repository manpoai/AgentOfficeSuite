'use client';

import { useState, useEffect } from 'react';
import type { Graph } from '@antv/x6';
import { Minus, Plus } from 'lucide-react';
import { useT } from '@/lib/i18n';

interface ZoomBarProps {
  graph: Graph | null;
}

export function ZoomBar({ graph }: ZoomBarProps) {
  const { t } = useT();
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

  return (
    <div className="absolute bottom-3 right-3 z-20 flex items-center gap-1 bg-card/50 backdrop-blur-sm rounded border border-black/10 dark:border-white/10 px-3 h-10">
      <button
        className="w-7 h-7 flex items-center justify-center rounded hover:bg-black/[0.04] text-black/70 dark:text-white/70"
        onClick={handleZoomOut}
        title={t('toolbar.zoomOut')}
      >
        <Minus size={14} />
      </button>

      <span className="text-sm font-medium text-black/70 dark:text-white/70 w-10 text-center tabular-nums">{zoom}%</span>

      <button
        className="w-7 h-7 flex items-center justify-center rounded hover:bg-black/[0.04] text-black/70 dark:text-white/70"
        onClick={handleZoomIn}
        title={t('toolbar.zoomIn')}
      >
        <Plus size={14} />
      </button>
    </div>
  );
}
