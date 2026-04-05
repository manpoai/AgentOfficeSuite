/**
 * Mindmap tree data structure and layout utilities.
 *
 * The tree is stored as nested objects in the root node's data.
 * Each tree operation updates the data, then re-renders all nodes/edges on the graph.
 */
import type { Graph, Node } from '@antv/x6';
import { MINDMAP_COLORS } from '../constants';
import { getT } from '@/lib/i18n';

export interface MindmapTreeNode {
  id: string;
  label: string;
  collapsed: boolean;
  children: MindmapTreeNode[];
}

let idCounter = 0;
function newMmId() {
  return `mm_${Date.now().toString(36)}_${++idCounter}`;
}

// ── Tree CRUD ──

export function createRootTree(label?: string): MindmapTreeNode {
  if (!label) label = getT()('diagram.centralTopic');
  return { id: newMmId(), label, collapsed: false, children: [] };
}

function findNode(tree: MindmapTreeNode, id: string): MindmapTreeNode | null {
  if (tree.id === id) return tree;
  for (const child of tree.children) {
    const found = findNode(child, id);
    if (found) return found;
  }
  return null;
}

function findParent(tree: MindmapTreeNode, id: string): MindmapTreeNode | null {
  for (const child of tree.children) {
    if (child.id === id) return tree;
    const found = findParent(child, id);
    if (found) return found;
  }
  return null;
}

export function addChild(tree: MindmapTreeNode, parentId: string, label = ''): string | null {
  const parent = findNode(tree, parentId);
  if (!parent) return null;
  const id = newMmId();
  parent.children.push({ id, label, collapsed: false, children: [] });
  parent.collapsed = false;
  return id;
}

export function addSibling(tree: MindmapTreeNode, nodeId: string, label = ''): string | null {
  const parent = findParent(tree, nodeId);
  if (!parent) return null;
  const idx = parent.children.findIndex(c => c.id === nodeId);
  if (idx === -1) return null;
  const id = newMmId();
  parent.children.splice(idx + 1, 0, { id, label, collapsed: false, children: [] });
  return id;
}

export function removeNode(tree: MindmapTreeNode, nodeId: string): boolean {
  const parent = findParent(tree, nodeId);
  if (!parent) return false;
  parent.children = parent.children.filter(c => c.id !== nodeId);
  return true;
}

export function updateLabel(tree: MindmapTreeNode, nodeId: string, label: string) {
  const node = findNode(tree, nodeId);
  if (node) node.label = label;
}

export function toggleCollapse(tree: MindmapTreeNode, nodeId: string) {
  const node = findNode(tree, nodeId);
  if (node) node.collapsed = !node.collapsed;
}

// ── Layout & Rendering ──

interface LayoutNode {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  isRoot: boolean;
  label: string;
  bgColor: string;
  borderColor: string;
  textColor: string;
  collapsed: boolean;
  childCount: number;
  depth: number;
}

interface LayoutEdge {
  source: string;
  target: string;
}

const H_GAP = 40;
const V_GAP = 16;
const NODE_H = 36;
const ROOT_W = 180;
const ROOT_H = 46;

function measureWidth(label: string, isRoot: boolean): number {
  const charW = isRoot ? 12 : 10;
  return Math.max(isRoot ? ROOT_W : 80, label.length * charW + 32);
}

interface SubtreeLayout {
  nodes: LayoutNode[];
  edges: LayoutEdge[];
  height: number;
}

function layoutSubtree(
  tree: MindmapTreeNode,
  x: number,
  y: number,
  depth: number,
): SubtreeLayout {
  const isRoot = depth === 0;
  const w = measureWidth(tree.label, isRoot);
  const h = isRoot ? ROOT_H : NODE_H;
  const color = MINDMAP_COLORS[depth % MINDMAP_COLORS.length];

  const thisNode: LayoutNode = {
    id: tree.id,
    x,
    y,
    width: w,
    height: h,
    isRoot,
    label: tree.label,
    bgColor: isRoot ? '#dbeafe' : color.bg,
    borderColor: isRoot ? '#3b82f6' : color.border,
    textColor: isRoot ? '#1e40af' : color.text,
    collapsed: tree.collapsed,
    childCount: tree.children.length,
    depth,
  };

  if (tree.collapsed || tree.children.length === 0) {
    return { nodes: [thisNode], edges: [], height: h };
  }

  const childX = x + w + H_GAP;
  const childLayouts: SubtreeLayout[] = [];
  let totalChildH = 0;

  for (let i = 0; i < tree.children.length; i++) {
    const cl = layoutSubtree(tree.children[i], childX, 0, depth + 1);
    childLayouts.push(cl);
    totalChildH += cl.height;
    if (i > 0) totalChildH += V_GAP;
  }

  // Center children vertically relative to parent
  const totalH = Math.max(h, totalChildH);
  const childStartY = y + (h - totalChildH) / 2;

  const allNodes: LayoutNode[] = [thisNode];
  const allEdges: LayoutEdge[] = [];
  let curY = childStartY;

  for (const cl of childLayouts) {
    const offsetY = curY;
    for (const n of cl.nodes) {
      allNodes.push({ ...n, y: n.y + offsetY });
    }
    allEdges.push(...cl.edges);
    allEdges.push({ source: tree.id, target: cl.nodes[0].id });
    curY += cl.height + V_GAP;
  }

  return { nodes: allNodes, edges: allEdges, height: totalH };
}

/**
 * Render a mindmap tree onto an X6 graph.
 * Uses incremental update: existing nodes are moved/updated in place,
 * new nodes are added, removed nodes are deleted. This avoids the
 * destroy-and-recreate cycle that causes React component unmount race
 * conditions with X6's event system.
 */
export function renderMindmapToGraph(
  graph: Graph,
  tree: MindmapTreeNode,
  rootX: number,
  rootY: number,
  mindmapGroupId: string,
) {
  // Collect all IDs that belong to this mindmap tree
  const treeIds = new Set<string>();
  const collectIds = (node: MindmapTreeNode) => {
    treeIds.add(node.id);
    node.children.forEach(collectIds);
  };
  collectIds(tree);

  // Layout first (before touching graph) so we have all data ready
  const layout = layoutSubtree(tree, rootX, rootY, 0);
  const layoutNodeMap = new Map(layout.nodes.map(n => [n.id, n]));

  // Build a set of desired edge keys for diffing
  const desiredEdgeKeys = new Set(layout.edges.map(e => `${e.source}->${e.target}`));

  graph.startBatch('mindmap-render');

  // ── Step 1: Collect existing mindmap cells ──
  const existingNodes = new Map<string, Node>();
  const existingEdges: import('@antv/x6').Edge[] = [];
  for (const c of graph.getCells()) {
    const data = c.getData();
    if (data?.mindmapGroupId !== mindmapGroupId && !treeIds.has(c.id)) continue;
    if (c.isNode()) {
      existingNodes.set(c.id, c as Node);
    } else if (c.isEdge()) {
      existingEdges.push(c as import('@antv/x6').Edge);
    }
  }

  // ── Step 2: Remove edges that no longer exist ──
  for (const edge of existingEdges) {
    const src = typeof edge.getSourceCellId === 'function' ? edge.getSourceCellId() : (edge.getSource() as any)?.cell;
    const tgt = typeof edge.getTargetCellId === 'function' ? edge.getTargetCellId() : (edge.getTarget() as any)?.cell;
    const key = `${src}->${tgt}`;
    if (!desiredEdgeKeys.has(key)) {
      graph.removeCells([edge]);
    }
  }

  // ── Step 3: Remove nodes that are no longer in the tree ──
  for (const [id, node] of existingNodes) {
    if (!layoutNodeMap.has(id)) {
      graph.removeCells([node]);
      existingNodes.delete(id);
    }
  }

  // ── Step 4: Update existing nodes or add new ones ──
  for (const n of layout.nodes) {
    const nodeData = {
      label: n.label,
      isRoot: n.isRoot,
      bgColor: n.bgColor,
      borderColor: n.borderColor,
      textColor: n.textColor,
      fontSize: n.isRoot ? 16 : 14,
      fontWeight: n.isRoot ? 'bold' : 'normal',
      collapsed: n.collapsed,
      childCount: n.childCount,
      mindmapGroupId,
      treeNodeId: n.id,
      depth: n.depth,
    };

    const existing = existingNodes.get(n.id);
    if (existing) {
      // Update in place — no destroy/recreate.
      // 1. Silently update model (no events → no notifyCellEvent crash)
      existing.prop('position', { x: n.x, y: n.y }, { silent: true });
      existing.prop('size', { width: n.width, height: n.height }, { silent: true });
      // 2. Directly update the SVG view (bypasses event system entirely)
      const view = graph.findViewByCell(existing.id);
      if (view) {
        (view as any).translate();
        (view as any).resize();
      }
      // 3. Non-silent setData triggers React re-render for label/colors/etc.
      existing.setData(nodeData);
    } else {
      // New node — add it
      graph.addNode({
        id: n.id,
        shape: n.isRoot ? 'mindmap-root' : 'mindmap-node',
        x: n.x,
        y: n.y,
        width: n.width,
        height: n.height,
        data: nodeData,
      });
    }
  }

  // ── Step 5: Add missing edges ──
  // Build set of existing edge keys (after removal)
  const currentEdgeKeys = new Set<string>();
  for (const c of graph.getCells()) {
    if (!c.isEdge()) continue;
    const data = c.getData();
    if (data?.mindmapGroupId !== mindmapGroupId) continue;
    const src = typeof (c as any).getSourceCellId === 'function' ? (c as any).getSourceCellId() : ((c as any).getSource() as any)?.cell;
    const tgt = typeof (c as any).getTargetCellId === 'function' ? (c as any).getTargetCellId() : ((c as any).getTarget() as any)?.cell;
    currentEdgeKeys.add(`${src}->${tgt}`);
  }

  for (const e of layout.edges) {
    const key = `${e.source}->${e.target}`;
    if (currentEdgeKeys.has(key)) continue;
    graph.addEdge({
      source: { cell: e.source, port: 'right' },
      target: { cell: e.target, port: 'left' },
      router: { name: 'normal' },
      connector: { name: 'smooth' },
      attrs: {
        line: {
          stroke: '#94a3b8',
          strokeWidth: 1.5,
          targetMarker: null,
        },
      },
      data: { mindmapGroupId },
    });
  }

  // Store tree on root node so it survives save/reload
  const rootNode = graph.getCellById(tree.id);
  if (rootNode) {
    rootNode.setData({ ...rootNode.getData(), mindmapTree: tree }, { silent: true });
  }

  graph.stopBatch('mindmap-render');
}
