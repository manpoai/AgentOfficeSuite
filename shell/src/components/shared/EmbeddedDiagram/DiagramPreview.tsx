/**
 * DiagramPreview — Static SVG preview of a diagram.
 *
 * Renders diagram nodes and edges as lightweight SVG without
 * loading the full X6 graph library. Used for thumbnails,
 * embeds in documents, and presentation slides.
 */

import React, { useId, useMemo } from 'react';
import { cn } from '@/lib/utils';

interface DiagramNode {
  id: string;
  shape?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  label?: string;
  data?: { label?: string; color?: string; backgroundColor?: string };
  attrs?: {
    body?: { fill?: string; stroke?: string; rx?: number; ry?: number };
    label?: { text?: string; fill?: string; fontSize?: number };
  };
}

interface DiagramEdge {
  id: string;
  source: string | { cell: string };
  target: string | { cell: string };
  attrs?: {
    line?: { stroke?: string; strokeWidth?: number; strokeDasharray?: string };
  };
  labels?: Array<{ attrs?: { label?: { text?: string } } }>;
}

export interface DiagramData {
  nodes: DiagramNode[];
  edges: DiagramEdge[];
  viewport?: { x: number; y: number; zoom: number };
}

export interface DiagramPreviewProps {
  data: DiagramData;
  width?: number;
  height?: number;
  className?: string;
}

export function DiagramPreview({
  data,
  width = 400,
  height = 300,
  className,
}: DiagramPreviewProps) {
  const reactId = useId();
  const markerId = `arrowhead-${reactId.replace(/:/g, '')}`;
  const { viewBox, nodes, edges } = useMemo(() => {
    if (!data.nodes.length) {
      return { viewBox: `0 0 ${width} ${height}`, nodes: [], edges: [] };
    }

    // Calculate bounding box
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of data.nodes) {
      const x = n.x ?? 0;
      const y = n.y ?? 0;
      const w = n.width ?? 120;
      const h = n.height ?? 60;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x + w);
      maxY = Math.max(maxY, y + h);
    }

    const padding = 20;
    minX -= padding;
    minY -= padding;
    maxX += padding;
    maxY += padding;

    return {
      viewBox: `${minX} ${minY} ${maxX - minX} ${maxY - minY}`,
      nodes: data.nodes,
      edges: data.edges,
    };
  }, [data, width, height]);

  // Build node position map for edge rendering
  const nodeMap = useMemo(() => {
    const map = new Map<string, DiagramNode>();
    for (const n of nodes) map.set(n.id, n);
    return map;
  }, [nodes]);

  const getNodeCenter = (ref: string | { cell: string }): { x: number; y: number } | null => {
    const id = typeof ref === 'string' ? ref : ref.cell;
    const node = nodeMap.get(id);
    if (!node) return null;
    return {
      x: (node.x ?? 0) + (node.width ?? 120) / 2,
      y: (node.y ?? 0) + (node.height ?? 60) / 2,
    };
  };

  return (
    <svg
      width={width}
      height={height}
      viewBox={viewBox}
      className={cn('bg-white rounded', className)}
      preserveAspectRatio="xMidYMid meet"
    >
      {/* Edges */}
      {edges.map((edge) => {
        const from = getNodeCenter(edge.source);
        const to = getNodeCenter(edge.target);
        if (!from || !to) return null;

        const stroke = edge.attrs?.line?.stroke || '#94a3b8';
        const strokeWidth = edge.attrs?.line?.strokeWidth || 1.5;
        const dasharray = edge.attrs?.line?.strokeDasharray;

        return (
          <g key={edge.id}>
            <line
              x1={from.x}
              y1={from.y}
              x2={to.x}
              y2={to.y}
              stroke={stroke}
              strokeWidth={strokeWidth}
              strokeDasharray={dasharray}
              markerEnd={`url(#${markerId})`}
            />
            {edge.labels?.[0]?.attrs?.label?.text && (
              <text
                x={(from.x + to.x) / 2}
                y={(from.y + to.y) / 2 - 6}
                textAnchor="middle"
                fontSize={10}
                fill="#64748b"
              >
                {edge.labels[0].attrs!.label!.text}
              </text>
            )}
          </g>
        );
      })}

      {/* Nodes */}
      {nodes.map((node) => {
        const x = node.x ?? 0;
        const y = node.y ?? 0;
        const w = node.width ?? 120;
        const h = node.height ?? 60;
        const fill = node.data?.backgroundColor || node.attrs?.body?.fill || '#ffffff';
        const stroke = node.data?.color || node.attrs?.body?.stroke || '#374151';
        const rx = node.attrs?.body?.rx ?? 4;
        const label =
          node.label || node.data?.label || node.attrs?.label?.text || '';

        return (
          <g key={node.id}>
            <rect
              x={x}
              y={y}
              width={w}
              height={h}
              rx={rx}
              ry={rx}
              fill={fill}
              stroke={stroke}
              strokeWidth={1.5}
            />
            {label && (
              <text
                x={x + w / 2}
                y={y + h / 2}
                textAnchor="middle"
                dominantBaseline="central"
                fontSize={12}
                fill={node.attrs?.label?.fill || '#1f2937'}
                className="select-none"
              >
                {label.length > 20 ? label.slice(0, 18) + '...' : label}
              </text>
            )}
          </g>
        );
      })}

      {/* Arrow marker definition */}
      <defs>
        <marker
          id={markerId}
          markerWidth="8"
          markerHeight="6"
          refX="8"
          refY="3"
          orient="auto"
        >
          <path d="M 0 0 L 8 3 L 0 6 Z" fill="#94a3b8" />
        </marker>
      </defs>
    </svg>
  );
}
