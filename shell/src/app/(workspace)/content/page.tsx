'use client';

import { useState, useRef, useEffect, useLayoutEffect, useCallback, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as docApi from '@/lib/api/documents';
import type { Document as DocType, Comment as DocComment, Revision as DocRevision } from '@/lib/api/documents';
import { FileText, Table2, Plus, ArrowLeft, Trash2, X, Search, Clock, MoreHorizontal, MessageSquare as MessageSquareIcon, Download, ChevronRight, ChevronDown, FolderOpen, Smile, Eye, Code2, Maximize2, RotateCcw, ArrowLeftToLine, ArrowRightToLine, Link2, Presentation, GitBranch, Pin, PinOff } from 'lucide-react';
import { ContentTopBar } from '@/components/shared/ContentTopBar';
import { ContentSidebar } from '@/components/ContentSidebar';
import { EmojiPicker } from '@/components/EmojiPicker';
import { cn } from '@/lib/utils';
import { formatRelativeTime } from '@/lib/utils/time';
import { ScrollArea } from '@/components/ui/scroll-area';
import dynamic from 'next/dynamic';
import { SearchBar } from '@/components/editor';
import { Comments } from '@/components/comments/Comments';
import RevisionHistory from '@/components/RevisionHistory';
// DocRevision is imported above
import { EditorSkeleton, TableSkeleton } from '@/components/shared/Skeleton';

const Editor = dynamic(
  () => import('@/components/editor/Editor').then(m => ({ default: m.Editor })),
  { ssr: false, loading: () => <EditorSkeleton /> }
);

const TableEditor = dynamic(
  () => import('@/components/table-editor/TableEditor').then(m => ({ default: m.TableEditor })),
  { ssr: false, loading: () => <TableSkeleton /> }
);

const PresentationEditor = dynamic(
  () => import('@/components/presentation-editor/PresentationEditor').then(m => ({ default: m.PresentationEditor })),
  { ssr: false, loading: () => <EditorSkeleton /> }
);

const DiagramEditor = dynamic(
  () => import('@/components/diagram-editor/X6DiagramEditor'),
  { ssr: false, loading: () => <EditorSkeleton /> }
);

const RevisionPreview = dynamic(() => import('@/components/RevisionPreview'), { ssr: false });
import * as gw from '@/lib/api/gateway';
import { useT } from '@/lib/i18n';
import { getAutoPosition } from '@/lib/hooks/use-auto-position';
import { useContextMenu } from '@/lib/hooks/use-context-menu';
import type { ContextMenuItem } from '@/lib/hooks/use-context-menu';
import { AutoDropdown } from '@/components/ui/auto-dropdown';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  DragOverlay,
  useDraggable,
  type DragStartEvent,
  type DragEndEvent,
  type DragOverEvent,
  type DragMoveEvent,
} from '@dnd-kit/core';
import { arrayMove } from '@dnd-kit/sortable';

/** Where to drop: before/after = reorder, inside = reparent */
type DropIntent = { overId: string; position: 'before' | 'after' | 'inside' } | null;

// ═══════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════

/** Unified content item (doc or table) */
type ContentNode = {
  id: string;         // doc:<id> or table:<id>
  rawId: string;      // original id without prefix
  type: 'doc' | 'table' | 'presentation' | 'diagram';
  title: string;
  emoji?: string;
  createdAt: number;
  updatedAt?: string;
  parentId: string | null;
  pinned?: boolean;
};

type Selection = { type: 'doc'; id: string } | { type: 'table'; id: string } | { type: 'presentation'; id: string } | { type: 'diagram'; id: string } | null;

/** Tree ordering stored in localStorage */
interface TreeState {
  /** parentId → ordered child IDs */
  children: Record<string, string[]>;
  /** nodeId → parentId */
  parents: Record<string, string>;
}

const TREE_STATE_KEY = 'asuite-content-tree';
const EXPANDED_STATE_KEY = 'asuite-content-expanded';

function loadTreeState(): TreeState {
  try {
    const raw = localStorage.getItem(TREE_STATE_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return { children: {}, parents: {} };
}

function saveTreeState(state: TreeState) {
  localStorage.setItem(TREE_STATE_KEY, JSON.stringify(state));
  // Debounced write to Gateway
  saveTreeStateToGateway(state);
}

function loadExpandedState(): string[] {
  try {
    const raw = localStorage.getItem(EXPANDED_STATE_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return [];
}

function saveExpandedState(ids: Set<string>) {
  localStorage.setItem(EXPANDED_STATE_KEY, JSON.stringify(Array.from(ids)));
}

// Debounced Gateway persistence for tree state
let _gwSaveTimer: ReturnType<typeof setTimeout> | null = null;
function saveTreeStateToGateway(state: TreeState) {
  if (_gwSaveTimer) clearTimeout(_gwSaveTimer);
  _gwSaveTimer = setTimeout(() => {
    gw.setPreference('content-tree-state', state).catch(err => {
      console.warn('[TreeState] Failed to save to Gateway:', err);
    });
  }, 500);
}

// ═══════════════════════════════════════════════════
// URL ↔ Selection helpers
// ═══════════════════════════════════════════════════

/** Read ?id=doc:xxx or ?id=table:xxx from the current URL */
function selectionFromURL(): Selection | null {
  try {
    const params = new URLSearchParams(window.location.search);
    const id = params.get('id');
    if (!id) return null;
    if (id.startsWith('doc:')) return { type: 'doc', id: id.slice(4) };
    if (id.startsWith('table:')) return { type: 'table', id: id.slice(6) };
    if (id.startsWith('presentation:')) return { type: 'presentation', id: id.slice(13) };
    if (id.startsWith('diagram:')) return { type: 'diagram', id: id.slice(8) };
  } catch { /* SSR or invalid */ }
  return null;
}

/** Update the browser URL to reflect the current selection (no page reload) */
function syncSelectionToURL(sel: Selection | null) {
  const url = new URL(window.location.href);
  if (sel) {
    url.searchParams.set('id', `${sel.type}:${sel.id}`);
  } else {
    url.searchParams.delete('id');
  }
  window.history.replaceState(null, '', url.toString());
}

/** Build a shareable link for a content item */
function buildContentLink(sel: NonNullable<Selection>): string {
  const url = new URL(window.location.href);
  url.searchParams.set('id', `${sel.type}:${sel.id}`);
  return url.toString();
}

// ═══════════════════════════════════════════════════
// Main Page
// ═══════════════════════════════════════════════════

export default function ContentPage() {
  const { t } = useT();
  const [selection, setSelection] = useState<Selection>(null);
  const [mobileView, setMobileView] = useState<'list' | 'detail'>('list');
  const [showNewMenu, setShowNewMenu] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [treeState, setTreeState] = useState<TreeState>({ children: {}, parents: {} });
  const [dragActiveId, setDragActiveId] = useState<string | null>(null);
  const [dropIntent, setDropIntent] = useState<DropIntent>(null);
  const [sidebarView, setSidebarView] = useState<'library' | 'trash'>('library');
  const [deleteDialog, setDeleteDialog] = useState<{ nodeId: string; hasChildren: boolean } | null>(null);
  const [docListVisible, setDocListVisible] = useState(true);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const queryClient = useQueryClient();

  // Hydrate client-only state after mount (avoid SSR mismatch)
  useEffect(() => {
    const fromURL = selectionFromURL();
    if (fromURL) {
      setSelection(fromURL);
      setMobileView('detail');
    } else {
      try {
        const saved = sessionStorage.getItem('asuite-content-selection');
        if (saved) { setSelection(JSON.parse(saved)); setMobileView('detail'); }
      } catch { /* ignore */ }
    }
    setExpandedIds(new Set(loadExpandedState()));
    setTreeState(loadTreeState());
    const savedCollapsed = localStorage.getItem('asuite-sidebar-collapsed');
    if (savedCollapsed === 'true') setSidebarCollapsed(true);
    setHydrated(true);
  }, []);

  // On mount: fetch tree state from Gateway (migration from localStorage)
  useEffect(() => {
    gw.getPreference<TreeState>('content-tree-state').then(remote => {
      if (remote && (Object.keys(remote.children).length > 0 || Object.keys(remote.parents).length > 0)) {
        setTreeState(remote);
        localStorage.setItem(TREE_STATE_KEY, JSON.stringify(remote));
      }
    }).catch(() => { /* Gateway unavailable — use localStorage */ });
  }, []);

  // Content items from Gateway SQLite (Gateway is source of truth)
  const { data: contentItems, isLoading: contentLoading } = useQuery({
    queryKey: ['content-items'],
    queryFn: gw.listContentItems,
    staleTime: 60 * 1000,
  });

  // Derive icon map from content items
  const customIcons = useMemo(() => {
    if (!contentItems) return undefined;
    const icons: Record<string, string> = {};
    for (const i of contentItems) {
      if (i.icon) icons[i.raw_id] = i.icon;
    }
    return icons;
  }, [contentItems]);

  const { data: deletedItems, isLoading: deletedLoading } = useQuery({
    queryKey: ['content-items-deleted'],
    queryFn: gw.listDeletedContentItems,
    enabled: sidebarView === 'trash',
    staleTime: 30 * 1000,
  });

  const { data: searchResults } = useQuery({
    queryKey: ['document-search', searchQuery],
    queryFn: () => docApi.searchDocuments(searchQuery),
    enabled: searchQuery.length >= 2,
  });

  const selectedDocId = selection?.type === 'doc' ? selection.id : null;
  const selectedTableId = selection?.type === 'table' ? selection.id : null;
  const selectedPresentationId = selection?.type === 'presentation' ? selection.id : null;
  const selectedDiagramId = selection?.type === 'diagram' ? selection.id : null;

  const { data: selectedDoc } = useQuery({
    queryKey: ['document', selectedDocId],
    queryFn: () => docApi.getDocument(selectedDocId!),
    enabled: !!selectedDocId,
    staleTime: 5 * 60 * 1000, // 5 min — avoid background refetch replacing local editor state with round-tripped markdown
    refetchOnWindowFocus: false, // Prevent refetch from overwriting local editor state
  });

  // Build unified node map directly from contentItems (Gateway is source of truth)
  const nodeMap = useMemo(() => {
    const map = new Map<string, ContentNode>();
    for (const item of (contentItems || [])) {
      map.set(item.id, {
        id: item.id,
        rawId: item.raw_id,
        type: item.type as 'doc' | 'table' | 'presentation' | 'diagram',
        title: item.title || (item.type === 'doc' ? t('content.untitled') : item.type === 'table' ? t('content.untitledTable') : item.type === 'diagram' ? (t('content.untitledDiagram') || 'Untitled Diagram') : (t('content.untitledPresentation') || 'Untitled Presentation')),
        emoji: item.icon || undefined,
        createdAt: new Date(item.created_at || 0).getTime(),
        updatedAt: item.updated_at || undefined,
        parentId: item.parent_id,
        pinned: !!item.pinned,
      });
    }
    return map;
  }, [contentItems, t]);

  // Apply treeState parents to nodes (for tables parented under docs, etc.)
  const effectiveNodes = useMemo(() => {
    const nodes = new Map(nodeMap);
    // Apply localStorage parent overrides
    for (const [nodeId, parentId] of Object.entries(treeState.parents)) {
      const node = nodes.get(nodeId);
      if (!node) continue;
      if (parentId === '__root__') {
        // Explicitly moved to root — override native parent
        nodes.set(nodeId, { ...node, parentId: null });
      } else if (nodes.has(parentId)) {
        nodes.set(nodeId, { ...node, parentId });
      }
    }
    return nodes;
  }, [nodeMap, treeState]);

  // Build children map and root items
  const { childrenMap, rootIds, pinnedIds, unpinnedIds } = useMemo(() => {
    const cMap = new Map<string, string[]>();
    const allIds = new Set(effectiveNodes.keys());
    const hasParent = new Set<string>();

    // First, populate from actual parent relationships
    effectiveNodes.forEach((node) => {
      if (node.parentId && allIds.has(node.parentId)) {
        hasParent.add(node.id);
        const children = cMap.get(node.parentId) || [];
        children.push(node.id);
        cMap.set(node.parentId, children);
      }
    });

    // Sort children by treeState order, then by createdAt (oldest first)
    cMap.forEach((children, parentId) => {
      const order = treeState.children[parentId];
      if (order) {
        children.sort((a, b) => {
          const ia = order.indexOf(a);
          const ib = order.indexOf(b);
          if (ia >= 0 && ib >= 0) return ia - ib;
          if (ia >= 0) return -1;
          if (ib >= 0) return 1;
          return (effectiveNodes.get(a)?.createdAt || 0) - (effectiveNodes.get(b)?.createdAt || 0);
        });
      } else {
        children.sort((a, b) => (effectiveNodes.get(a)?.createdAt || 0) - (effectiveNodes.get(b)?.createdAt || 0));
      }
    });

    // Root items: no parent or parent not in set
    const roots: string[] = [];
    effectiveNodes.forEach((node) => {
      if (!hasParent.has(node.id)) roots.push(node.id);
    });

    // Sort roots by treeState order, then by createdAt (oldest first)
    const rootOrder = treeState.children['__root__'];
    if (rootOrder) {
      roots.sort((a, b) => {
        const ia = rootOrder.indexOf(a);
        const ib = rootOrder.indexOf(b);
        if (ia >= 0 && ib >= 0) return ia - ib;
        if (ia >= 0) return -1;
        if (ib >= 0) return 1;
        return (effectiveNodes.get(a)?.createdAt || 0) - (effectiveNodes.get(b)?.createdAt || 0);
      });
    } else {
      roots.sort((a, b) => (effectiveNodes.get(a)?.createdAt || 0) - (effectiveNodes.get(b)?.createdAt || 0));
    }

    // Split roots into pinned and unpinned
    const pinned: string[] = [];
    const unpinned: string[] = [];
    for (const id of roots) {
      if (effectiveNodes.get(id)?.pinned) pinned.push(id);
      else unpinned.push(id);
    }

    return { childrenMap: cMap, rootIds: roots, pinnedIds: pinned, unpinnedIds: unpinned };
  }, [effectiveNodes, treeState]);

  const toggleExpand = (id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      saveExpandedState(next);
      return next;
    });
  };

  // Search results
  const displaySearchItems = searchQuery.length >= 2
    ? (searchResults
        ? searchResults.map(r => ({
            id: `doc:${r.document.id}`,
            rawId: r.document.id,
            type: 'doc' as const,
            title: r.document.title,
            emoji: customIcons?.[r.document.id] || r.document.icon || undefined,
            createdAt: 0,
            parentId: null,
          }))
        : [])
    : null;

  // Select a nearby document when the current one is deleted
  const selectNearbyDoc = (deletedNodeId: string) => {
    // Find the deleted node's parent and siblings
    const deletedNode = effectiveNodes.get(deletedNodeId);
    const siblings = deletedNode?.parentId
      ? childrenMap.get(deletedNode.parentId) || []
      : rootIds;
    const idx = siblings.indexOf(deletedNodeId);

    // Try next sibling, then previous sibling, then parent
    let nextId: string | null = null;
    if (idx >= 0 && idx < siblings.length - 1) {
      nextId = siblings[idx + 1];
    } else if (idx > 0) {
      nextId = siblings[idx - 1];
    } else if (deletedNode?.parentId) {
      nextId = deletedNode.parentId;
    }

    if (nextId) {
      const nextNode = effectiveNodes.get(nextId);
      if (nextNode) {
        const sel = { type: nextNode.type, id: nextNode.rawId } as Selection;
        setSelection(sel);
        sessionStorage.setItem('asuite-content-selection', JSON.stringify(sel));
        syncSelectionToURL(sel);
        return;
      }
    }
    setSelection(null);
    syncSelectionToURL(null);
    setMobileView('list');
  };

  // Request deletion of a node — shows dialog for docs with children, or confirms directly
  const requestDelete = (nodeId: string) => {
    const node = effectiveNodes.get(nodeId);
    if (!node) return;
    const children = childrenMap.get(nodeId) || [];
    if (node.type === 'doc' && children.length > 0) {
      setDeleteDialog({ nodeId, hasChildren: true });
    } else {
      // No children — simple confirm
      if (!confirm(t('content.deleteConfirm'))) return;
      executeDelete(nodeId, 'only');
    }
  };

  // Execute deletion: mode = 'only' (just this node) | 'all' (with descendants)
  const executeDelete = async (nodeId: string, mode: 'only' | 'all') => {
    const node = effectiveNodes.get(nodeId);
    if (!node) return;
    const isSelected = selection?.type === node.type && selection?.id === node.rawId;
    if (isSelected) selectNearbyDoc(nodeId);

    try {
      await gw.deleteContentItem(nodeId, mode);
      await queryClient.invalidateQueries({ queryKey: ['content-items'] });
    } catch (err) {
      console.error('Delete failed:', err);
    }
    setDeleteDialog(null);
  };

  const handleSelect = (nodeId: string) => {
    const node = effectiveNodes.get(nodeId);
    if (!node) return;
    const sel = { type: node.type, id: node.rawId };
    setSelection(sel);
    sessionStorage.setItem('asuite-content-selection', JSON.stringify(sel));
    syncSelectionToURL(sel);
    setMobileView('detail');
    // Auto-expand selected item's children
    const children = childrenMap.get(nodeId);
    if (children && children.length > 0) {
      setExpandedIds(prev => {
        if (prev.has(nodeId)) return prev;
        const next = new Set(prev);
        next.add(nodeId);
        return next;
      });
    }
  };

  // Auto-expand selected item and all its ancestors on load
  useEffect(() => {
    if (!selection) return;
    const nodeId = selection.type === 'doc' ? `doc:${selection.id}` : `table:${selection.id}`;
    const toExpand: string[] = [];

    // Expand the selected node's children if any
    const children = childrenMap.get(nodeId);
    if (children && children.length > 0) {
      toExpand.push(nodeId);
    }

    // Walk up the tree to expand all parent ancestors
    let current = effectiveNodes.get(nodeId);
    while (current?.parentId) {
      toExpand.push(current.parentId);
      current = effectiveNodes.get(current.parentId);
    }

    if (toExpand.length > 0) {
      setExpandedIds(prev => {
        const next = new Set(prev);
        let changed = false;
        for (const id of toExpand) {
          if (!next.has(id)) { next.add(id); changed = true; }
        }
        return changed ? next : prev;
      });
    }

    // Scroll the selected node into view after DOM updates (delay for expand animation)
    setTimeout(() => {
      const el = document.querySelector(`[data-tree-id="${CSS.escape(nodeId)}"]`);
      if (el) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }, 100);
  }, [selection, childrenMap, effectiveNodes]);

  // Auto-select first item if nothing is selected
  useEffect(() => {
    if (selection || rootIds.length === 0) return;
    const firstId = rootIds[0];
    const firstNode = effectiveNodes.get(firstId);
    if (firstNode) {
      const sel = { type: firstNode.type, id: firstNode.rawId } as Selection;
      setSelection(sel);
      sessionStorage.setItem('asuite-content-selection', JSON.stringify(sel));
      syncSelectionToURL(sel);
    }
  }, [rootIds, selection, effectiveNodes]);

  const refreshDocs = () => {
    queryClient.invalidateQueries({ queryKey: ['content-items'] });
    // Don't invalidate the individual doc query on save — the local state is authoritative.
  };

  const refreshTables = () => {
    queryClient.invalidateQueries({ queryKey: ['content-items'] });
  };

  const handleTogglePin = async (nodeId: string) => {
    const node = effectiveNodes.get(nodeId);
    if (!node) return;
    try {
      await gw.updateContentItem(nodeId, { pinned: !node.pinned });
      queryClient.invalidateQueries({ queryKey: ['content-items'] });
    } catch (e) {
      console.error('Failed to toggle pin:', e);
    }
  };

  const handleCreateDoc = async (parentNodeId?: string) => {
    if (creating) return;
    setCreating(true);
    try {
      const item = await gw.createContentItem({
        type: 'doc',
        title: '',
        parent_id: parentNodeId || null,
      });
      if (parentNodeId) {
        setExpandedIds(prev => new Set(prev).add(parentNodeId));
      }
      await queryClient.invalidateQueries({ queryKey: ['content-items'] });
      const sel = { type: 'doc' as const, id: item.raw_id };
      setSelection(sel);
      syncSelectionToURL(sel);
      setMobileView('detail');
    } catch (e) {
      console.error('Create doc failed:', e);
    } finally {
      setCreating(false);
    }
  };

  const handleCreateTable = async (parentNodeId?: string) => {
    if (creating) return;
    setCreating(true);
    try {
      const item = await gw.createContentItem({
        type: 'table',
        title: t('content.untitledTable'),
        parent_id: parentNodeId || null,
      });
      if (parentNodeId) {
        setExpandedIds(prev => new Set(prev).add(parentNodeId));
      }
      await queryClient.invalidateQueries({ queryKey: ['content-items'] });
      const sel = { type: 'table' as const, id: item.raw_id };
      setSelection(sel);
      syncSelectionToURL(sel);
      setMobileView('detail');
    } catch (e) {
      console.error('Create table failed:', e);
    } finally {
      setCreating(false);
    }
  };

  const handleCreatePresentation = async (parentNodeId?: string) => {
    if (creating) return;
    setCreating(true);
    try {
      const item = await gw.createContentItem({
        type: 'presentation',
        title: '',
        parent_id: parentNodeId || null,
      });
      if (parentNodeId) {
        setExpandedIds(prev => new Set(prev).add(parentNodeId));
      }
      await queryClient.invalidateQueries({ queryKey: ['content-items'] });
      const sel = { type: 'presentation' as const, id: item.raw_id };
      setSelection(sel);
      syncSelectionToURL(sel);
      setMobileView('detail');
    } catch (e) {
      console.error('Create presentation failed:', e);
    } finally {
      setCreating(false);
    }
  };

  const handleCreateDiagram = async (parentNodeId?: string) => {
    if (creating) return;
    setCreating(true);
    try {
      const item = await gw.createContentItem({
        type: 'diagram',
        title: '',
        parent_id: parentNodeId || null,
      });
      if (parentNodeId) {
        setExpandedIds(prev => new Set(prev).add(parentNodeId));
      }
      await queryClient.invalidateQueries({ queryKey: ['content-items'] });
      const sel = { type: 'diagram' as const, id: item.raw_id };
      setSelection(sel);
      syncSelectionToURL(sel);
      setMobileView('detail');
    } catch (e) {
      console.error('Create diagram failed:', e);
    } finally {
      setCreating(false);
    }
  };

  const updateTreeParent = (nodeId: string, parentId: string) => {
    setTreeState(prev => {
      const next = {
        children: { ...prev.children },
        parents: { ...prev.parents, [nodeId]: parentId },
      };
      // Add to parent's children list
      const parentChildren = [...(next.children[parentId] || [])];
      if (!parentChildren.includes(nodeId)) parentChildren.push(nodeId);
      next.children[parentId] = parentChildren;
      saveTreeState(next);
      return next;
    });
  };

  const isLoading = contentLoading;

  // DnD
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

  // Check if nodeId is a descendant of ancestorId (prevent circular reparenting)
  const isDescendant = useCallback((nodeId: string, ancestorId: string): boolean => {
    const children = childrenMap.get(ancestorId);
    if (!children) return false;
    for (const childId of children) {
      if (childId === nodeId) return true;
      if (isDescendant(nodeId, childId)) return true;
    }
    return false;
  }, [childrenMap]);

  const handleDragStart = (event: DragStartEvent) => {
    setDragActiveId(event.active.id as string);
    setDropIntent(null);
  };

  // Track current pointer position via a ref (updated by native pointer events)
  const pointerPosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  useEffect(() => {
    const handler = (e: PointerEvent) => {
      pointerPosRef.current = { x: e.clientX, y: e.clientY };
    };
    window.addEventListener('pointermove', handler);
    return () => window.removeEventListener('pointermove', handler);
  }, []);

  const updateDropIntent = useCallback((event: DragOverEvent | DragMoveEvent) => {
    const { active } = event;
    const { x, y } = pointerPosRef.current;

    // Find which tree node is under the cursor using DOM inspection
    const els = document.elementsFromPoint(x, y);
    let targetEl: Element | null = null;
    for (const el of els) {
      const treeId = (el as HTMLElement).closest?.('[data-tree-id]');
      if (treeId && treeId.getAttribute('data-tree-id') !== active.id) {
        targetEl = treeId;
        break;
      }
    }

    if (!targetEl) {
      setDropIntent(null);
      return;
    }

    const overId = targetEl.getAttribute('data-tree-id')!;
    const rect = targetEl.getBoundingClientRect();
    const relativeY = y - rect.top;
    const ratio = relativeY / rect.height;

    // Top 25% = before, bottom 25% = after, middle 50% = inside (become child)
    let position: 'before' | 'after' | 'inside';
    if (ratio < 0.25) position = 'before';
    else if (ratio > 0.75) position = 'after';
    else position = 'inside';

    setDropIntent({ overId, position });
  }, []);

  const handleDragEnd = (event: DragEndEvent) => {
    const intent = dropIntent;
    setDragActiveId(null);
    setDropIntent(null);

    const { active } = event;
    const activeId = active.id as string;

    // Use dropIntent as source of truth (not event.over which may differ due to sortable reordering)
    if (!intent) return;
    const overId = intent.overId;
    if (activeId === overId) return;

    const activeNode = effectiveNodes.get(activeId);
    const overNode = effectiveNodes.get(overId);
    if (!activeNode || !overNode) return;

    const position = intent.position;

    if (position === 'inside') {
      // Reparent: make activeNode a child of overNode
      // Prevent circular: can't drop a parent into its own descendant
      if (isDescendant(overId, activeId)) return;

      // Remove from old parent's children list in treeState
      const oldParent = activeNode.parentId || '__root__';
      setTreeState(prev => {
        const next = {
          children: { ...prev.children },
          parents: { ...prev.parents },
        };
        // Remove from old parent
        if (next.children[oldParent]) {
          next.children[oldParent] = next.children[oldParent].filter(id => id !== activeId);
        }
        // For doc→doc native parents, we also need treeState override
        next.parents[activeId] = overId;
        // Add to new parent's children
        const newChildren = [...(next.children[overId] || [])];
        if (!newChildren.includes(activeId)) newChildren.push(activeId);
        next.children[overId] = newChildren;
        saveTreeState(next);
        return next;
      });

      // Expand the target so user sees the dropped item
      setExpandedIds(prev => new Set(prev).add(overId));
    } else {
      // Reorder: place activeNode before/after overNode
      const overParent = overNode.parentId || '__root__';
      const activeParent = activeNode.parentId || '__root__';

      if (activeParent === overParent) {
        // Same parent — simple reorder
        const siblings = overParent === '__root__' ? [...rootIds] : [...(childrenMap.get(overParent) || [])];
        const oldIndex = siblings.indexOf(activeId);
        const newIndex = siblings.indexOf(overId);
        if (oldIndex < 0 || newIndex < 0) return;
        const reordered = arrayMove(siblings, oldIndex, newIndex);
        setTreeState(prev => {
          const next = { ...prev, children: { ...prev.children, [overParent]: reordered } };
          saveTreeState(next);
          return next;
        });
      } else {
        // Cross-parent: move to overNode's parent, inserting before/after overNode
        if (isDescendant(overId, activeId)) return;

        setTreeState(prev => {
          const next = {
            children: { ...prev.children },
            parents: { ...prev.parents },
          };
          // Remove from old parent
          if (next.children[activeParent]) {
            next.children[activeParent] = next.children[activeParent].filter(id => id !== activeId);
          }
          // Set new parent (use '__root__' to override native parentDocumentId)
          if (overParent === '__root__') {
            next.parents[activeId] = '__root__';
          } else {
            next.parents[activeId] = overParent;
          }
          // Insert into new parent's children list
          const newSiblings = [...(next.children[overParent] || [])];
          // Remove if already present
          const existingIdx = newSiblings.indexOf(activeId);
          if (existingIdx >= 0) newSiblings.splice(existingIdx, 1);
          const overIdx = newSiblings.indexOf(overId);
          const insertIdx = position === 'before' ? overIdx : overIdx + 1;
          newSiblings.splice(insertIdx >= 0 ? insertIdx : newSiblings.length, 0, activeId);
          next.children[overParent] = newSiblings;
          saveTreeState(next);
          return next;
        });

      }
    }
  };

  // Breadcrumb
  const getBreadcrumb = (docId: string): { id: string; title: string }[] => {
    const path: { id: string; title: string }[] = [];
    let nodeId: string | null = `doc:${docId}`;
    while (nodeId) {
      const node = effectiveNodes.get(nodeId);
      if (!node) break;
      path.unshift({ id: node.rawId, title: node.title });
      nodeId = node.parentId;
    }
    return path;
  };

  const toggleSidebarCollapse = () => {
    const next = !sidebarCollapsed;
    setSidebarCollapsed(next);
    localStorage.setItem('asuite-sidebar-collapsed', String(next));
  };

  const dragActiveNode = dragActiveId ? effectiveNodes.get(dragActiveId) : null;

  // ── Mobile swipe-back gesture (left edge → right swipe returns to list) ──
  const [swipeProgress, setSwipeProgress] = useState(0);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const isMobile = window.innerWidth < 768;
    if (!isMobile) return;

    let startX = 0;
    let startY = 0;
    let swiping = false;

    const onStart = (e: TouchEvent) => {
      const touch = e.touches[0];
      if (touch.clientX < 30 && mobileView === 'detail') {
        startX = touch.clientX;
        startY = touch.clientY;
        swiping = true;
        setSwipeProgress(0);
      }
    };

    const onMove = (e: TouchEvent) => {
      if (!swiping) return;
      const dx = e.touches[0].clientX - startX;
      const dy = Math.abs(e.touches[0].clientY - startY);
      if (dy > 50) { swiping = false; setSwipeProgress(0); return; } // vertical scroll, cancel
      if (dx > 0) {
        setSwipeProgress(Math.min(dx / 80, 1));
      }
      if (dx > 80) {
        swiping = false;
        setSwipeProgress(0);
        setMobileView('list');
      }
    };

    const onEnd = () => { swiping = false; setSwipeProgress(0); };

    window.addEventListener('touchstart', onStart, { passive: true });
    window.addEventListener('touchmove', onMove, { passive: true });
    window.addEventListener('touchend', onEnd);
    return () => {
      window.removeEventListener('touchstart', onStart);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onEnd);
    };
  }, [mobileView]);

  // Get depth of a node for rendering
  const getDepth = (nodeId: string): number => {
    let depth = 0;
    let current = effectiveNodes.get(nodeId);
    while (current?.parentId) {
      depth++;
      current = effectiveNodes.get(current.parentId);
    }
    return depth;
  };

  return (
    <div className="flex h-full overflow-hidden flex-col md:flex-row relative">
      {/* Mobile swipe-back indicator */}
      {swipeProgress > 0 && mobileView === 'detail' && (
        <div
          className="fixed left-0 top-0 bottom-0 z-50 pointer-events-none flex items-center md:hidden"
          style={{ width: 32 }}
        >
          <div
            className="w-8 h-16 flex items-center justify-center rounded-r-lg bg-primary/20 backdrop-blur-sm transition-opacity"
            style={{ opacity: swipeProgress, transform: `translateX(${swipeProgress * 12 - 12}px)` }}
          >
            <ArrowLeft className="w-4 h-4 text-primary" style={{ opacity: swipeProgress }} />
          </div>
        </div>
      )}
      {/* Unified sidebar (desktop only) — includes logo, search, tree, settings */}
      <ContentSidebar
        collapsed={sidebarCollapsed}
        onToggleCollapse={toggleSidebarCollapse}
        visible={docListVisible && mobileView === 'list' || docListVisible}
        sidebarView={sidebarView}
        onSidebarViewChange={setSidebarView}
        showNewMenu={showNewMenu}
        onShowNewMenuChange={setShowNewMenu}
        creating={creating}
        onCreateDoc={() => handleCreateDoc()}
        onCreateTable={() => handleCreateTable()}
        onCreatePresentation={() => handleCreatePresentation()}
        onCreateDiagram={() => handleCreateDiagram()}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
      >
        {sidebarView === 'library' ? (
          <>
            {isLoading && (
              <div className="space-y-1 px-1 py-2">
                {[...Array(6)].map((_, i) => (
                  <div key={i} className="flex items-center gap-2 py-1.5 animate-pulse">
                    <div className="w-4 h-4 rounded bg-muted shrink-0" />
                    <div className="h-3.5 rounded bg-muted" style={{ width: `${60 + Math.random() * 80}px` }} />
                  </div>
                ))}
              </div>
            )}

            {/* Search mode */}
            {displaySearchItems && (
              displaySearchItems.length === 0 ? (
                <p className="p-3 text-xs text-muted-foreground">{t('content.noMatch')}</p>
              ) : (
                displaySearchItems.map(item => (
                  <TreeNodeItem
                    key={item.id}
                    nodeId={item.id}
                    node={item}
                    isSelected={selection?.type === item.type && selection?.id === item.rawId}
                    onSelect={() => handleSelect(item.id)}
                    hasChildren={false}
                    isExpanded={false}
                    onToggle={() => {}}
                    depth={0}
                    onCreateChild={() => {}}
                  />
                ))
              )
            )}

            {/* Tree mode with DnD */}
            {!displaySearchItems && !isLoading && (
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragStart={handleDragStart}
                onDragOver={updateDropIntent}
                onDragMove={updateDropIntent}
                onDragEnd={handleDragEnd}
              >
                {/* Pinned section */}
                {pinnedIds.length > 0 && (
                  <>
                    <div className="px-2 pt-1.5 pb-0.5 text-[10px] font-medium text-muted-foreground/60 uppercase tracking-wider">Pinned</div>
                    {pinnedIds.map(nodeId => (
                      <TreeNodeRecursive
                        key={nodeId}
                        nodeId={nodeId}
                        nodes={effectiveNodes}
                        childrenMap={childrenMap}
                        selection={selection}
                        expandedIds={expandedIds}
                        onSelect={handleSelect}
                        onToggle={toggleExpand}
                        onCreateDoc={handleCreateDoc}
                        onCreateTable={handleCreateTable}
                        onCreatePresentation={handleCreatePresentation}
                        onCreateDiagram={handleCreateDiagram}
                        onRequestDelete={requestDelete}
                        onTogglePin={handleTogglePin}
                        depth={0}
                        creating={creating}
                        dropIntent={dropIntent}
                        dragActiveId={dragActiveId}
                      />
                    ))}
                    <div className="border-t border-border/50 my-1 mx-2" />
                  </>
                )}
                {/* Library section */}
                {pinnedIds.length > 0 && unpinnedIds.length > 0 && (
                  <div className="px-2 pt-0.5 pb-0.5 text-[10px] font-medium text-muted-foreground/60 uppercase tracking-wider">Library</div>
                )}
                {unpinnedIds.map(nodeId => (
                  <TreeNodeRecursive
                    key={nodeId}
                    nodeId={nodeId}
                    nodes={effectiveNodes}
                    childrenMap={childrenMap}
                    selection={selection}
                    expandedIds={expandedIds}
                    onSelect={handleSelect}
                    onToggle={toggleExpand}
                    onCreateDoc={handleCreateDoc}
                    onCreateTable={handleCreateTable}
                    onCreatePresentation={handleCreatePresentation}
                    onCreateDiagram={handleCreateDiagram}
                    onRequestDelete={requestDelete}
                    onTogglePin={handleTogglePin}
                    depth={0}
                    creating={creating}
                    dropIntent={dropIntent}
                    dragActiveId={dragActiveId}
                  />
                ))}

                <DragOverlay dropAnimation={null}>
                  {dragActiveNode && (
                    <div className="flex items-center gap-1.5 py-1.5 px-2 text-sm bg-card border border-border rounded-lg shadow-lg opacity-90">
                      {dragActiveNode.type === 'table'
                        ? <Table2 className="h-4 w-4 text-muted-foreground shrink-0" />
                        : dragActiveNode.type === 'presentation'
                        ? <Presentation className="h-4 w-4 text-muted-foreground shrink-0" />
                        : dragActiveNode.type === 'diagram'
                        ? <GitBranch className="h-4 w-4 text-muted-foreground shrink-0" />
                        : <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                      }
                      <span className="truncate">{dragActiveNode.title}</span>
                    </div>
                  )}
                </DragOverlay>
              </DndContext>
            )}
          </>
        ) : (
          /* Trash view */
          <>
            {deletedLoading && (
              <div className="space-y-1 px-1 py-2">
                {[...Array(4)].map((_, i) => (
                  <div key={i} className="flex items-center gap-2 py-1.5 animate-pulse">
                    <div className="w-4 h-4 rounded bg-muted shrink-0" />
                    <div className="h-3.5 rounded bg-muted" style={{ width: `${60 + Math.random() * 80}px` }} />
                  </div>
                ))}
              </div>
            )}
            {(() => {
              if (deletedLoading) return null;
              const entries = (deletedItems || []).map(item => ({
                key: item.id,
                type: item.type as 'doc' | 'table',
                nodeId: item.id,
                title: item.title,
                deletedAt: item.deleted_at || '',
              }));
              entries.sort((a, b) => new Date(b.deletedAt).getTime() - new Date(a.deletedAt).getTime());

              if (entries.length === 0) {
                return (
                  <p className="p-3 text-xs text-muted-foreground text-center">
                    {t('content.trashEmpty') || 'Trash is empty'}
                  </p>
                );
              }

              return entries.map(entry => (
                <TrashItem
                  key={entry.key}
                  title={entry.title}
                  icon={entry.type === 'table'
                    ? <Table2 className="h-4 w-4 text-muted-foreground shrink-0" />
                    : <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                  }
                  deletedAt={entry.deletedAt}
                  onRestore={async () => {
                    try {
                      await gw.restoreContentItem(entry.nodeId);
                      queryClient.invalidateQueries({ queryKey: ['content-items'] });
                      queryClient.invalidateQueries({ queryKey: ['content-items-deleted'] });
                    } catch (err) { console.error('Restore failed:', err); }
                  }}
                  onPermanentDelete={async () => {
                    const msg = t('content.permanentDeleteConfirm') || 'Permanently delete? This cannot be undone.';
                    if (!confirm(msg)) return;
                    try {
                      await gw.permanentlyDeleteContentItem(entry.nodeId);
                      queryClient.invalidateQueries({ queryKey: ['content-items-deleted'] });
                    } catch (err) { console.error('Permanent delete failed:', err); }
                  }}
                />
              ));
            })()}
          </>
        )}
      </ContentSidebar>

      {/* Mobile sidebar (only visible on mobile when in list view) */}
      {mobileView === 'list' && (
        <div className="md:hidden w-full bg-sidebar flex flex-col min-h-0 overflow-hidden">
          <div className="px-3 pt-3 pb-2 flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              {sidebarView === 'library' ? 'Library' : (t('content.trash') || 'Trash')}
            </span>
            {sidebarView === 'library' && (
              <button onClick={() => setShowNewMenu(v => !v)} className="p-1 text-muted-foreground hover:text-foreground" title={t('common.new')}>
                <Plus className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <ScrollArea className="flex-1 min-h-0">
            <div className="px-2 py-1">
              {/* Reuse same tree content for mobile - simplified without DnD for now */}
              {isLoading && (
                <div className="space-y-1 px-1 py-2">
                  {[...Array(6)].map((_, i) => (
                    <div key={i} className="flex items-center gap-2 py-1.5 animate-pulse">
                      <div className="w-4 h-4 rounded bg-muted shrink-0" />
                      <div className="h-3.5 rounded bg-muted" style={{ width: `${60 + Math.random() * 80}px` }} />
                    </div>
                  ))}
                </div>
              )}
              {!isLoading && sidebarView === 'library' && (
                <DndContext
                  sensors={sensors}
                  collisionDetection={closestCenter}
                  onDragStart={handleDragStart}
                  onDragOver={updateDropIntent}
                  onDragMove={updateDropIntent}
                  onDragEnd={handleDragEnd}
                >
                  {pinnedIds.length > 0 && (
                    <>
                      <div className="px-2 pt-1.5 pb-0.5 text-[10px] font-medium text-muted-foreground/60 uppercase tracking-wider">Pinned</div>
                      {pinnedIds.map(nodeId => (
                        <TreeNodeRecursive key={nodeId} nodeId={nodeId} nodes={effectiveNodes} childrenMap={childrenMap} selection={selection} expandedIds={expandedIds} onSelect={handleSelect} onToggle={toggleExpand} onCreateDoc={handleCreateDoc} onCreateTable={handleCreateTable} onCreatePresentation={handleCreatePresentation} onCreateDiagram={handleCreateDiagram} onRequestDelete={requestDelete} onTogglePin={handleTogglePin} depth={0} creating={creating} dropIntent={dropIntent} dragActiveId={dragActiveId} />
                      ))}
                      <div className="border-t border-border/50 my-1 mx-2" />
                    </>
                  )}
                  {pinnedIds.length > 0 && unpinnedIds.length > 0 && (
                    <div className="px-2 pt-0.5 pb-0.5 text-[10px] font-medium text-muted-foreground/60 uppercase tracking-wider">Library</div>
                  )}
                  {unpinnedIds.map(nodeId => (
                    <TreeNodeRecursive key={nodeId} nodeId={nodeId} nodes={effectiveNodes} childrenMap={childrenMap} selection={selection} expandedIds={expandedIds} onSelect={handleSelect} onToggle={toggleExpand} onCreateDoc={handleCreateDoc} onCreateTable={handleCreateTable} onCreatePresentation={handleCreatePresentation} onCreateDiagram={handleCreateDiagram} onRequestDelete={requestDelete} onTogglePin={handleTogglePin} depth={0} creating={creating} dropIntent={dropIntent} dragActiveId={dragActiveId} />
                  ))}
                  <DragOverlay dropAnimation={null}>
                    {dragActiveNode && (
                      <div className="flex items-center gap-1.5 py-1.5 px-2 text-sm bg-card border border-border rounded-lg shadow-lg opacity-90">
                        {dragActiveNode.type === 'table' ? <Table2 className="h-4 w-4 text-muted-foreground shrink-0" /> : dragActiveNode.type === 'presentation' ? <Presentation className="h-4 w-4 text-muted-foreground shrink-0" /> : dragActiveNode.type === 'diagram' ? <GitBranch className="h-4 w-4 text-muted-foreground shrink-0" /> : <FileText className="h-4 w-4 text-muted-foreground shrink-0" />}
                        <span className="truncate">{dragActiveNode.title}</span>
                      </div>
                    )}
                  </DragOverlay>
                </DndContext>
              )}
            </div>
          </ScrollArea>
        </div>
      )}

      {/* Detail area */}
      <div className={cn(
        'flex-1 flex flex-col min-w-0 min-h-0 bg-card',
        mobileView === 'list' ? 'hidden md:flex' : 'flex'
      )}>
        {selectedDoc && selection?.type === 'doc' ? (
          <DocPanel
            key={selectedDoc.id}
            doc={selectedDoc}
            customIcon={customIcons?.[selectedDoc.id]}
            breadcrumb={getBreadcrumb(selectedDoc.id)}
            onBack={() => setMobileView('list')}
            onSaved={refreshDocs}
            onDeleted={() => { requestDelete(`doc:${selectedDoc.id}`); }}
            onNavigate={(docId) => { const sel = { type: 'doc' as const, id: docId }; setSelection(sel); syncSelectionToURL(sel); }}
            docListVisible={docListVisible}
            onToggleDocList={() => setDocListVisible(v => !v)}
          />
        ) : selectedTableId ? (
          <TableEditor
            tableId={selectedTableId}
            breadcrumb={(() => {
              const path: { id: string; title: string }[] = [];
              let nodeId: string | null = `table:${selectedTableId}`;
              while (nodeId) {
                const node = effectiveNodes.get(nodeId);
                if (!node) break;
                path.unshift({ id: node.rawId, title: node.title });
                nodeId = node.parentId;
              }
              return path;
            })()}
            onBack={() => setMobileView('list')}
            onDeleted={() => {
              setSelection(null); setMobileView('list');
              queryClient.invalidateQueries({ queryKey: ['content-items'] });
            }}
            onCopyLink={() => {
              navigator.clipboard.writeText(buildContentLink({ type: 'table', id: selectedTableId }));
            }}
            docListVisible={docListVisible}
            onToggleDocList={() => setDocListVisible(v => !v)}
          />
        ) : selectedPresentationId ? (
          <PresentationEditor
            presentationId={selectedPresentationId}
            breadcrumb={(() => {
              const path: { id: string; title: string }[] = [];
              let nodeId: string | null = `presentation:${selectedPresentationId}`;
              while (nodeId) {
                const node = effectiveNodes.get(nodeId);
                if (!node) break;
                path.unshift({ id: node.rawId, title: node.title });
                nodeId = node.parentId;
              }
              return path;
            })()}
            onBack={() => setMobileView('list')}
            onDeleted={() => {
              setSelection(null); setMobileView('list');
              queryClient.invalidateQueries({ queryKey: ['content-items'] });
            }}
            onCopyLink={() => {
              navigator.clipboard.writeText(buildContentLink({ type: 'presentation', id: selectedPresentationId }));
            }}
            docListVisible={docListVisible}
            onToggleDocList={() => setDocListVisible(v => !v)}
          />
        ) : selectedDiagramId ? (
          <DiagramEditor
            diagramId={selectedDiagramId}
            breadcrumb={(() => {
              const path: { id: string; title: string }[] = [];
              let nodeId: string | null = `diagram:${selectedDiagramId}`;
              while (nodeId) {
                const node = effectiveNodes.get(nodeId);
                if (!node) break;
                path.unshift({ id: node.rawId, title: node.title });
                nodeId = node.parentId;
              }
              return path;
            })()}
            onBack={() => setMobileView('list')}
            onDeleted={() => {
              setSelection(null); setMobileView('list');
              queryClient.invalidateQueries({ queryKey: ['content-items'] });
            }}
            onCopyLink={() => {
              navigator.clipboard.writeText(buildContentLink({ type: 'diagram', id: selectedDiagramId }));
            }}
            docListVisible={docListVisible}
            onToggleDocList={() => setDocListVisible(v => !v)}
          />
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground gap-2">
            <div className="flex gap-3 mb-2">
              <FileText className="h-8 w-8 opacity-20" />
              <Table2 className="h-8 w-8 opacity-20" />
              <Presentation className="h-8 w-8 opacity-20" />
              <GitBranch className="h-8 w-8 opacity-20" />
            </div>
            <p className="text-sm">{t('content.selectHint')}</p>
            <p className="text-xs text-muted-foreground/50">{t('content.createHint')}</p>
          </div>
        )}
      </div>

      {/* Delete dialog for docs with children */}
      {deleteDialog && (
        <>
          <div className="fixed inset-0 z-50 bg-black/50" onClick={() => setDeleteDialog(null)} />
          <div className="fixed z-50 top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-card border border-border rounded-xl shadow-2xl p-5 w-[340px]">
            <h3 className="text-sm font-medium mb-3">{t('content.deleteDocWithChildren') || 'This document has sub-documents'}</h3>
            <div className="space-y-2">
              <button
                onClick={() => { executeDelete(deleteDialog.nodeId, 'only'); }}
                className="w-full text-left px-3 py-2.5 text-sm rounded-lg border border-border hover:bg-accent transition-colors"
              >
                <div className="font-medium">{t('content.deleteOnly') || 'Delete this document only'}</div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {t('content.deleteOnlyDesc') || 'Sub-documents will be moved up one level'}
                </div>
              </button>
              <button
                onClick={() => { executeDelete(deleteDialog.nodeId, 'all'); }}
                className="w-full text-left px-3 py-2.5 text-sm rounded-lg border border-destructive/30 hover:bg-destructive/5 text-destructive transition-colors"
              >
                <div className="font-medium">{t('content.deleteAll') || 'Delete with all sub-documents'}</div>
                <div className="text-xs text-destructive/70 mt-0.5">
                  {t('content.deleteAllDesc') || 'All sub-documents will also be moved to trash'}
                </div>
              </button>
            </div>
            <button
              onClick={() => setDeleteDialog(null)}
              className="w-full mt-3 px-3 py-2 text-sm text-muted-foreground hover:text-foreground rounded-lg hover:bg-accent transition-colors"
            >
              {t('common.cancel') || 'Cancel'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════
// Recursive tree node
// ═══════════════════════════════════════════════════

function TreeNodeRecursive({
  nodeId, nodes, childrenMap, selection, expandedIds, onSelect, onToggle,
  onCreateDoc, onCreateTable, onCreatePresentation, onCreateDiagram, onRequestDelete, onTogglePin, depth, creating, dropIntent, dragActiveId,
}: {
  nodeId: string;
  nodes: Map<string, ContentNode>;
  childrenMap: Map<string, string[]>;
  selection: Selection;
  expandedIds: Set<string>;
  onSelect: (id: string) => void;
  onToggle: (id: string) => void;
  onCreateDoc: (parentId?: string) => void;
  onCreateTable: (parentId?: string) => void;
  onCreatePresentation: (parentId?: string) => void;
  onCreateDiagram: (parentId?: string) => void;
  onRequestDelete: (nodeId: string) => void;
  onTogglePin: (nodeId: string) => void;
  depth: number;
  creating: boolean;
  dropIntent: DropIntent;
  dragActiveId: string | null;
}) {
  const node = nodes.get(nodeId);
  if (!node) return null;

  const children = childrenMap.get(nodeId) || [];
  const hasChildren = children.length > 0;
  const isExpanded = expandedIds.has(nodeId);
  const isSelected = selection?.type === node.type && selection?.id === node.rawId;

  // Drop indicators for this node
  const isDropTarget = dropIntent?.overId === nodeId && dragActiveId !== nodeId;
  const dropPosition = isDropTarget ? dropIntent!.position : null;

  return (
    <div>
      <DraggableTreeNode
        nodeId={nodeId}
        node={node}
        isSelected={isSelected}
        onSelect={() => onSelect(nodeId)}
        hasChildren={hasChildren}
        isExpanded={isExpanded}
        onToggle={() => onToggle(nodeId)}
        depth={depth}
        onCreateChild={(type) => {
          if (type === 'doc') onCreateDoc(nodeId);
          else if (type === 'table') onCreateTable(nodeId);
          else if (type === 'presentation') onCreatePresentation(nodeId);
          else onCreateDiagram(nodeId);
        }}
        onRequestDelete={onRequestDelete}
        onTogglePin={onTogglePin}
        creating={creating}
        dropPosition={dropPosition}
        isDragActive={dragActiveId === nodeId}
      />
      {hasChildren && isExpanded && (
        <div>
          {children.map(childId => (
            <TreeNodeRecursive
              key={childId}
              nodeId={childId}
              nodes={nodes}
              childrenMap={childrenMap}
              selection={selection}
              expandedIds={expandedIds}
              onSelect={onSelect}
              onToggle={onToggle}
              onCreateDoc={onCreateDoc}
              onCreateTable={onCreateTable}
              onCreatePresentation={onCreatePresentation}
              onCreateDiagram={onCreateDiagram}
              onRequestDelete={onRequestDelete}
              onTogglePin={onTogglePin}
              depth={depth + 1}
              creating={creating}
              dropIntent={dropIntent}
              dragActiveId={dragActiveId}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════
// Draggable tree node (stays in place while dragging, grayed out)
// ═══════════════════════════════════════════════════

function DraggableTreeNode({
  nodeId, node, isSelected, onSelect, hasChildren, isExpanded, onToggle, depth, onCreateChild, onRequestDelete, onTogglePin, creating, dropPosition, isDragActive,
}: {
  nodeId: string;
  node: ContentNode;
  isSelected: boolean;
  onSelect: () => void;
  hasChildren: boolean;
  isExpanded: boolean;
  onToggle: () => void;
  depth: number;
  onCreateChild: (type: 'doc' | 'table' | 'presentation' | 'diagram') => void;
  onRequestDelete: (nodeId: string) => void;
  onTogglePin: (nodeId: string) => void;
  creating?: boolean;
  dropPosition?: 'before' | 'after' | 'inside' | null;
  isDragActive?: boolean;
}) {
  const { t } = useT();
  const queryClient = useQueryClient();
  const { attributes, listeners, setNodeRef } = useDraggable({ id: nodeId });
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [showIconPicker, setShowIconPicker] = useState(false);
  const addBtnRef = useRef<HTMLButtonElement>(null);
  const addMenuRef = useRef<HTMLDivElement>(null);
  const moreBtnRef = useRef<HTMLButtonElement>(null);
  const moreMenuRef = useRef<HTMLDivElement>(null);
  const iconPickerRef = useRef<HTMLDivElement>(null);

  // Right-click context menu
  const getContextMenuItems = useCallback((): ContextMenuItem[] => [
    {
      id: 'pin',
      label: node.pinned ? 'Unpin' : 'Pin to top',
      icon: node.pinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />,
      onClick: () => onTogglePin(nodeId),
    },
    {
      id: 'copy-link',
      label: 'Copy link',
      icon: <Link2 className="h-3.5 w-3.5" />,
      shortcut: '⌘L',
      onClick: () => {
        const link = `${window.location.origin}/content?id=${node.rawId}&type=${node.type}`;
        navigator.clipboard.writeText(link).catch(() => {});
      },
    },
    {
      id: 'delete',
      label: t('content.delete'),
      icon: <Trash2 className="h-3.5 w-3.5" />,
      danger: true,
      separator: true,
      onClick: () => onRequestDelete(nodeId),
    },
  ], [node.pinned, node.rawId, node.type, nodeId, onTogglePin, onRequestDelete, t]);

  const { onContextMenu: handleContextMenu, onTouchStart: handleLongPressStart, onTouchEnd: handleLongPressEnd, onTouchMove: handleLongPressMove } = useContextMenu(getContextMenuItems);

  // Close icon picker on outside click
  useEffect(() => {
    if (!showIconPicker) return;
    const handler = (e: MouseEvent) => {
      if (iconPickerRef.current && !iconPickerRef.current.contains(e.target as Node)) {
        setShowIconPicker(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showIconPicker]);

  const handleIconSelect = async (selectedEmoji: string | null) => {
    setShowIconPicker(false);
    try {
      await gw.updateContentItem(node.id, { icon: selectedEmoji || null });
      queryClient.invalidateQueries({ queryKey: ['content-items'] });
    } catch (e) {
      console.error('Failed to update icon:', e);
    }
  };

  // Calculate fixed position for dropdown menus to avoid overflow clipping
  // Reposition menus after they render (to get actual dimensions)
  useLayoutEffect(() => {
    if (showAddMenu && addBtnRef.current && addMenuRef.current) {
      const rect = addBtnRef.current.getBoundingClientRect();
      const pos = getAutoPosition(rect, 144, addMenuRef.current.offsetHeight, { align: 'right' });
      addMenuRef.current.style.top = `${pos.top}px`;
      addMenuRef.current.style.left = `${pos.left}px`;
      if (pos.maxHeight < addMenuRef.current.offsetHeight) addMenuRef.current.style.maxHeight = `${pos.maxHeight}px`;
    }
  }, [showAddMenu]);

  useLayoutEffect(() => {
    if (showMoreMenu && moreBtnRef.current && moreMenuRef.current) {
      const rect = moreBtnRef.current.getBoundingClientRect();
      const pos = getAutoPosition(rect, 160, moreMenuRef.current.offsetHeight, { align: 'right' });
      moreMenuRef.current.style.top = `${pos.top}px`;
      moreMenuRef.current.style.left = `${pos.left}px`;
      if (pos.maxHeight < moreMenuRef.current.offsetHeight) moreMenuRef.current.style.maxHeight = `${pos.maxHeight}px`;
    }
  }, [showMoreMenu]);

  const getMenuPos = (btnRef: React.RefObject<HTMLButtonElement | null>, _menuRef: React.RefObject<HTMLDivElement | null>, menuWidth = 160) => {
    if (!btnRef.current) return { top: 0, left: 0 };
    const rect = btnRef.current.getBoundingClientRect();
    // Initial position — will be corrected by useEffect after mount
    const pos = getAutoPosition(rect, menuWidth, 0, { align: 'right' });
    return { top: pos.top, left: pos.left };
  };

  return (
    <div ref={setNodeRef} className="relative" data-tree-id={nodeId}>
      {/* Drop indicator: before */}
      {dropPosition === 'before' && (
        <div className="absolute top-0 left-2 right-2 h-0.5 bg-sidebar-primary rounded-full z-10" />
      )}
      <div
        className={cn(
          'group relative flex items-center gap-1 py-1.5 px-1 text-sm transition-colors rounded-lg cursor-pointer',
          isDragActive && 'opacity-40',
          isSelected && !isDragActive
            ? 'bg-sidebar-accent text-sidebar-primary'
            : !isDragActive && 'text-foreground hover:bg-black/[0.03] dark:hover:bg-accent/50',
          dropPosition === 'inside' && 'ring-2 ring-sidebar-primary ring-inset bg-sidebar-accent'
        )}
        style={{ paddingLeft: `${4 + depth * 16}px` }}
        onClick={onSelect}
        onContextMenu={handleContextMenu}
        onTouchStart={handleLongPressStart}
        onTouchEnd={handleLongPressEnd}
        onTouchMove={handleLongPressMove}
      >
        {/* Expand/collapse toggle */}
        {hasChildren ? (
          <button
            onClick={(e) => { e.stopPropagation(); onToggle(); }}
            className="p-0.5 shrink-0 text-muted-foreground hover:text-foreground"
          >
            <svg className={cn('h-3 w-3 transition-transform', isExpanded && 'rotate-90')} viewBox="0 0 16 16" fill="currentColor"><polygon points="6,3 13,8 6,13" /></svg>
          </button>
        ) : (
          <span className="w-4 shrink-0" />
        )}

        {/* Icon — emoji overrides default for docs; click to change */}
        <div className="relative shrink-0" ref={iconPickerRef}>
          <button
            onClick={(e) => {
              e.stopPropagation(); setShowIconPicker(v => !v);
            }}
            className="shrink-0 hover:opacity-70 transition-opacity"
            title="Change icon"
          >
            {node.emoji ? (
              node.emoji.startsWith('/api/') || node.emoji.startsWith('http') ? (
                <img src={node.emoji} alt="" className="w-4 h-4 rounded object-cover" />
              ) : (
                <span className="text-sm leading-none">{node.emoji}</span>
              )
            ) : node.type === 'table'
              ? <Table2 className={cn('h-4 w-4', isSelected ? 'text-sidebar-primary' : 'text-muted-foreground')} />
              : node.type === 'presentation'
              ? <Presentation className={cn('h-4 w-4', isSelected ? 'text-sidebar-primary' : 'text-muted-foreground')} />
              : <FileText className={cn('h-4 w-4', isSelected ? 'text-sidebar-primary' : 'text-muted-foreground')} />
            }
          </button>
          {showIconPicker && (
            <div className="fixed z-50 rounded-lg shadow-xl overflow-hidden" style={(() => {
              const rect = iconPickerRef.current?.getBoundingClientRect();
              return rect ? { top: rect.bottom + 4, left: Math.max(4, rect.left - 80) } : { top: 0, left: 0 };
            })()}>
              <EmojiPicker
                onSelect={(em) => handleIconSelect(em)}
                onRemove={node.emoji ? () => handleIconSelect(null) : undefined}
                onUploadImage={node.type === 'doc' ? async (file) => {
                  const result = await docApi.uploadFile(file, node.rawId);
                  return result.url;
                } : undefined}
              />
            </div>
          )}
        </div>

        {/* Title — drag handle */}
        <span className="truncate flex-1 select-none" {...attributes} {...listeners}>{node.title}</span>

        {/* Hover actions: Add + More */}
        <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 pointer-events-none group-hover:pointer-events-auto transition-opacity">
          <div className="relative">
            <button
              ref={addBtnRef}
              onClick={(e) => { e.stopPropagation(); setShowAddMenu(v => !v); }}
              className="p-0.5 text-muted-foreground hover:text-foreground rounded"
              title="Add child"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
            {showAddMenu && (
              <>
                <div className="fixed inset-0 z-10" onClick={(e) => { e.stopPropagation(); setShowAddMenu(false); }} />
                <div ref={addMenuRef} className="fixed z-50 bg-card border border-border rounded-lg shadow-lg py-1 w-36 overflow-y-auto" style={getMenuPos(addBtnRef, addMenuRef, 144)}>
                  <button
                    onClick={(e) => { e.stopPropagation(); setShowAddMenu(false); onCreateChild('doc'); }}
                    disabled={creating}
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-foreground hover:bg-accent transition-colors disabled:opacity-50"
                  >
                    <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                    {t('content.newDoc')}
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); setShowAddMenu(false); onCreateChild('table'); }}
                    disabled={creating}
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-foreground hover:bg-accent transition-colors disabled:opacity-50"
                  >
                    <Table2 className="h-3.5 w-3.5 text-muted-foreground" />
                    {t('content.newTable')}
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); setShowAddMenu(false); onCreateChild('presentation'); }}
                    disabled={creating}
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-foreground hover:bg-accent transition-colors disabled:opacity-50"
                  >
                    <Presentation className="h-3.5 w-3.5 text-muted-foreground" />
                    {t('content.newPresentation') || 'New Presentation'}
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); setShowAddMenu(false); onCreateChild('diagram'); }}
                    disabled={creating}
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-foreground hover:bg-accent transition-colors disabled:opacity-50"
                  >
                    <GitBranch className="h-3.5 w-3.5 text-muted-foreground" />
                    {t('content.newDiagram') || 'New Diagram'}
                  </button>
                </div>
              </>
            )}
          </div>
          <div className="relative">
            <button
              ref={moreBtnRef}
              onClick={(e) => { e.stopPropagation(); setShowMoreMenu(v => !v); }}
              className="p-0.5 text-muted-foreground hover:text-foreground rounded"
              title="More"
            >
              <MoreHorizontal className="h-3.5 w-3.5" />
            </button>
            {showMoreMenu && (
              <>
                <div className="fixed inset-0 z-10" onClick={(e) => { e.stopPropagation(); setShowMoreMenu(false); }} />
                <div ref={moreMenuRef} className="fixed z-50 bg-card border border-border rounded-lg shadow-xl py-1 w-40 overflow-y-auto" style={getMenuPos(moreBtnRef, moreMenuRef, 160)}>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowMoreMenu(false);
                      onTogglePin(nodeId);
                    }}
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-foreground hover:bg-accent transition-colors"
                  >
                    {node.pinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
                    {node.pinned ? 'Unpin' : 'Pin to top'}
                  </button>
                  <div className="border-t border-border my-0.5" />
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowMoreMenu(false);
                      onRequestDelete(nodeId);
                    }}
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-destructive hover:bg-accent transition-colors"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    {t('content.delete')}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
      {/* Drop indicator: after */}
      {dropPosition === 'after' && (
        <div className="absolute bottom-0 left-2 right-2 h-0.5 bg-sidebar-primary rounded-full z-10" />
      )}
    </div>
  );
}

// Non-sortable version for search results
function TreeNodeItem({
  nodeId, node, isSelected, onSelect, hasChildren, isExpanded, onToggle, depth, onCreateChild,
}: {
  nodeId: string;
  node: { type: 'doc' | 'table'; title: string; emoji?: string };
  isSelected: boolean;
  onSelect: () => void;
  hasChildren: boolean;
  isExpanded: boolean;
  onToggle: () => void;
  depth: number;
  onCreateChild: () => void;
}) {
  return (
    <button
      onClick={onSelect}
      className={cn(
        'w-full flex items-center gap-1.5 py-1.5 px-2 text-left text-sm transition-colors rounded-lg',
        isSelected
          ? 'bg-sidebar-accent text-sidebar-primary'
          : 'text-foreground hover:bg-black/[0.03] dark:hover:bg-accent/50'
      )}
      style={{ paddingLeft: `${8 + depth * 16}px` }}
    >
      <span className="w-4 shrink-0" />
      {node.emoji ? (
        node.emoji.startsWith('/api/') || node.emoji.startsWith('http') ? (
          <img src={node.emoji} alt="" className="w-4 h-4 rounded object-cover shrink-0" />
        ) : (
          <span className="text-sm shrink-0 leading-none">{node.emoji}</span>
        )
      ) : (node.type as string) === 'table'
        ? <Table2 className={cn('h-4 w-4 shrink-0', isSelected ? 'text-sidebar-primary' : 'text-muted-foreground')} />
        : (node.type as string) === 'presentation'
        ? <Presentation className={cn('h-4 w-4 shrink-0', isSelected ? 'text-sidebar-primary' : 'text-muted-foreground')} />
        : (node.type as string) === 'diagram'
        ? <GitBranch className={cn('h-4 w-4 shrink-0', isSelected ? 'text-sidebar-primary' : 'text-muted-foreground')} />
        : <FileText className={cn('h-4 w-4 shrink-0', isSelected ? 'text-sidebar-primary' : 'text-muted-foreground')} />
      }
      <span className="truncate">{node.title}</span>
    </button>
  );
}

// ═══════════════════════════════════════════════════
// Trash item component
// ═══════════════════════════════════════════════════

function TrashItem({ title, icon, deletedAt, onRestore, onPermanentDelete }: {
  title: string;
  icon: React.ReactNode;
  deletedAt?: string;
  onRestore: () => Promise<void>;
  onPermanentDelete: () => Promise<void>;
}) {
  const [loading, setLoading] = useState(false);

  const handleAction = async (action: () => Promise<void>) => {
    if (loading) return;
    setLoading(true);
    try { await action(); } finally { setLoading(false); }
  };

  const deletedDate = deletedAt ? new Date(deletedAt).toLocaleDateString() : '';

  return (
    <div className={cn(
      'group flex items-center gap-1.5 py-1.5 px-2 text-sm rounded-lg',
      loading ? 'opacity-50' : 'hover:bg-black/[0.03] dark:hover:bg-accent/50'
    )}>
      {icon}
      <div className="flex-1 min-w-0">
        <span className="truncate block select-none">{title || 'Untitled'}</span>
        {deletedDate && (
          <span className="text-[10px] text-muted-foreground/60">{deletedDate}</span>
        )}
      </div>
      <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={() => handleAction(onRestore)}
          disabled={loading}
          className="p-1 text-muted-foreground hover:text-foreground rounded"
          title="Restore"
        >
          <RotateCcw className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={() => handleAction(onPermanentDelete)}
          disabled={loading}
          className="p-1 text-destructive hover:text-destructive/80 rounded"
          title="Delete permanently"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════
// Document sub-components
// ═══════════════════════════════════════════════════

/* Emoji picker is now a separate component: @/components/EmojiPicker */

function DocPanel({ doc, customIcon, breadcrumb, onBack, onSaved, onDeleted, onNavigate, docListVisible, onToggleDocList }: {
  doc: DocType;
  customIcon?: string;
  breadcrumb: { id: string; title: string }[];
  onBack: () => void;
  onSaved: () => void;
  onDeleted: () => void;
  onNavigate: (docId: string) => void;
  docListVisible?: boolean;
  onToggleDocList?: () => void;
}) {
  const { t } = useT();
  const queryClient = useQueryClient();

  // Shared comment fetch function — used by both highlight extraction and Comments component
  const fetchDocComments = useCallback(async () => {
    const comments = await docApi.listComments(doc.id);
    return comments.map(c => ({
      id: c.id,
      text: docApi.proseMirrorToText(c.data),
      actor: c.createdBy?.name || 'Unknown',
      parent_id: c.parentCommentId || null,
      resolved_by: c.resolvedBy || null,
      resolved_at: c.resolvedAt || null,
      created_at: c.createdAt,
      updated_at: c.updatedAt,
    }));
  }, [doc.id]);

  // Fetch comments — shared query key with Comments component so invalidation works
  const { data: docComments = [] } = useQuery({
    queryKey: ['doc-comments', doc.id],
    queryFn: fetchDocComments,
  });
  // Extract quoted text from comments for editor highlighting (skip resolved comments)
  const commentHighlightQuotes = useMemo(() => {
    return docComments
      .filter(c => !c.resolved_by) // Don't highlight resolved comments
      .map(c => {
        const match = c.text.match(/^>\s(.+?)(?:\n\n)/);
        return match ? { id: c.id, text: match[1] } : null;
      })
      .filter((q): q is { id: string; text: string } => q !== null);
  }, [docComments]);

  const [showComments, setShowComments] = useState(false);
  const [showDocMenu, setShowDocMenu] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [commentQuote, setCommentQuote] = useState('');
  const [title, setTitle] = useState(doc.title);
  const [emoji, setEmoji] = useState<string | null>(customIcon || doc.icon?.trim() || null);
  const [text, setText] = useState(doc.text);
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'unsaved' | 'error'>('saved');
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showTitleIcon, setShowTitleIcon] = useState(false);
  const [editorKey, setEditorKey] = useState(0);
  const [fullWidth, setFullWidth] = useState(doc.full_width ?? false);
  const [showSearch, setShowSearch] = useState(false);
  const [searchWithReplace, setSearchWithReplace] = useState(false);
  const [focusedCommentId, setFocusedCommentId] = useState<string | null>(null);
  const [commentTopOffset, setCommentTopOffset] = useState<number | null>(null);
  const [insightsEnabled, setInsightsEnabled] = useState(true);
  const [previewRevision, setPreviewRevision] = useState<DocRevision | null>(null);
  const [prevRevision, setPrevRevision] = useState<DocRevision | null>(null);
  const [highlightChanges, setHighlightChanges] = useState(false);
  const titleSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const textSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const titleVersionRef = useRef(0);
  const textVersionRef = useRef(0);
  const docIdRef = useRef(doc.id);
  const latestTitleRef = useRef(doc.title);
  const latestTextRef = useRef(doc.text);
  const latestEmojiRef = useRef((customIcon || doc.icon || null) as string | null);
  const emojiPickerRef = useRef<HTMLDivElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);

  // Update sidebar doc list via Gateway when title/emoji change
  const updateDocCache = useCallback((newTitle: string, newEmoji: string | null) => {
    gw.updateContentItem(`doc:${doc.id}`, { title: newTitle, icon: newEmoji }).then(() => {
      queryClient.invalidateQueries({ queryKey: ['content-items'] });
    }).catch(() => {});
  }, [doc.id, queryClient]);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.text) {
        setCommentQuote(detail.text);
        setShowComments(true);
        // Calculate top offset of the selection for sidebar alignment
        const editorArea = document.querySelector('.outline-editor');
        if (editorArea) {
          const editorRect = editorArea.getBoundingClientRect();
          // Try selection range first (inline comments), then blockRect (block comments)
          const sel = window.getSelection();
          if (sel && sel.rangeCount > 0) {
            const rangeRect = sel.getRangeAt(0).getBoundingClientRect();
            if (rangeRect.height > 0) {
              setCommentTopOffset(rangeRect.top - editorRect.top);
              return;
            }
          }
          if (detail.blockRect) {
            setCommentTopOffset(detail.blockRect.top - editorRect.top);
          }
        }
      }
    };
    window.addEventListener('editor-comment', handler);
    return () => window.removeEventListener('editor-comment', handler);
  }, []);

  // Click handler for comment marks in editor — highlight and open sidebar
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const commentEl = target.closest('.comment-marker') as HTMLElement | null;
      if (!commentEl) {
        // Clicked outside a comment mark — clear focus
        if (focusedCommentId) {
          document.querySelectorAll('.comment-marker.comment-focused').forEach(el =>
            el.classList.remove('comment-focused')
          );
          setFocusedCommentId(null);
        }
        return;
      }
      const id = commentEl.id.replace('comment-', '');
      const resolved = commentEl.getAttribute('data-resolved');
      if (resolved) return;

      // Clear previous focus
      document.querySelectorAll('.comment-marker.comment-focused').forEach(el =>
        el.classList.remove('comment-focused')
      );

      // Add focus to all spans of this comment (may span multiple nodes)
      document.querySelectorAll(`#comment-${id}`).forEach(el =>
        el.classList.add('comment-focused')
      );
      setFocusedCommentId(id);

      // Calculate offset for sidebar alignment
      const editorArea = document.querySelector('.outline-editor');
      if (editorArea) {
        const editorRect = editorArea.getBoundingClientRect();
        const markRect = commentEl.getBoundingClientRect();
        setCommentTopOffset(markRect.top - editorRect.top);
      }

      // Open comments sidebar if not already open
      if (!showComments) setShowComments(true);
    };
    document.addEventListener('mouseup', handler);
    return () => document.removeEventListener('mouseup', handler);
  }, [focusedCommentId, showComments]);

  // Global Cmd+F / Cmd+H to open search bar
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key === 'f') {
        // Only intercept if not already inside ProseMirror (editor handles its own)
        if ((e.target as HTMLElement)?.closest?.('.ProseMirror')) return;
        e.preventDefault();
        setShowSearch(true);
        setSearchWithReplace(false);
      }
      if (mod && e.key === 'h') {
        if ((e.target as HTMLElement)?.closest?.('.ProseMirror')) return;
        e.preventDefault();
        setShowSearch(true);
        setSearchWithReplace(true);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Reset local state and cancel pending saves when switching to a different document
  useEffect(() => {
    // Cancel any pending saves from previous doc
    if (titleSaveTimerRef.current) { clearTimeout(titleSaveTimerRef.current); titleSaveTimerRef.current = null; }
    if (textSaveTimerRef.current) { clearTimeout(textSaveTimerRef.current); textSaveTimerRef.current = null; }
    docIdRef.current = doc.id;
    setTitle(doc.title);
    setEmoji(customIcon || doc.icon?.trim() || null);
    setText(doc.text);
    latestTitleRef.current = doc.title;
    latestTextRef.current = doc.text;
    latestEmojiRef.current = (customIcon || doc.icon || null) as string | null;
    setSaveStatus('saved');
    setShowHistory(false);
    setPreviewRevision(null);
    setPrevRevision(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc.id]);

  // Close emoji picker on outside click
  useEffect(() => {
    if (!showEmojiPicker) return;
    const handler = (e: MouseEvent) => {
      if (emojiPickerRef.current && !emojiPickerRef.current.contains(e.target as Node)) {
        setShowEmojiPicker(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showEmojiPicker]);

  // Shared save execution — sends current latestRefs to Outline API
  const executeSave = useCallback(async (saveDocId: string, titleVersion: number, textVersion: number) => {
    if (saveDocId !== docIdRef.current) return;
    setSaveStatus('saving');
    try {
      const savingTitle = latestTitleRef.current;
      const savingText = latestTextRef.current;
      const savingEmoji = latestEmojiRef.current;
      const outlineEmoji = savingEmoji && (savingEmoji.startsWith('/api/') || savingEmoji.startsWith('http')) ? null : savingEmoji;
      const titleToSave = savingTitle ?? '';
      const savedDoc = await docApi.updateDocument(saveDocId, titleToSave, savingText, outlineEmoji);
      // Only update cache if no newer save of either type has been scheduled
      if (titleVersionRef.current !== titleVersion || textVersionRef.current !== textVersion) return;
      const confirmedTitle = savedDoc.title;
      const confirmedEmoji = savingEmoji;
      queryClient.setQueryData<DocType>(['document', saveDocId], (old) =>
        old ? { ...old, title: confirmedTitle, text: savingText, icon: confirmedEmoji } : old
      );
      queryClient.invalidateQueries({ queryKey: ['content-items'] });
      if (saveDocId === docIdRef.current) {
        setSaveStatus('saved');
      }
    } catch (e) {
      console.error('Auto-save failed:', e);
      if (saveDocId === docIdRef.current) setSaveStatus('error');
    }
  }, [queryClient]);

  // Schedule title save — only updates title ref, does not touch text ref
  const scheduleTitleSave = useCallback((newTitle: string, newEmoji?: string | null) => {
    latestTitleRef.current = newTitle;
    if (newEmoji !== undefined) latestEmojiRef.current = newEmoji;
    setSaveStatus('unsaved');
    if (titleSaveTimerRef.current) clearTimeout(titleSaveTimerRef.current);
    // Also cancel any pending text save — the combined save will include both
    if (textSaveTimerRef.current) { clearTimeout(textSaveTimerRef.current); textSaveTimerRef.current = null; }
    const saveDocId = docIdRef.current;
    const tv = ++titleVersionRef.current;
    const xv = textVersionRef.current;
    titleSaveTimerRef.current = setTimeout(() => executeSave(saveDocId, tv, xv), 1500);
  }, [executeSave]);

  // Schedule text save — only updates text ref, does not touch title ref
  const scheduleTextSave = useCallback((newText: string) => {
    latestTextRef.current = newText;
    setSaveStatus('unsaved');
    if (textSaveTimerRef.current) clearTimeout(textSaveTimerRef.current);
    // Also cancel any pending title save — the combined save will include both
    if (titleSaveTimerRef.current) { clearTimeout(titleSaveTimerRef.current); titleSaveTimerRef.current = null; }
    const saveDocId = docIdRef.current;
    const tv = titleVersionRef.current;
    const xv = ++textVersionRef.current;
    textSaveTimerRef.current = setTimeout(() => executeSave(saveDocId, tv, xv), 1500);
  }, [executeSave]);

  useEffect(() => {
    return () => {
      if (titleSaveTimerRef.current) clearTimeout(titleSaveTimerRef.current);
      if (textSaveTimerRef.current) clearTimeout(textSaveTimerRef.current);
    };
  }, [doc.id]);

  const handleTitleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newTitle = e.target.value;
    setTitle(newTitle);
    updateDocCache(newTitle, emoji);
    scheduleTitleSave(newTitle);
  };

  const handleEmojiSelect = async (selectedEmoji: string | null) => {
    setEmoji(selectedEmoji);
    setShowEmojiPicker(false);
    updateDocCache(title, selectedEmoji);

    const isUrl = selectedEmoji && (selectedEmoji.startsWith('/api/') || selectedEmoji.startsWith('http'));

    if (isUrl) {
      // Image-based icon: save to NocoDB (Outline doesn't support URL icons)
      // Clear Outline's native icon
      scheduleTitleSave(title, null);
      try {
        await gw.setDocIcon(doc.id, selectedEmoji);
        queryClient.invalidateQueries({ queryKey: ['content-items'] });
      } catch (e) {
        console.error('Failed to save custom icon:', e);
      }
    } else {
      // Unicode emoji or null (remove): save to Outline, remove custom icon
      scheduleTitleSave(title, selectedEmoji);
      try {
        await gw.removeDocIcon(doc.id);
        queryClient.invalidateQueries({ queryKey: ['content-items'] });
      } catch (e) {
        // Ignore if no custom icon existed
      }
    }
  };

  const handleTextChange = (newText: string) => {
    setText(newText);
    scheduleTextSave(newText);
  };

  const handleDelete = () => {
    onDeleted(); // delegate to parent — handles children dialog, trash, navigation
  };

  const statusText = saveStatus === 'saving' ? t('content.saving') : saveStatus === 'unsaved' ? t('content.unsaved') : saveStatus === 'error' ? t('content.saveFailed') : '';

  return (
    <div className="flex flex-row h-full overflow-hidden">
    <div className="flex-1 min-w-0 flex flex-col">
      {/* Top bar — breadcrumb + actions, split when comments open */}
      <div className="flex items-center border-b border-border bg-card shrink-0">
        <ContentTopBar
          breadcrumb={breadcrumb}
          onNavigate={onNavigate}
          onBack={onBack}
          docListVisible={docListVisible}
          onToggleDocList={onToggleDocList}
          title={title || breadcrumb?.[breadcrumb.length - 1]?.title || ''}
          metaLine={
            <button
              onClick={() => setShowHistory(true)}
              className="text-[11px] text-muted-foreground/50 hover:text-muted-foreground transition-colors cursor-pointer"
            >
              {formatRelativeTime(doc.updated_at)}
              {doc.updated_by && <span> · {doc.updated_by}</span>}
            </button>
          }
          statusText={statusText}
          statusError={saveStatus === 'error'}
          actions={<>
            <button
              onClick={() => { setShowSearch(true); setSearchWithReplace(false); }}
              className={cn('p-1.5 rounded transition-colors', showSearch ? 'text-sidebar-primary bg-sidebar-primary/10' : 'text-muted-foreground hover:text-foreground')}
              title={t('content.findReplace') || 'Find & Replace'}
            >
              <Search className="h-4 w-4" />
            </button>
            <button
              onClick={() => setShowComments(v => !v)}
              className={cn('p-1.5 rounded transition-colors', showComments ? 'text-sidebar-primary bg-sidebar-primary/10' : 'text-muted-foreground hover:text-foreground')}
              title={t('content.comments')}
            >
              <MessageSquareIcon className="h-4 w-4" />
            </button>
            <div className="relative">
              <button onClick={() => setShowDocMenu(v => !v)} className="p-1.5 text-muted-foreground hover:text-foreground shrink-0" title={t('content.moreActions')}>
                <MoreHorizontal className="h-4 w-4" />
              </button>
              {showDocMenu && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setShowDocMenu(false)} />
                  <div className="absolute right-0 top-full mt-1 z-20 bg-card border border-border rounded-lg shadow-xl py-1 w-44">
                    <DocMenuBtn icon={Clock} label={t('content.versionHistory')} onClick={() => { setShowDocMenu(false); setShowHistory(true); }} />
                    <DocMenuBtn icon={Link2} label={t('content.copyLink')} onClick={() => { navigator.clipboard.writeText(buildContentLink({ type: 'doc', id: doc.id })); setShowDocMenu(false); }} />
                    <DocMenuBtn icon={Download} label={t('content.download')} onClick={() => {
                      const blob = new Blob([doc.text], { type: 'text/markdown' });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a'); a.href = url; a.download = `${title}.md`; a.click();
                      URL.revokeObjectURL(url);
                      setShowDocMenu(false);
                    }} />
                    <div className="border-t border-border my-1" />
                    <DocMenuBtn icon={Trash2} label={t('content.delete')} onClick={() => { setShowDocMenu(false); handleDelete(); }} danger />
                    <div className="border-t border-border my-1" />
                    <DocMenuToggle icon={Maximize2} label={t('content.fullWidth')} checked={fullWidth} onChange={async (v) => {
                      setFullWidth(v);
                      await docApi.updateDocument(doc.id, undefined, undefined, undefined, { fullWidth: v });
                    }} />
                  </div>
                </>
              )}
            </div>
          </>}
        />
        {/* Comment sidebar header — aligned with top bar */}
        {showComments && !showHistory && (
          <div className="w-80 shrink-0 flex items-center justify-between px-4 py-2 border-l border-border">
            <h3 className="text-sm font-semibold text-foreground">{t('content.comments')}</h3>
            <button onClick={() => setShowComments(false)} className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors" title={t('common.close')}>
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        )}
        {/* History sidebar — no top bar extension, sidebar has its own header */}
      </div>

      {/* Content area */}
      <div className="flex-1 min-h-0 flex flex-row overflow-hidden">
        <div className={cn('flex-1 min-h-0 min-w-0 flex flex-col overflow-y-auto', fullWidth && 'doc-full-width')}>
          {/* Revision preview banner with exit button */}
          {previewRevision && (
            <div className="flex items-center gap-3 px-4 py-2 bg-amber-50 dark:bg-amber-950/30 border-b border-amber-200 dark:border-amber-800 shrink-0">
              <Clock className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0" />
              <span className="text-sm text-amber-800 dark:text-amber-300 flex-1">
                {t('content.previewingVersion') || 'Previewing historical version'} — {new Date(previewRevision.createdAt).toLocaleString()}
              </span>
              <button
                onClick={() => { setShowHistory(false); setPreviewRevision(null); setPrevRevision(null); }}
                className="flex items-center gap-1.5 px-3 py-1 rounded-md text-sm font-medium bg-amber-600 text-white hover:bg-amber-700 transition-colors"
              >
                <X className="h-3.5 w-3.5" />
                {t('content.exitPreview') || 'Exit preview'}
              </button>
            </div>
          )}
          {/* Title area — Outline style: emoji inline when set, hover icon positioned outside */}
          <div
            className="doc-title-wrap"
            onMouseEnter={() => setShowTitleIcon(true)}
            onMouseLeave={() => { if (!showEmojiPicker) setShowTitleIcon(false); }}
          >
          <div className="doc-title-area group/title">
            <div className="relative flex items-center" ref={emojiPickerRef}>
              {/* Emoji or hover icon — absolute positioned to the LEFT, outside content area */}
              {!previewRevision && emoji ? (
                <button
                  onClick={() => setShowEmojiPicker(v => !v)}
                  className="absolute -left-12 top-1/2 -translate-y-1/2 text-4xl leading-none hover:opacity-70 transition-opacity"
                  title="Change icon"
                >
                  {emoji.startsWith('/api/') || emoji.startsWith('http') ? (
                    <img src={emoji} alt="icon" className="w-9 h-9 rounded object-cover" />
                  ) : emoji}
                </button>
              ) : !previewRevision && showTitleIcon ? (
                <button
                  onClick={() => setShowEmojiPicker(v => !v)}
                  className="absolute -left-10 top-1/2 -translate-y-1/2 p-1 rounded text-muted-foreground/30 hover:text-muted-foreground hover:bg-black/5 transition-all"
                  title="Add icon"
                >
                  <Smile className="h-6 w-6" />
                </button>
              ) : null}
              {/* Title — show revision title (read-only) or editable input */}
              {previewRevision ? (
                <div className="flex-1 min-w-0 text-[2.5rem] font-bold text-foreground leading-tight opacity-70">
                  {previewRevision.title || t('content.untitled')}
                </div>
              ) : (
                <input
                  ref={titleInputRef}
                  autoFocus={!doc.title}
                  value={title}
                  onChange={handleTitleChange}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      const wrapper = (e.target as HTMLElement).closest('.doc-title-wrap');
                      const mount = wrapper?.parentElement?.querySelector('.outline-editor-mount') as any;
                      const view = mount?.__pmView;
                      if (view) {
                        view.focus();
                        // Place cursor at start of first block (pos 1 = inside first block node)
                        const sel = view.state.selection.constructor.create(view.state.doc, 1);
                        view.dispatch(view.state.tr.setSelection(sel));
                      }
                    }
                  }}
                  placeholder={t('content.untitled')}
                  className="flex-1 min-w-0 text-[2.5rem] font-bold text-foreground bg-transparent border-none outline-none placeholder:text-muted-foreground/30 leading-tight"
                />
              )}
              {/* Emoji picker dropdown */}
              {showEmojiPicker && !previewRevision && (
                <div className="absolute -left-12 top-full mt-1 z-50 rounded-lg shadow-xl overflow-hidden">
                  <EmojiPicker
                    onSelect={(em) => handleEmojiSelect(em)}
                    onRemove={emoji ? () => handleEmojiSelect(null) : undefined}
                    onUploadImage={async (file) => {
                      const result = await docApi.uploadFile(file, doc.id);
                      return result.url;
                    }}
                  />
                </div>
              )}
            </div>
            <div className="mb-8" />
          </div>
          </div>

          {/* Search bar — sticky at top of scroll container */}
          {!previewRevision && showSearch && (
            <div className="sticky top-0 z-30 flex justify-end pr-4">
              <SearchBar
                getView={() => {
                  const mount = document.querySelector('.outline-editor-mount') as any;
                  return mount?.__pmView || null;
                }}
                showReplace={searchWithReplace}
                onClose={() => setShowSearch(false)}
              />
            </div>
          )}

          {/* Editor / Revision preview area */}
          <div className="relative flex-1 min-h-0">
            {previewRevision ? (
              <RevisionPreview
                key={previewRevision.id + (highlightChanges ? '-diff' : '')}
                data={previewRevision.data}
                prevData={prevRevision?.data}
                highlightChanges={highlightChanges}
              />
            ) : (
              <Editor
                key={`${doc.id}-${editorKey}`}
                defaultValue={doc.text}
                onChange={handleTextChange}
                placeholder={t('content.editorPlaceholder')}
                documentId={doc.id}
                onSearchOpen={(withReplace) => { setShowSearch(true); setSearchWithReplace(withReplace); }}
                commentQuotes={commentHighlightQuotes}
              />
            )}
          </div>
        </div>

        {showComments && !showHistory && (
          <div className="w-80 border-l border-border bg-card flex flex-col shrink-0 overflow-hidden">
            <Comments
              queryKey={['doc-comments', doc.id]}
              fetchComments={fetchDocComments}
              postComment={(text, parentId) => gw.commentOnDoc(doc.id, text, parentId)}
              editComment={async (commentId, text) => {
                await docApi.updateComment(commentId, docApi.textToProseMirror(text));
              }}
              deleteComment={async (commentId) => {
                await docApi.deleteComment(commentId);
              }}
              resolveComment={async (commentId) => {
                await docApi.resolveComment(commentId);
              }}
              unresolveComment={async (commentId) => {
                await docApi.unresolveComment(commentId);
              }}
              uploadImage={async (file) => {
                const result = await docApi.uploadFile(file, doc.id);
                return result.url;
              }}
              initialQuote={commentQuote}
              onQuoteConsumed={() => setCommentQuote('')}
              topOffset={commentTopOffset}
            />
          </div>
        )}

      </div>
    </div>

    {/* History sidebar — full height, independent from top bar */}
    {showHistory && (
      <div className="w-72 border-l border-border bg-card flex flex-col shrink-0 overflow-hidden">
        <RevisionHistory
          doc={doc as any}
          onClose={() => { setShowHistory(false); setPreviewRevision(null); setPrevRevision(null); }}
          onRestored={async () => {
            await queryClient.invalidateQueries({ queryKey: ['document', doc.id] });
            await queryClient.invalidateQueries({ queryKey: ['content-items'] });
            const restored = await queryClient.fetchQuery({ queryKey: ['document', doc.id], queryFn: () => docApi.getDocument(doc.id) });
            setTitle(restored.title);
            setText(restored.text);
            latestTitleRef.current = restored.title;
            latestTextRef.current = restored.text;
            latestEmojiRef.current = (restored.icon || null) as string | null;
            setEditorKey(k => k + 1);
            onSaved();
          }}
          onSelect={(rev, prev) => { setPreviewRevision(rev as any); setPrevRevision(prev as any); }}
          highlightChanges={highlightChanges}
          onHighlightChangesToggle={() => setHighlightChanges(v => !v)}
        />
      </div>
    )}
    </div>
  );
}

// ═══════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════

function DocMenuBtn({ icon: Icon, label, onClick, danger }: {
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

function DocMenuToggle({ icon: Icon, label, checked, onChange }: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-foreground hover:bg-accent transition-colors"
    >
      <Icon className="h-4 w-4 shrink-0" />
      <span className="flex-1 text-left">{label}</span>
      <span className={cn(
        'relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full transition-colors',
        checked ? 'bg-primary' : 'bg-muted'
      )}>
        <span className={cn(
          'pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform mt-0.5 ml-0.5',
          checked ? 'translate-x-4' : 'translate-x-0'
        )} />
      </span>
    </button>
  );
}

// formatDate and formatRelativeTime are now imported from @/lib/utils/time
