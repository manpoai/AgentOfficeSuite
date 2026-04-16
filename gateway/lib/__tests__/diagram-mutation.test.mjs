/**
 * Tests for diagram (flowchart) mutation semantics (7.3E)
 * Tests node/edge CRUD, auto_layout, and isolation guarantees
 * in pure-logic form (no HTTP server required).
 *
 * Run from gateway/ dir: node lib/__tests__/diagram-mutation.test.mjs
 */

let pass = 0, fail = 0;
function test(name, fn) {
  try {
    fn();
    pass++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    fail++;
    console.error(`  ✗ ${name}\n      ${err.message}`);
  }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
function assertEq(a, b, msg) {
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    throw new Error(`${msg || 'expected equality'}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
  }
}

// ── Pure mutation helpers (mirroring gateway route logic) ──

function makeDiagram(cells = []) {
  return { cells, viewport: { x: 0, y: 0, zoom: 1 } };
}

function makeNode(id, label, x = 100, y = 100) {
  return {
    id,
    shape: 'flowchart-node',
    x, y, width: 120, height: 60,
    data: { label, flowchartShape: 'rounded-rect', bgColor: '#fff', borderColor: '#374151', textColor: '#1f2937', fontSize: 14 },
  };
}

function makeEdge(id, sourceId, targetId, label = '') {
  return {
    id,
    shape: 'edge',
    source: { cell: sourceId, port: 'bottom' },
    target: { cell: targetId, port: 'top' },
    labels: label ? [{ attrs: { label: { text: label } } }] : [],
    attrs: { line: { stroke: '#94a3b8', strokeWidth: 2 } },
    router: { name: 'manhattan' },
    connector: { name: 'rounded' },
  };
}

function addNode(diagram, node) {
  return { ...diagram, cells: [...diagram.cells, node] };
}

function addEdge(diagram, edge) {
  return { ...diagram, cells: [...diagram.cells, edge] };
}

function updateCell(diagram, cellId, patch) {
  const idx = diagram.cells.findIndex(c => c.id === cellId);
  if (idx === -1) throw new Error(`CELL_NOT_FOUND: ${cellId}`);
  const cells = [...diagram.cells];
  cells[idx] = { ...cells[idx], ...patch };
  if (patch.data) cells[idx].data = { ...diagram.cells[idx].data, ...patch.data };
  return { ...diagram, cells };
}

function deleteCell(diagram, cellId) {
  const exists = diagram.cells.some(c => c.id === cellId);
  if (!exists) throw new Error(`CELL_NOT_FOUND: ${cellId}`);
  // When deleting a node, also delete connected edges
  const cells = diagram.cells.filter(c => {
    if (c.id === cellId) return false;
    if (c.shape === 'edge') {
      if (c.source?.cell === cellId || c.target?.cell === cellId) return false;
    }
    return true;
  });
  return { ...diagram, cells };
}

/** Topological auto_layout — mirrors the MCP tool's implementation */
function autoLayout(diagram) {
  const NODE_W = 160, NODE_H = 60, H_GAP = 200, V_GAP = 150, START_X = 80, START_Y = 80;
  const cells = diagram.cells;
  const nodes = cells.filter(c => c.shape !== 'edge');
  const edges = cells.filter(c => c.shape === 'edge');

  const inDegree = {}, adjList = {};
  for (const n of nodes) { inDegree[n.id] = 0; adjList[n.id] = []; }
  for (const e of edges) {
    adjList[e.source?.cell]?.push(e.target?.cell);
    if (e.target?.cell in inDegree) inDegree[e.target?.cell]++;
  }

  const layers = [];
  let queue = nodes.filter(n => inDegree[n.id] === 0).map(n => n.id);
  const visited = new Set();
  while (queue.length > 0) {
    layers.push([...queue]);
    queue.forEach(id => visited.add(id));
    const next = [];
    for (const id of queue) {
      for (const nxt of (adjList[id] || [])) {
        if (!visited.has(nxt)) {
          inDegree[nxt]--;
          if (inDegree[nxt] === 0) next.push(nxt);
        }
      }
    }
    queue = next;
  }
  // Nodes not reached in topological order go last
  const unplaced = nodes.filter(n => !visited.has(n.id));
  if (unplaced.length) layers.push(unplaced.map(n => n.id));

  const positions = {};
  layers.forEach((layer, li) => {
    const y = START_Y + li * (NODE_H + V_GAP);
    const totalW = layer.length * NODE_W + (layer.length - 1) * (H_GAP - NODE_W);
    const startX = START_X + Math.max(0, (960 - totalW) / 2 - START_X);
    layer.forEach((id, ci) => {
      positions[id] = { x: startX + ci * H_GAP, y };
    });
  });

  const updatedCells = cells.map(c => {
    if (c.shape === 'edge') return c;
    const pos = positions[c.id];
    if (!pos) return c;
    return { ...c, x: pos.x, y: pos.y, width: NODE_W, height: NODE_H };
  });
  return { ...diagram, cells: updatedCells };
}

// ── Tests: add_node / update_node / delete_node ──

test('add_node: appends node to cells array', () => {
  const diagram = makeDiagram();
  const result = addNode(diagram, makeNode('n1', 'Start'));
  assertEq(result.cells.length, 1);
  assertEq(result.cells[0].id, 'n1');
});

test('add_node: multiple nodes have distinct IDs and positions', () => {
  let diagram = makeDiagram();
  diagram = addNode(diagram, makeNode('n1', 'A', 100, 100));
  diagram = addNode(diagram, makeNode('n2', 'B', 300, 100));
  assertEq(diagram.cells.length, 2);
  assert(diagram.cells[0].x !== diagram.cells[1].x, 'nodes at different x positions');
});

test('update_node: patches label without affecting other cells', () => {
  let diagram = makeDiagram([makeNode('n1', 'Old Label'), makeNode('n2', 'Other')]);
  diagram = updateCell(diagram, 'n1', { data: { label: 'New Label' } });
  assertEq(diagram.cells[0].data.label, 'New Label');
  assertEq(diagram.cells[1].data.label, 'Other', 'n2 unchanged');
});

test('update_node: throws CELL_NOT_FOUND for unknown id', () => {
  const diagram = makeDiagram([makeNode('n1', 'A')]);
  try {
    updateCell(diagram, 'ghost', { data: { label: 'x' } });
    assert(false, 'should throw');
  } catch (e) {
    assert(e.message.includes('CELL_NOT_FOUND'), `got: ${e.message}`);
  }
});

test('delete_node: removes node from cells', () => {
  const diagram = makeDiagram([makeNode('n1', 'A'), makeNode('n2', 'B')]);
  const result = deleteCell(diagram, 'n1');
  assertEq(result.cells.length, 1);
  assertEq(result.cells[0].id, 'n2');
});

test('delete_node: removes connected edges when node is deleted', () => {
  let diagram = makeDiagram([makeNode('n1', 'A'), makeNode('n2', 'B'), makeNode('n3', 'C')]);
  diagram = addEdge(diagram, makeEdge('e1', 'n1', 'n2'));
  diagram = addEdge(diagram, makeEdge('e2', 'n2', 'n3'));
  // Delete n2 — both e1 and e2 should be removed
  const result = deleteCell(diagram, 'n2');
  const edgesRemaining = result.cells.filter(c => c.shape === 'edge');
  assertEq(edgesRemaining.length, 0, 'all connected edges removed');
  assertEq(result.cells.length, 2, 'only n1 and n3 remain');
});

test('delete_node: unconnected edges survive deletion', () => {
  let diagram = makeDiagram([makeNode('n1', 'A'), makeNode('n2', 'B'), makeNode('n3', 'C')]);
  diagram = addEdge(diagram, makeEdge('e1', 'n1', 'n2'));
  diagram = addEdge(diagram, makeEdge('e2', 'n2', 'n3'));
  // Delete n1 — only e1 (connected to n1) is removed; e2 (n2→n3) stays
  const result = deleteCell(diagram, 'n1');
  const edgesRemaining = result.cells.filter(c => c.shape === 'edge');
  assertEq(edgesRemaining.length, 1, 'one edge remains');
  assertEq(edgesRemaining[0].id, 'e2', 'e2 (n2→n3) survives');
});

// ── Tests: add_edge / update_edge / delete_edge ──

test('add_edge: connects two existing nodes', () => {
  let diagram = makeDiagram([makeNode('n1', 'Start'), makeNode('n2', 'End')]);
  diagram = addEdge(diagram, makeEdge('e1', 'n1', 'n2', 'Yes'));
  const edge = diagram.cells.find(c => c.id === 'e1');
  assertEq(edge.source.cell, 'n1');
  assertEq(edge.target.cell, 'n2');
  assertEq(edge.labels[0].attrs.label.text, 'Yes');
});

test('update_edge: patches edge label', () => {
  let diagram = makeDiagram([makeNode('n1', 'A'), makeNode('n2', 'B')]);
  diagram = addEdge(diagram, makeEdge('e1', 'n1', 'n2'));
  // Patch labels directly
  const cells = diagram.cells.map(c =>
    c.id === 'e1'
      ? { ...c, labels: [{ attrs: { label: { text: 'Patched' } } }] }
      : c
  );
  const result = { ...diagram, cells };
  const edge = result.cells.find(c => c.id === 'e1');
  assertEq(edge.labels[0].attrs.label.text, 'Patched');
});

test('delete_edge: removes edge without affecting nodes', () => {
  let diagram = makeDiagram([makeNode('n1', 'A'), makeNode('n2', 'B')]);
  diagram = addEdge(diagram, makeEdge('e1', 'n1', 'n2'));
  const result = deleteCell(diagram, 'e1');
  const nodes = result.cells.filter(c => c.shape !== 'edge');
  assertEq(nodes.length, 2, 'both nodes intact');
  const edges = result.cells.filter(c => c.shape === 'edge');
  assertEq(edges.length, 0, 'edge removed');
});

// ── Tests: auto_layout ──

test('auto_layout: positions nodes in layers (no manual positions override)', () => {
  let diagram = makeDiagram([
    makeNode('n1', 'Start', 0, 0),
    makeNode('n2', 'Step', 0, 0),
    makeNode('n3', 'End', 0, 0),
  ]);
  diagram = addEdge(diagram, makeEdge('e1', 'n1', 'n2'));
  diagram = addEdge(diagram, makeEdge('e2', 'n2', 'n3'));
  const result = autoLayout(diagram);
  const nodes = result.cells.filter(c => c.shape !== 'edge');
  // After layout, nodes in different layers have different y positions
  const ys = nodes.map(n => n.y);
  assert(new Set(ys).size === 3, 'all three nodes have distinct y positions (different layers)');
});

test('auto_layout: nodes in same layer share y position', () => {
  // n1 → n2, n1 → n3 (n2 and n3 are in the same layer)
  let diagram = makeDiagram([
    makeNode('n1', 'Root', 0, 0),
    makeNode('n2', 'Left', 0, 0),
    makeNode('n3', 'Right', 0, 0),
  ]);
  diagram = addEdge(diagram, makeEdge('e1', 'n1', 'n2'));
  diagram = addEdge(diagram, makeEdge('e2', 'n1', 'n3'));
  const result = autoLayout(diagram);
  const nodes = result.cells.filter(c => c.shape !== 'edge');
  const nodeById = Object.fromEntries(nodes.map(n => [n.id, n]));
  assertEq(nodeById.n2.y, nodeById.n3.y, 'n2 and n3 share y (same layer)');
  assert(nodeById.n1.y < nodeById.n2.y, 'root is above its children');
});

test('auto_layout: preserves edge count', () => {
  let diagram = makeDiagram([makeNode('n1', 'A'), makeNode('n2', 'B'), makeNode('n3', 'C')]);
  diagram = addEdge(diagram, makeEdge('e1', 'n1', 'n2'));
  diagram = addEdge(diagram, makeEdge('e2', 'n2', 'n3'));
  const result = autoLayout(diagram);
  const edges = result.cells.filter(c => c.shape === 'edge');
  assertEq(edges.length, 2, 'edges preserved after layout');
});

test('auto_layout: orphan nodes (no edges) are included at end', () => {
  let diagram = makeDiagram([
    makeNode('n1', 'Connected-A'),
    makeNode('n2', 'Connected-B'),
    makeNode('orphan', 'Orphan'),
  ]);
  diagram = addEdge(diagram, makeEdge('e1', 'n1', 'n2'));
  const result = autoLayout(diagram);
  const orphanNode = result.cells.find(c => c.id === 'orphan');
  assertNotNull(orphanNode, 'orphan node still present after layout');
  assert(typeof orphanNode.x === 'number', 'orphan has x position');
  assert(typeof orphanNode.y === 'number', 'orphan has y position');
});

function assertNotNull(v, msg) { if (v == null) throw new Error(msg || 'expected non-null'); }

// ── Isolation: human edits node A, agent edits node B ──

test('isolation: agent edit of node B does not affect node A (human position)', () => {
  const humanPosition = { x: 350, y: 200 };
  const nodeA = { ...makeNode('n-A', 'Human Node'), ...humanPosition };
  let diagram = makeDiagram([nodeA, makeNode('n-B', 'Agent Node', 600, 200)]);

  // Agent updates only n-B
  diagram = updateCell(diagram, 'n-B', { data: { label: 'Agent Updated' } });

  const updatedNodeA = diagram.cells.find(c => c.id === 'n-A');
  assertEq(updatedNodeA.x, humanPosition.x, 'n-A x position unchanged');
  assertEq(updatedNodeA.y, humanPosition.y, 'n-A y position unchanged');
  assertEq(updatedNodeA.data.label, 'Human Node', 'n-A label unchanged');
});

console.log(`\n[diagram-mutation] ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
