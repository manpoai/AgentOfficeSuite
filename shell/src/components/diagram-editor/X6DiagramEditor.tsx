'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Graph, Node, Cell } from '@antv/x6';
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
export default function X6DiagramEditor({
  diagramId, breadcrumb, onBack, onDeleted, onCopyLink, docListVisible, onToggleDocList,
}: X6DiagramEditorProps) {
  const { t } = useT();
  const queryClient = useQueryClient();

  // Refs
  const containerRef = useRef<HTMLDivElement>(null);
  const minimapRef = useRef<HTMLDivElement>(null);

  // X6 graph
  const { graph, ready } = useX6Graph(containerRef, minimapRef);

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

  // ─── Keyboard shortcuts ──
  useEffect(() => {
    if (!graph || !ready) return;

    // Delete
    graph.bindKey(['delete', 'backspace'], () => {
      const cells = graph.getSelectedCells();
      if (cells.length) graph.removeCells(cells);
    });

    // Undo / Redo
    graph.bindKey(['meta+z', 'ctrl+z'], () => graph.undo());
    graph.bindKey(['meta+shift+z', 'ctrl+shift+z'], () => graph.redo());

    // Copy / Paste
    graph.bindKey(['meta+c', 'ctrl+c'], () => {
      const cells = graph.getSelectedCells();
      if (cells.length) graph.copy(cells);
    });
    graph.bindKey(['meta+v', 'ctrl+v'], () => {
      if (!graph.isClipboardEmpty()) {
        graph.paste({ offset: 20 });
      }
    });

    // Select all
    graph.bindKey(['meta+a', 'ctrl+a'], () => {
      graph.select(graph.getCells());
    });

    // Tool shortcuts
    graph.bindKey('v', () => setActiveTool('select'));
    graph.bindKey('t', () => setActiveTool('text'));
    graph.bindKey('r', () => setActiveTool('rounded-rect'));
    graph.bindKey('d', () => setActiveTool('diamond'));
    graph.bindKey('l', () => setActiveTool('connector'));
    graph.bindKey('m', () => setActiveTool('mindmap'));

    // Mindmap keys (Tab, Enter, Shift+Tab)
    graph.bindKey('tab', (e) => {
      e.preventDefault();
      handleMindmapTab();
    });
    graph.bindKey('enter', (e) => {
      handleMindmapEnter(e);
    });
    graph.bindKey('shift+tab', (e) => {
      e.preventDefault();
      // TODO: add parent node
    });
    graph.bindKey(['meta+.', 'ctrl+.'], () => {
      handleMindmapToggleCollapse();
    });
  }, [graph, ready]);

  // ─── Canvas click: create shape or mindmap ──
  useEffect(() => {
    if (!graph) return;

    const handleBlankClick = ({ e, x, y }: { e: MouseEvent; x: number; y: number }) => {
      const local = graph.graphToLocal(x, y);

      if (activeTool === 'text') {
        graph.addNode({
          id: newNodeId(),
          shape: 'flowchart-node',
          x: local.x - 60,
          y: local.y - 20,
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
        setActiveTool('select');
        return;
      }

      if (activeTool === 'mindmap') {
        const tree = createRootTree();
        const groupId = `mmg_${Date.now().toString(36)}`;
        mindmapTreeRef.current = tree;
        mindmapGroupIdRef.current = groupId;
        renderMindmapToGraph(graph, tree, local.x - 90, local.y - 23, groupId);
        setActiveTool('select');
        return;
      }

      const shapeMeta = SHAPE_META[activeTool as FlowchartShape];
      if (shapeMeta) {
        graph.addNode({
          id: newNodeId(),
          shape: 'flowchart-node',
          x: local.x - shapeMeta.width / 2,
          y: local.y - shapeMeta.height / 2,
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
        setActiveTool('select');
        return;
      }
    };

    graph.on('blank:click', handleBlankClick);
    return () => { graph.off('blank:click', handleBlankClick); };
  }, [graph, activeTool]);

  // ─── Quick-create: click port → new node + edge ──
  useEffect(() => {
    if (!graph) return;

    const handlePortClick = ({ e, node, port }: { e: MouseEvent; node: Node; port: string }) => {
      // Only quick-create when in select mode and not already dragging
      if (activeTool !== 'select') return;

      // Don't quick-create for mindmap nodes (they use Tab/Enter)
      if (node.getData()?.mindmapGroupId) return;

      const newNode = quickCreateNode(graph, node, port);
      if (newNode) {
        graph.select(newNode);
      }
    };

    graph.on('node:port:click', handlePortClick);
    return () => { graph.off('node:port:click', handlePortClick); };
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

  // ─── Mindmap keyboard handlers ──
  const handleMindmapTab = useCallback(() => {
    if (!graph || !mindmapTreeRef.current) return;
    const selected = graph.getSelectedCells();
    if (selected.length !== 1 || !selected[0].isNode()) return;
    const node = selected[0] as Node;
    const data = node.getData();
    if (!data?.mindmapGroupId) return;

    const newId = addChild(mindmapTreeRef.current, node.id);
    if (newId) {
      // Store tree on root
      const rootNode = graph.getNodes().find(n => n.getData()?.isRoot && n.getData()?.mindmapGroupId === data.mindmapGroupId);
      if (rootNode) rootNode.setData({ ...rootNode.getData(), mindmapTree: mindmapTreeRef.current });

      renderMindmapToGraph(graph, mindmapTreeRef.current, rootNode?.position().x || 0, rootNode?.position().y || 0, data.mindmapGroupId);

      // Select new node
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
    if (data?.isRoot) return; // Can't add sibling to root

    e?.preventDefault();

    const newId = addSibling(mindmapTreeRef.current, node.id);
    if (newId) {
      const rootNode = graph.getNodes().find(n => n.getData()?.isRoot && n.getData()?.mindmapGroupId === data.mindmapGroupId);
      if (rootNode) rootNode.setData({ ...rootNode.getData(), mindmapTree: mindmapTreeRef.current });

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
      rootNode.setData({ ...rootNode.getData(), mindmapTree: mindmapTreeRef.current });
      renderMindmapToGraph(graph, mindmapTreeRef.current, rootNode.position().x, rootNode.position().y, data.mindmapGroupId);
    }

    // Re-select
    const nodeCell = graph.getCellById(node.id);
    if (nodeCell) graph.select(nodeCell);
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
        <div ref={containerRef} className="w-full h-full" />

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
