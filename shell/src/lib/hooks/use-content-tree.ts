'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as docApi from '@/lib/api/documents';
import * as gw from '@/lib/api/gateway';
import { useT } from '@/lib/i18n';
import { showError } from '@/lib/utils/error';
import { getPublicOrigin } from '@/lib/remote-access';
import {
  DragOverEvent,
  DragMoveEvent,
  DragStartEvent,
  DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { arrayMove } from '@dnd-kit/sortable';

// ═══════════════════════════════════════════════════
// Types
// ═════════════════════════════════════════════��═════

/** Unified content item (doc or table) */
export type ContentNode = {
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

export type Selection = { type: 'doc'; id: string } | { type: 'table'; id: string } | { type: 'presentation'; id: string } | { type: 'diagram'; id: string } | null;

/** Tree ordering stored in localStorage */
export interface TreeState {
  /** parentId → ordered child IDs */
  children: Record<string, string[]>;
  /** nodeId → parentId */
  parents: Record<string, string>;
}

/** Where to drop: before/after = reorder, inside = reparent */
export type DropIntent = { overId: string; position: 'before' | 'after' | 'inside' } | null;

// ══════════════════════════════════════════════════���
// localStorage / Gateway persistence
// ═══════════════════════════════════════════════════

const TREE_STATE_KEY = 'aose-content-tree';
const EXPANDED_STATE_KEY = 'aose-content-expanded';

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
export function selectionFromURL(): Selection | null {
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
export function syncSelectionToURL(sel: Selection | null, replace = false) {
  const url = new URL(window.location.href);
  if (sel) {
    url.searchParams.set('id', `${sel.type}:${sel.id}`);
  } else {
    url.searchParams.delete('id');
  }
  const newUrl = url.toString();
  if (replace || newUrl === window.location.href) {
    window.history.replaceState(null, '', newUrl);
  } else {
    window.history.pushState(null, '', newUrl);
  }
}

/** Build a shareable link for a content item */
export function buildContentLink(sel: NonNullable<Selection>): string {
  const origin = getPublicOrigin();
  const url = new URL('/content', origin);
  url.searchParams.set('id', `${sel.type}:${sel.id}`);
  return url.toString();
}

// ═══════════════════════════════════════════════════
// Hook: useContentTree
// ═══════════════════════════════��═══════════════════

export interface UseContentTreeReturn {
  // Data
  contentItems: gw.ContentItem[] | undefined;
  contentLoading: boolean;
  customIcons: Record<string, string> | undefined;
  deletedItems: gw.ContentItem[] | undefined;
  deletedLoading: boolean;
  searchResults: docApi.SearchResult[] | undefined;
  selectedDoc: docApi.Document | undefined;
  effectiveNodes: Map<string, ContentNode>;
  childrenMap: Map<string, string[]>;
  rootIds: string[];
  pinnedIds: string[];
  unpinnedIds: string[];
  nodeMap: Map<string, ContentNode>;

  // Selection
  selection: Selection;
  setSelection: (sel: Selection) => void;
  selectedDocId: string | null;
  selectedTableId: string | null;
  selectedPresentationId: string | null;
  selectedDiagramId: string | null;

  // Mobile
  mobileView: 'list' | 'detail';
  setMobileView: (v: 'list' | 'detail') => void;

  // Search
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  displaySearchItems: ContentNode[] | null;

  // Tree state
  treeState: TreeState;
  expandedIds: Set<string>;
  toggleExpand: (id: string) => void;

  // Sidebar
  sidebarView: 'library' | 'trash';
  setSidebarView: (v: 'library' | 'trash') => void;
  sidebarCollapsed: boolean;
  toggleSidebarCollapse: () => void;
  pinnedCollapsed: boolean;
  setPinnedCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
  libraryCollapsed: boolean;
  setLibraryCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
  docListVisible: boolean;
  setDocListVisible: React.Dispatch<React.SetStateAction<boolean>>;

  // CRUD
  creating: boolean;
  handleCreateDoc: (parentNodeId?: string) => Promise<void>;
  handleCreateTable: (parentNodeId?: string) => Promise<void>;
  handleCreatePresentation: (parentNodeId?: string) => Promise<void>;
  handleCreateDiagram: (parentNodeId?: string) => Promise<void>;
  requestDelete: (nodeId: string) => void;
  executeDelete: (nodeId: string, mode: 'only' | 'all') => Promise<void>;
  deleteDialog: { nodeId: string; hasChildren: boolean } | null;
  setDeleteDialog: React.Dispatch<React.SetStateAction<{ nodeId: string; hasChildren: boolean } | null>>;
  handleTogglePin: (nodeId: string) => Promise<void>;

  // Navigation
  handleSelect: (nodeId: string) => void;
  handleMobileBack: () => void;
  navigateToBreadcrumb: (rawId: string) => void;
  getBreadcrumb: (typePrefix: string, rawId: string) => { id: string; title: string }[];
  selectNearbyDoc: (deletedNodeId: string) => void;

  // DnD
  sensors: ReturnType<typeof useSensors>;
  dragActiveId: string | null;
  dragActiveNode: ContentNode | null;
  dropIntent: DropIntent;
  handleDragStart: (event: DragStartEvent) => void;
  updateDropIntent: (event: DragOverEvent | DragMoveEvent) => void;
  handleDragEnd: (event: DragEndEvent) => void;

  // Refresh
  refreshDocs: () => void;
  refreshTables: () => void;

  // Hydrated
  hydrated: boolean;

  // Query client (for sub-components that need it)
  queryClient: ReturnType<typeof useQueryClient>;
}

export function useContentTree(isMobilePage: boolean): UseContentTreeReturn {
  const { t } = useT();
  const queryClient = useQueryClient();

  const [selection, setSelectionRaw] = useState<Selection>(null);
  const [mobileView, setMobileView] = useState<'list' | 'detail'>('list');
  const [searchQuery, setSearchQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [treeState, setTreeState] = useState<TreeState>({ children: {}, parents: {} });
  const [dragActiveId, setDragActiveId] = useState<string | null>(null);
  const [dropIntent, setDropIntent] = useState<DropIntent>(null);
  const [sidebarView, setSidebarView] = useState<'library' | 'trash'>('library');
  const [pinnedCollapsed, setPinnedCollapsed] = useState(false);
  const [libraryCollapsed, setLibraryCollapsed] = useState(false);
  const [deleteDialog, setDeleteDialog] = useState<{ nodeId: string; hasChildren: boolean } | null>(null);
  const [docListVisible, setDocListVisible] = useState(true);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  // Wrapper to also persist selection
  const setSelection = useCallback((sel: Selection) => {
    setSelectionRaw(sel);
  }, []);

  // Hydrate client-only state after mount (avoid SSR mismatch)
  useEffect(() => {
    const fromURL = selectionFromURL();
    if (fromURL) {
      setSelectionRaw(fromURL);
      setMobileView('detail');
    } else {
      try {
        const saved = sessionStorage.getItem('aose-content-selection');
        if (saved) { setSelectionRaw(JSON.parse(saved)); setMobileView('detail'); }
      } catch { /* ignore */ }
    }
    setExpandedIds(new Set(loadExpandedState()));
    setTreeState(loadTreeState());
    const savedCollapsed = localStorage.getItem('aose-sidebar-collapsed');
    if (savedCollapsed === 'true') setSidebarCollapsed(true);
    setHydrated(true);

    // Listen for popstate events (SPA navigation from ContentLink clicks)
    const handlePopState = () => {
      const sel = selectionFromURL();
      if (sel) {
        setSelectionRaw(sel);
        setMobileView('detail');
      }
    };
    window.addEventListener('popstate', handlePopState);

    // Listen for ⌘+\ toggle-sidebar from KeyboardManager
    const handleToggleSidebar = () => {
      setSidebarCollapsed(prev => {
        const next = !prev;
        localStorage.setItem('aose-sidebar-collapsed', String(next));
        return next;
      });
    };
    window.addEventListener('toggle-sidebar', handleToggleSidebar);

    return () => {
      window.removeEventListener('popstate', handlePopState);
      window.removeEventListener('toggle-sidebar', handleToggleSidebar);
    };
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
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  // Build unified node map directly from contentItems (Gateway is source of truth)
  const nodeMap = useMemo(() => {
    const map = new Map<string, ContentNode>();
    for (const item of (contentItems || [])) {
      map.set(item.id, {
        id: item.id,
        rawId: item.raw_id,
        type: item.type as 'doc' | 'table' | 'presentation' | 'diagram',
        title: item.title || (item.type === 'doc' ? t('content.untitled') : item.type === 'table' ? t('content.untitledTable') : item.type === 'diagram' ? t('content.untitledDiagram') : t('content.untitledPresentation')),
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
    for (const [nodeId, parentId] of Object.entries(treeState.parents)) {
      const node = nodes.get(nodeId);
      if (!node) continue;
      if (parentId === '__root__') {
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

    effectiveNodes.forEach((node) => {
      if (node.parentId && allIds.has(node.parentId)) {
        hasParent.add(node.id);
        const children = cMap.get(node.parentId) || [];
        children.push(node.id);
        cMap.set(node.parentId, children);
      }
    });

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

    const roots: string[] = [];
    effectiveNodes.forEach((node) => {
      if (!hasParent.has(node.id)) roots.push(node.id);
    });

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

    const pinned: string[] = [];
    const unpinned: string[] = [];
    for (const id of roots) {
      unpinned.push(id); // always add to library
      if (effectiveNodes.get(id)?.pinned) pinned.push(id); // also add to pinned section if pinned
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
  const selectNearbyDoc = useCallback((deletedNodeId: string) => {
    const deletedNode = effectiveNodes.get(deletedNodeId);
    const siblings = deletedNode?.parentId
      ? childrenMap.get(deletedNode.parentId) || []
      : rootIds;
    const idx = siblings.indexOf(deletedNodeId);

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
        setSelectionRaw(sel);
        sessionStorage.setItem('aose-content-selection', JSON.stringify(sel));
        syncSelectionToURL(sel);
        return;
      }
    }
    setSelectionRaw(null);
    syncSelectionToURL(null);
    setMobileView('list');
  }, [effectiveNodes, childrenMap, rootIds]);

  // Mobile back: clear selection + URL + sessionStorage + switch to list view
  const handleMobileBack = useCallback(() => {
    setSelectionRaw(null);
    syncSelectionToURL(null);
    try { sessionStorage.removeItem('aose-content-selection'); } catch {}
    setMobileView('list');
  }, []);

  // Request deletion of a node
  const requestDelete = useCallback((nodeId: string) => {
    const node = effectiveNodes.get(nodeId);
    if (!node) return;
    const children = childrenMap.get(nodeId) || [];
    if (node.type === 'doc' && children.length > 0) {
      setDeleteDialog({ nodeId, hasChildren: true });
    } else {
      if (!confirm(t('content.deleteConfirm'))) return;
      executeDeleteFn(nodeId, 'only');
    }
  }, [effectiveNodes, childrenMap, t]);

  // Execute deletion
  const executeDeleteFn = useCallback(async (nodeId: string, mode: 'only' | 'all') => {
    const node = effectiveNodes.get(nodeId);
    if (!node) return;
    const isSelected = selection?.type === node.type && selection?.id === node.rawId;
    if (isSelected) selectNearbyDoc(nodeId);

    try {
      await gw.deleteContentItem(nodeId, mode);
      await queryClient.invalidateQueries({ queryKey: ['content-items'] });
    } catch (err) {
      showError(t('errors.deleteFailed'), err);
    }
    setDeleteDialog(null);
  }, [effectiveNodes, selection, selectNearbyDoc, queryClient]);

  const handleSelect = useCallback((nodeId: string) => {
    const node = effectiveNodes.get(nodeId);
    if (!node) return;
    const sel = { type: node.type, id: node.rawId };
    setSelectionRaw(sel);
    sessionStorage.setItem('aose-content-selection', JSON.stringify(sel));
    syncSelectionToURL(sel);
    setMobileView('detail');
    const children = childrenMap.get(nodeId);
    if (children && children.length > 0) {
      setExpandedIds(prev => {
        if (prev.has(nodeId)) return prev;
        const next = new Set(prev);
        next.add(nodeId);
        return next;
      });
    }
  }, [effectiveNodes, childrenMap]);

  // Navigate to a breadcrumb item by rawId
  const navigateToBreadcrumb = useCallback((rawId: string) => {
    for (const prefix of ['doc', 'table', 'presentation', 'diagram']) {
      const nodeId = `${prefix}:${rawId}`;
      const node = effectiveNodes.get(nodeId);
      if (node) {
        const sel = { type: node.type, id: node.rawId };
        setSelectionRaw(sel);
        syncSelectionToURL(sel);
        setMobileView('detail');
        return;
      }
    }
  }, [effectiveNodes]);

  // Auto-expand selected item and all its ancestors on load
  useEffect(() => {
    if (!selection) return;
    const nodeId = selection.type === 'doc' ? `doc:${selection.id}` : `table:${selection.id}`;
    const toExpand: string[] = [];

    const children = childrenMap.get(nodeId);
    if (children && children.length > 0) {
      toExpand.push(nodeId);
    }

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

    setTimeout(() => {
      const el = document.querySelector(`[data-tree-id="${CSS.escape(nodeId)}"]`);
      if (el) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }, 100);
  }, [selection, childrenMap, effectiveNodes]);

  // Auto-select first item if nothing is selected — desktop only
  useEffect(() => {
    if (!hydrated || selection || rootIds.length === 0 || isMobilePage) return;
    const firstId = rootIds[0];
    const firstNode = effectiveNodes.get(firstId);
    if (firstNode) {
      const sel = { type: firstNode.type, id: firstNode.rawId } as Selection;
      setSelectionRaw(sel);
      sessionStorage.setItem('aose-content-selection', JSON.stringify(sel));
      syncSelectionToURL(sel, true);
    }
  }, [hydrated, rootIds, selection, effectiveNodes, isMobilePage]);

  const refreshDocs = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['content-items'] });
  }, [queryClient]);

  const refreshTables = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['content-items'] });
  }, [queryClient]);

  const handleTogglePin = useCallback(async (nodeId: string) => {
    const node = effectiveNodes.get(nodeId);
    if (!node) return;
    try {
      if (node.pinned) {
        await gw.unpinContentItem(nodeId);
      } else {
        await gw.pinContentItem(nodeId);
      }
      queryClient.invalidateQueries({ queryKey: ['content-items'] });
    } catch (e) {
      showError(t('errors.togglePinFailed'), e);
    }
  }, [effectiveNodes, queryClient]);

  const handleCreateDoc = useCallback(async (parentNodeId?: string) => {
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
      setSelectionRaw(sel);
      syncSelectionToURL(sel);
      setMobileView('detail');
    } catch (e) {
      showError(t('errors.createDocFailed'), e);
    } finally {
      setCreating(false);
    }
  }, [creating, queryClient]);

  const handleCreateTable = useCallback(async (parentNodeId?: string) => {
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
      setSelectionRaw(sel);
      syncSelectionToURL(sel);
      setMobileView('detail');
    } catch (e) {
      showError(t('errors.createTableFailed'), e);
    } finally {
      setCreating(false);
    }
  }, [creating, queryClient, t]);

  const handleCreatePresentation = useCallback(async (parentNodeId?: string) => {
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
      setSelectionRaw(sel);
      syncSelectionToURL(sel);
      setMobileView('detail');
    } catch (e) {
      showError(t('errors.createPresentationFailed'), e);
    } finally {
      setCreating(false);
    }
  }, [creating, queryClient]);

  const handleCreateDiagram = useCallback(async (parentNodeId?: string) => {
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
      setSelectionRaw(sel);
      syncSelectionToURL(sel);
      setMobileView('detail');
    } catch (e) {
      showError(t('errors.createDiagramFailed'), e);
    } finally {
      setCreating(false);
    }
  }, [creating, queryClient]);

  const toggleSidebarCollapse = useCallback(() => {
    const next = !sidebarCollapsed;
    setSidebarCollapsed(next);
    localStorage.setItem('aose-sidebar-collapsed', String(next));
  }, [sidebarCollapsed]);

  const getBreadcrumb = useCallback((typePrefix: string, rawId: string): { id: string; title: string }[] => {
    const path: { id: string; title: string }[] = [];
    let nodeId: string | null = `${typePrefix}:${rawId}`;
    while (nodeId) {
      const node = effectiveNodes.get(nodeId);
      if (!node) break;
      path.unshift({ id: node.rawId, title: node.title });
      nodeId = node.parentId;
    }
    return path;
  }, [effectiveNodes]);

  // DnD
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

  const isDescendant = useCallback((nodeId: string, ancestorId: string): boolean => {
    const children = childrenMap.get(ancestorId);
    if (!children) return false;
    for (const childId of children) {
      if (childId === nodeId) return true;
      if (isDescendant(nodeId, childId)) return true;
    }
    return false;
  }, [childrenMap]);

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setDragActiveId(event.active.id as string);
    setDropIntent(null);
  }, []);

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

    let position: 'before' | 'after' | 'inside';
    if (ratio < 0.25) position = 'before';
    else if (ratio > 0.75) position = 'after';
    else position = 'inside';

    setDropIntent({ overId, position });
  }, []);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const intent = dropIntent;
    setDragActiveId(null);
    setDropIntent(null);

    const { active } = event;
    const activeId = active.id as string;

    if (!intent) return;
    const overId = intent.overId;
    if (activeId === overId) return;

    const activeNode = effectiveNodes.get(activeId);
    const overNode = effectiveNodes.get(overId);
    if (!activeNode || !overNode) return;

    const position = intent.position;

    if (position === 'inside') {
      if (isDescendant(overId, activeId)) return;

      const oldParent = activeNode.parentId || '__root__';
      setTreeState(prev => {
        const next = {
          children: { ...prev.children },
          parents: { ...prev.parents },
        };
        if (next.children[oldParent]) {
          next.children[oldParent] = next.children[oldParent].filter(id => id !== activeId);
        }
        next.parents[activeId] = overId;
        const newChildren = [...(next.children[overId] || [])];
        if (!newChildren.includes(activeId)) newChildren.push(activeId);
        next.children[overId] = newChildren;
        saveTreeState(next);
        return next;
      });

      setExpandedIds(prev => new Set(prev).add(overId));
    } else {
      const overParent = overNode.parentId || '__root__';
      const activeParent = activeNode.parentId || '__root__';

      if (activeParent === overParent) {
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
        if (isDescendant(overId, activeId)) return;

        setTreeState(prev => {
          const next = {
            children: { ...prev.children },
            parents: { ...prev.parents },
          };
          if (next.children[activeParent]) {
            next.children[activeParent] = next.children[activeParent].filter(id => id !== activeId);
          }
          if (overParent === '__root__') {
            next.parents[activeId] = '__root__';
          } else {
            next.parents[activeId] = overParent;
          }
          const newSiblings = [...(next.children[overParent] || [])];
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
  }, [dropIntent, effectiveNodes, isDescendant, rootIds, childrenMap]);

  const dragActiveNode = dragActiveId ? effectiveNodes.get(dragActiveId) || null : null;

  return {
    contentItems,
    contentLoading,
    customIcons,
    deletedItems,
    deletedLoading,
    searchResults,
    selectedDoc,
    effectiveNodes,
    childrenMap,
    rootIds,
    pinnedIds,
    unpinnedIds,
    nodeMap,

    selection,
    setSelection,
    selectedDocId,
    selectedTableId,
    selectedPresentationId,
    selectedDiagramId,

    mobileView,
    setMobileView,

    searchQuery,
    setSearchQuery,
    displaySearchItems,

    treeState,
    expandedIds,
    toggleExpand,

    sidebarView,
    setSidebarView,
    sidebarCollapsed,
    toggleSidebarCollapse,
    pinnedCollapsed,
    setPinnedCollapsed,
    libraryCollapsed,
    setLibraryCollapsed,
    docListVisible,
    setDocListVisible,

    creating,
    handleCreateDoc,
    handleCreateTable,
    handleCreatePresentation,
    handleCreateDiagram,
    requestDelete,
    executeDelete: executeDeleteFn,
    deleteDialog,
    setDeleteDialog,
    handleTogglePin,

    handleSelect,
    handleMobileBack,
    navigateToBreadcrumb,
    getBreadcrumb,
    selectNearbyDoc,

    sensors,
    dragActiveId,
    dragActiveNode,
    dropIntent,
    handleDragStart,
    updateDropIntent,
    handleDragEnd,

    refreshDocs,
    refreshTables,

    hydrated,
    queryClient,
  };
}
