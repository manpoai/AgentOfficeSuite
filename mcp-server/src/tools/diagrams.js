import { z } from 'zod';

const NodeShape = z.enum([
  'rounded-rect', 'rect', 'diamond', 'ellipse', 'parallelogram',
  'cylinder', 'hexagon', 'cloud', 'terminal',
]).optional().default('rounded-rect');

const NodePatch = {
  label: z.string().optional().describe('Node display text'),
  shape: NodeShape.describe('Node shape style'),
  bgColor: z.string().optional().describe('Background color hex'),
  borderColor: z.string().optional().describe('Border color hex'),
  textColor: z.string().optional().describe('Text color hex'),
  x: z.number().optional().describe('X position'),
  y: z.number().optional().describe('Y position'),
  width: z.number().optional().describe('Width in pixels'),
  height: z.number().optional().describe('Height in pixels'),
};

export function registerDiagramTools(server, gw) {
  server.tool(
    'create_diagram',
    'Create a new flowchart/diagram canvas. Returns the diagram_id.',
    { title: z.string().describe('Diagram title') },
    async ({ title }) => {
      const result = await gw.post('/diagrams', { title });
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
  );

  server.tool(
    'get_diagram',
    'Read a diagram and all its nodes/edges. Returns cells array with id, shape, position, label, and connection info.',
    { diagram_id: z.string().describe('Diagram ID') },
    async ({ diagram_id }) => {
      const result = await gw.get(`/diagrams/${diagram_id}`);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
  );

  server.tool(
    'update_diagram',
    'Replace the full diagram content (all nodes and edges at once). Use get_diagram first to get existing cells, modify them, and pass the updated cells array back.',
    {
      diagram_id: z.string().describe('Diagram ID'),
      cells: z.array(z.object({
        id: z.string(),
        shape: z.string().optional(),
        data: z.object({
          label: z.string().optional(),
          flowchartShape: NodeShape,
          bgColor: z.string().optional(),
          borderColor: z.string().optional(),
          textColor: z.string().optional(),
        }).optional(),
        source: z.string().optional(),
        target: z.string().optional(),
        x: z.number().optional(),
        y: z.number().optional(),
        width: z.number().optional(),
        height: z.number().optional(),
      })).describe('Full cells array (nodes + edges)'),
      title: z.string().optional().describe('Update the diagram title'),
      revision_description: z.string().optional(),
    },
    async ({ diagram_id, cells, title, revision_description }) => {
      const body = { data: { cells } };
      if (title !== undefined) body.title = title;
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
        id: z.string().describe('Unique node ID'),
        label: z.string().describe('Node display text'),
        shape: NodeShape,
        bgColor: z.string().optional(),
        borderColor: z.string().optional(),
        textColor: z.string().optional(),
      })),
      edges: z.array(z.object({
        source: z.string(),
        target: z.string(),
        label: z.string().optional(),
      })),
      revision_description: z.string().optional(),
    },
    async ({ diagram_id, nodes, edges, revision_description }) => {
      const NODE_W = 160, NODE_H = 60, H_GAP = 200, V_GAP = 150, START_X = 80, START_Y = 80;
      const inDegree = {}, adjList = {};
      for (const n of nodes) { inDegree[n.id] = 0; adjList[n.id] = []; }
      for (const e of edges) { adjList[e.source]?.push(e.target); if (e.target in inDegree) inDegree[e.target]++; }
      const layers = [];
      let queue = nodes.filter(n => inDegree[n.id] === 0).map(n => n.id);
      const visited = new Set();
      while (queue.length > 0) {
        layers.push([...queue]);
        queue.forEach(id => visited.add(id));
        const next = [];
        for (const id of queue) { for (const nb of (adjList[id] || [])) { inDegree[nb]--; if (inDegree[nb] === 0 && !visited.has(nb)) next.push(nb); } }
        queue = next;
      }
      const remaining = nodes.filter(n => !visited.has(n.id)).map(n => n.id);
      if (remaining.length > 0) layers.push(remaining);
      const posMap = {};
      layers.forEach((layer, rowIdx) => {
        const totalW = layer.length * NODE_W + (layer.length - 1) * (H_GAP - NODE_W);
        const offsetX = Math.max(START_X, (960 - totalW) / 2);
        layer.forEach((id, colIdx) => { posMap[id] = { x: offsetX + colIdx * H_GAP, y: START_Y + rowIdx * V_GAP }; });
      });
      const cells = [
        ...nodes.map(n => ({ id: n.id, shape: 'flowchart-node', x: posMap[n.id]?.x ?? START_X, y: posMap[n.id]?.y ?? START_Y, width: NODE_W, height: NODE_H, data: { label: n.label, flowchartShape: n.shape || 'rounded-rect', bgColor: n.bgColor || '#ffffff', borderColor: n.borderColor || '#374151', textColor: n.textColor || '#1f2937', fontSize: 14, fontWeight: 'normal', fontStyle: 'normal' } })),
        ...edges.map((e, i) => ({ id: `edge-${e.source}-${e.target}-${i}`, shape: 'edge', source: e.source, target: e.target, ...(e.label ? { labels: [{ attrs: { label: { text: e.label } } }] } : {}) })),
      ];
      const body = { data: { cells } };
      if (revision_description) body.revision_description = revision_description;
      const result = await gw.patch(`/diagrams/${diagram_id}`, body);
      return { content: [{ type: 'text', text: JSON.stringify({ ...result, nodes_placed: nodes.length, edges_placed: edges.length, layers: layers.length }) }] };
    }
  );

  // ─── Node-level tools ────────────────────────────

  server.tool(
    'add_node',
    'Add a single node to a diagram. If no position given, place it at (x=80, y=80) — use update_node to reposition if needed.',
    {
      diagram_id: z.string().describe('Diagram ID'),
      id: z.string().describe('Unique node ID (you choose — must not already exist in the diagram)'),
      label: z.string().describe('Node display text'),
      shape: NodeShape,
      bgColor: z.string().optional().describe('Background color hex (default #ffffff)'),
      borderColor: z.string().optional().describe('Border color hex (default #374151)'),
      textColor: z.string().optional().describe('Text color hex (default #1f2937)'),
      x: z.number().optional().describe('X position (default 80)'),
      y: z.number().optional().describe('Y position (default 80)'),
      width: z.number().optional().describe('Width (default 160)'),
      height: z.number().optional().describe('Height (default 60)'),
    },
    async ({ diagram_id, ...spec }) => {
      const result = await gw.post(`/diagrams/${diagram_id}/nodes`, spec);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
  );

  server.tool(
    'update_node',
    'Update a node in a diagram by its ID. Patches only the fields you provide — other nodes are untouched.',
    {
      diagram_id: z.string().describe('Diagram ID'),
      node_id: z.string().describe('Node ID to update'),
      ...NodePatch,
    },
    async ({ diagram_id, node_id, ...patch }) => {
      const result = await gw.patch(`/diagrams/${diagram_id}/nodes/${node_id}`, patch);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
  );

  server.tool(
    'delete_node',
    'Delete a node from a diagram. All edges connected to this node are also deleted automatically.',
    {
      diagram_id: z.string().describe('Diagram ID'),
      node_id: z.string().describe('Node ID to delete'),
    },
    async ({ diagram_id, node_id }) => {
      const result = await gw.del(`/diagrams/${diagram_id}/nodes/${node_id}`);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
  );

  // ─── Edge-level tools ────────────────────────────

  server.tool(
    'add_edge',
    'Add a directed edge between two existing nodes in a diagram.',
    {
      diagram_id: z.string().describe('Diagram ID'),
      id: z.string().describe('Unique edge ID'),
      source: z.string().describe('Source node ID'),
      target: z.string().describe('Target node ID'),
      label: z.string().optional().describe('Edge label text'),
    },
    async ({ diagram_id, ...spec }) => {
      const result = await gw.post(`/diagrams/${diagram_id}/edges`, spec);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
  );

  server.tool(
    'update_edge',
    'Update an edge in a diagram — change its source, target, or label.',
    {
      diagram_id: z.string().describe('Diagram ID'),
      edge_id: z.string().describe('Edge ID to update'),
      source: z.string().optional().describe('New source node ID'),
      target: z.string().optional().describe('New target node ID'),
      label: z.string().optional().describe('New edge label'),
    },
    async ({ diagram_id, edge_id, ...patch }) => {
      const result = await gw.patch(`/diagrams/${diagram_id}/edges/${edge_id}`, patch);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
  );

  server.tool(
    'delete_edge',
    'Delete an edge from a diagram by its ID.',
    {
      diagram_id: z.string().describe('Diagram ID'),
      edge_id: z.string().describe('Edge ID to delete'),
    },
    async ({ diagram_id, edge_id }) => {
      const result = await gw.del(`/diagrams/${diagram_id}/edges/${edge_id}`);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
  );

  server.tool(
    'auto_layout',
    'Re-run automatic topological layout on an existing diagram. Recomputes all node positions based on the current graph structure. WARNING: this overwrites all manual positioning.',
    {
      diagram_id: z.string().describe('Diagram ID'),
    },
    async ({ diagram_id }) => {
      const current = await gw.get(`/diagrams/${diagram_id}`);
      const cells = current.data?.cells || [];
      const NODE_W = 160, NODE_H = 60, H_GAP = 200, V_GAP = 150, START_X = 80, START_Y = 80;
      const nodes = cells.filter(c => c.shape !== 'edge');
      const edges = cells.filter(c => c.shape === 'edge');
      const inDegree = {}, adjList = {};
      for (const n of nodes) { inDegree[n.id] = 0; adjList[n.id] = []; }
      for (const e of edges) { adjList[e.source]?.push(e.target); if (e.target in inDegree) inDegree[e.target]++; }
      const layers = [];
      let queue = nodes.filter(n => inDegree[n.id] === 0).map(n => n.id);
      const visited = new Set();
      while (queue.length > 0) {
        layers.push([...queue]);
        queue.forEach(id => visited.add(id));
        const next = [];
        for (const id of queue) { for (const nb of (adjList[id] || [])) { inDegree[nb]--; if (inDegree[nb] === 0 && !visited.has(nb)) next.push(nb); } }
        queue = next;
      }
      const remaining = nodes.filter(n => !visited.has(n.id)).map(n => n.id);
      if (remaining.length > 0) layers.push(remaining);
      const posMap = {};
      layers.forEach((layer, rowIdx) => {
        const totalW = layer.length * NODE_W + (layer.length - 1) * (H_GAP - NODE_W);
        const offsetX = Math.max(START_X, (960 - totalW) / 2);
        layer.forEach((id, colIdx) => { posMap[id] = { x: offsetX + colIdx * H_GAP, y: START_Y + rowIdx * V_GAP }; });
      });
      const updatedCells = cells.map(c => {
        if (c.shape === 'edge' || !posMap[c.id]) return c;
        return { ...c, x: posMap[c.id].x, y: posMap[c.id].y, width: c.width || c.geometry?.width || NODE_W, height: c.height || c.geometry?.height || NODE_H, geometry: undefined };
      });
      const result = await gw.patch(`/diagrams/${diagram_id}`, { data: { cells: updatedCells, viewport: current.data?.viewport } });
      return { content: [{ type: 'text', text: JSON.stringify({ ...result, nodes_repositioned: nodes.length }) }] };
    }
  );
}
