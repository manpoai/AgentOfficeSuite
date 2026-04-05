'use client';

import { useState, useEffect, useCallback, useRef, useMemo, useImperativeHandle, Component, type ErrorInfo, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Graph, Node, Edge, Cell } from '@antv/x6';
import * as gw from '@/lib/api/gateway';
import {
  ArrowLeft, ChevronRight,
  Plus, GitBranch, Type, Trash, X,
} from 'lucide-react';
import { CommentPanel } from '@/components/shared/CommentPanel';
import { BottomSheet } from '@/components/shared/BottomSheet';
import { RevisionHistory } from '@/components/shared/RevisionHistory';
import { EditFAB } from '@/components/shared/EditFAB';
import { cn } from '@/lib/utils';
import { showError } from '@/lib/utils/error';
import { useT, getT } from '@/lib/i18n';
import { ContentTopBar } from '@/components/shared/ContentTopBar';
import { useX6Graph } from './hooks/useX6Graph';
import { useAutoSave } from './hooks/useAutoSave';
import { usePinchZoom } from '@/lib/hooks/use-pinch-zoom';
import { LeftToolbar, type ActiveTool } from './components/LeftToolbar';
import { FloatingToolbar } from '@/components/shared/FloatingToolbar';
import { getDiagramNodeItems, getDiagramEdgeItems, getDiagramImageItems, getSimpleTableItems } from '@/components/shared/FloatingToolbar/presets';
import { createDiagramNodeHandler, createDiagramEdgeHandler, createDiagramImageHandler } from './diagram-toolbar-handler';
import { RichTable } from '@/components/shared/RichTable';
import { createDocsTableHandler } from '@/components/editor/docs-toolbar-handler';
import { ShapePicker } from '@/components/shared/ShapeSet';
import { SHAPE_MAP } from '@/components/shared/ShapeSet/shapes';
import { flowchartPorts } from './shapes/register';
import type { ToolbarItem } from '@/components/shared/FloatingToolbar/types';
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
import { diagramNodeActions, diagramCanvasActions, type DiagramNodeCtx, type DiagramCanvasCtx } from '@/actions/diagram-node.actions';
import { diagramSurfaces } from '@/surfaces/diagram.surfaces';
import { toContextMenuItems } from '@/surfaces/bridge';
import { buildActionMap } from '@/actions/types';
import { useKeyboardScope } from '@/lib/keyboard';
import type { ShortcutRegistration } from '@/lib/keyboard';

// ─── Module-level action maps ────────────────────────
const diagramNodeActionMap = buildActionMap(diagramNodeActions);
const diagramCanvasActionMap = buildActionMap(diagramCanvasActions);

// ─── Types ──────────────────────────────────────────
export interface DiagramEditorHandle {
  undo: () => void;
  redo: () => void;
  exportPNG: () => void;
  deleteDiagram: () => Promise<void>;
  save: () => Promise<void>;
  flushSave: () => Promise<void> | void;
  restoreFromSnapshot: (data: any) => Promise<void>;
}

export interface DiagramSaveStatus {
  saving: boolean;
  lastSaved: number | null;
}

interface X6DiagramEditorProps {
  diagramId: string;
  /** When provided, exposes editor controls to parent */
  editorRef?: React.Ref<DiagramEditorHandle>;
  /** Called when save status changes */
  onSaveStatusChange?: (status: DiagramSaveStatus) => void;
  /** Called after diagram is deleted */
  onDeleted?: () => void;
  /** When true, hides CommentPanel, RevisionHistory — used inside DiagramEditorDialog */
  embedded?: boolean;
  /** Show comments panel */
  showComments?: boolean;
  /** Show history panel */
  showHistory?: boolean;
  /** Called when comment/history panels should close */
  onClosePanel?: () => void;
  /** Breadcrumb navigation items */
  breadcrumb?: { id: string; title: string }[];
  /** Called when back button is pressed */
  onBack?: () => void;
  /** Whether doc list is visible */
  docListVisible?: boolean;
  /** Toggle doc list visibility */
  onToggleDocList?: () => void;
}

let nodeIdCounter = 0;
function newNodeId() {
  return `node_${Date.now().toString(36)}_${++nodeIdCounter}`;
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
    showError(getT()('diagram.crashed'), error);
  }
  render() {
    if (this.state.error) {
      const t = getT();
      return (
        <div className="flex items-center justify-center h-full bg-muted">
          <div className="text-center p-8 max-w-md">
            <p className="text-muted-foreground text-sm mb-2">{t('diagram.loadFailed')}</p>
            <p className="text-xs text-muted-foreground font-mono break-all">{this.state.error.message}</p>
            <button
              className="mt-4 px-4 py-2 bg-sidebar-primary text-sidebar-primary-foreground rounded text-sm hover:bg-sidebar-primary/90"
              onClick={() => this.setState({ error: null })}
            >
              {t('diagram.retry')}
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

/** Inline shape selector for diagram node toolbar — wraps ShapePicker in a dropdown */
function DiagramShapeSelector({ current, onSelect }: { current: string; onSelect: (v: string) => void }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as globalThis.Node)) setOpen(false);
    };
    const id = setTimeout(() => document.addEventListener('mousedown', handler, true), 0);
    return () => { clearTimeout(id); document.removeEventListener('mousedown', handler, true); };
  }, [open]);

  const shapeDef = SHAPE_MAP.get(current as any);
  const iconPath = shapeDef?.iconPath ?? '';

  return (
    <div className="relative" ref={ref}>
      <button
        className="h-[26px] px-1.5 flex items-center gap-0.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground text-xs"
        onClick={() => setOpen(!open)}
        onMouseDown={(e) => e.preventDefault()}
        title={t('diagram.shapes')}
      >
        <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
          <path d={iconPath} fill="none" />
        </svg>
        <span className="text-[10px]">▾</span>
      </button>
      {open && (
        <div className="absolute left-0 bottom-full mb-1 z-40" onMouseDown={(e) => e.preventDefault()}>
          <ShapePicker
            onSelect={(shapeType) => { onSelect(shapeType); setOpen(false); }}
            selectedShape={current}
            columns={6}
          />
        </div>
      )}
    </div>
  );
}

/** DOM overlay for table nodes in the diagram */
function DiagramTableOverlay({ graph, node, containerRef, isSelected }: {
  graph: any;
  node: any;
  containerRef: React.RefObject<HTMLDivElement | null>;
  isSelected: boolean;
}) {
  const [pos, setPos] = useState({ left: 0, top: 0, width: 360, height: 108 });
  const [editing, setEditing] = useState(false);
  const [tableToolbarInfo, setTableToolbarInfo] = useState<{
    anchor: { top: number; left: number; width: number };
    view: any;
  } | null>(null);

  const tableJSON = node.getData()?.tableJSON || null;

  const updatePos = useCallback(() => {
    if (!graph || !containerRef.current) return;
    const position = node.getPosition();
    const size = node.getSize();
    const topLeft = graph.localToGraph(position.x, position.y);
    const bottomRight = graph.localToGraph(position.x + size.width, position.y + size.height);
    setPos({
      left: topLeft.x,
      top: topLeft.y,
      width: bottomRight.x - topLeft.x,
      height: bottomRight.y - topLeft.y,
    });
  }, [graph, node, containerRef]);

  useEffect(() => {
    if (!graph) return;
    const handler = () => updatePos();
    graph.on('scale', handler);
    graph.on('translate', handler);
    graph.on('node:moved', handler);
    graph.on('node:resized', handler);
    updatePos();
    return () => {
      graph.off('scale', handler);
      graph.off('translate', handler);
      graph.off('node:moved', handler);
      graph.off('node:resized', handler);
    };
  }, [graph, updatePos]);

  // Double-click to enter edit mode
  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (isSelected) setEditing(true);
  }, [isSelected]);

  // Exit edit mode
  useEffect(() => {
    if (!editing) return;
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('.diagram-table-overlay') || target.closest('[data-floating-toolbar]')) return;
      setEditing(false);
      setTableToolbarInfo(null);
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setEditing(false);
        setTableToolbarInfo(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEsc);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEsc);
    };
  }, [editing]);

  const handleProsemirrorChange = useCallback((json: Record<string, unknown>) => {
    node.setData({ ...node.getData(), tableJSON: json });
  }, [node]);

  // Sync overlay size back to X6 node so selection frame matches table
  const overlayRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = overlayRef.current;
    if (!el || !graph) return;
    const observer = new ResizeObserver(() => {
      const { sx } = graph.scale();
      const zoom = sx || 1;
      const naturalW = el.scrollWidth / zoom;
      const naturalH = el.scrollHeight / zoom;
      const size = node.getSize();
      if (Math.abs(size.width - naturalW) > 2 || Math.abs(size.height - naturalH) > 2) {
        node.resize(naturalW, naturalH, { silent: true });
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [graph, node]);

  if (!tableJSON) return null;

  return (
    <>
      <div
        ref={overlayRef}
        className="diagram-table-overlay absolute overflow-visible"
        style={{
          left: pos.left,
          top: pos.top,
          width: pos.width,
          zIndex: editing ? 50 : isSelected ? 30 : 10,
          pointerEvents: editing || isSelected ? 'auto' : 'none',
        }}
        onDoubleClick={handleDoubleClick}
      >
        <RichTable
          prosemirrorJSON={tableJSON}
          onProsemirrorChange={editing ? handleProsemirrorChange : undefined}
          onCellToolbar={editing ? (info) => setTableToolbarInfo(info) : undefined}
          config={{
            cellMinWidth: 60,
            showToolbar: false,
            showContextMenu: editing,
            readonly: !editing,
          }}
          width="100%"
        />
        {!editing && isSelected && (
          <div className="absolute inset-0 border-2 border-sidebar-primary/50 rounded pointer-events-none" />
        )}
      </div>
      {tableToolbarInfo && editing && (
        <FloatingToolbar
          items={getSimpleTableItems()}
          handler={createDocsTableHandler(tableToolbarInfo.view)}
          anchor={tableToolbarInfo.anchor}
          visible={true}
        />
      )}
    </>
  );
}

export default function X6DiagramEditor(props: X6DiagramEditorProps) {
  return (
    <DiagramErrorBoundary>
      <X6DiagramEditorInner {...props} />
    </DiagramErrorBoundary>
  );
}

export { X6DiagramEditor };

const DIAGRAM_SHORTCUTS: ShortcutRegistration[] = [
  {
    id: 'diagram-tab',
    key: 'Tab',
    handler: () => window.dispatchEvent(new CustomEvent('diagram:add-child')),
    label: 'Add child node',
    category: 'Diagram',
    priority: 5,
  },
  {
    id: 'diagram-enter',
    key: 'Enter',
    handler: () => window.dispatchEvent(new CustomEvent('diagram:add-sibling')),
    label: 'Add sibling',
    category: 'Diagram',
    priority: 5,
  },
  {
    id: 'diagram-f2',
    key: 'F2',
    handler: () => window.dispatchEvent(new CustomEvent('diagram:edit-label')),
    label: 'Edit label',
    category: 'Diagram',
    priority: 5,
  },
  {
    id: 'diagram-select-all',
    key: 'a',
    modifiers: { meta: true },
    handler: () => window.dispatchEvent(new CustomEvent('diagram:select-all')),
    label: 'Select all',
    category: 'Diagram',
    priority: 5,
  },
];

function X6DiagramEditorInner({
  diagramId, editorRef, onSaveStatusChange, onDeleted, embedded,
  showComments: showCommentsProp, showHistory: showHistoryProp, onClosePanel,
  breadcrumb, onBack, docListVisible, onToggleDocList,
}: X6DiagramEditorProps) {
  const { t } = useT();

  // Register diagram keyboard scope + context shortcuts
  useKeyboardScope('diagram', DIAGRAM_SHORTCUTS);
  const queryClient = useQueryClient();

  // Refs
  const containerRef = useRef<HTMLDivElement>(null);
  const minimapRef = useRef<HTMLDivElement>(null);

  // X6 graph
  const { graph, ready, error: graphError } = useX6Graph(containerRef, minimapRef);

  // Mobile detection — editing not supported on mobile
  const isMobile = typeof window !== 'undefined' && window.innerWidth < 640;
  const mobileEditing = false;

  // State
  const [activeTool, setActiveTool] = useState<ActiveTool>('select');
  const [activeConnector, setActiveConnector] = useState<ConnectorType>(DEFAULT_CONNECTOR);
  const showComments = showCommentsProp ?? false;
  const showHistory = showHistoryProp ?? false;
  const [migrationNeeded, setMigrationNeeded] = useState(false);

  // Floating toolbar selection tracking
  const [diagramToolbarCell, setDiagramToolbarCell] = useState<Cell | null>(null);
  const [diagramToolbarAnchor, setDiagramToolbarAnchor] = useState<{ top: number; left: number; width: number } | null>(null);

  // Table nodes for DOM overlays
  const [tableNodes, setTableNodes] = useState<any[]>([]);

  // Mobile node overlays — workaround for Safari foreignObject positioning bug
  const [mobileNodeOverlays, setMobileNodeOverlays] = useState<Array<{
    id: string; x: number; y: number; width: number; height: number;
    label: string; bgColor: string; borderColor: string; textColor: string;
    fontSize: number; fontWeight: string; isRoot: boolean; collapsed: boolean; childCount: number;
  }>>([]);

  // Mindmap state
  const mindmapTreeRef = useRef<MindmapTreeNode | null>(null);
  const mindmapGroupIdRef = useRef<string>('');
  const startEditRef = useRef<((node: Node, initialKey?: string) => void) | null>(null);
  const justFinishedEditRef = useRef(0); // timestamp — used to debounce Enter after edit commit

  // Auto-save
  const { save, lastSaved, saving, flushSave } = useAutoSave(graph, diagramId);

  // Notify parent of save status changes
  useEffect(() => {
    onSaveStatusChange?.({ saving, lastSaved });
  }, [saving, lastSaved, onSaveStatusChange]);

  // ─── Pinch-to-zoom via shared hook ──
  usePinchZoom(containerRef, {
    onZoom: useCallback((scale: number) => {
      if (graph) graph.zoomTo(scale);
    }, [graph]),
    minScale: 0.2,
    maxScale: 3,
    getCurrentScale: useCallback(() => graph?.zoom() ?? 1, [graph]),
  });

  // ─── Mobile: toggle interacting on graph based on mobileEditing ──
  useEffect(() => {
    if (!graph || !isMobile) return;
    if (mobileEditing) {
      (graph as any).options.interacting = {
        nodeMovable: true,
        edgeMovable: true,
        edgeLabelMovable: true,
      };
    } else {
      // Preview mode: disable all editing interactions
      (graph as any).options.interacting = false;
      // Panning remains enabled so user can scroll the canvas in preview

      // Disable selection plugin (hides selection boxes and resize handles)
      const selPlugin = (graph as any).getPlugin('selection');
      if (selPlugin) selPlugin.disable();
      const transformPlugin = (graph as any).getPlugin('transform');
      if (transformPlugin) transformPlugin.disable();

      // Clear any existing selection
      graph.cleanSelection();

      // Hide all ports on all nodes
      graph.getNodes().forEach((node: any) => {
        const ports = node.getPorts();
        ports.forEach((port: any) => {
          node.portProp(port.id!, 'attrs/circle/style/visibility', 'hidden');
        });
      });
    }
  }, [graph, isMobile, mobileEditing]);

  // ─── Diagram floating toolbar: track selection & position ──
  useEffect(() => {
    if (!graph) return;

    const computeAnchor = (cell: Cell): { top: number; left: number; width: number } | null => {
      const container = graph.container?.parentElement;
      if (!container) return null;
      const containerRect = container.getBoundingClientRect();

      if (cell.isNode()) {
        const node = cell as Node;
        const pos = node.position();
        const size = node.size();
        const graphPt = graph.localToGraph(pos.x + size.width / 2, pos.y);
        return {
          top: containerRect.top + graphPt.y - 10,
          left: containerRect.left + graphPt.x - size.width / 2,
          width: size.width,
        };
      }
      if (cell.isEdge()) {
        const edge = cell as Edge;
        const sourceCell = edge.getSourceCell();
        const targetCell = edge.getTargetCell();
        if (sourceCell?.isNode() && targetCell?.isNode()) {
          const sp = (sourceCell as Node).position();
          const ss = (sourceCell as Node).size();
          const tp = (targetCell as Node).position();
          const ts = (targetCell as Node).size();
          const sx = sp.x + ss.width / 2, sy = sp.y + ss.height / 2;
          const tx = tp.x + ts.width / 2, ty = tp.y + ts.height / 2;
          const midPt = graph.localToGraph((sx + tx) / 2, Math.min(sy, ty));
          return {
            top: containerRect.top + midPt.y - 10,
            left: containerRect.left + midPt.x - 50,
            width: 100,
          };
        }
        const vertices = edge.getVertices();
        if (vertices.length > 0) {
          const v = vertices[Math.floor(vertices.length / 2)];
          const gp = graph.localToGraph(v.x, v.y);
          return {
            top: containerRect.top + gp.y - 10,
            left: containerRect.left + gp.x - 50,
            width: 100,
          };
        }
        return null;
      }
      return null;
    };

    const updateSelection = () => {
      const cells = graph.getSelectedCells();
      if (cells.length === 1) {
        const cell = cells[0];
        setDiagramToolbarCell(cell);
        setDiagramToolbarAnchor(computeAnchor(cell));
      } else {
        setDiagramToolbarCell(null);
        setDiagramToolbarAnchor(null);
      }
    };

    const onNodeMoved = () => {
      const cells = graph.getSelectedCells();
      if (cells.length === 1 && cells[0].isNode()) {
        setDiagramToolbarAnchor(computeAnchor(cells[0]));
      }
    };

    graph.on('selection:changed', updateSelection);
    graph.on('node:moved', onNodeMoved);
    graph.on('node:resized', onNodeMoved);

    return () => {
      graph.off('selection:changed', updateSelection);
      graph.off('node:moved', onNodeMoved);
      graph.off('node:resized', onNodeMoved);
    };
  }, [graph]);

  // ─── Track table nodes for DOM overlays ──
  useEffect(() => {
    if (!graph) return;
    const refreshTableNodes = () => {
      const nodes = graph.getNodes().filter((n: any) => n.getData()?.type === 'table');
      setTableNodes([...nodes]);
    };
    graph.on('node:added', refreshTableNodes);
    graph.on('node:removed', refreshTableNodes);
    graph.on('node:change:data', refreshTableNodes);
    refreshTableNodes();
    return () => {
      graph.off('node:added', refreshTableNodes);
      graph.off('node:removed', refreshTableNodes);
      graph.off('node:change:data', refreshTableNodes);
    };
  }, [graph]);

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
      const x6Data = migrateToX6(rawData);
      graph.fromJSON(x6Data);
      if (x6Data.viewport) {
        graph.translate(x6Data.viewport.x || 0, x6Data.viewport.y || 0);
        graph.zoomTo(x6Data.viewport.zoom || 1);
      }
    } else {
      // X6 native format
      if (rawData.cells) {
        graph.fromJSON(rawData);
      }
      if (rawData.viewport) {
        graph.translate(rawData.viewport.x || 0, rawData.viewport.y || 0);
      }
      graph.zoomTo(1);
    }

    if (isMobile) {
      // Safari has a known bug where foreignObject positions are wrong.
      // Workaround: hide foreignObject content, render HTML overlays instead.
      const setupMobileOverlays = () => {
        try {
          const area = graph.getContentArea();
          const container = graph.container?.parentElement;
          if (!container || !area || area.width === 0 || area.height === 0) return;
          const cw = container.clientWidth;
          const ch = container.clientHeight;
          if (cw === 0 || ch === 0) return;
          const padding = 40;
          const scaleX = (cw - padding * 2) / area.width;
          const scaleY = (ch - padding * 2) / area.height;
          const scale = Math.min(scaleX, scaleY, 1);
          graph.zoomTo(scale);
          const tx = (cw - area.width * scale) / 2 - area.x * scale;
          const ty = (ch - area.height * scale) / 2 - area.y * scale;
          graph.translate(tx, ty);

          // Hide all foreignObject content (Safari renders them at wrong positions)
          const foElements = graph.container?.querySelectorAll('foreignObject');
          foElements?.forEach(fo => {
            (fo as HTMLElement).style.opacity = '0';
          });

          // Build overlay data for all nodes
          const overlays = graph.getNodes().map(n => {
            const pos = n.position();
            const size = n.size();
            const data = n.getData() || {};
            return {
              id: n.id,
              x: pos.x * scale + tx,
              y: pos.y * scale + ty,
              width: size.width * scale,
              height: size.height * scale,
              label: data.label || '',
              bgColor: data.bgColor || '#ffffff',
              borderColor: data.borderColor || '#d1d5db',
              textColor: data.textColor || '#1f2937',
              fontSize: (data.fontSize || 14) * scale,
              fontWeight: data.fontWeight || 'normal',
              isRoot: !!data.isRoot,
              collapsed: !!data.collapsed,
              childCount: data.childCount || 0,
            };
          });
          setMobileNodeOverlays(overlays);
        } catch (e) {
          console.warn('setupMobileOverlays failed:', e);
        }
      };
      setTimeout(setupMobileOverlays, 300);
      setTimeout(setupMobileOverlays, 800);
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

    // Refresh table node overlays after data load (fromJSON may not trigger node:added)
    const tableNodesAfterLoad = graph.getNodes().filter((n: any) => n.getData()?.type === 'table');
    if (tableNodesAfterLoad.length > 0) {
      // Inject ports for legacy table nodes saved without ports
      for (const tn of tableNodesAfterLoad) {
        if (!tn.getPorts || tn.getPorts().length === 0) {
          try { tn.prop('ports', flowchartPorts); } catch {}
        }
      }
      setTableNodes([...tableNodesAfterLoad]);
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

      // Copy / Paste via action maps
      if (meta && e.key === 'c') {
        const cells = graph.getSelectedCells();
        if (cells.length) {
          const ctx: DiagramNodeCtx = { graph, cell: cells[0] };
          diagramNodeActionMap['diagram-copy'].execute(ctx);
          e.preventDefault();
        }
        return;
      }
      if (meta && e.key === 'v') {
        const ctx: DiagramCanvasCtx = { graph };
        diagramCanvasActionMap['diagram-canvas-paste'].execute(ctx);
        e.preventDefault();
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

      if (activeTool === 'table') {
        const defaultTableJSON = {
          type: 'doc',
          content: [{ type: 'table', content: [
            { type: 'table_row', content: Array.from({ length: 3 }, () => ({
              type: 'table_header',
              attrs: { colspan: 1, rowspan: 1, alignment: null, colwidth: null, background: null },
              content: [{ type: 'paragraph' }],
            }))},
            ...Array.from({ length: 2 }, () => ({
              type: 'table_row',
              content: Array.from({ length: 3 }, () => ({
                type: 'table_cell',
                attrs: { colspan: 1, rowspan: 1, alignment: null, colwidth: null, background: null },
                content: [{ type: 'paragraph' }],
              })),
            })),
          ]}],
        };
        const nodeId = `tbl_${Date.now().toString(36)}`;
        graph.addNode({
          id: nodeId,
          x: x + previewOffset - 180,
          y: y + previewOffset - 54,
          width: 360,
          height: 108,
          data: { type: 'table', tableJSON: defaultTableJSON },
          attrs: {
            body: { fill: 'transparent', stroke: 'transparent', strokeWidth: 0 },
          },
          ports: flowchartPorts,
        });
        graph.select(graph.getCellById(nodeId)!);
        setActiveTool('select');
        return;
      }

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

  // ─── Context menu: desktop right-click + mobile long-press ──
  useEffect(() => {
    if (!graph) return;
    const container = containerRef.current;
    if (!container) return;

    // Shared: build context menu items via actions+bridge
    const showMenu = (x: number, y: number, hitCell?: Cell) => {
      const items = hitCell
        ? toContextMenuItems(diagramSurfaces.nodeMenu, diagramNodeActionMap, { graph, cell: hitCell } as DiagramNodeCtx, t)
        : toContextMenuItems(diagramSurfaces.canvasMenu, diagramCanvasActionMap, { graph } as DiagramCanvasCtx, t);
      if (items.length > 0) {
        window.dispatchEvent(
          new CustomEvent('show-context-menu', { detail: { items, x, y } })
        );
      }
    };

    // Desktop: right-click
    const onContextMenu = (e: MouseEvent) => {
      const g = graph;
      let hitCell: Cell | undefined;
      if (g) {
        try {
          // Check if click is on an edge — if so, allow browser default menu
          const edges = g.model.getEdges().filter(edge => {
            try {
              const view = g.findViewByCell(edge);
              return view && view.container.contains(e.target as globalThis.Node);
            } catch { return false; }
          });
          if (edges.length > 0) {
            return; // don't preventDefault — show browser default menu
          }
        } catch { /* ignore edge detection errors */ }
        try {
          // Find and select node under cursor
          const localPoint = g.clientToLocal({ x: e.clientX, y: e.clientY });
          const nodes = g.getNodesFromPoint(localPoint.x, localPoint.y);
          if (nodes.length > 0) {
            const topNode = nodes[nodes.length - 1];
            if (!g.isSelected(topNode)) {
              g.cleanSelection();
              g.select(topNode);
            }
            hitCell = topNode;
          } else {
            const selected = g.getSelectedCells().filter(c => c.isNode());
            if (selected.length > 0) hitCell = selected[0];
          }
        } catch { /* ignore selection errors */ }
      }
      e.preventDefault();
      e.stopPropagation();
      showMenu(e.clientX, e.clientY, hitCell);
    };
    container.addEventListener('contextmenu', onContextMenu, true);

    // Mobile: long-press
    let longPressTimer: ReturnType<typeof setTimeout> | null = null;
    let touchStartPos: { x: number; y: number } | null = null;

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) {
        if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
        return;
      }
      const touch = e.touches[0];
      touchStartPos = { x: touch.clientX, y: touch.clientY };

      longPressTimer = setTimeout(() => {
        if (!touchStartPos) return;
        showMenu(touchStartPos.x, touchStartPos.y);
      }, 500);
    };

    const onTouchMove = (e: TouchEvent) => {
      if (longPressTimer && touchStartPos) {
        const touch = e.touches[0];
        if (touch) {
          const dx = touch.clientX - touchStartPos.x;
          const dy = touch.clientY - touchStartPos.y;
          if (Math.sqrt(dx * dx + dy * dy) > 10) {
            clearTimeout(longPressTimer);
            longPressTimer = null;
          }
        }
      }
    };

    const onTouchEnd = () => {
      if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
      touchStartPos = null;
    };

    container.addEventListener('touchstart', onTouchStart, { passive: true });
    container.addEventListener('touchmove', onTouchMove, { passive: true });
    container.addEventListener('touchend', onTouchEnd);
    container.addEventListener('touchcancel', onTouchEnd);

    return () => {
      container.removeEventListener('contextmenu', onContextMenu, true);
      container.removeEventListener('touchstart', onTouchStart);
      container.removeEventListener('touchmove', onTouchMove);
      container.removeEventListener('touchend', onTouchEnd);
      container.removeEventListener('touchcancel', onTouchEnd);
      if (longPressTimer) clearTimeout(longPressTimer);
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
    if (!confirm(t('diagram.deleteConfirm'))) return;
    try {
      // TODO: implement delete API
      onDeleted?.();
    } catch (e) {
      showError('Delete diagram failed', e);
    }
  }, [onDeleted]);

  // ─── Export ──
  const handleExport = useCallback(() => {
    if (!graph) return;
    graph.exportPNG('diagram.png', { padding: 20 });
  }, [graph]);

  // ─── Expose controls to parent via ref ──
  useImperativeHandle(editorRef, () => ({
    undo: () => graph?.undo(),
    redo: () => graph?.redo(),
    exportPNG: () => handleExport(),
    deleteDiagram: () => handleDelete(),
    save: () => save(),
    flushSave: () => flushSave(),
    restoreFromSnapshot: async (data: any) => {
      if (graph && data) {
        await gw.saveDiagram(diagramId, data);
        graph.fromJSON(data);
        queryClient.invalidateQueries({ queryKey: ['diagram', diagramId] });
      }
    },
  }), [graph, handleExport, handleDelete, save, flushSave, diagramId, queryClient]);

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
    <div className="flex flex-row h-full bg-muted">
      {/* Left column: Header + canvas + toolbar */}
      <div className="flex-1 flex flex-col h-full min-w-0">
      {/* ── Header ── */}
      {!embedded && (
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
          mode={isMobile && mobileEditing ? 'edit' : undefined}
          statusText={saving ? 'Saving...' : lastSaved ? `Saved ${formatRelativeTime(lastSaved)}` : ''}
          actions={<>
            <button
              className="p-1.5 rounded hover:bg-muted text-muted-foreground"
              onClick={() => graph?.undo()}
              title={t('toolbar.undo')}
            >
              <Undo2 size={16} />
            </button>
            <button
              className="p-1.5 rounded hover:bg-muted text-muted-foreground"
              onClick={() => graph?.redo()}
              title={t('toolbar.redo')}
            >
              <Redo2 size={16} />
            </button>
            <button
              onClick={() => { setShowComments(v => !v); setShowHistory(false); }}
              className={cn('p-1.5 rounded transition-colors', showComments ? 'text-[#2fcc71] bg-[#2fcc71]/10' : 'text-[#2fcc71] hover:text-[#27ae60]')}
              title={t('content.comments')}
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
      )}

      {/* ── Migration banner ── */}
      {migrationNeeded && (
        <div className="bg-sidebar-accent border-b border-sidebar-primary/30 px-4 py-2 flex items-center gap-3 text-sm">
          <span className="text-sidebar-primary">{t('diagram.migrationNotice')}</span>
          <button
            className="px-3 py-1 bg-sidebar-primary text-sidebar-primary-foreground rounded text-xs hover:bg-sidebar-primary/90"
            onClick={handleMigrate}
          >
            {t('diagram.saveNewFormat')}
          </button>
        </div>
      )}

      {/* ── Canvas + sidebar row ── */}
      <div className="flex-1 flex min-h-0">
        {/* ── Canvas area ── */}
        <div className="flex-1 relative overflow-hidden bg-[#F5F7F5] dark:bg-zinc-900">
          {/* X6 container */}
          <div
            ref={containerRef}
            className={cn('w-full h-full', activeTool !== 'select' && 'cursor-crosshair')}
          />

          {/* Mobile node overlays — workaround for Safari foreignObject bug */}
          {isMobile && mobileNodeOverlays.length > 0 && (
            <div className="absolute inset-0 pointer-events-none" style={{ zIndex: 1 }}>
              {mobileNodeOverlays.map(n => (
                <div
                  key={n.id}
                  style={{
                    position: 'absolute',
                    left: n.x,
                    top: n.y,
                    width: n.width,
                    height: n.height,
                    backgroundColor: n.bgColor,
                    border: `${Math.max(1, n.fontSize / 7)}px solid ${n.borderColor}`,
                    borderRadius: n.isRoot ? n.height * 0.25 : n.height * 0.15,
                    color: n.textColor,
                    fontSize: Math.max(6, n.fontSize),
                    fontWeight: n.isRoot ? 'bold' : n.fontWeight,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: '0 4px',
                    overflow: 'hidden',
                    whiteSpace: 'nowrap',
                    textOverflow: 'ellipsis',
                    boxSizing: 'border-box',
                  }}
                >
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{n.label}</span>
                </div>
              ))}
            </div>
          )}

          {/* Error fallback */}
          {graphError && (
            <div className="absolute inset-0 flex items-center justify-center bg-muted z-50">
              <div className="text-center p-8">
                <p className="text-muted-foreground text-sm mb-2">{t('diagram.loadFailed')}</p>
                <p className="text-xs text-muted-foreground font-mono">{graphError}</p>
              </div>
            </div>
          )}

          {/* Left toolbar — hidden on mobile in preview mode */}
          {(!isMobile || mobileEditing) && (
            <LeftToolbar
              activeTool={activeTool}
              onToolChange={setActiveTool}
              activeConnector={activeConnector}
              onConnectorChange={setActiveConnector}
              graph={graph}
            />
          )}

          {/* Floating toolbar — hidden on mobile in preview mode */}
          {(!isMobile || mobileEditing) && graph && diagramToolbarCell && diagramToolbarAnchor && (() => {
            const data = diagramToolbarCell.getData() || {};
            const isNode = diagramToolbarCell.isNode();
            const isEdge = diagramToolbarCell.isEdge();
            const isImage = isNode && diagramToolbarCell.shape === 'image-node';
            const isMindmapNode = !!data.mindmapGroupId;

            // Skip mindmap nodes for now (they have limited toolbar)
            if (isMindmapNode) return null;

            let items, handler;
            if (isImage) {
              items = getDiagramImageItems();
              handler = createDiagramImageHandler({ graph, cell: diagramToolbarCell });
            } else if (isEdge) {
              items = getDiagramEdgeItems();
              handler = createDiagramEdgeHandler({ graph, cell: diagramToolbarCell });
            } else if (isNode && data.flowchartShape !== undefined) {
              // Inject ShapePicker renderCustom for the shapeSelect item
              items = getDiagramNodeItems().map(item =>
                item.key === 'shapeSelect'
                  ? { ...item, renderCustom: (val: string | undefined, onSelect: (v: string) => void) => (
                      <DiagramShapeSelector current={val || 'rounded-rect'} onSelect={onSelect} />
                    )} as ToolbarItem
                  : item
              );
              handler = createDiagramNodeHandler({ graph, cell: diagramToolbarCell });
            } else {
              return null;
            }

            return (
              <FloatingToolbar
                items={items}
                handler={handler}
                anchor={diagramToolbarAnchor}
                visible={true}
              />
            );
          })()}

          {/* Table DOM overlays */}
          {graph && tableNodes.map((tNode) => (
            <DiagramTableOverlay
              key={tNode.id}
              graph={graph}
              node={tNode}
              containerRef={containerRef}
              isSelected={diagramToolbarCell?.id === tNode.id}
            />
          ))}

          {/* Zoom bar — hidden on mobile */}
          {!isMobile && <ZoomBar graph={graph} />}

          {/* Shape preview following cursor — desktop only */}
          {!isMobile && (
            <ShapePreview activeTool={activeTool} containerRef={containerRef} graph={graph} onDragCreate={handleDragCreate} />
          )}

          {/* Minimap — hidden on mobile */}
          <div
            ref={minimapRef}
            className={cn(
              'absolute right-3 bottom-12 bg-card rounded-lg shadow-md border border-border overflow-hidden',
              isMobile && 'hidden',
            )}
            style={{ width: 180, height: 120 }}
          />

          {/* Mobile: no edit FAB — editing not supported on mobile */}
        </div>

      </div>
      </div>{/* end left column */}

      {/* Sidebar — full height on desktop, BottomSheet on mobile */}
      {showComments && !showHistory && !embedded && (
        <>
          <div className="hidden md:flex w-80 border-l border-border bg-card flex-col shrink-0 overflow-hidden h-full">
            <CommentPanel
              targetType="diagram"
              targetId={`diagram:${diagramId}`}
              onClose={() => setShowComments(false)}
            />
          </div>
          <BottomSheet open={true} onClose={() => setShowComments(false)} title={t('content.comments')} initialHeight="full">
            <CommentPanel
              targetType="diagram"
              targetId={`diagram:${diagramId}`}
              onClose={() => setShowComments(false)}
            />
          </BottomSheet>
        </>
      )}

      {showHistory && !embedded && (
        <>
          <div className="hidden md:flex w-72 border-l border-border bg-card flex-col shrink-0 overflow-hidden h-full">
            <RevisionHistory
              contentType="diagram"
              contentId={diagramId}
              onClose={() => setShowHistory(false)}
              onRestore={async (data) => {
                if (graph && data) {
                  await gw.saveDiagram(diagramId, data);
                  graph.fromJSON(data);
                  queryClient.invalidateQueries({ queryKey: ['diagram', diagramId] });
                }
              }}
            />
          </div>
          <div className="md:hidden">
            <RevisionHistory
              contentType="diagram"
              contentId={diagramId}
              onClose={() => setShowHistory(false)}
              onRestore={async (data) => {
                if (graph && data) {
                  await gw.saveDiagram(diagramId, data);
                  graph.fromJSON(data);
                  queryClient.invalidateQueries({ queryKey: ['diagram', diagramId] });
                }
              }}
            />
          </div>
        </>
      )}
    </div>
  );
}

