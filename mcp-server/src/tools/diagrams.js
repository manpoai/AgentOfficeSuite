import { z } from 'zod';

const NodeShape = z.enum([
  'rounded-rect', 'rect', 'diamond', 'ellipse', 'parallelogram',
  'cylinder', 'hexagon', 'cloud', 'terminal',
]).optional().default('rounded-rect');

export function registerDiagramTools(server, gw) {
  server.tool(
    'create_diagram',
    'Create a new flowchart/diagram canvas. Returns the diagram_id.',
    {
      title: z.string().describe('Diagram title'),
    },
    async ({ title }) => {
      // POST /api/diagrams creates the diagram; title goes to content_items via content route
      const result = await gw.post('/diagrams', { title });
      // Also upsert the content item title if gateway returns an id
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
  );

  server.tool(
    'get_diagram',
    'Read a diagram and all its nodes/edges. Returns cells array with id, shape, position, label, and connection info.',
    {
      diagram_id: z.string().describe('Diagram ID'),
    },
    async ({ diagram_id }) => {
      const result = await gw.get(`/diagrams/${diagram_id}`);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
  );

  server.tool(
    'update_diagram',
    'Replace the full diagram content (all nodes and edges at once). Use get_diagram first to get existing cells, modify them, and pass the updated cells array back. The gateway will normalize cell shapes automatically.',
    {
      diagram_id: z.string().describe('Diagram ID'),
      cells: z.array(z.object({
        id: z.string().describe('Unique cell ID'),
        shape: z.string().optional().describe('Cell shape: "flowchart-node" for nodes, "edge" for connections'),
        data: z.object({
          label: z.string().optional(),
          flowchartShape: NodeShape.describe('Node shape style'),
          bgColor: z.string().optional().describe('Background color hex'),
          borderColor: z.string().optional().describe('Border color hex'),
          textColor: z.string().optional().describe('Text color hex'),
        }).optional(),
        source: z.string().optional().describe('Source node ID (for edges)'),
        target: z.string().optional().describe('Target node ID (for edges)'),
        geometry: z.object({
          x: z.number().optional(),
          y: z.number().optional(),
          width: z.number().optional(),
          height: z.number().optional(),
        }).optional(),
      })).describe('Full cells array (nodes + edges)'),
      revision_description: z.string().optional().describe('Optional description for revision history'),
    },
    async ({ diagram_id, cells, revision_description }) => {
      const body = { data: { cells } };
      if (revision_description) body.revision_description = revision_description;
      const result = await gw.patch(`/diagrams/${diagram_id}`, body);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
  );

  server.tool(
    'build_diagram',
    'Build a flowchart from a high-level node+edge description. Automatically assigns positions in a top-down layout. Nodes and edges are passed separately — no need to compute x/y coordinates manually.',
    {
      diagram_id: z.string().describe('Diagram ID to write to (replaces current content)'),
      nodes: z.array(z.object({
        id: z.string().describe('Unique node ID (used in edge source/target)'),
        label: z.string().describe('Node display text'),
        shape: NodeShape.describe('Node shape style (default: rounded-rect)'),
        bgColor: z.string().optional().describe('Background color hex (default: #ffffff)'),
        borderColor: z.string().optional().describe('Border color hex (default: #374151)'),
        textColor: z.string().optional().describe('Text color hex (default: #1f2937)'),
      })).describe('List of nodes'),
      edges: z.array(z.object({
        source: z.string().describe('Source node ID'),
        target: z.string().describe('Target node ID'),
        label: z.string().optional().describe('Edge label'),
      })).describe('List of directed edges connecting nodes'),
      revision_description: z.string().optional().describe('Optional description for revision history'),
    },
    async ({ diagram_id, nodes, edges, revision_description }) => {
      // Auto-layout: simple grid layout, 200px horizontal, 150px vertical spacing
      const NODE_W = 160;
      const NODE_H = 60;
      const H_GAP = 200;
      const V_GAP = 150;
      const START_X = 80;
      const START_Y = 80;

      // Build adjacency for topological sort
      const inDegree = {};
      const adjList = {};
      for (const n of nodes) { inDegree[n.id] = 0; adjList[n.id] = []; }
      for (const e of edges) {
        adjList[e.source]?.push(e.target);
        if (e.target in inDegree) inDegree[e.target]++;
      }

      // Kahn's algorithm for topological layers
      const layers = [];
      let queue = nodes.filter(n => inDegree[n.id] === 0).map(n => n.id);
      const visited = new Set();
      while (queue.length > 0) {
        layers.push([...queue]);
        queue.forEach(id => visited.add(id));
        const next = [];
        for (const id of queue) {
          for (const nb of (adjList[id] || [])) {
            inDegree[nb]--;
            if (inDegree[nb] === 0 && !visited.has(nb)) next.push(nb);
          }
        }
        queue = next;
      }
      // Any remaining nodes (cycles) go in a final layer
      const remaining = nodes.filter(n => !visited.has(n.id)).map(n => n.id);
      if (remaining.length > 0) layers.push(remaining);

      // Assign positions
      const posMap = {};
      layers.forEach((layer, rowIdx) => {
        const totalW = layer.length * NODE_W + (layer.length - 1) * (H_GAP - NODE_W);
        const offsetX = (960 - totalW) / 2; // center horizontally in ~960px canvas
        layer.forEach((id, colIdx) => {
          posMap[id] = {
            x: Math.max(START_X, offsetX) + colIdx * H_GAP,
            y: START_Y + rowIdx * V_GAP,
          };
        });
      });

      const cells = [
        ...nodes.map(n => ({
          id: n.id,
          shape: 'flowchart-node',
          geometry: { x: posMap[n.id]?.x ?? START_X, y: posMap[n.id]?.y ?? START_Y, width: NODE_W, height: NODE_H },
          data: {
            label: n.label,
            flowchartShape: n.shape || 'rounded-rect',
            bgColor: n.bgColor || '#ffffff',
            borderColor: n.borderColor || '#374151',
            textColor: n.textColor || '#1f2937',
            fontSize: 14,
            fontWeight: 'normal',
            fontStyle: 'normal',
          },
        })),
        ...edges.map((e, i) => ({
          id: `edge-${e.source}-${e.target}-${i}`,
          shape: 'edge',
          source: e.source,
          target: e.target,
          ...(e.label ? { labels: [{ attrs: { label: { text: e.label } } }] } : {}),
        })),
      ];

      const body = { data: { cells } };
      if (revision_description) body.revision_description = revision_description;
      const result = await gw.patch(`/diagrams/${diagram_id}`, body);
      return { content: [{ type: 'text', text: JSON.stringify({ ...result, nodes_placed: nodes.length, edges_placed: edges.length, layers: layers.length }) }] };
    }
  );
}
