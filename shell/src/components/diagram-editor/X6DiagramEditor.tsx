'use client';

import { useState, useEffect, useCallback, useRef, Component, type ErrorInfo, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Graph, Node, Edge, Cell } from '@antv/x6';
import * as gw from '@/lib/api/gateway';
import {
  ArrowLeft, ArrowLeftToLine, ArrowRightToLine,
  MoreHorizontal, Link2, Download, Trash2, ChevronRight,
  Undo2, Redo2, MessageSquare, Clock, X,
} from 'lucide-react';
import { Comments } from '@/components/comments/Comments';
import ContentRevisionHistory from '@/components/ContentRevisionHistory';
import { cn } from '@/lib/utils';
import { useT } from '@/lib/i18n';
import { ContentTopBar } from '@/components/shared/ContentTopBar';
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
        <div className="flex items-center justify-center h-full bg-muted">
          <div className="text-center p-8 max-w-md">
            <p className="text-muted-foreground text-sm mb-2">图表编辑器加载失败</p>
            <p className="text-xs text-muted-foreground font-mono break-all">{this.state.error.message}</p>
            <button
              className="mt-4 px-4 py-2 bg-sidebar-primary text-sidebar-primary-foreground rounded text-sm hover:bg-sidebar-primary/90"
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
  const [showComments, setShowComments] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  // Title editing now handled by ContentTopBar
  const [migrationNeeded, setMigrationNeeded] = useState(false);

  // Mindmap state
  const mindmapTreeRef = useRef<MindmapTreeNode | null>(null);
  const mindmapGroupIdRef = useRef<string>('');
  const startEditRef = useRef<((node: Node, initialKey?: string) => void) | null>(null);
  const justFinishedEditRef = useRef(0); // timestamp — used to debounce Enter after edit commit

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

      // Defer selection + auto-edit to next frame so React components finish mounting
      requestAnimationFrame(() => {
        const newNode = graph.getCellById(newId);
        if (newNode) {
          graph.resetSelection(newNode);
          // Auto-enter edit mode on the new node
          setTimeout(() => {
            if (startEditRef.current) startEditRef.current(newNode as Node);
          }, 50);
        }
      });
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

      requestAnimationFrame(() => {
        const newNode = graph.getCellById(newId);
        if (newNode) {
          graph.resetSelection(newNode);
          setTimeout(() => {
            if (startEditRef.current) startEditRef.current(newNode as Node);
          }, 50);
        }
      });
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

    requestAnimationFrame(() => {
      const nodeCell = graph.getCellById(node.id);
      if (nodeCell) graph.resetSelection(nodeCell);
    });
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

      // Skip Enter/Tab if we just finished editing (input already unmounted
      // so isEditing returns false, but the keydown is still from the edit commit)
      if ((e.key === 'Enter' || e.key === 'Tab') && Date.now() - justFinishedEditRef.current < 100) return;

      const meta = e.metaKey || e.ctrlKey;

      // Delete
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const cells = graph.getSelectedCells();
        if (cells.length) {
          // For mindmap nodes, also remove from tree data structure
          if (mindmapTreeRef.current) {
            let needsRerender = false;
            let mmGroupId = '';
            for (const cell of cells) {
              if (!cell.isNode()) continue;
              const data = cell.getData();
              if (!data?.mindmapGroupId) continue;
              if (data.isRoot) continue; // don't delete root via backspace
              removeNode(mindmapTreeRef.current, cell.id);
              mmGroupId = data.mindmapGroupId;
              needsRerender = true;
            }
            if (needsRerender && mmGroupId) {
              const rootNode = graph.getNodes().find(n => n.getData()?.isRoot && n.getData()?.mindmapGroupId === mmGroupId);
              if (rootNode) {
                renderMindmapToGraph(graph, mindmapTreeRef.current, rootNode.position().x, rootNode.position().y, mmGroupId);
              }
              e.preventDefault();
              return;
            }
          }
          graph.removeCells(cells);
          e.preventDefault();
        }
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
      justFinishedEditRef.current = Date.now();
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

      // Ensure only this node is selected
      const selected = graph.getSelectedCells();
      if (selected.length !== 1 || selected[0].id !== nodeToEdit.id) {
        graph.resetSelection(nodeToEdit);
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
  // Preview uses pure DOM overlay (not X6 cells) to avoid ghost node bugs.
  useEffect(() => {
    if (!graph) return;

    const portOffsets: Record<string, { dx: number; dy: number }> = {
      top: { dx: 0, dy: -1 }, bottom: { dx: 0, dy: 1 },
      left: { dx: -1, dy: 0 }, right: { dx: 1, dy: 0 },
    };

    // ── DOM-based preview overlay ──
    const container = graph.container.parentElement!;
    const previewEl = document.createElement('div');
    previewEl.style.cssText = 'position:absolute;top:0;left:0;pointer-events:none;z-index:5;display:none;';
    container.appendChild(previewEl);

    // SVG for the connecting line
    const svgNs = 'http://www.w3.org/2000/svg';
    const lineSvg = document.createElementNS(svgNs, 'svg');
    lineSvg.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:4;display:none;';
    lineSvg.setAttribute('overflow', 'visible');
    const lineEl = document.createElementNS(svgNs, 'line');
    lineEl.setAttribute('stroke-dasharray', '6 4');
    lineEl.setAttribute('stroke-width', '1.5');
    lineEl.setAttribute('opacity', '0.5');
    lineSvg.appendChild(lineEl);
    container.appendChild(lineSvg);

    const showPreview = (
      nodeScreenX: number, nodeScreenY: number,
      nodeW: number, nodeH: number,
      borderColor: string, bgColor: string,
      portScreenX: number, portScreenY: number,
      targetEdgeX: number, targetEdgeY: number,
    ) => {
      previewEl.style.display = 'block';
      previewEl.style.left = `${nodeScreenX}px`;
      previewEl.style.top = `${nodeScreenY}px`;
      previewEl.style.width = `${nodeW}px`;
      previewEl.style.height = `${nodeH}px`;
      previewEl.style.border = `1px dashed ${borderColor}`;
      previewEl.style.borderRadius = '8px';
      previewEl.style.backgroundColor = bgColor;
      previewEl.style.opacity = '0.5';

      lineSvg.style.display = 'block';
      lineEl.setAttribute('x1', String(portScreenX));
      lineEl.setAttribute('y1', String(portScreenY));
      lineEl.setAttribute('x2', String(targetEdgeX));
      lineEl.setAttribute('y2', String(targetEdgeY));
      lineEl.setAttribute('stroke', borderColor);
    };

    const hidePreview = () => {
      previewEl.style.display = 'none';
      lineSvg.style.display = 'none';
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

    const handlePortClick = ({ e, node, port }: { e: MouseEvent; node: Node; port: string }) => {
      if (activeTool !== 'select') return;
      if (node.getData()?.mindmapGroupId) return;
      hidePreview();
      restorePortStyle();
      const newNode = quickCreateNode(graph, node, port);
      if (newNode) {
        graph.select(newNode);
      }
    };

    const handlePortEnter = ({ node, port }: { e: MouseEvent; node: Node; port: string }) => {
      if (activeTool !== 'select') return;
      if (node.getData()?.mindmapGroupId) return;

      restorePortStyle();

      // Highlight hovered port
      node.portProp(port, 'attrs/circle/fill', '#3b82f6');
      node.portProp(port, 'attrs/circle/stroke', '#3b82f6');
      node.portProp(port, 'attrs/circle/r', 8);
      hoveredPortInfo = { nodeId: node.id, portId: port };

      // Calculate preview position in local coords
      const dir = portOffsets[port];
      if (!dir) return;
      const pos = node.position();
      const size = node.size();
      const gap = 80;
      const pw = size.width, ph = size.height;
      const nx = pos.x + dir.dx * (size.width + gap) + (dir.dx === 0 ? (size.width - pw) / 2 : 0);
      const ny = pos.y + dir.dy * (size.height + gap) + (dir.dy === 0 ? (size.height - ph) / 2 : 0);

      const srcData = node.getData() || {};
      const previewBorder = srcData.borderColor || '#374151';
      const previewBg = srcData.bgColor || '#ffffff';

      // Convert local coords to screen (graph container) coords
      const { sx, sy } = graph.scale();
      const { tx, ty } = graph.translate();
      const screenX = nx * sx + tx;
      const screenY = ny * sy + ty;
      const screenW = pw * sx;
      const screenH = ph * sy;

      // Port position in local coords (center of the port side)
      let portLocalX: number, portLocalY: number;
      if (dir.dx === 1) { portLocalX = pos.x + size.width; portLocalY = pos.y + size.height / 2; }
      else if (dir.dx === -1) { portLocalX = pos.x; portLocalY = pos.y + size.height / 2; }
      else if (dir.dy === 1) { portLocalX = pos.x + size.width / 2; portLocalY = pos.y + size.height; }
      else { portLocalX = pos.x + size.width / 2; portLocalY = pos.y; }
      const portSX = portLocalX * sx + tx;
      const portSY = portLocalY * sy + ty;

      // Target edge center (nearest side of preview node)
      let tLocalX: number, tLocalY: number;
      if (dir.dx === 1) { tLocalX = nx; tLocalY = ny + ph / 2; }
      else if (dir.dx === -1) { tLocalX = nx + pw; tLocalY = ny + ph / 2; }
      else if (dir.dy === 1) { tLocalX = nx + pw / 2; tLocalY = ny; }
      else { tLocalX = nx + pw / 2; tLocalY = ny + ph; }
      const tSX = tLocalX * sx + tx;
      const tSY = tLocalY * sy + ty;

      showPreview(screenX, screenY, screenW, screenH, previewBorder, previewBg, portSX, portSY, tSX, tSY);
    };

    const handlePortLeave = () => {
      restorePortStyle();
      hidePreview();
    };

    const handleCleanup = () => {
      restorePortStyle();
      hidePreview();
    };

    graph.on('node:port:click', handlePortClick);
    graph.on('node:port:mouseenter', handlePortEnter);
    graph.on('node:port:mouseleave', handlePortLeave);
    graph.on('blank:click', handleCleanup);
    graph.on('blank:mousedown', handleCleanup);

    // Also clean up any leftover _isPreview cells from old code
    const oldOrphans = graph.getCells().filter(c => c.getData()?._isPreview);
    if (oldOrphans.length > 0) graph.removeCells(oldOrphans);

    return () => {
      graph.off('node:port:click', handlePortClick);
      graph.off('node:port:mouseenter', handlePortEnter);
      graph.off('node:port:mouseleave', handlePortLeave);
      graph.off('blank:click', handleCleanup);
      graph.off('blank:mousedown', handleCleanup);
      previewEl.remove();
      lineSvg.remove();
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

      // Handle collapse toggle signal from MindmapNode button
      if (data._collapseToggle) {
        // Clear the signal
        cell.setData({ ...data, _collapseToggle: undefined }, { silent: true });
        toggleCollapse(mindmapTreeRef.current, cell.id);
        const rootNode = graph.getNodes().find(n => n.getData()?.isRoot && n.getData()?.mindmapGroupId === data.mindmapGroupId);
        if (rootNode) {
          renderMindmapToGraph(graph, mindmapTreeRef.current, rootNode.position().x, rootNode.position().y, data.mindmapGroupId);
        }
        return;
      }

      // Sync label back to tree
      updateLabel(mindmapTreeRef.current, cell.id, data.label || '');
    };

    graph.on('cell:change:data', handleDataChange);
    return () => { graph.off('cell:change:data', handleDataChange); };
  }, [graph]);

  // ─── Title editing ──
  // handleTitleEdit now inlined in ContentTopBar onTitleChange

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
    <div className="flex flex-col h-full bg-muted">
      {/* ── Header ── */}
      <div className="flex items-center h-12 bg-card border-b border-border shrink-0">
        <ContentTopBar
          breadcrumb={breadcrumb}
          onBack={onBack}
          docListVisible={docListVisible}
          onToggleDocList={onToggleDocList}
          title={(diagram as any)?.title || 'Untitled Diagram'}
          titlePlaceholder="Untitled Diagram"
          onTitleChange={async (newTitle) => {
            // TODO: update diagram title via gateway API if supported
          }}
          statusText={saving ? 'Saving...' : lastSaved ? `Saved ${formatRelativeTime(lastSaved)}` : ''}
          actions={<>
            <button
              className="p-1.5 rounded hover:bg-muted text-muted-foreground"
              onClick={() => graph?.undo()}
              title="撤销 (Cmd+Z)"
            >
              <Undo2 size={16} />
            </button>
            <button
              className="p-1.5 rounded hover:bg-muted text-muted-foreground"
              onClick={() => graph?.redo()}
              title="重做 (Cmd+Shift+Z)"
            >
              <Redo2 size={16} />
            </button>
            <button
              onClick={() => { setShowComments(v => !v); setShowHistory(false); }}
              className={cn('p-1.5 rounded transition-colors', showComments ? 'text-sidebar-primary bg-sidebar-primary/10' : 'text-muted-foreground hover:text-foreground')}
              title="Comments"
            >
              <MessageSquare size={16} />
            </button>
            <div className="relative">
              <button
                className="p-1.5 rounded hover:bg-muted text-muted-foreground"
                onClick={() => setShowMenu(!showMenu)}
              >
                <MoreHorizontal size={16} />
              </button>
              {showMenu && (
                <div className="absolute right-0 top-full mt-1 bg-card rounded-lg shadow-lg border border-border py-1 w-44 z-50">
                  <MenuButton icon={<Clock size={14} />} label="版本历史" onClick={() => { setShowHistory(true); setShowComments(false); setShowMenu(false); }} />
                  {onCopyLink && (
                    <MenuButton icon={<Link2 size={14} />} label="复制链接" onClick={() => { onCopyLink(); setShowMenu(false); }} />
                  )}
                  <MenuButton icon={<Download size={14} />} label="导出 PNG" onClick={() => { handleExport(); setShowMenu(false); }} />
                  <div className="border-t border-border my-1" />
                  <MenuButton icon={<Trash2 size={14} />} label="删除图表" onClick={() => { handleDelete(); setShowMenu(false); }} danger />
                </div>
              )}
            </div>
          </>}
        />
      </div>

      {/* ── Migration banner ── */}
      {migrationNeeded && (
        <div className="bg-sidebar-accent border-b border-sidebar-primary/30 px-4 py-2 flex items-center gap-3 text-sm">
          <span className="text-sidebar-primary">此图表使用旧格式，已自动迁移到新引擎。</span>
          <button
            className="px-3 py-1 bg-sidebar-primary text-sidebar-primary-foreground rounded text-xs hover:bg-sidebar-primary/90"
            onClick={handleMigrate}
          >
            保存新格式
          </button>
        </div>
      )}

      {/* ── Canvas + sidebar row ── */}
      <div className="flex-1 flex min-h-0">
        {/* ── Canvas area ── */}
        <div className="flex-1 relative overflow-hidden">
          {/* X6 container */}
          <div
            ref={containerRef}
            className={cn('w-full h-full', activeTool !== 'select' && 'cursor-crosshair')}
          />

          {/* Error fallback */}
          {graphError && (
            <div className="absolute inset-0 flex items-center justify-center bg-muted z-50">
              <div className="text-center p-8">
                <p className="text-muted-foreground text-sm mb-2">图表编辑器加载失败</p>
                <p className="text-xs text-muted-foreground font-mono">{graphError}</p>
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
            className="absolute right-3 bottom-12 bg-card rounded-lg shadow-md border border-border overflow-hidden"
            style={{ width: 180, height: 120 }}
          />
        </div>

        {/* Comments sidebar */}
        {showComments && !showHistory && (
          <div className="w-80 border-l border-border bg-card flex flex-col shrink-0 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2 border-b border-border">
              <h3 className="text-sm font-semibold text-foreground">Comments</h3>
              <button onClick={() => setShowComments(false)} className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
                <X size={14} />
              </button>
            </div>
            <Comments
              queryKey={['content-comments', `diagram:${diagramId}`]}
              fetchComments={() => gw.listContentComments(`diagram:${diagramId}`)}
              postComment={(text, parentId) => gw.createContentComment(`diagram:${diagramId}`, text, parentId)}
              editComment={(commentId, text) => gw.editContentComment(commentId, text)}
              deleteComment={(commentId) => gw.deleteContentComment(commentId)}
              resolveComment={(commentId) => gw.resolveContentComment(commentId)}
              unresolveComment={(commentId) => gw.unresolveContentComment(commentId)}
            />
          </div>
        )}

        {/* Version history sidebar */}
        {showHistory && (
          <div className="w-72 border-l border-border bg-card flex flex-col shrink-0 overflow-hidden">
            <ContentRevisionHistory
              contentId={`diagram:${diagramId}`}
              onClose={() => setShowHistory(false)}
              onRestored={async (data) => {
                if (graph && data) {
                  // Save restored data to backend
                  await gw.saveDiagram(diagramId, data);
                  // Reload the graph from the restored data
                  graph.fromJSON(data);
                  queryClient.invalidateQueries({ queryKey: ['diagram', diagramId] });
                }
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Menu Button ──
function MenuButton({ icon, label, onClick, danger }: { icon: React.ReactNode; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button
      className={cn(
        'w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-muted',
        danger ? 'text-destructive' : 'text-foreground',
      )}
      onClick={onClick}
    >
      {icon}
      {label}
    </button>
  );
}
