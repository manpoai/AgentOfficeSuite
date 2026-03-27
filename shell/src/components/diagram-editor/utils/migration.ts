/**
 * Migrate React Flow data format to X6 format.
 */
import { DEFAULT_NODE_COLOR, SHAPE_META, type FlowchartShape } from '../constants';

interface RFNode {
  id: string;
  type?: string;
  position: { x: number; y: number };
  data: { label?: string; shape?: string; bgColor?: string; borderColor?: string; textColor?: string };
  width?: number;
  height?: number;
}

interface RFEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
  sourceHandle?: string;
  targetHandle?: string;
}

interface RFData {
  nodes: RFNode[];
  edges: RFEdge[];
  viewport?: { x: number; y: number; zoom: number };
}

interface X6Data {
  cells: any[];
  viewport?: { x: number; y: number; zoom: number };
}

// Map old shape names to new
const SHAPE_MAP: Record<string, FlowchartShape> = {
  'rectangle': 'rect',
  'rounded': 'rounded-rect',
  'diamond': 'diamond',
  'circle': 'circle',
  'mindmap': 'rounded-rect',
  'mindmap-root': 'rounded-rect',
};

export function isReactFlowData(data: any): data is RFData {
  return data && Array.isArray(data.nodes) && !data.cells;
}

export function migrateToX6(data: RFData): X6Data {
  const cells: any[] = [];

  // Convert nodes
  for (const node of data.nodes) {
    const oldShape = node.data?.shape || 'rounded';
    const newShape: FlowchartShape = SHAPE_MAP[oldShape] || 'rounded-rect';
    const meta = SHAPE_META[newShape];

    cells.push({
      id: node.id,
      shape: 'flowchart-node',
      x: node.position.x,
      y: node.position.y,
      width: node.width || meta.width,
      height: node.height || meta.height,
      data: {
        label: node.data?.label || '',
        flowchartShape: newShape,
        bgColor: node.data?.bgColor || DEFAULT_NODE_COLOR.bg,
        borderColor: node.data?.borderColor || DEFAULT_NODE_COLOR.border,
        textColor: node.data?.textColor || DEFAULT_NODE_COLOR.text,
        fontSize: 14,
        fontWeight: 'normal',
        fontStyle: 'normal',
      },
      ports: {
        groups: {
          top:    { position: 'top',    attrs: { circle: { r: 5, magnet: true, stroke: '#5F95FF', strokeWidth: 1.5, fill: '#fff', style: { visibility: 'hidden' }}}},
          bottom: { position: 'bottom', attrs: { circle: { r: 5, magnet: true, stroke: '#5F95FF', strokeWidth: 1.5, fill: '#fff', style: { visibility: 'hidden' }}}},
          left:   { position: 'left',   attrs: { circle: { r: 5, magnet: true, stroke: '#5F95FF', strokeWidth: 1.5, fill: '#fff', style: { visibility: 'hidden' }}}},
          right:  { position: 'right',  attrs: { circle: { r: 5, magnet: true, stroke: '#5F95FF', strokeWidth: 1.5, fill: '#fff', style: { visibility: 'hidden' }}}},
        },
        items: [
          { id: 'top', group: 'top' },
          { id: 'bottom', group: 'bottom' },
          { id: 'left', group: 'left' },
          { id: 'right', group: 'right' },
        ],
      },
    });
  }

  // Convert edges
  for (const edge of data.edges) {
    cells.push({
      id: edge.id,
      shape: 'flowchart-edge',
      source: { cell: edge.source, port: edge.sourceHandle || 'bottom' },
      target: { cell: edge.target, port: edge.targetHandle || 'top' },
      labels: edge.label ? [{ attrs: { text: { text: edge.label } }, position: 0.5 }] : [],
    });
  }

  return {
    cells,
    viewport: data.viewport,
  };
}
