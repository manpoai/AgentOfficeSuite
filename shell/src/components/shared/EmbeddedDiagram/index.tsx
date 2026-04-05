'use client';

/**
 * EmbeddedDiagram — Embedded diagram component for Docs and PPT.
 *
 * Shows a static SVG preview of a diagram. Double-click opens
 * a modal with the full diagram editor for editing.
 *
 * Used in:
 * - Documents: as a ProseMirror node (via adapters)
 * - PPT: as a Fabric.js overlay (via adapters)
 */

import React, { useState, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  GitBranch,
  Maximize2,
  ExternalLink,
  Loader2,
  AlertCircle,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';
import { getDiagram } from '@/lib/api/gateway';
import { DiagramPreview, type DiagramData } from './DiagramPreview';

export interface EmbeddedDiagramProps {
  /** The diagram content ID (e.g. "diagram:abc123") */
  diagramId: string;
  /** Display width */
  width?: number;
  /** Display height */
  height?: number;
  /** Whether editing is allowed (double-click to edit) */
  editable?: boolean;
  /** Additional CSS class */
  className?: string;
  /** Called when diagram data changes (after editing) */
  onChange?: (data: DiagramData) => void;
}

/** Extract raw ID from content ID format */
function getRawId(diagramId: string): string {
  const prefix = 'diagram:';
  return diagramId.startsWith(prefix) ? diagramId.slice(prefix.length) : diagramId;
}

export function EmbeddedDiagram({
  diagramId,
  width = 400,
  height = 300,
  editable = true,
  className,
  onChange: _onChange,
}: EmbeddedDiagramProps) {
  const router = useRouter();
  const rawId = getRawId(diagramId);
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['diagram', rawId],
    queryFn: () => getDiagram(rawId),
    staleTime: 30_000,
  });

  const handleDoubleClick = useCallback(() => {
    if (!editable) return;
    // Open diagram in full editor view
    router.push(`/content?id=${encodeURIComponent(diagramId)}`);
  }, [editable, diagramId, router]);

  const handleOpenExternal = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      router.push(`/content?id=${encodeURIComponent(diagramId)}`);
    },
    [diagramId, router],
  );

  if (isLoading) {
    return (
      <div
        className={cn(
          'flex items-center justify-center bg-muted/30 rounded-lg border border-border',
          className,
        )}
        style={{ width, height }}
      >
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div
        className={cn(
          'flex flex-col items-center justify-center gap-2 bg-muted/30 rounded-lg border border-border',
          className,
        )}
        style={{ width, height }}
      >
        <AlertCircle className="w-6 h-6 text-muted-foreground" />
        <span className="text-xs text-muted-foreground">
          Failed to load diagram
        </span>
      </div>
    );
  }

  const diagramData: DiagramData = data.data || { nodes: [], edges: [] };
  const isEmpty = diagramData.nodes.length === 0;

  return (
    <div
      className={cn(
        'group relative rounded-lg border border-border overflow-hidden transition-shadow',
        editable && 'cursor-pointer hover:shadow-md hover:border-sidebar-primary/30',
        className,
      )}
      style={{ width, height }}
      onDoubleClick={handleDoubleClick}
      title={editable ? 'Double-click to edit diagram' : undefined}
    >
      {isEmpty ? (
        <div className="flex flex-col items-center justify-center h-full gap-2 bg-muted/20">
          <GitBranch className="w-8 h-8 text-muted-foreground/50" />
          <span className="text-xs text-muted-foreground">Empty diagram</span>
          {editable && (
            <span className="text-[10px] text-muted-foreground/60">
              Double-click to edit
            </span>
          )}
        </div>
      ) : (
        <DiagramPreview
          data={diagramData}
          width={width}
          height={height}
        />
      )}

      {/* Hover overlay with actions */}
      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/5 transition-colors pointer-events-none" />
      <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={handleOpenExternal}
          className="p-1.5 rounded-md bg-background/90 border border-border shadow-sm hover:bg-background transition-colors pointer-events-auto"
          title={t('toolbar.openFullEditor')}
        >
          <ExternalLink className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Bottom label */}
      <div className="absolute bottom-0 left-0 right-0 flex items-center gap-1.5 px-2 py-1 bg-gradient-to-t from-black/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity">
        <GitBranch className="w-3 h-3 text-white/70" />
        <span className="text-[10px] text-white/70 font-medium">Diagram</span>
      </div>
    </div>
  );
}

export { DiagramPreview } from './DiagramPreview';
export type { DiagramData, DiagramPreviewProps } from './DiagramPreview';
