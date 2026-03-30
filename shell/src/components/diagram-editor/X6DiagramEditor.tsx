'use client';

import { useState, useEffect, useCallback, useRef, Component, type ErrorInfo, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Graph, Node, Edge, Cell } from '@antv/x6';
import * as gw from '@/lib/api/gateway';
import {
  ArrowLeft, ArrowLeftToLine, ArrowRightToLine,
  MoreHorizontal, Link2, Download, Trash2, ChevronRight,
  Undo2, Redo2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useT } from '@/lib/i18n';
import { useX6Graph } from './hooks/useX6Graph';
import { useAutoSave } from './hooks/useAutoSave';
import { LeftToolbar, type ActiveTool } from './components/LeftToolbar';
import { FloatingToolbar } from './components/FloatingToolbar';
import { ZoomBar } from './components/ZoomBar';
import { ShapePreview } from './components/ShapePreview';
import {
  SHAPE_META, DEFAULT_NODE_COLOR, DEFAULT_CONNECTOR,
  CONNECTOR_META,
  type FlowchartShape, type ConnectorType,
} from './constants';
import { quickCreateNode } from './utils/quick-create';
import {
  createRootTree, addChild, addSibling, removeNode,
  updateLabel, toggleCollapse, renderMindmapToGraph,
  type MindmapTreeNode,
} from './utils/mindmap-tree';
import { isReactFlowData, migrateToX6 } from './utils/migration';

// ─── Types ──────────────────────────────────────────
interface X6DiagramEditorProps {
  diagramId: string;
  breadcrumb?: { id: string; title: string }[];
  onBack?: () => void;
  onDeleted?: () => void;
  onCopyLink?: () => void;
  docListVisible?: boolean;
  onToggleDocList?: () => void;
}

let nodeIdCounter = 0;
function newNodeId() {
  return `node_${Date.now().toString(36)}_${++nodeIdCounter}`;
}

// ─── Helpers ────────────────────────────────────────
function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

// ─── Main Component ─────────────────────────────────
// ─── Error Boundary ──
class DiagramErrorBoundary extends Component<
  { children: ReactNode; fallback?: ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('DiagramEditor crashed:', error, info);
  }
  render() {
    if (this.state.error) {
      return (
        <div className="flex items-center justify-center h-full bg-gray-50">
          <div className="text-center p-8 max-w-md">
            <p className="text-gray-600 text-sm mb-2">图表编辑器加载失败</p>
            <p className="text-xs text-gray-400 font-mono break-all">{this.state.error.message}</p>
            <button
              className="mt-4 px-4 py-2 bg-blue-600 text-white rounded text-sm hover:bg-blue-700"
              onClick={() => this.setState({ error: null })}
            >
              重试
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function X6DiagramEditor(props: X6DiagramEditorProps) {
  return (
    <DiagramErrorBoundary>
      <X6DiagramEditorInner {...props} />
    </DiagramErrorBoundary>
  );
}

function X6DiagramEditorInner({
  diagramId, breadcrumb, onBack, onDeleted, onCopyLink, docListVisible, onToggleDocList,
}: X6DiagramEditorProps) {
  const { t } = useT();
  const queryClient = useQueryClient();

  // Refs
  const containerRef = useRef<HTMLDivElement>(null);
  const minimapRef = useRef<HTMLDivElement>(null);

  // X6 graph
  const { graph, ready, error: graphError } = useX6Graph(containerRef, minimapRef);

  // State
  const [activeTool, setActiveTool] = useState<ActiveTool>('select');
  const [activeConnector, setActiveConnector] = useState<ConnectorType>(DEFAULT_CONNECTOR);
  const [showMenu, setShowMenu] = useState(false);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [migrationNeeded, setMigrationNeeded] = useState(false);

  // Mindmap state
  const mindmapTreeRef = useRef<MindmapTreeNode | null>(null);
  const mindmapGroupIdRef = useRef<string>('');
  const startEditRef = useRef<((node: Node, initialKey?: string) => void) | null>(null);
  const [selectedMindmapNode, setSelectedMindmapNode] = useState<string | null>(null);

  // Auto-save
  const { save, lastSaved, saving } = useAutoSave(graph, diagramId);

  // ─── Load diagram data ──
  const { data: diagram } = useQuery({
    queryKey: ['diagram', diagramId],
    queryFn: () => gw.getDiagram(diagramId),
  });

  // Load data into graph
  useEffect(() => {
    if (!graph || !ready || !diagram) return;

    const rawData = (diagram as any).data;
    if (!rawData) return;

    if (isReactFlowData(rawData)) {
      setMigrationNeeded(true);
      // Auto-migrate
      const x6Data = migrateToX6(rawData);
      graph.fromJSON(x6Data);
      if (x6Data.viewport) {
        graph.translate(x6Data.viewport.x || 0, x6Data.viewport.y || 0);
        graph.zoomTo(x6Data.viewport.zoom || 1);
      }
      return;
    }

    // X6 native format
    if (rawData.cells) {
      graph.fromJSON(rawData);
    }
    if (rawData.viewport) {
      graph.translate(rawData.viewport.x || 0, rawData.viewport.y || 0);
      graph.zoomTo(rawData.viewport.zoom || 1);
    }

    // Restore mindmap tree if present
    const mmRoot = graph.getNodes().find(n => n.getData()?.mindmapGroupId && n.getData()?.isRoot);
    if (mmRoot) {
      // Re-build tree from stored data if exists
      const storedTree = mmRoot.getData()?.mindmapTree;
      if (storedTree) {
        mindmapTreeRef.current = storedTree;
        mindmapGroupIdRef.current = mmRoot.getData()?.mindmapGroupId;
      }
    }
  }, [graph, ready, diagram]);

  // ─── Mindmap keyboard handlers ──
  // (must be declared before the keyboard useEffect that references them)
  const handleMindmapTab = useCallback(() => {
    if (!graph || !mindmapTreeRef.current) return;
    const selected = graph.getSelectedCells();
    if (selected.length !== 1 || !selected[0].isNode()) return;
    const node = selected[0] as Node;
    const data = node.getData();
    if (!data?.mindmapGroupId) return;

    const newId = addChild(mindmapTreeRef.current, node.id);
    if (newId) {
      const rootNode = graph.getNodes().find(n => n.getData()?.isRoot && n.getData()?.mindmapGroupId === data.mindmapGroupId);
      renderMindmapToGraph(graph, mindmapTreeRef.current, rootNode?.position().x || 0, rootNode?.position().y || 0, data.mindmapGroupId);

      const newNode = graph.getCellById(newId);
      if (newNode) graph.select(newNode);
    }
  }, [graph]);

  const handleMindmapEnter = useCallback((e?: KeyboardEvent) => {
    if (!graph || !mindmapTreeRef.current) return;
    const selected = graph.getSelectedCells();
    if (selected.length !== 1 || !selected[0].isNode()) return;
    const node = selected[0] as Node;
    const data = node.getData();
    if (!data?.mindmapGroupId) return;
    if (data?.isRoot) return;

    e?.preventDefault();

    const newId = addSibling(mindmapTreeRef.current, node.id);
    if (newId) {
      const rootNode = graph.getNodes().find(n => n.getData()?.isRoot && n.getData()?.mindmapGroupId === data.mindmapGroupId);
      renderMindmapToGraph(graph, mindmapTreeRef.current, rootNode?.position().x || 0, rootNode?.position().y || 0, data.mindmapGroupId);

      const newNode = graph.getCellById(newId);
      if (newNode) graph.select(newNode);
    }
  }, [graph]);

  const handleMindmapToggleCollapse = useCallback(() => {
    if (!graph || !mindmapTreeRef.current) return;
    const selected = graph.getSelectedCells();
    if (selected.length !== 1 || !selected[0].isNode()) return;
    const node = selected[0] as Node;
    const data = node.getData();
    if (!data?.mindmapGroupId) return;

    toggleCollapse(mindmapTreeRef.current, node.id);

    const rootNode = graph.getNodes().find(n => n.getData()?.isRoot && n.getData()?.mindmapGroupId === data.mindmapGroupId);
    if (rootNode) {
      renderMindmapToGraph(graph, mindmapTreeRef.current, rootNode.position().x, rootNode.position().y, data.mindmapGroupId);
    }

    const nodeCell = graph.getCellById(node.id);
    if (nodeCell) graph.select(nodeCell);
  }, [graph]);

  // ─── Keyboard shortcuts (DOM-level, not graph.bindKey) ──
  useEffect(() => {
    if (!graph || !ready) return;

    const isEditing = (e: KeyboardEvent) => {
      // Check e.target (element that originally dispatched the event)
      const target = e.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA') return true;
        if (target.contentEditable === 'true') return true;
        // React nodes rendered inside X6's foreignObject use portals —
        // events may not propagate stopPropagation correctly across the
        // SVG/HTML boundary.  If the target is inside a foreignObject,
        // it's a React node component — let it handle its own keys.
        if (target.closest?.('foreignObject')) return true;
      }
      // Also check document.activeElement as a fallback — focus may have
      // moved to an input via setTimeout after double-click, making
      // activeElement more reliable than e.target in some edge cases.
      const active = document.activeElement as HTMLElement | null;
      if (active) {
        const aTag = active.tagName;
        if (aTag === 'INPUT' || aTag === 'TEXTAREA') return true;
        if (active.contentEditable === 'true') return true;
      }
      return false;
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      // Never intercept when user is typing in an input
      if (isEditing(e)) return;

      const meta = e.metaKey || e.ctrlKey;

      // Delete
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const cells = graph.getSelectedCells();
        if (cells.length) { graph.removeCells(cells); e.preventDefault(); }
        return;
      }

      // Undo / Redo
      if (meta && e.shiftKey && e.key === 'z') { graph.redo(); e.preventDefault(); return; }
      if (meta && e.key === 'z') { graph.undo(); e.preventDefault(); return; }

      // Copy / Paste
      if (meta && e.key === 'c') {
        const cells = graph.getSelectedCells();
        if (cells.length) graph.copy(cells);
        return;
      }
      if (meta && e.key === 'v') {
        if (!graph.isClipboardEmpty()) { graph.paste({ offset: 20 }); e.preventDefault(); }
        return;
      }

      // Select all
      if (meta && e.key === 'a') { graph.select(graph.getCells()); e.preventDefault(); return; }

      // Collapse mindmap (Cmd+.)
      if (meta && e.key === '.') { handleMindmapToggleCollapse(); e.preventDefault(); return; }

      // Single-key tool shortcuts (only without modifiers)
      if (!meta && !e.shiftKey && !e.altKey) {
        switch (e.key.toLowerCase()) {
          case 'v': setActiveTool('select'); return;
          case 't': setActiveTool('text'); return;
          case 'r': setActiveTool('rounded-rect'); return;
          case 'd': setActiveTool('diamond'); return;
          case 'm': setActiveTool('mindmap'); return;
          case 'tab':
            e.preventDefault();
            handleMindmapTab();
            return;
          case 'enter':
            handleMindmapEnter(e);
            return;
        }
      }

      // Shift+Tab for mindmap
      if (e.shiftKey && e.key === 'Tab') {
        e.preventDefault();
        // TODO: add parent node
        return;
      }

      // Printable character with a single node selected → start editing.
      // The character is passed through edit:start so the node component
      // can insert it after gaining focus (replacing any existing text).
      // Allow Shift (for uppercase/symbols) but not Ctrl/Meta/Alt.
      if (!meta && !e.altKey && e.key.length === 1) {
        const selected = graph.getSelectedCells();
        if (selected.length === 1 && selected[0].isNode() && startEditRef.current) {
          e.preventDefault();
          startEditRef.current(selected[0] as Node, e.key);
          return;
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [graph, ready, handleMindmapTab, handleMindmapEnter, handleMindmapToggleCollapse]);

  // ─── Double-click node → enter edit mode ──
  //
  // Architecture:
  //   Selection overlay (x6-widget-selection-box) is a plain <div> appended
  //   to graph.container as a sibling of the SVG. When a node is selected,
  //   this overlay covers the node and intercepts all mouse events —
  //   X6's own node:dblclick (which listens on the SVG) never fires.
  //
  //   For unselected nodes, dblclick lands on the foreignObject content.
  //   X6's node:dblclick fires in this case, but we DON'T use it because
  //   our DOM handler already covers this path and we don't want duplicates.
  //
  //   Strategy:
  //   1. Single DOM dblclick handler on graph.container (catches both cases)
  //   2. Find which node was hit:
  //      a. If a node is selected → edit that node (covers selection-box case)
  //      b. Else find node via X6's findViewByElem (uses data-cell-id walk)
  //      c. Fallback: coordinate-based hit detection
  //   3. No onBlur commit — X6 steals focus unpredictably
  //   4. Commit via: Enter key, or mousedown outside the node
  //   5. Cancel via: Escape key
  //
  useEffect(() => {
    if (!graph) return;
    const container = containerRef.current;
    if (!container) return;

    let editingNode: Node | null = null;
    let mousedownListenerActive = false;

    const hideSelectionBox = () => {
      const boxes = container.querySelectorAll('.x6-widget-selection-box');
      boxes.forEach(b => (b as HTMLElement).style.display = 'none');
    };
    const showSelectionBox = () => {
      const boxes = container.querySelectorAll('.x6-widget-selection-box');
      boxes.forEach(b => (b as HTMLElement).style.display = '');
    };

    const finishEdit = () => {
      const node = editingNode;
      editingNode = null;
      showSelectionBox();
      if (mousedownListenerActive) {
        document.removeEventListener('mousedown', onMouseDown, true);
        mousedownListenerActive = false;
      }
      // Auto-delete empty text nodes (transparent bg + border, no label)
      if (node && graph.hasCell(node.id)) {
        const d = node.getData();
        if (d && d.bgColor === 'transparent' && d.borderColor === 'transparent' && !d.label?.trim()) {
          graph.removeNode(node.id);
        }
      }
    };

    // Click-outside commit: mousedown on capture phase.
    // If the click is inside the editing node's foreignObject, ignore it.
    // Otherwise, commit the edit.
    const onMouseDown = (e: MouseEvent) => {
      if (!editingNode) return;
      const target = e.target as HTMLElement;
      const fo = target.closest?.('foreignObject');
      if (fo) {
        // Check if this foreignObject belongs to our editing node by walking
        // up to find the <g data-cell-id="..."> wrapper
        const gWrapper = fo.closest('[data-cell-id]');
        if (gWrapper && gWrapper.getAttribute('data-cell-id') === editingNode.id) {
          return; // Click inside our editing node — don't commit
        }
      }
      // Also ignore clicks on selection-box elements that belong to our node
      const selBox = target.closest?.('.x6-widget-selection-box');
      if (selBox && selBox.getAttribute('data-cell-id') === editingNode.id) {
        return;
      }
      // Click was outside — commit
      editingNode.trigger('edit:commit');
    };

    const startEdit = (nodeToEdit: Node, initialKey?: string) => {
      // Stale editingNode recovery: if editingNode is set but no editor element
      // is focused, the previous edit session ended without triggering edit:end
      // (can happen when X6's event system drops custom events). Clear it.
      if (editingNode) {
        const activeEl = document.activeElement as HTMLElement | null;
        const isEditorActive = activeEl?.contentEditable === 'true' ||
                               activeEl?.tagName === 'INPUT' ||
                               activeEl?.tagName === 'TEXTAREA';
        if (!isEditorActive) {
          finishEdit();
        }
      }

      // If already editing this exact node, skip (dedup)
      if (editingNode && editingNode.id === nodeToEdit.id) {
        return;
      }

      // If editing a different node, commit it first
      if (editingNode) {
        const prev = editingNode;
        finishEdit();
        prev.trigger('edit:commit');
      }

      editingNode = nodeToEdit;

      // Select the node if not already selected
      const selected = graph.getSelectedCells();
      if (selected.length !== 1 || selected[0].id !== nodeToEdit.id) {
        graph.select(nodeToEdit);
      }

      hideSelectionBox();
      nodeToEdit.trigger('edit:start', { initialKey });

      // Listen for edit:end from the node component (fires on Enter/Escape/commit)
      const onEditEnd = () => {
        finishEdit();
      };
      nodeToEdit.once('edit:end', onEditEnd);

      // Register click-outside on next tick so current dblclick's mousedown
      // (which already happened) doesn't trigger it
      setTimeout(() => {
        if (editingNode === nodeToEdit) {
          document.addEventListener('mousedown', onMouseDown, true);
          mousedownListenerActive = true;
        }
      }, 0);
    };

    // Find the node that was double-clicked
    const findNodeFromEvent = (e: MouseEvent): Node | null => {
      // Strategy 1: If exactly one node is selected, use it.
      // This handles the selection-box overlay case — the overlay covers
      // the node so we can't identify it from e.target, but we know which
      // node is selected.
      const selected = graph.getSelectedCells();
      if (selected.length === 1 && selected[0].isNode()) {
        return selected[0] as Node;
      }

      // Strategy 2: Use X6's own findViewByElem — walks up from e.target
      // looking for data-cell-id attribute. Works when clicking directly
      // on foreignObject content. Note: don't use this for selection-box
      // elements (they have data-cell-id but are not cell views).
      const target = e.target as Element;
      if (!target.closest?.('.x6-widget-selection')) {
        const view = graph.findViewByElem(target);
        if (view?.cell?.isNode()) {
          return view.cell as Node;
        }
      }

      // Strategy 3: Coordinate-based hit detection as last resort.
      // clientToLocal takes browser viewport coords (clientX/clientY).
      const localPt = graph.clientToLocal(e.clientX, e.clientY);
      const nodes = graph.getNodes();
      for (const n of nodes) {
        const bbox = n.getBBox();
        if (localPt.x >= bbox.x && localPt.x <= bbox.x + bbox.width &&
            localPt.y >= bbox.y && localPt.y <= bbox.y + bbox.height) {
          return n;
        }
      }

      return null;
    };

    const handleDblClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;

      // If dblclick lands on an active editor element (INPUT, TEXTAREA, or
      // focused contentEditable), don't start a new edit — user is interacting
      // with the existing editor (e.g., double-click to select a word).
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
        return;
      }
      if (target.contentEditable === 'true' && document.activeElement === target) {
        return;
      }

      const node = findNodeFromEvent(e);
      if (node) {
        e.stopPropagation();
        startEdit(node);
      }
    };

    startEditRef.current = startEdit;

    // Use capture phase so we fire before X6's internal handler
    container.addEventListener('dblclick', handleDblClick, true);
    return () => {
      startEditRef.current = null;
      container.removeEventListener('dblclick', handleDblClick, true);
      if (mousedownListenerActive) {
        document.removeEventListener('mousedown', onMouseDown, true);
      }
    };
  }, [graph]);

  // ─── Canvas click: create shape or mindmap ──
  useEffect(() => {
    if (!graph) return;

    const handleBlankClick = ({ e, x, y }: { e: MouseEvent; x: number; y: number }) => {
      // x, y from blank:click are already in local (canvas) coordinates
      // — X6 calls snapToGrid(clientToLocal(clientX, clientY)) internally.
      // When a shape tool is active, the preview appears at cursor + 12px screen offset.
      // Convert that offset to local coords so the node appears where the preview is.
      const zoom = graph.zoom();
      const previewOffset = 12 / zoom;

      if (activeTool === 'text') {
        const textNode = graph.addNode({
          id: newNodeId(),
          shape: 'flowchart-node',
          x: x + previewOffset,
          y: y + previewOffset,
          width: 120,
          height: 40,
          data: {
            label: '',
            flowchartShape: 'rounded-rect' as FlowchartShape,
            bgColor: 'transparent',
            borderColor: 'transparent',
            textColor: '#1f2937',
            fontSize: 14,
            fontWeight: 'normal',
            fontStyle: 'normal',
          },
        });
        graph.select(textNode);
        setActiveTool('select');
        // Auto-enter edit mode for text nodes
        setTimeout(() => {
          if (startEditRef.current) startEditRef.current(textNode);
        }, 50);
        return;
      }

      if (activeTool === 'mindmap') {
        const tree = createRootTree();
        const groupId = `mmg_${Date.now().toString(36)}`;
        mindmapTreeRef.current = tree;
        mindmapGroupIdRef.current = groupId;
        renderMindmapToGraph(graph, tree, x + previewOffset, y + previewOffset, groupId);
        setActiveTool('select');
        return;
      }

      const shapeMeta = SHAPE_META[activeTool as FlowchartShape];
      if (shapeMeta) {
        const newNode = graph.addNode({
          id: newNodeId(),
          shape: 'flowchart-node',
          x: x + previewOffset,
          y: y + previewOffset,
          width: shapeMeta.width,
          height: shapeMeta.height,
          data: {
            label: '',
            flowchartShape: activeTool as FlowchartShape,
            bgColor: DEFAULT_NODE_COLOR.bg,
            borderColor: DEFAULT_NODE_COLOR.border,
            textColor: DEFAULT_NODE_COLOR.text,
            fontSize: 14,
            fontWeight: 'normal',
            fontStyle: 'normal',
          },
        });
        graph.select(newNode);
        setActiveTool('select');
        return;
      }
    };

    graph.on('blank:click', handleBlankClick);
    return () => { graph.off('blank:click', handleBlankClick); };
  }, [graph, activeTool]);

  // ─── Disable rubberband selection when a creation tool is active ──
  // (otherwise drag-to-create conflicts with rubberband)
  useEffect(() => {
    if (!graph) return;
    const sel = graph.getPlugin('selection') as any;
    if (!sel) return;
    if (activeTool !== 'select') {
      sel.disableRubberband();
    } else {
      sel.enableRubberband();
    }
  }, [graph, activeTool]);

  // ─── Edge tools: show vertices handles on selected edge ──
  useEffect(() => {
    if (!graph) return;

    const onSelectionChanged = () => {
      graph.getEdges().forEach(e => {
        if (e.hasTools()) e.removeTools();
      });
      const cells = graph.getSelectedCells();
      if (cells.length === 1 && cells[0].isEdge()) {
        const edge = cells[0] as Edge;
        edge.addTools([
          { name: 'vertices', args: { stopPropagation: false } },
        ]);
      }
    };

    graph.on('selection:changed', onSelectionChanged);
    return () => {
      graph.off('selection:changed', onSelectionChanged);
    };
  }, [graph]);

  // ─── Quick-create: click port → new node + edge ──
  useEffect(() => {
    if (!graph) return;

    // Fixed IDs to guarantee only one preview at a time
    const PREVIEW_NODE_ID = '__port_preview_node__';
    const PREVIEW_EDGE_ID = '__port_preview_edge__';

    const portOffsets: Record<string, { dx: number; dy: number }> = {
      top: { dx: 0, dy: -1 }, bottom: { dx: 0, dy: 1 },
      left: { dx: -1, dy: 0 }, right: { dx: 1, dy: 0 },
    };

    const clearPreview = () => {
      // Aggressively remove by fixed ID AND scan for any _isPreview cells
      try {
        if (graph.hasCell(PREVIEW_EDGE_ID)) graph.removeCell(PREVIEW_EDGE_ID);
      } catch (e) { console.warn('[preview] removeEdge error:', e); }
      try {
        if (graph.hasCell(PREVIEW_NODE_ID)) graph.removeCell(PREVIEW_NODE_ID);
      } catch (e) { console.warn('[preview] removeNode error:', e); }
      // Fallback: remove ANY cell marked as preview (handles orphans from re-renders)
      const orphans = graph.getCells().filter(c => c.getData()?._isPreview);
      if (orphans.length > 0) {
        console.warn('[preview] Found orphaned preview cells:', orphans.length);
        graph.removeCells(orphans);
      }
    };

    // Track which port is currently hovered for style restoration
    let hoveredPortInfo: { nodeId: string; portId: string } | null = null;

    const restorePortStyle = () => {
      if (!hoveredPortInfo) return;
      const node = graph.getCellById(hoveredPortInfo.nodeId);
      if (node && node.isNode()) {
        (node as Node).portProp(hoveredPortInfo.portId, 'attrs/circle/fill', '#fff');
        (node as Node).portProp(hoveredPortInfo.portId, 'attrs/circle/stroke', '#5F95FF');
        (node as Node).portProp(hoveredPortInfo.portId, 'attrs/circle/r', 5);
      }
      hoveredPortInfo = null;
    };

    // After a port click creates a node, block preview until mouse truly re-enters a port
    let createdViaPortClick = false;

    const handlePortClick = ({ e, node, port }: { e: MouseEvent; node: Node; port: string }) => {
      if (activeTool !== 'select') return;
      if (node.getData()?.mindmapGroupId) return;
      createdViaPortClick = true;
      clearPreview();
      restorePortStyle();
      const newNode = quickCreateNode(graph, node, port);
      if (newNode) {
        graph.select(newNode);
      }
      // Clear again after creation — events during addNode may have recreated preview
      clearPreview();
    };

    const handlePortEnter = ({ node, port }: { e: MouseEvent; node: Node; port: string }) => {
      if (activeTool !== 'select') return;
      if (node.getData()?.mindmapGroupId) return;
      // Don't show preview on preview nodes
      if (node.getData()?._isPreview) return;
      // After port click, ignore enter events until a mouseleave resets the flag
      if (createdViaPortClick) return;

      // Restore previous port style if different
      restorePortStyle();

      // Highlight hovered port
      node.portProp(port, 'attrs/circle/fill', '#3b82f6');
      node.portProp(port, 'attrs/circle/stroke', '#3b82f6');
      node.portProp(port, 'attrs/circle/r', 8);
      hoveredPortInfo = { nodeId: node.id, portId: port };

      // Calculate preview node position (matching source node size)
      const dir = portOffsets[port];
      if (!dir) return;
      const pos = node.position();
      const size = node.size();
      const gap = 80;
      const pw = size.width, ph = size.height;
      const nx = pos.x + dir.dx * (size.width + gap) + (dir.dx === 0 ? (size.width - pw) / 2 : 0);
      const ny = pos.y + dir.dy * (size.height + gap) + (dir.dy === 0 ? (size.height - ph) / 2 : 0);

      // Read source node colors for preview
      const srcData = node.getData() || {};
      const previewBg = srcData.bgColor || '#ffffff';
      const previewBorder = srcData.borderColor || '#374151';

      clearPreview();
      graph.addNode({
        id: PREVIEW_NODE_ID,
        shape: 'rect',
        x: nx, y: ny,
        width: pw, height: ph,
        attrs: {
          body: { fill: previewBg, stroke: previewBorder, strokeWidth: 1, strokeDasharray: '4 3', rx: 8, ry: 8, opacity: 0.5 },
        },
        zIndex: -1,
        data: { _isPreview: true },
      });

      // Edge target = nearest edge center of preview node (not center)
      let tx: number, ty: number;
      if (dir.dx === 1)  { tx = nx;          ty = ny + ph / 2; } // right port → target left edge center
      else if (dir.dx === -1) { tx = nx + pw; ty = ny + ph / 2; } // left port → target right edge center
      else if (dir.dy === 1)  { tx = nx + pw / 2; ty = ny;      } // bottom port → target top edge center
      else                    { tx = nx + pw / 2; ty = ny + ph;  } // top port → target bottom edge center

      graph.addEdge({
        id: PREVIEW_EDGE_ID,
        source: { cell: node.id, port },
        target: { x: tx, y: ty },
        attrs: { line: { stroke: previewBorder, strokeWidth: 1.5, strokeDasharray: '6 4', targetMarker: null, opacity: 0.5 } },
        router: { name: 'normal' },
        connector: { name: 'normal' },
        zIndex: -1,
        data: { _isPreview: true },
      });
    };

    const handlePortLeave = () => {
      createdViaPortClick = false;
      restorePortStyle();
      clearPreview();
    };

    // Also clean up on blank click, selection change, and node click
    const handleCleanup = () => {
      createdViaPortClick = false;
      restorePortStyle();
      clearPreview();
    };

    graph.on('node:port:click', handlePortClick);
    graph.on('node:port:mouseenter', handlePortEnter);
    graph.on('node:port:mouseleave', handlePortLeave);
    graph.on('blank:click', handleCleanup);
    graph.on('blank:mousedown', handleCleanup);
    return () => {
      graph.off('node:port:click', handlePortClick);
      graph.off('node:port:mouseenter', handlePortEnter);
      graph.off('node:port:mouseleave', handlePortLeave);
      graph.off('blank:click', handleCleanup);
      graph.off('blank:mousedown', handleCleanup);
      clearPreview();
    };
  }, [graph, activeTool]);

  // ─── Drag & Drop from toolbar ──
  useEffect(() => {
    if (!graph) return;
    const container = graph.container;

    const handleDragOver = (e: DragEvent) => {
      e.preventDefault();
      e.dataTransfer!.dropEffect = 'copy';
    };

    const handleDrop = (e: DragEvent) => {
      e.preventDefault();
      const jsonStr = e.dataTransfer?.getData('application/x6-shape');
      if (!jsonStr) return;

      const nodeData = JSON.parse(jsonStr);
      const rect = container.getBoundingClientRect();
      const local = graph.graphToLocal(e.clientX - rect.x, e.clientY - rect.y);

      graph.addNode({
        id: newNodeId(),
        ...nodeData,
        x: local.x - (nodeData.width || 120) / 2,
        y: local.y - (nodeData.height || 60) / 2,
      });
    };

    container.addEventListener('dragover', handleDragOver);
    container.addEventListener('drop', handleDrop);
    return () => {
      container.removeEventListener('dragover', handleDragOver);
      container.removeEventListener('drop', handleDrop);
    };
  }, [graph]);

  // ─── Mindmap node data change → update tree ──
  useEffect(() => {
    if (!graph) return;

    const handleDataChange = ({ cell }: { cell: Cell }) => {
      if (!cell.isNode()) return;
      const data = cell.getData();
      if (!data?.mindmapGroupId || !mindmapTreeRef.current) return;

      // Sync label back to tree
      updateLabel(mindmapTreeRef.current, cell.id, data.label || '');
    };

    graph.on('cell:change:data', handleDataChange);
    return () => { graph.off('cell:change:data', handleDataChange); };
  }, [graph]);

  // ─── Title editing ──
  const handleTitleEdit = useCallback(async () => {
    if (!editTitle.trim() || !diagram) return;
    setIsEditingTitle(false);
    // TODO: update diagram title via gateway API if supported
  }, [editTitle, diagram]);

  // ─── Delete diagram ──
  const handleDelete = useCallback(async () => {
    if (!confirm('确定要删除此图表吗？')) return;
    try {
      // TODO: implement delete API
      onDeleted?.();
    } catch (e) {
      console.error(e);
    }
  }, [onDeleted]);

  // ─── Export ──
  const handleExport = useCallback(() => {
    if (!graph) return;
    graph.exportPNG('diagram.png', { padding: 20 });
  }, [graph]);

  // ─── Migrate data ──
  const handleMigrate = useCallback(async () => {
    if (!graph) return;
    await save();
    setMigrationNeeded(false);
  }, [graph, save]);

  // ─── Drag-to-create: user drags on canvas to create a custom-sized node ──
  const handleDragCreate = useCallback((localX: number, localY: number, localW: number, localH: number) => {
    if (!graph) return;

    const shape = activeTool === 'text' ? 'rounded-rect' as FlowchartShape : activeTool as FlowchartShape;
    const isText = activeTool === 'text';

    const newNode = graph.addNode({
      id: newNodeId(),
      shape: 'flowchart-node',
      x: localX,
      y: localY,
      width: localW,
      height: localH,
      data: {
        label: '',
        flowchartShape: shape,
        bgColor: isText ? 'transparent' : DEFAULT_NODE_COLOR.bg,
        borderColor: isText ? 'transparent' : DEFAULT_NODE_COLOR.border,
        textColor: isText ? '#1f2937' : DEFAULT_NODE_COLOR.text,
        fontSize: 14,
        fontWeight: 'normal',
        fontStyle: 'normal',
      },
    });
    graph.select(newNode);
    setActiveTool('select');
    // Auto-enter edit mode for text nodes
    if (isText) {
      setTimeout(() => {
        if (startEditRef.current) startEditRef.current(newNode);
      }, 50);
    }
  }, [graph, activeTool]);

  return (
    <div className="flex flex-col h-full bg-gray-50">
      {/* ── Header ── */}
      <div className="flex items-center h-12 px-3 bg-white border-b border-gray-200 shrink-0">
        <div className="flex items-center gap-1 min-w-0 flex-1">
          {onBack && (
            <button onClick={onBack} className="p-1.5 rounded hover:bg-gray-100 text-gray-500">
              <ArrowLeft size={16} />
            </button>
          )}

          {/* Breadcrumb */}
          {breadcrumb?.map((item, i) => (
            <span key={item.id} className="flex items-center text-sm text-gray-400">
              {i > 0 && <ChevronRight size={12} className="mx-0.5" />}
              <span className="truncate max-w-[120px]">{item.title}</span>
            </span>
          ))}

          {/* Title */}
          {isEditingTitle ? (
            <input
              className="text-sm font-medium bg-transparent border-b border-blue-400 outline-none px-1 min-w-[120px]"
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              onBlur={handleTitleEdit}
              onKeyDown={(e) => e.key === 'Enter' && handleTitleEdit()}
              autoFocus
            />
          ) : (
            <button
              className="text-sm font-medium text-gray-800 truncate max-w-[200px] hover:text-blue-600 px-1"
              onClick={() => {
                setEditTitle((diagram as any)?.title || '');
                setIsEditingTitle(true);
              }}
            >
              {(diagram as any)?.title || 'Untitled Diagram'}
            </button>
          )}

          {/* Save status */}
          <span className="text-xs text-gray-400 ml-2">
            {saving ? 'Saving...' : lastSaved ? `Saved ${formatRelativeTime(lastSaved)}` : ''}
          </span>
        </div>

        {/* Right actions */}
        <div className="flex items-center gap-1">
          {/* Undo / Redo */}
          <button
            className="p-1.5 rounded hover:bg-gray-100 text-gray-500"
            onClick={() => graph?.undo()}
            title="撤销 (Cmd+Z)"
          >
            <Undo2 size={16} />
          </button>
          <button
            className="p-1.5 rounded hover:bg-gray-100 text-gray-500"
            onClick={() => graph?.redo()}
            title="重做 (Cmd+Shift+Z)"
          >
            <Redo2 size={16} />
          </button>

          {/* Toggle doc list */}
          {onToggleDocList && (
            <button onClick={onToggleDocList} className="p-1.5 rounded hover:bg-gray-100 text-gray-500" title="切换文档列表">
              {docListVisible ? <ArrowLeftToLine size={16} /> : <ArrowRightToLine size={16} />}
            </button>
          )}

          {/* Menu */}
          <div className="relative">
            <button
              className="p-1.5 rounded hover:bg-gray-100 text-gray-500"
              onClick={() => setShowMenu(!showMenu)}
            >
              <MoreHorizontal size={16} />
            </button>
            {showMenu && (
              <div className="absolute right-0 top-full mt-1 bg-white rounded-lg shadow-lg border border-gray-200 py-1 w-40 z-50">
                {onCopyLink && (
                  <MenuButton icon={<Link2 size={14} />} label="复制链接" onClick={() => { onCopyLink(); setShowMenu(false); }} />
                )}
                <MenuButton icon={<Download size={14} />} label="导出 PNG" onClick={() => { handleExport(); setShowMenu(false); }} />
                <div className="border-t border-gray-100 my-1" />
                <MenuButton icon={<Trash2 size={14} />} label="删除图表" onClick={() => { handleDelete(); setShowMenu(false); }} danger />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Migration banner ── */}
      {migrationNeeded && (
        <div className="bg-blue-50 border-b border-blue-200 px-4 py-2 flex items-center gap-3 text-sm">
          <span className="text-blue-700">此图表使用旧格式，已自动迁移到新引擎。</span>
          <button
            className="px-3 py-1 bg-blue-600 text-white rounded text-xs hover:bg-blue-700"
            onClick={handleMigrate}
          >
            保存新格式
          </button>
        </div>
      )}

      {/* ── Canvas area ── */}
      <div className="flex-1 relative overflow-hidden">
        {/* X6 container */}
        <div
          ref={containerRef}
          className={cn('w-full h-full', activeTool !== 'select' && 'cursor-crosshair')}
        />

        {/* Error fallback */}
        {graphError && (
          <div className="absolute inset-0 flex items-center justify-center bg-gray-50 z-50">
            <div className="text-center p-8">
              <p className="text-gray-500 text-sm mb-2">图表编辑器加载失败</p>
              <p className="text-xs text-gray-400 font-mono">{graphError}</p>
            </div>
          </div>
        )}

        {/* Left toolbar */}
        <LeftToolbar
          activeTool={activeTool}
          onToolChange={setActiveTool}
          activeConnector={activeConnector}
          onConnectorChange={setActiveConnector}
          graph={graph}
        />

        {/* Floating toolbar */}
        <FloatingToolbar graph={graph} />

        {/* Zoom bar */}
        <ZoomBar graph={graph} />

        {/* Shape preview following cursor */}
        <ShapePreview activeTool={activeTool} containerRef={containerRef} graph={graph} onDragCreate={handleDragCreate} />

        {/* Minimap */}
        <div
          ref={minimapRef}
          className="absolute right-3 bottom-12 bg-white rounded-lg shadow-md border border-gray-200 overflow-hidden"
          style={{ width: 180, height: 120 }}
        />
      </div>
    </div>
  );
}

// ─── Menu Button ──
function MenuButton({ icon, label, onClick, danger }: { icon: React.ReactNode; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button
      className={cn(
        'w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-gray-100',
        danger ? 'text-red-600' : 'text-gray-700',
      )}
      onClick={onClick}
    >
      {icon}
      {label}
    </button>
  );
}
