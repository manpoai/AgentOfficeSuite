'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as gw from '@/lib/api/gateway';
import {
  ArrowLeft, ArrowLeftToLine, ArrowRightToLine,
  MoreHorizontal, Link2, Download, Trash2, ChevronRight,
  Square, Diamond, Circle, Type, ArrowRight,
  LayoutGrid, GitBranch, Minus, Plus as PlusIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { showError } from '@/lib/utils/error';
import { useT } from '@/lib/i18n';
import {
  ReactFlow,
  MiniMap,
  Controls,
  Background,
  BackgroundVariant,
  addEdge,
  applyNodeChanges,
  applyEdgeChanges,
  MarkerType,
  Panel,
  useReactFlow,
  ReactFlowProvider,
  type Node,
  type Edge,
  type OnNodesChange,
  type OnEdgesChange,
  type OnConnect,
  type NodeTypes,
  type EdgeTypes,
  type Connection,
  type NodeChange,
  type EdgeChange,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import dagre from 'dagre';

// ─── Types ──────────────────────────────────────────
interface DiagramEditorProps {
  diagramId: string;
  breadcrumb?: { id: string; title: string }[];
  onBack?: () => void;
  onDeleted?: () => void;
  onCopyLink?: () => void;
  docListVisible?: boolean;
  onToggleDocList?: () => void;
}

type NodeShape = 'rectangle' | 'rounded' | 'diamond' | 'circle' | 'mindmap' | 'mindmap-root';

// ─── Custom Node Components ─────────────────────────
function FlowchartNode({ data, selected }: { data: any; selected?: boolean }) {
  const shape: NodeShape = data.shape || 'rounded';
  const bgColor = data.bgColor || '#ffffff';
  const borderColor = data.borderColor || '#374151';
  const textColor = data.textColor || '#1f2937';

  const shapeClasses: Record<string, string> = {
    rectangle: 'rounded-none',
    rounded: 'rounded-lg',
    circle: 'rounded-full aspect-square flex items-center justify-center',
    diamond: '',
    mindmap: 'rounded-xl',
    'mindmap-root': 'rounded-2xl',
  };

  if (shape === 'diamond') {
    return (
      <div className="relative" style={{ width: 120, height: 80 }}>
        <div
          className={cn('absolute inset-0 border-2', selected && 'ring-2 ring-sidebar-primary')}
          style={{
            backgroundColor: bgColor,
            borderColor,
            transform: 'rotate(45deg)',
            transformOrigin: 'center',
            width: '70%',
            height: '70%',
            margin: '15%',
          }}
        />
        <div className="absolute inset-0 flex items-center justify-center text-xs font-medium pointer-events-none" style={{ color: textColor }}>
          {data.label || ''}
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'px-4 py-2 border-2 min-w-[80px] text-center text-sm font-medium',
        shapeClasses[shape] || 'rounded-lg',
        shape === 'mindmap-root' && 'px-6 py-3 text-base font-bold',
        shape === 'mindmap' && 'px-3 py-1.5 text-sm border',
        selected && 'ring-2 ring-sidebar-primary',
      )}
      style={{
        backgroundColor: bgColor,
        borderColor,
        color: textColor,
      }}
    >
      {data.label || ''}
    </div>
  );
}

const nodeTypes: NodeTypes = {
  flowchart: FlowchartNode,
};

// ─── Dagre Layout ───────────────────────────────────
function getLayoutedElements(nodes: Node[], edges: Edge[], direction = 'TB') {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: direction, nodesep: 60, ranksep: 80 });

  nodes.forEach((node) => {
    g.setNode(node.id, { width: 150, height: 50 });
  });
  edges.forEach((edge) => {
    g.setEdge(edge.source, edge.target);
  });

  dagre.layout(g);

  const layoutedNodes = nodes.map((node) => {
    const pos = g.node(node.id);
    return { ...node, position: { x: pos.x - 75, y: pos.y - 25 } };
  });

  return { nodes: layoutedNodes, edges };
}

// ─── Colors ─────────────────────────────────────────
const NODE_COLORS = [
  { bg: '#ffffff', border: '#374151', text: '#1f2937', name: 'Default' },
  { bg: '#dbeafe', border: '#3b82f6', text: '#1e40af', name: 'Blue' },
  { bg: '#dcfce7', border: '#22c55e', text: '#166534', name: 'Green' },
  { bg: '#fef9c3', border: '#eab308', text: '#854d0e', name: 'Yellow' },
  { bg: '#fee2e2', border: '#ef4444', text: '#991b1b', name: 'Red' },
  { bg: '#f3e8ff', border: '#a855f7', text: '#6b21a8', name: 'Purple' },
  { bg: '#ffedd5', border: '#f97316', text: '#9a3412', name: 'Orange' },
  { bg: '#e0e7ff', border: '#6366f1', text: '#3730a3', name: 'Indigo' },
];

const MINDMAP_COLORS = [
  { bg: '#dbeafe', border: '#3b82f6', text: '#1e40af' },
  { bg: '#dcfce7', border: '#22c55e', text: '#166534' },
  { bg: '#fef9c3', border: '#eab308', text: '#854d0e' },
  { bg: '#f3e8ff', border: '#a855f7', text: '#6b21a8' },
  { bg: '#ffedd5', border: '#f97316', text: '#9a3412' },
  { bg: '#fee2e2', border: '#ef4444', text: '#991b1b' },
];

// ─── Helper ─────────────────────────────────────────
function formatRelativeTime(ts: number): string {
  const now = Date.now();
  const diff = now - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} minutes ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hours ago`;
  const days = Math.floor(hours / 24);
  return `${days} days ago`;
}

let nodeIdCounter = 0;
function newNodeId() {
  return `node_${Date.now()}_${++nodeIdCounter}`;
}

// ─── Inner Component (needs ReactFlowProvider) ──────
function DiagramEditorInner({
  diagramId, breadcrumb, onBack, onDeleted, onCopyLink, docListVisible, onToggleDocList,
}: DiagramEditorProps) {
  const { t } = useT();
  const queryClient = useQueryClient();
  const reactFlowInstance = useReactFlow();

  // State
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [showMenu, setShowMenu] = useState(false);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [activeTool, setActiveTool] = useState<'select' | NodeShape>('select');
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [selectedColor, setSelectedColor] = useState(NODE_COLORS[0]);

  // Refs
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const initialLoadedRef = useRef(false);

  // Fetch diagram data
  const { data: diagram, isLoading } = useQuery({
    queryKey: ['diagram', diagramId],
    queryFn: () => gw.getDiagram(diagramId),
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const currentTitle = breadcrumb?.[breadcrumb.length - 1]?.title || '';

  // Load data
  useEffect(() => {
    if (!diagram || initialLoadedRef.current) return;
    const data = diagram.data;
    if (data.nodes?.length > 0) {
      // Ensure all nodes have the flowchart type
      setNodes(data.nodes.map((n: any) => ({ ...n, type: n.type || 'flowchart' })));
    }
    if (data.edges?.length > 0) {
      setEdges(data.edges);
    }
    if (data.viewport) {
      setTimeout(() => {
        reactFlowInstance.setViewport(data.viewport);
      }, 100);
    }
    initialLoadedRef.current = true;
  }, [diagram, reactFlowInstance]);

  // Reset on ID change
  useEffect(() => {
    initialLoadedRef.current = false;
    setNodes([]);
    setEdges([]);
  }, [diagramId]);

  // ─── Auto-save ────────────────────────────────────
  const triggerSave = useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      const viewport = reactFlowInstance.getViewport();
      gw.saveDiagram(diagramId, {
        nodes: nodes.map(n => ({ ...n, selected: undefined })),
        edges: edges.map(e => ({ ...e, selected: undefined })),
        viewport,
      }).catch((err: Error) => {
        showError('Diagram auto-save failed', err);
      });
    }, 1000);
  }, [diagramId, nodes, edges, reactFlowInstance]);

  // Trigger save on changes
  useEffect(() => {
    if (!initialLoadedRef.current) return;
    triggerSave();
  }, [nodes, edges, triggerSave]);

  // ─── ReactFlow callbacks ──────────────────────────
  const onNodesChange: OnNodesChange = useCallback((changes: NodeChange[]) => {
    setNodes((nds) => applyNodeChanges(changes, nds));
  }, []);

  const onEdgesChange: OnEdgesChange = useCallback((changes: EdgeChange[]) => {
    setEdges((eds) => applyEdgeChanges(changes, eds));
  }, []);

  const onConnect: OnConnect = useCallback((connection: Connection) => {
    setEdges((eds) => addEdge({
      ...connection,
      type: 'smoothstep',
      markerEnd: { type: MarkerType.ArrowClosed },
      style: { strokeWidth: 2 },
    }, eds));
  }, []);

  // ─── Add Node ─────────────────────────────────────
  const addNode = useCallback((shape: NodeShape, position?: { x: number; y: number }) => {
    const viewport = reactFlowInstance.getViewport();
    const pos = position || {
      x: (-viewport.x + 400) / viewport.zoom + Math.random() * 50,
      y: (-viewport.y + 300) / viewport.zoom + Math.random() * 50,
    };

    const isMindmap = shape === 'mindmap' || shape === 'mindmap-root';
    const colorIdx = nodes.length % MINDMAP_COLORS.length;
    const color = isMindmap ? MINDMAP_COLORS[colorIdx] : selectedColor;

    const newNode: Node = {
      id: newNodeId(),
      type: 'flowchart',
      position: pos,
      data: {
        label: isMindmap ? (shape === 'mindmap-root' ? 'Central Topic' : 'Branch') : 'New Node',
        shape,
        bgColor: color.bg,
        borderColor: color.border,
        textColor: color.text,
      },
    };

    setNodes((nds) => [...nds, newNode]);
    setActiveTool('select');
  }, [nodes, selectedColor, reactFlowInstance]);

  // ─── Canvas click to add node ─────────────────────
  const onPaneClick = useCallback((event: React.MouseEvent) => {
    if (activeTool !== 'select') {
      const bounds = (event.target as HTMLElement).closest('.react-flow')?.getBoundingClientRect();
      if (bounds) {
        const viewport = reactFlowInstance.getViewport();
        const position = {
          x: (event.clientX - bounds.left - viewport.x) / viewport.zoom,
          y: (event.clientY - bounds.top - viewport.y) / viewport.zoom,
        };
        addNode(activeTool, position);
      }
    }
  }, [activeTool, addNode, reactFlowInstance]);

  // ─── Double click to edit label ───────────────────
  const onNodeDoubleClick = useCallback((_: React.MouseEvent, node: Node) => {
    const newLabel = prompt('Edit label:', node.data.label || '');
    if (newLabel !== null) {
      setNodes((nds) => nds.map((n) =>
        n.id === node.id ? { ...n, data: { ...n.data, label: newLabel } } : n
      ));
    }
  }, []);

  // ─── Delete selected ─────────────────────────────
  const deleteSelected = useCallback(() => {
    setNodes((nds) => nds.filter((n) => !n.selected));
    setEdges((eds) => eds.filter((e) => !e.selected));
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA') return;
        deleteSelected();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [deleteSelected]);

  // ─── Auto Layout ──────────────────────────────────
  const autoLayout = useCallback((direction: 'TB' | 'LR' = 'TB') => {
    const { nodes: layoutedNodes, edges: layoutedEdges } = getLayoutedElements(nodes, edges, direction);
    setNodes(layoutedNodes);
    setEdges(layoutedEdges);
    setTimeout(() => reactFlowInstance.fitView({ padding: 0.2 }), 50);
  }, [nodes, edges, reactFlowInstance]);

  // ─── Export JSON ───────────────────────────────────
  const handleExport = useCallback(() => {
    setShowMenu(false);
    const data = JSON.stringify({ nodes, edges }, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${currentTitle || 'diagram'}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [nodes, edges, currentTitle]);

  // ─── Title Editing ────────────────────────────────
  const startEditTitle = useCallback(() => {
    setEditTitle(currentTitle || '');
    setIsEditingTitle(true);
    setTimeout(() => titleInputRef.current?.select(), 0);
  }, [currentTitle]);

  const saveTitle = useCallback(async () => {
    setIsEditingTitle(false);
    const newTitle = editTitle.trim();
    if (newTitle !== currentTitle) {
      await gw.updateContentItem(`diagram:${diagramId}`, { title: newTitle });
      queryClient.invalidateQueries({ queryKey: ['content-items'] });
    }
  }, [editTitle, currentTitle, diagramId, queryClient]);

  // ─── Delete ───────────────────────────────────────
  const handleDelete = useCallback(async () => {
    setShowMenu(false);
    await gw.deleteContentItem(`diagram:${diagramId}`);
    queryClient.invalidateQueries({ queryKey: ['content-items'] });
    onDeleted?.();
  }, [diagramId, queryClient, onDeleted]);

  // ─── Loading / Not Found ──────────────────────────
  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground">
        <div className="text-sm">{t('common.loading') || 'Loading...'}</div>
      </div>
    );
  }

  if (!diagram) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground">
        <div className="text-sm">{t('diagram.notFound')}</div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-card">
      {/* ─── Header Bar ─── */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border shrink-0">
        <button onClick={onBack} className="md:hidden p-1 text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" />
        </button>

        {onToggleDocList && (
          <button
            onClick={onToggleDocList}
            className="hidden md:flex p-1 text-muted-foreground hover:text-foreground"
            title={docListVisible ? 'Hide sidebar' : 'Show sidebar'}
          >
            {docListVisible ? <ArrowLeftToLine className="h-4 w-4" /> : <ArrowRightToLine className="h-4 w-4" />}
          </button>
        )}

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1 text-sm">
            {breadcrumb?.map((crumb, i) => (
              <span key={crumb.id} className="flex items-center gap-1 min-w-0">
                {i > 0 && <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />}
                {i < (breadcrumb.length - 1) ? (
                  <span className="text-muted-foreground truncate">{crumb.title}</span>
                ) : isEditingTitle ? (
                  <input
                    ref={titleInputRef}
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    onBlur={saveTitle}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') saveTitle();
                      if (e.key === 'Escape') setIsEditingTitle(false);
                    }}
                    className="text-foreground font-medium bg-transparent border-b border-primary outline-none min-w-[100px] max-w-[300px]"
                    autoFocus
                  />
                ) : (
                  <button
                    onClick={startEditTitle}
                    className="text-foreground font-medium truncate hover:text-primary transition-colors"
                    title={t('content.rename') || 'Click to rename'}
                  >
                    {crumb.title || (t('content.untitledDiagram') || 'Untitled Diagram')}
                  </button>
                )}
              </span>
            ))}
          </div>
          <div className="text-[11px] text-muted-foreground/50 mt-0.5">
            {formatRelativeTime(diagram.updated_at)}
            {diagram.updated_by && <span> &middot; {diagram.updated_by}</span>}
          </div>
        </div>

        {/* Right actions */}
        <div className="flex items-center gap-1.5 shrink-0">
          <div className="relative">
            <button
              onClick={() => setShowMenu(v => !v)}
              className="p-1.5 text-muted-foreground hover:text-foreground shrink-0"
              title={t('content.moreActions') || 'More'}
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>
            {showMenu && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setShowMenu(false)} />
                <div className="absolute right-0 top-full mt-1 z-20 bg-card border border-border rounded-lg shadow-xl py-1 w-52">
                  <MenuBtn icon={Link2} label={t('content.copyLink') || 'Copy Link'} onClick={() => {
                    setShowMenu(false);
                    onCopyLink?.();
                  }} />
                  <MenuBtn icon={Download} label="Export" onClick={handleExport} />
                  <div className="border-t border-border my-1" />
                  <MenuBtn icon={Trash2} label={t('content.delete') || 'Delete'} onClick={handleDelete} danger />
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* ─── ReactFlow Canvas ─── */}
      <div className="flex-1 min-h-0 relative">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onPaneClick={onPaneClick}
          onNodeDoubleClick={onNodeDoubleClick}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          defaultEdgeOptions={{
            type: 'smoothstep',
            markerEnd: { type: MarkerType.ArrowClosed },
            style: { strokeWidth: 2 },
          }}
          className="bg-muted"
        >
          <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
          <Controls />
          <MiniMap
            nodeStrokeWidth={3}
            className="!bg-card !border-border"
          />

          {/* ─── Toolbar Panel ─── */}
          <Panel position="top-left" className="!m-2">
            <div className="flex items-center gap-1 bg-card border border-border rounded-lg shadow-sm px-1 py-1">
              {/* Flowchart shapes */}
              <ToolBtn
                icon={Square}
                title={t('diagram.rectangle')}
                active={activeTool === 'rectangle'}
                onClick={() => setActiveTool(activeTool === 'rectangle' ? 'select' : 'rectangle')}
              />
              <ToolBtn
                icon={({ className }: { className?: string }) => (
                  <div className={cn('h-4 w-4 flex items-center justify-center', className)}>
                    <div className="w-3 h-3 border-2 border-current rounded" />
                  </div>
                )}
                title={t('diagram.roundedRectangle')}
                active={activeTool === 'rounded'}
                onClick={() => setActiveTool(activeTool === 'rounded' ? 'select' : 'rounded')}
              />
              <ToolBtn
                icon={Diamond}
                title={t('diagram.diamond')}
                active={activeTool === 'diamond'}
                onClick={() => setActiveTool(activeTool === 'diamond' ? 'select' : 'diamond')}
              />
              <ToolBtn
                icon={Circle}
                title={t('diagram.circle')}
                active={activeTool === 'circle'}
                onClick={() => setActiveTool(activeTool === 'circle' ? 'select' : 'circle')}
              />

              <div className="w-px h-5 bg-border mx-1" />

              {/* Mind map */}
              <ToolBtn
                icon={GitBranch}
                title={t('diagram.mindMapRoot')}
                active={activeTool === 'mindmap-root'}
                onClick={() => setActiveTool(activeTool === 'mindmap-root' ? 'select' : 'mindmap-root')}
              />
              <ToolBtn
                icon={Type}
                title={t('diagram.mindMapBranch')}
                active={activeTool === 'mindmap'}
                onClick={() => setActiveTool(activeTool === 'mindmap' ? 'select' : 'mindmap')}
              />

              <div className="w-px h-5 bg-border mx-1" />

              {/* Color picker */}
              <div className="relative">
                <button
                  onClick={() => setShowColorPicker(v => !v)}
                  className="p-1.5 rounded hover:bg-accent transition-colors"
                  title={t('diagram.nodeColor')}
                >
                  <div
                    className="w-4 h-4 rounded border border-border"
                    style={{ backgroundColor: selectedColor.bg }}
                  />
                </button>
                {showColorPicker && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setShowColorPicker(false)} />
                    <div className="absolute top-full left-0 mt-1 z-20 bg-card border border-border rounded-lg shadow-xl p-2 grid grid-cols-4 gap-1">
                      {NODE_COLORS.map((c, i) => (
                        <button
                          key={i}
                          onClick={() => { setSelectedColor(c); setShowColorPicker(false); }}
                          className={cn(
                            'w-7 h-7 rounded border-2 transition-colors',
                            selectedColor === c ? 'border-sidebar-primary' : 'border-transparent hover:border-border'
                          )}
                          style={{ backgroundColor: c.bg }}
                          title={c.name}
                        />
                      ))}
                    </div>
                  </>
                )}
              </div>

              <div className="w-px h-5 bg-border mx-1" />

              {/* Auto layout */}
              <ToolBtn
                icon={LayoutGrid}
                title={t('diagram.autoLayoutTB')}
                onClick={() => autoLayout('TB')}
              />
              <ToolBtn
                icon={({ className }: { className?: string }) => (
                  <ArrowRight className={className} />
                )}
                title={t('diagram.autoLayoutLR')}
                onClick={() => autoLayout('LR')}
              />
            </div>
          </Panel>
        </ReactFlow>
      </div>
    </div>
  );
}

// ─── Toolbar Button ─────────────────────────────────
function ToolBtn({ icon: Icon, title, active, onClick }: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'p-1.5 rounded transition-colors',
        active ? 'bg-sidebar-accent text-sidebar-primary' : 'hover:bg-accent text-foreground'
      )}
      title={title}
    >
      <Icon className="h-4 w-4" />
    </button>
  );
}

// ─── Menu Button ────────────────────────────────────
function MenuBtn({ icon: Icon, label, onClick, danger }: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full flex items-center gap-2 px-3 py-1.5 text-sm transition-colors',
        danger ? 'text-destructive hover:bg-destructive/10' : 'text-foreground hover:bg-accent'
      )}
    >
      <Icon className="h-4 w-4 shrink-0" />
      {label}
    </button>
  );
}

// ─── Main Export (wrapped with Provider) ────────────
export function DiagramEditor(props: DiagramEditorProps) {
  return (
    <ReactFlowProvider>
      <DiagramEditorInner {...props} />
    </ReactFlowProvider>
  );
}
