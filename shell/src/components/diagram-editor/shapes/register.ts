/**
 * Register all custom X6 shapes (flowchart nodes, mindmap nodes, edges).
 * Call once before creating a Graph instance.
 */
import { Graph } from '@antv/x6';
import { register } from '@antv/x6-react-shape';
import { FlowchartNode } from '../nodes/FlowchartNode';
import { MindmapNode } from '../nodes/MindmapNode';
import { PORT_R } from '../constants';

let registered = false;

const portAttrs = {
  circle: {
    r: PORT_R,
    magnet: true,
    stroke: '#5F95FF',
    strokeWidth: 1.5,
    fill: '#fff',
    style: { visibility: 'hidden' },
  },
};

// Offset ports outward so they don't overlap resize handles.
// We register custom port layout functions that place ports outside the node boundary.
const PORT_OFFSET = 10;

Graph.registerPortLayout('port-top', (portsPositionArgs, elemBBox) => {
  return portsPositionArgs.map(() => ({
    position: { x: elemBBox.width / 2, y: -PORT_OFFSET },
    angle: 0,
  }));
}, true);

Graph.registerPortLayout('port-bottom', (portsPositionArgs, elemBBox) => {
  return portsPositionArgs.map(() => ({
    position: { x: elemBBox.width / 2, y: elemBBox.height + PORT_OFFSET },
    angle: 0,
  }));
}, true);

Graph.registerPortLayout('port-left', (portsPositionArgs, elemBBox) => {
  return portsPositionArgs.map(() => ({
    position: { x: -PORT_OFFSET, y: elemBBox.height / 2 },
    angle: 0,
  }));
}, true);

Graph.registerPortLayout('port-right', (portsPositionArgs, elemBBox) => {
  return portsPositionArgs.map(() => ({
    position: { x: elemBBox.width + PORT_OFFSET, y: elemBBox.height / 2 },
    angle: 0,
  }));
}, true);

const portGroups = {
  top:    { position: 'port-top',    attrs: portAttrs },
  bottom: { position: 'port-bottom', attrs: portAttrs },
  left:   { position: 'port-left',   attrs: portAttrs },
  right:  { position: 'port-right',  attrs: portAttrs },
};

const flowchartPorts = {
  groups: portGroups,
  items: [
    { id: 'top', group: 'top' },
    { id: 'bottom', group: 'bottom' },
    { id: 'left', group: 'left' },
    { id: 'right', group: 'right' },
  ],
};

export function registerShapes() {
  if (registered) return;
  registered = true;

  // ── Flowchart node (React component) ──
  register({
    shape: 'flowchart-node',
    width: 120,
    height: 60,
    component: FlowchartNode,
    ports: flowchartPorts,
  });

  // ── Mindmap node (React component) ──
  register({
    shape: 'mindmap-node',
    width: 160,
    height: 40,
    component: MindmapNode,
    ports: {
      groups: portGroups,
      items: [
        { id: 'left', group: 'left' },
        { id: 'right', group: 'right' },
      ],
    },
  });

  // ── Mindmap root node ──
  register({
    shape: 'mindmap-root',
    width: 180,
    height: 50,
    component: MindmapNode,
    ports: {
      groups: portGroups,
      items: [
        { id: 'left', group: 'left' },
        { id: 'right', group: 'right' },
        { id: 'top', group: 'top' },
        { id: 'bottom', group: 'bottom' },
      ],
    },
  });

  // ── Custom edge with label support ──
  Graph.registerEdge(
    'flowchart-edge',
    {
      inherit: 'edge',
      attrs: {
        line: {
          stroke: '#94a3b8',
          strokeWidth: 2,
          targetMarker: { name: 'classic', size: 8 },
        },
      },
      router: { name: 'manhattan' },
      connector: { name: 'rounded', args: { radius: 8 } },
    },
    true,
  );
}
