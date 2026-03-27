/**
 * Quick-create: click a port on a node → auto-create new node + edge
 */
import type { Graph, Node } from '@antv/x6';
import { SHAPE_META, DEFAULT_NODE_COLOR, type FlowchartShape } from '../constants';

let idCounter = 0;
function newId(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}_${++idCounter}`;
}

const OFFSET = 80; // Gap between nodes

interface PortDirection {
  dx: number;
  dy: number;
}

const PORT_OFFSETS: Record<string, PortDirection> = {
  top:    { dx: 0,  dy: -1 },
  bottom: { dx: 0,  dy: 1 },
  left:   { dx: -1, dy: 0 },
  right:  { dx: 1,  dy: 0 },
};

export function quickCreateNode(
  graph: Graph,
  sourceNode: Node,
  portId: string,
  shape: FlowchartShape = (sourceNode.getData()?.flowchartShape || 'rounded-rect'),
) {
  const dir = PORT_OFFSETS[portId];
  if (!dir) return null;

  const sourcePos = sourceNode.position();
  const sourceSize = sourceNode.size();
  const meta = SHAPE_META[shape] || SHAPE_META['rounded-rect'];

  const newX = sourcePos.x + dir.dx * (sourceSize.width + OFFSET) + (dir.dx === 0 ? (sourceSize.width - meta.width) / 2 : 0);
  const newY = sourcePos.y + dir.dy * (sourceSize.height + OFFSET) + (dir.dy === 0 ? (sourceSize.height - meta.height) / 2 : 0);

  const nodeId = newId('node');
  const newNode = graph.addNode({
    id: nodeId,
    shape: 'flowchart-node',
    x: newX,
    y: newY,
    width: meta.width,
    height: meta.height,
    data: {
      label: '',
      flowchartShape: shape,
      bgColor: DEFAULT_NODE_COLOR.bg,
      borderColor: DEFAULT_NODE_COLOR.border,
      textColor: DEFAULT_NODE_COLOR.text,
      fontSize: 14,
      fontWeight: 'normal',
      fontStyle: 'normal',
    },
  });

  // Determine source/target ports for the edge
  const oppositePort: Record<string, string> = {
    top: 'bottom',
    bottom: 'top',
    left: 'right',
    right: 'left',
  };

  graph.addEdge({
    shape: 'flowchart-edge',
    source: { cell: sourceNode.id, port: portId },
    target: { cell: nodeId, port: oppositePort[portId] || 'top' },
  });

  return newNode;
}
