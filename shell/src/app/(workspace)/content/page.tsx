'use client';

import React, { useState, useRef, useEffect, useLayoutEffect, useCallback, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as docApi from '@/lib/api/documents';
import type { Document as DocType } from '@/lib/api/documents';
import { FileText, Table2, Plus, Trash2, Search, Clock, MoreHorizontal, ChevronDown, RotateCcw, Presentation, GitBranch, Pencil } from 'lucide-react';
import { CREATE_CONTENT_ITEMS } from '@/actions/create-content.actions';
import { ENTITY_NAMES, CREATABLE_TYPES } from '@/actions/entity-names';
import { SwipeBack } from '@/components/shared/SwipeBack';
import { ContentSidebar } from '@/components/ContentSidebar';
import { EmojiPicker } from '@/components/EmojiPicker';
import { MobileIconPicker } from '@/components/shared/MobileIconPicker';
import { ContentMenuList } from '@/components/shared/ContentMenuList';
import { cn } from '@/lib/utils';
import { showError } from '@/lib/utils/error';
import { formatRelativeTime, formatDate } from '@/lib/utils/time';
import { ScrollArea } from '@/components/ui/scroll-area';
import dynamic from 'next/dynamic';
import { EditorSkeleton, TableSkeleton } from '@/components/shared/Skeleton';
import { MobileNav } from '@/components/shared/MobileNav';
import { NotificationPanel } from '@/components/shared/NotificationPanel';
import { BottomSheet } from '@/components/shared/BottomSheet';
import { useIsMobile } from '@/lib/hooks/use-mobile';
import { useAuth } from '@/lib/auth';
import { useTheme } from 'next-themes';
import { LogOut, Key, Globe, Camera, ChevronRight } from 'lucide-react';
import { ContentDocView, ContentDiagramView } from '@/components/content-views';

const TableEditor = dynamic(
  () => import('@/components/table-editor/TableEditor').then(m => ({ default: m.TableEditor })),
  { ssr: false, loading: () => <TableSkeleton /> }
);

const PresentationEditor = dynamic(
  () => import('@/components/presentation-editor/PresentationEditor').then(m => ({ default: m.PresentationEditor })),
  { ssr: false, loading: () => <EditorSkeleton /> }
);
import * as gw from '@/lib/api/gateway';
import { useT, LOCALE_LABELS, type Locale } from '@/lib/i18n';
import { getAutoPosition } from '@/lib/hooks/use-auto-position';
import { useContextMenu } from '@/lib/hooks/use-context-menu';
import type { ContextMenuItem } from '@/lib/hooks/use-context-menu';
import { contentItemActions, type ContentItemCtx } from '@/actions/content-item.actions';
import { contentItemSurfaces } from '@/surfaces/content-item.surfaces';
import { toContextMenuItems, toContentMenuItems } from '@/surfaces/bridge';
import { AgentPanelContent } from '@/components/shared/AgentPanelContent';
import { buildActionMap } from '@/actions/types';
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

const contentActionMap = buildActionMap(contentItemActions);

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
  unresolvedCommentCount?: number;
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
const SIDEBAR_WIDTH_KEY = 'asuite-sidebar-width';
const DEFAULT_SIDEBAR_WIDTH = 232;
const MIN_SIDEBAR_WIDTH = 200;
const MAX_SIDEBAR_WIDTH = 480;

function clampSidebarWidth(value: number) {
  if (!Number.isFinite(value)) return DEFAULT_SIDEBAR_WIDTH;
  return Math.max(MIN_SIDEBAR_WIDTH, Math.min(MAX_SIDEBAR_WIDTH, value));
}

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
function parseContentId(id: string): Selection | null {
  if (id.startsWith('doc:')) return { type: 'doc', id: id.slice(4) };
  if (id.startsWith('table:')) return { type: 'table', id: id.slice(6) };
  if (id.startsWith('presentation:')) return { type: 'presentation', id: id.slice(13) };
  if (id.startsWith('diagram:')) return { type: 'diagram', id: id.slice(8) };
  return null;
}

function selectionFromURL(): Selection | null {
  try {
    const params = new URLSearchParams(window.location.search);
    const id = params.get('id');
    if (!id) return null;
    return parseContentId(id);
  } catch { /* SSR or invalid */ }
  return null;
}

/** Update the browser URL to reflect the current selection (no page reload) */
function syncSelectionToURL(sel: Selection | null, replace = false) {
  const url = new URL(window.location.href);
  if (sel) {
    url.searchParams.set('id', `${sel.type}:${sel.id}`);
  } else {
    url.searchParams.delete('id');
  }
  // Clear comment-related params when navigating to a different file
  url.searchParams.delete('comment_id');
  url.searchParams.delete('anchor_type');
  url.searchParams.delete('anchor_id');
  const newUrl = url.toString();
  if (replace || newUrl === window.location.href) {
    window.history.replaceState(null, '', newUrl);
  } else {
    window.history.pushState(null, '', newUrl);
  }
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
  const { t, locale, setLocale } = useT();
  const { actor, logout, refreshActor } = useAuth();
  const { setTheme, theme } = useTheme();
  const isMobilePage = useIsMobile();
  const [selection, setSelection] = useState<Selection>(null);
  const [mobileView, setMobileView] = useState<'list' | 'detail'>('list');
  const [showNewMenu, setShowNewMenu] = useState(false);
  const [showMobileFabMenu, setShowMobileFabMenu] = useState(false);
  const [showMobileProfile, setShowMobileProfile] = useState(false);
  const [showMobileAgents, setShowMobileAgents] = useState(false);
  const [mobileEditingName, setMobileEditingName] = useState(false);
  const [mobileEditNameValue, setMobileEditNameValue] = useState('');
  const [mobileSavingProfile, setMobileSavingProfile] = useState(false);
  const [mobileShowLang, setMobileShowLang] = useState(false);
  const mobileAvatarInputRef = useRef<HTMLInputElement>(null);
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
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH);
  const [hydrated, setHydrated] = useState(false);
  const [showMobileNotifications, setShowMobileNotifications] = useState(false);
  const [focusCommentId, setFocusCommentId] = useState<string | undefined>(undefined);
  const [showComments, setShowComments] = useState(false);
  useEffect(() => { if (focusCommentId) setShowComments(true); }, [focusCommentId]);
  const onShowComments = useCallback(() => setShowComments(true), []);
  const onCloseComments = useCallback(() => setShowComments(false), []);
  const onToggleComments = useCallback(() => setShowComments(v => !v), []);
  const queryClient = useQueryClient();

  const handleSidebarWidthChange = useCallback((width: number) => {
    const next = clampSidebarWidth(width);
    setSidebarWidth(next);
    localStorage.setItem(SIDEBAR_WIDTH_KEY, String(next));
  }, []);

  // Unread notification count for MobileNav badge
  const { data: mobileUnreadCount = 0 } = useQuery({
    queryKey: ['notifications-unread-count'],
    queryFn: gw.getUnreadCount,
    refetchInterval: 30_000,
  });

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
    // Read comment_id and anchor params from URL for direct link / new tab opens
    try {
      const urlParams = new URLSearchParams(window.location.search);
      const cid = urlParams.get('comment_id');
      if (cid) setFocusCommentId(cid);
    } catch { /* ignore */ }

    setExpandedIds(new Set(loadExpandedState()));
    setTreeState(loadTreeState());
    const savedCollapsed = localStorage.getItem('asuite-sidebar-collapsed');
    if (savedCollapsed === 'true') setSidebarCollapsed(true);
    const savedSidebarWidth = localStorage.getItem(SIDEBAR_WIDTH_KEY);
    if (savedSidebarWidth !== null) {
      setSidebarWidth(clampSidebarWidth(Number(savedSidebarWidth)));
    }
    setHydrated(true);

    // Listen for popstate events (SPA navigation from ContentLink clicks)
    const handlePopState = () => {
      const sel = selectionFromURL();
      if (sel) {
        setSelection(sel);
        setMobileView('detail');
      }
    };
    window.addEventListener('popstate', handlePopState);

    // Listen for ⌘+\ toggle-sidebar from KeyboardManager
    const handleToggleSidebar = () => {
      setSidebarCollapsed(prev => {
        const next = !prev;
        localStorage.setItem('asuite-sidebar-collapsed', String(next));
        return next;
      });
    };
    window.addEventListener('toggle-sidebar', handleToggleSidebar);

    return () => {
      window.removeEventListener('popstate', handlePopState);
      window.removeEventListener('toggle-sidebar', handleToggleSidebar);
    };
  }, []);

  // Listen for focus-comment events from notification panel (same document, no reload)
  useEffect(() => {
    const handler = (e: Event) => {
      const { commentId } = (e as CustomEvent).detail;
      if (commentId) setFocusCommentId(commentId);
    };
    window.addEventListener('focus-comment', handler);
    return () => window.removeEventListener('focus-comment', handler);
  }, []);

  // Listen for notification-navigate events (in-app navigation from notification panel)
  useEffect(() => {
    const handler = (e: Event) => {
      const { targetId, commentId } = (e as CustomEvent).detail;
      if (targetId) {
        const sel = parseContentId(targetId);
        if (sel) {
          setSelection(sel);
          syncSelectionToURL(sel);
          setMobileView('detail');
        }
      }
      // Reset comment state, then set new focusCommentId if present
      setFocusCommentId(undefined);
      setShowComments(false);
      if (commentId) {
        // Use setTimeout to ensure state is cleared first, then set new focus
        setTimeout(() => setFocusCommentId(commentId), 0);
      }
    };
    window.addEventListener('notification-navigate', handler);
    return () => window.removeEventListener('notification-navigate', handler);
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
        title: item.title || (item.type === 'doc' ? t('content.untitled') : item.type === 'table' ? t('content.untitledTable') : item.type === 'diagram' ? t('content.untitledDiagram') : t('content.untitledPresentation')),
        emoji: item.icon || undefined,
        createdAt: new Date(item.created_at || 0).getTime(),
        updatedAt: item.updated_at || undefined,
        parentId: item.parent_id,
        pinned: !!item.pinned,
        unresolvedCommentCount: item.unresolved_comment_count || 0,
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

    // Pinned section: all pinned items across the entire tree (not just roots)
    // Library section: all root items (unpinned roots only, to avoid duplication)
    const pinned: string[] = [];
    const unpinned: string[] = [];
    effectiveNodes.forEach((node) => {
      if (node.pinned) pinned.push(node.id);
    });
    for (const id of roots) {
      if (!effectiveNodes.get(id)?.pinned) unpinned.push(id);
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

  // Mobile back: clear selection + URL + sessionStorage + switch to list view
  const handleMobileBack = useCallback(() => {
    window.dispatchEvent(new CustomEvent('flush-doc-save'));
    setSelection(null);
    syncSelectionToURL(null);
    try { sessionStorage.removeItem('asuite-content-selection'); } catch {}
    setMobileView('list');
  }, []);

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
      showError(t('errors.deleteFailed'), err);
    }
    setDeleteDialog(null);
  };

  const handleSelect = (nodeId: string) => {
    window.dispatchEvent(new CustomEvent('flush-doc-save'));
    const node = effectiveNodes.get(nodeId);
    if (!node) return;
    const sel = { type: node.type, id: node.rawId };
    setSelection(sel);
    sessionStorage.setItem('asuite-content-selection', JSON.stringify(sel));
    syncSelectionToURL(sel);
    setMobileView('detail');
    // Clear comment state when switching files
    setShowComments(false);
    setFocusCommentId(undefined);
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

  // Navigate to a breadcrumb item by rawId — resolves type from the content tree
  const navigateToBreadcrumb = (rawId: string) => {
    // Try all possible node types
    for (const prefix of ['doc', 'table', 'presentation', 'diagram']) {
      const nodeId = `${prefix}:${rawId}`;
      const node = effectiveNodes.get(nodeId);
      if (node) {
        const sel = { type: node.type, id: node.rawId };
        setSelection(sel);
        syncSelectionToURL(sel);
        setMobileView('detail');
        return;
      }
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

  // Auto-select first item if nothing is selected — desktop only
  // On mobile, null selection = show list view (no auto-select)
  useEffect(() => {
    if (!hydrated || selection || rootIds.length === 0 || isMobilePage) return;
    const firstId = rootIds[0];
    const firstNode = effectiveNodes.get(firstId);
    if (firstNode) {
      const sel = { type: firstNode.type, id: firstNode.rawId } as Selection;
      setSelection(sel);
      sessionStorage.setItem('asuite-content-selection', JSON.stringify(sel));
      syncSelectionToURL(sel, true);
    }
  }, [hydrated, rootIds, selection, effectiveNodes, isMobilePage]);

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
    const newPinned = !node.pinned;
    // Optimistic update — queryData is ContentItem[] (listContentItems returns array directly)
    queryClient.setQueryData(['content-items'], (old: gw.ContentItem[] | undefined) => {
      if (!old) return old;
      return old.map(item =>
        item.id === nodeId ? { ...item, pinned: newPinned ? 1 : 0 } : item
      );
    });
    try {
      if (newPinned) {
        await gw.pinContentItem(nodeId);
      } else {
        await gw.unpinContentItem(nodeId);
      }
      queryClient.invalidateQueries({ queryKey: ['content-items'] });
    } catch (e) {
      console.error('[pin] toggle failed:', e);
      // Revert optimistic update on error
      queryClient.invalidateQueries({ queryKey: ['content-items'] });
      showError(t('errors.togglePinFailed'), e);
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
      showError(t('errors.createDocFailed'), e);
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
      showError(t('errors.createTableFailed'), e);
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
      showError(t('errors.createPresentationFailed'), e);
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
      showError(t('errors.createDiagramFailed'), e);
    } finally {
      setCreating(false);
    }
  };

  const handleCreateByType = (type: CreatableType, parentNodeId?: string) => {
    if (type === 'doc') return handleCreateDoc(parentNodeId);
    if (type === 'table') return handleCreateTable(parentNodeId);
    if (type === 'presentation') return handleCreatePresentation(parentNodeId);
    return handleCreateDiagram(parentNodeId);
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
    <div className="flex h-full overflow-hidden flex-col md:flex-row relative bg-sidebar">
      {/* Unified sidebar (desktop only) — includes logo, search, tree, settings */}
      <ContentSidebar
        collapsed={sidebarCollapsed}
        onToggleCollapse={toggleSidebarCollapse}
        width={sidebarWidth}
        onWidthChange={handleSidebarWidthChange}
        visible={docListVisible && mobileView === 'list' || docListVisible}
        sidebarView={sidebarView}
        onSidebarViewChange={setSidebarView}
        showNewMenu={showNewMenu}
        onShowNewMenuChange={setShowNewMenu}
        creating={creating}
        onCreateByType={(type) => handleCreateByType(type)}
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
                    <button
                      onClick={() => setPinnedCollapsed(v => !v)}
                      className="group/section flex items-center gap-1 w-full pl-2 pr-2 pt-3 pb-1 text-xs font-medium text-black/50 dark:text-white/50 hover:text-black/70 dark:hover:text-white/70 transition-colors"
                    >
                      {t('content.pinned')}
                      <ChevronDown className={cn('h-3 w-3 text-black/20 dark:text-white/20 opacity-0 group-hover/section:opacity-100 transition-all', pinnedCollapsed && '-rotate-90')} />
                    </button>
                    {!pinnedCollapsed && pinnedIds.map(nodeId => (
                      <TreeNodeRecursive
                        key={nodeId}
                        nodeId={nodeId}
                        nodes={effectiveNodes}
                        childrenMap={childrenMap}
                        selection={selection}
                        expandedIds={expandedIds}
                        onSelect={handleSelect}
                        onToggle={toggleExpand}
                        onCreateByType={handleCreateByType}
                        onRequestDelete={requestDelete}
                        onTogglePin={handleTogglePin}
                        depth={0}
                        creating={creating}
                        dropIntent={dropIntent}
                        dragActiveId={dragActiveId}
                      />
                    ))}
                  </>
                )}
                {/* Library section - always visible */}
                <button
                  onClick={() => setLibraryCollapsed(v => !v)}
                  className="group/section flex items-center gap-1 w-full pl-2 pr-2 pt-3 pb-1 text-xs font-medium text-black/50 dark:text-white/50 hover:text-black/70 dark:hover:text-white/70 transition-colors"
                >
                  {t('content.library')}
                  <ChevronDown className={cn('h-3 w-3 text-black/20 dark:text-white/20 opacity-0 group-hover/section:opacity-100 transition-all', libraryCollapsed && '-rotate-90')} />
                </button>
                {!libraryCollapsed && unpinnedIds.map(nodeId => (
                  <TreeNodeRecursive
                    key={nodeId}
                    nodeId={nodeId}
                    nodes={effectiveNodes}
                    childrenMap={childrenMap}
                    selection={selection}
                    expandedIds={expandedIds}
                    onSelect={handleSelect}
                    onToggle={toggleExpand}
                    onCreateByType={handleCreateByType}
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
                    {t('content.trashEmpty')}
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
                    } catch (err) { showError(t('errors.restoreFailed'), err); }
                  }}
                  onPermanentDelete={async () => {
                    const msg = t('content.permanentDeleteConfirm');
                    if (!confirm(msg)) return;
                    try {
                      await gw.permanentlyDeleteContentItem(entry.nodeId);
                      queryClient.invalidateQueries({ queryKey: ['content-items-deleted'] });
                    } catch (err) { showError(t('errors.permanentDeleteFailed'), err); }
                  }}
                />
              ));
            })()}
          </>
        )}
      </ContentSidebar>

      {/* Mobile sidebar (only visible on mobile when in list view) */}
      {mobileView === 'list' && (
        <div className="md:hidden w-full bg-white dark:bg-sidebar flex flex-col min-h-0 overflow-hidden">
          <MobileNav
            userName={actor?.display_name || actor?.username || ''}
            avatarUrl={actor?.avatar_url}
            unreadCount={mobileUnreadCount}
            onSearch={() => window.dispatchEvent(new Event('open-command-palette'))}
            onNotifications={() => setShowMobileNotifications(true)}
            onProfile={() => setShowMobileProfile(true)}
            onAgents={() => setShowMobileAgents(true)}
          />
          {/* Section header removed — Figma shows Pinned/Library inline with tree items */}
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
                      <button onClick={() => setPinnedCollapsed(v => !v)} className="px-2 pt-3 pb-1 flex items-center gap-1.5 text-base md:text-sm font-medium text-black/50 dark:text-white/50 active:opacity-60">
                        {t('content.pinned')} <ChevronDown className={cn('h-4 w-4 md:h-3.5 md:w-3.5 transition-transform', pinnedCollapsed && '-rotate-90')} />
                      </button>
                      {!pinnedCollapsed && pinnedIds.map(nodeId => (
                        <TreeNodeRecursive key={nodeId} nodeId={nodeId} nodes={effectiveNodes} childrenMap={childrenMap} selection={selection} expandedIds={expandedIds} onSelect={handleSelect} onToggle={toggleExpand} onCreateDoc={handleCreateDoc} onCreateTable={handleCreateTable} onCreatePresentation={handleCreatePresentation} onCreateDiagram={handleCreateDiagram} onRequestDelete={requestDelete} onTogglePin={handleTogglePin} depth={0} creating={creating} dropIntent={dropIntent} dragActiveId={dragActiveId} />
                      ))}
                      <div className="hidden md:block border-t border-border/50 my-1.5 mx-2" />
                    </>
                  )}
                  <button onClick={() => setLibraryCollapsed(v => !v)} className="px-2 pt-1 pb-1 flex items-center gap-1.5 text-base md:text-sm font-medium text-black/50 dark:text-white/50 active:opacity-60">
                    {t('content.library')} <ChevronDown className={cn('h-4 w-4 md:h-3.5 md:w-3.5 transition-transform', libraryCollapsed && '-rotate-90')} />
                  </button>
                  {!libraryCollapsed && unpinnedIds.map(nodeId => (
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
          {/* @suite watermark — Figma: bottom-left logo image */}
          <div className="px-6 py-4 mt-auto">
            <img src="/icons/asuite-watermark.png" alt="@suite" className="h-6 opacity-30 dark:invert dark:opacity-20 select-none pointer-events-none" draggable={false} />
          </div>
        </div>
      )}

      {/* Mobile FAB for creating new content — Figma: 64x64 green circle */}
      {mobileView === 'list' && (
        <div className="md:hidden">
          {/* FAB button — Figma: white 64x64 circle with shadow */}
          <button
            onClick={() => setShowMobileFabMenu(v => !v)}
            className={cn(
              'fixed z-50 w-16 h-16 rounded-full bg-white dark:bg-card text-foreground shadow-[0px_8px_20px_0px_rgba(0,0,0,0.1)]',
              'flex items-center justify-center',
              'active:scale-95 transition-transform duration-100',
              showMobileFabMenu && 'rotate-45'
            )}
            style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 24px)', right: '16px' }}
            aria-label={t('common.new')}
          >
            <Plus className="h-6 w-6" />
          </button>
          {/* FAB menu — BottomSheet */}
          <BottomSheet open={showMobileFabMenu} onClose={() => setShowMobileFabMenu(false)} title={t('common.new')}>
            <div className="py-2">
              {CREATE_CONTENT_ITEMS.map((item) => {
                const Icon = item.icon;
                const onClick = () => {
                  setShowMobileFabMenu(false);
                  handleCreateByType(item.type);
                };
                return (
                  <button
                    key={item.type}
                    onClick={onClick}
                    disabled={creating}
                    className="w-full flex items-center gap-3 px-4 py-3 text-base text-foreground active:bg-accent transition-colors disabled:opacity-50"
                  >
                    <Icon className="h-5 w-5 text-muted-foreground" />
                    {item.label(t)}
                  </button>
                );
              })}
            </div>
          </BottomSheet>
        </div>
      )}

      {/* Detail area — content editors render card styling on their own left column */}
      <SwipeBack onBack={handleMobileBack} enabled={mobileView === 'detail'} className={cn(
        'flex-1 flex flex-col min-w-0 min-h-0',
        mobileView === 'list' ? 'hidden md:flex' : 'flex'
      )}>
        {selectedDoc && selection?.type === 'doc' ? (
          <ContentDocView
            key={selectedDoc.id}
            doc={selectedDoc}
            customIcon={customIcons?.[selectedDoc.id]}
            breadcrumb={getBreadcrumb(selectedDoc.id)}
            onBack={handleMobileBack}
            onSaved={refreshDocs}
            onDeleted={() => { requestDelete(`doc:${selectedDoc.id}`); }}
            onNavigate={navigateToBreadcrumb}
            docListVisible={docListVisible}
            onToggleDocList={() => setDocListVisible(v => !v)}
            focusCommentId={focusCommentId}
            showComments={showComments}
            onShowComments={onShowComments}
            onCloseComments={onCloseComments}
            onToggleComments={onToggleComments}
            isPinned={effectiveNodes.get(`doc:${selectedDoc.id}`)?.pinned ?? false}
            onTogglePin={() => handleTogglePin(`doc:${selectedDoc.id}`)}
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
            onBack={handleMobileBack}
            onDeleted={() => {
              setSelection(null); syncSelectionToURL(null); setMobileView('list');
              queryClient.invalidateQueries({ queryKey: ['content-items'] });
            }}
            onCopyLink={() => {
              navigator.clipboard.writeText(buildContentLink({ type: 'table', id: selectedTableId }));
            }}
            docListVisible={docListVisible}
            onToggleDocList={() => setDocListVisible(v => !v)}
            onNavigate={navigateToBreadcrumb}
            focusCommentId={focusCommentId}
            showComments={showComments}
            onShowComments={onShowComments}
            onCloseComments={onCloseComments}
            onToggleComments={onToggleComments}
            isPinned={effectiveNodes.get(`table:${selectedTableId}`)?.pinned ?? false}
            onTogglePin={() => handleTogglePin(`table:${selectedTableId}`)}
          />
        ) : selectedPresentationId ? (
          <PresentationEditor
            key={selectedPresentationId}
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
            onBack={handleMobileBack}
            onDeleted={() => {
              setSelection(null); syncSelectionToURL(null); setMobileView('list');
              queryClient.invalidateQueries({ queryKey: ['content-items'] });
            }}
            onCopyLink={() => {
              navigator.clipboard.writeText(buildContentLink({ type: 'presentation', id: selectedPresentationId }));
            }}
            docListVisible={docListVisible}
            onToggleDocList={() => setDocListVisible(v => !v)}
            onNavigate={navigateToBreadcrumb}
            focusCommentId={focusCommentId}
            showComments={showComments}
            onShowComments={onShowComments}
            onCloseComments={onCloseComments}
            onToggleComments={onToggleComments}
            isPinned={effectiveNodes.get(`presentation:${selectedPresentationId}`)?.pinned ?? false}
            onTogglePin={() => handleTogglePin(`presentation:${selectedPresentationId}`)}
          />
        ) : selectedDiagramId ? (
          <ContentDiagramView
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
            onBack={handleMobileBack}
            onDeleted={() => {
              setSelection(null); syncSelectionToURL(null); setMobileView('list');
              queryClient.invalidateQueries({ queryKey: ['content-items'] });
            }}
            onCopyLink={() => {
              navigator.clipboard.writeText(buildContentLink({ type: 'diagram', id: selectedDiagramId }));
            }}
            docListVisible={docListVisible}
            onToggleDocList={() => setDocListVisible(v => !v)}
            onNavigate={navigateToBreadcrumb}
            focusCommentId={focusCommentId}
            showComments={showComments}
            onShowComments={onShowComments}
            onCloseComments={onCloseComments}
            onToggleComments={onToggleComments}
            isPinned={effectiveNodes.get(`diagram:${selectedDiagramId}`)?.pinned ?? false}
            onTogglePin={() => handleTogglePin(`diagram:${selectedDiagramId}`)}
          />
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground gap-2 bg-card md:rounded-lg md:shadow-[0px_0px_20px_0px_rgba(0,0,0,0.08)] md:overflow-hidden">
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
      </SwipeBack>

      {/* Delete dialog for docs with children */}
      {deleteDialog && (
        <>
          <div className="fixed inset-0 z-50 bg-black/50" onClick={() => setDeleteDialog(null)} />
          <div className="fixed z-50 top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-card border border-border rounded-xl shadow-2xl p-5 w-[340px]">
            <h3 className="text-sm font-medium mb-3">{t('content.deleteDocWithChildren')}</h3>
            <div className="space-y-2">
              <button
                onClick={() => { executeDelete(deleteDialog.nodeId, 'only'); }}
                className="w-full text-left px-3 py-2.5 text-sm rounded-lg border border-border hover:bg-accent transition-colors"
              >
                <div className="font-medium">{t('content.deleteOnly')}</div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {t('content.deleteOnlyDesc')}
                </div>
              </button>
              <button
                onClick={() => { executeDelete(deleteDialog.nodeId, 'all'); }}
                className="w-full text-left px-3 py-2.5 text-sm rounded-lg border border-destructive/30 hover:bg-destructive/5 text-destructive transition-colors"
              >
                <div className="font-medium">{t('content.deleteAll')}</div>
                <div className="text-xs text-destructive/70 mt-0.5">
                  {t('content.deleteAllDesc')}
                </div>
              </button>
            </div>
            <button
              onClick={() => setDeleteDialog(null)}
              className="w-full mt-3 px-3 py-2 text-sm text-muted-foreground hover:text-foreground rounded-lg hover:bg-accent transition-colors"
            >
              {t('common.cancel')}
            </button>
          </div>
        </>
      )}

      {/* Mobile notification panel (triggered from MobileNav) */}
      <NotificationPanel
        open={showMobileNotifications}
        onClose={() => setShowMobileNotifications(false)}
      />

      {/* Mobile profile BottomSheet */}
      <BottomSheet open={showMobileProfile} onClose={() => { setShowMobileProfile(false); setMobileEditingName(false); setMobileShowLang(false); }} title={t('profile.title')}>
        {mobileShowLang ? (
          /* Language sub-view */
          <div className="py-2">
            <button onClick={() => setMobileShowLang(false)} className="flex items-center gap-2 px-4 py-2 text-sm text-muted-foreground active:opacity-60">
              <ChevronDown className="h-4 w-4 rotate-90" />
              Back
            </button>
            {(Object.entries(LOCALE_LABELS) as [Locale, string][]).map(([key, label]) => (
              <button
                key={key}
                onClick={() => { setLocale(key); setMobileShowLang(false); }}
                className={cn(
                  'flex items-center w-full px-4 py-3 text-base',
                  locale === key ? 'text-sidebar-primary font-medium' : 'text-foreground active:bg-accent'
                )}
              >
                {label}
              </button>
            ))}
          </div>
        ) : (
          <div className="py-2">
            {/* Avatar + name + edit */}
            <div className="flex items-center gap-3 px-4 py-3">
              {/* Avatar with upload */}
              <div
                className="w-12 h-12 rounded-full bg-muted overflow-hidden shrink-0 border border-black/10 relative cursor-pointer"
                onClick={() => mobileAvatarInputRef.current?.click()}
              >
                {actor?.avatar_url ? (
                  <img src={actor.avatar_url} alt="" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-lg font-medium text-muted-foreground">
                    {(actor?.display_name || actor?.username || '?')[0].toUpperCase()}
                  </div>
                )}
                <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 active:opacity-100 transition-opacity rounded-full">
                  <Camera className="h-5 w-5 text-white" />
                </div>
              </div>
              <input
                ref={mobileAvatarInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  setMobileSavingProfile(true);
                  try {
                    await gw.uploadUserAvatar(file);
                    await refreshActor();
                  } catch (err) { showError(t('settings.avatarUploadFailed'), err); }
                  setMobileSavingProfile(false);
                  e.target.value = '';
                }}
              />
              {/* Name display or edit */}
              {mobileEditingName ? (
                <input
                  autoFocus
                  value={mobileEditNameValue}
                  onChange={e => setMobileEditNameValue(e.target.value)}
                  onKeyDown={async (e) => {
                    if (e.key === 'Enter' && mobileEditNameValue.trim().length >= 2) {
                      setMobileSavingProfile(true);
                      try {
                        await gw.updateProfile({ name: mobileEditNameValue.trim() });
                        await refreshActor();
                      } catch (err) { showError(t('settings.nameUpdateFailed'), err); }
                      setMobileSavingProfile(false);
                      setMobileEditingName(false);
                    }
                  }}
                  onBlur={() => setMobileEditingName(false)}
                  className="text-base font-medium text-foreground bg-transparent border-b border-sidebar-primary outline-none min-w-0 flex-1"
                  disabled={mobileSavingProfile}
                />
              ) : (
                <span className="text-base font-medium text-foreground truncate flex-1">{actor?.display_name || actor?.username || t('common.user')}</span>
              )}
              <button
                onClick={() => {
                  if (!mobileEditingName) {
                    setMobileEditNameValue(actor?.display_name || actor?.username || '');
                    setMobileEditingName(true);
                  }
                }}
                className="shrink-0 p-1 active:opacity-60"
              >
                <Pencil className="h-4 w-4 opacity-40" />
              </button>
            </div>

            {/* Menu items */}
            <button
              onClick={() => { setShowMobileProfile(false); }}
              className="flex items-center gap-3 w-full px-4 py-3 text-base text-foreground active:bg-accent transition-colors"
            >
              <Key className="h-5 w-5 text-[#939493] dark:text-[#818181]" />
              {t('settings.password')}
            </button>
            <button
              onClick={() => setMobileShowLang(true)}
              className="flex items-center gap-3 w-full px-4 py-3 text-base text-foreground active:bg-accent transition-colors"
            >
              <Globe className="h-5 w-5 text-[#939493] dark:text-[#818181]" />
              {t('settings.language')}
              <ChevronRight className="h-4 w-4 ml-auto opacity-40" />
            </button>
            <button
              onClick={() => { setShowMobileProfile(false); setSidebarView(sidebarView === 'trash' ? 'library' : 'trash'); }}
              className="flex items-center gap-3 w-full px-4 py-3 text-base text-foreground active:bg-accent transition-colors"
            >
              <Trash2 className="h-5 w-5 text-[#939493] dark:text-[#818181]" />
              {t('settings.trash')}
            </button>
            <button
              onClick={() => { setShowMobileProfile(false); logout(); }}
              className="flex items-center gap-3 w-full px-4 py-3 text-base text-foreground active:bg-accent transition-colors"
            >
              <LogOut className="h-5 w-5 text-[#939493] dark:text-[#818181]" />
              {t('settings.logout')}
            </button>

            {/* Theme toggle */}
            <div className="px-4 pt-3 pb-4 flex gap-1">
              {(['light', 'dark', 'system'] as const).map((th) => (
                <button
                  key={th}
                  onClick={() => setTheme(th)}
                  className={cn(
                    'flex items-center justify-center h-9 rounded text-sm font-medium flex-1 border',
                    theme === th
                      ? 'bg-sidebar-primary/10 text-sidebar-primary border-sidebar-primary/20'
                      : 'bg-black/[0.03] dark:bg-white/[0.05] text-foreground border-black/10 dark:border-white/10 active:bg-black/[0.06]'
                  )}
                >
                  {t(`theme.${th}`)}
                </button>
              ))}
            </div>
          </div>
        )}
      </BottomSheet>

      {/* Mobile agents BottomSheet */}
      <BottomSheet open={showMobileAgents} onClose={() => setShowMobileAgents(false)} title={t('toolbar.agents')}>
        <div className="py-2 px-4">
          <AgentPanelContent variant="bottomsheet" />
        </div>
      </BottomSheet>
    </div>
  );
}

// ═══════════════════════════════════════════════════
// Recursive tree node
// ═══════════════════════════════════════════════════

function TreeNodeRecursive({
  nodeId, nodes, childrenMap, selection, expandedIds, onSelect, onToggle,
  onCreateByType, onRequestDelete, onTogglePin, depth, creating, dropIntent, dragActiveId,
}: {
  nodeId: string;
  nodes: Map<string, ContentNode>;
  childrenMap: Map<string, string[]>;
  selection: Selection;
  expandedIds: Set<string>;
  onSelect: (id: string) => void;
  onToggle: (id: string) => void;
  onCreateByType: (type: CreatableType, parentId?: string) => void;
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
          onCreateByType(type, nodeId);
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
              onCreateByType={onCreateByType}
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
  const isMobile = useIsMobile();
  const { attributes, listeners, setNodeRef } = useDraggable({ id: nodeId, disabled: isMobile });
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [showIconPicker, setShowIconPicker] = useState(false);
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const renameInputRef = useRef<HTMLInputElement>(null);
  const addBtnRef = useRef<HTMLButtonElement>(null);
  const addMenuRef = useRef<HTMLDivElement>(null);
  const moreBtnRef = useRef<HTMLButtonElement>(null);
  const moreMenuRef = useRef<HTMLDivElement>(null);
  const iconPickerRef = useRef<HTMLDivElement>(null);

  const buildContentItemCtx = useCallback((): ContentItemCtx => ({
    id: nodeId,
    type: node.type,
    title: node.title,
    pinned: node.pinned ?? false,
    url: `${window.location.origin}/content?id=${node.type}:${node.rawId}`,
    startRename: () => {
      setRenameValue(node.title);
      setIsRenaming(true);
      setTimeout(() => renameInputRef.current?.select(), 30);
    },
    openIconPicker: () => setShowIconPicker(true),
    togglePin: () => onTogglePin(nodeId),
    deleteItem: () => onRequestDelete(nodeId),
    downloadItem: () => {},
    shareItem: () => {},
  }), [node.pinned, node.rawId, node.type, node.title, nodeId, onTogglePin, onRequestDelete]);

  // Right-click context menu
  const getContextMenuItems = useCallback((): ContextMenuItem[] => {
    return toContextMenuItems(contentItemSurfaces.contextMenu, contentActionMap, buildContentItemCtx(), t, isMobile, false);
  }, [buildContentItemCtx, isMobile, t]);

  const { onContextMenu: handleContextMenu, onTouchStart: handleLongPressStart, onTouchEnd: handleLongPressEnd, onTouchMove: handleLongPressMove } = useContextMenu(getContextMenuItems);

  // Close icon picker on outside click (desktop only — mobile uses BottomSheet close)
  useEffect(() => {
    if (!showIconPicker || isMobile) return;
    const handler = (e: MouseEvent) => {
      if (iconPickerRef.current && !iconPickerRef.current.contains(e.target as Node)) {
        setShowIconPicker(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showIconPicker, isMobile]);

  const iconSelectGuardRef = useRef(false);
  const handleIconSelect = async (selectedEmoji: string | null) => {
    setShowIconPicker(false);
    // Guard against click-through: BottomSheet closing can cause touch events to fall through to tree row
    iconSelectGuardRef.current = true;
    setTimeout(() => { iconSelectGuardRef.current = false; }, 300);
    try {
      await gw.updateContentItem(node.id, { icon: selectedEmoji || null });
      queryClient.invalidateQueries({ queryKey: ['content-items'] });
    } catch (e) {
      showError(t('errors.updateIconFailed'), e);
    }
  };

  const handleRenameCommit = async () => {
    const trimmed = renameValue.trim();
    setIsRenaming(false);
    if (!trimmed || trimmed === node.title) return;
    try {
      await gw.updateContentItem(node.id, { title: trimmed });
    } catch (e) {
      showError(t('errors.renameItemFailed'), e);
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
      const pos = getAutoPosition(rect, 172, moreMenuRef.current.offsetHeight, { align: 'left' });
      moreMenuRef.current.style.top = `${pos.top}px`;
      moreMenuRef.current.style.left = `${pos.left}px`;
      if (pos.maxHeight < moreMenuRef.current.offsetHeight) moreMenuRef.current.style.maxHeight = `${pos.maxHeight}px`;
    }
  }, [showMoreMenu]);

  const getMenuPos = (btnRef: React.RefObject<HTMLButtonElement | null>, _menuRef: React.RefObject<HTMLDivElement | null>, menuWidth = 160) => {
    if (!btnRef.current) return { top: 0, left: 0 };
    const rect = btnRef.current.getBoundingClientRect();
    // Initial position — will be corrected by useEffect after mount
    const pos = getAutoPosition(rect, menuWidth, 0, { align: 'left' });
    return { top: pos.top, left: pos.left };
  };

  return (
    <div ref={setNodeRef} className="relative" data-tree-id={nodeId}>
      {/* Drop indicator: before (desktop only) */}
      {!isMobile && dropPosition === 'before' && (
        <div className="absolute top-0 left-2 right-2 h-0.5 bg-sidebar-primary rounded-full z-10" />
      )}
      <div
        className={cn(
          'group relative flex items-center gap-2 md:gap-1 py-2.5 md:py-1.5 px-1 text-[18px] md:text-sm transition-colors rounded-lg cursor-pointer',
          !isMobile && isDragActive && 'opacity-40',
          isSelected && !isDragActive && !isMobile
            ? 'bg-sidebar-primary/10 text-sidebar-primary'
            : 'text-foreground',
          !isMobile && !isDragActive && !isSelected && 'hover:bg-black/[0.03] dark:hover:bg-accent/50',
          !isMobile && dropPosition === 'inside' && 'ring-2 ring-sidebar-primary ring-inset bg-sidebar-primary/10'
        )}
        style={{ paddingLeft: `${4 + depth * 16}px` }}
        onClick={() => { if (!showIconPicker && !iconSelectGuardRef.current) onSelect(); }}
        onContextMenu={handleContextMenu}
        onTouchStart={handleLongPressStart}
        onTouchEnd={handleLongPressEnd}
        onTouchMove={handleLongPressMove}
      >
        {/* Expand/collapse toggle */}
        {hasChildren ? (
          <button
            onClick={(e) => { e.stopPropagation(); onToggle(); }}
            className="p-0.5 shrink-0 text-black/20 dark:text-white/20 hover:text-black/40 dark:hover:text-white/40"
          >
            <svg className={cn('h-3.5 w-3.5 md:h-3 md:w-3 transition-transform', isExpanded && 'rotate-90')} viewBox="0 0 16 16" fill="currentColor"><polygon points="6,3 13,8 6,13" /></svg>
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
            title={t('icon.changeIcon')}
          >
            {node.emoji ? (
              node.emoji.startsWith('/api/') || node.emoji.startsWith('http') ? (
                <img src={node.emoji} alt="" className="w-6 h-6 md:w-4 md:h-4 rounded object-cover" />
              ) : (
                <span className="text-base md:text-sm leading-none">{node.emoji}</span>
              )
            ) : node.type === 'table'
              ? <Table2 className={cn('h-6 w-6 md:h-4 md:w-4', isSelected && !isMobile ? 'text-sidebar-primary' : 'text-[#939493] dark:text-[#818181]')} />
              : node.type === 'presentation'
              ? <Presentation className={cn('h-6 w-6 md:h-4 md:w-4', isSelected && !isMobile ? 'text-sidebar-primary' : 'text-[#939493] dark:text-[#818181]')} />
              : <FileText className={cn('h-6 w-6 md:h-4 md:w-4', isSelected && !isMobile ? 'text-sidebar-primary' : 'text-[#939493] dark:text-[#818181]')} />
            }
          </button>
          {showIconPicker && !isMobile && (
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
          {showIconPicker && isMobile && (
            <MobileIconPicker
              onSelect={(em) => handleIconSelect(em)}
              onRemove={node.emoji ? () => handleIconSelect(null) : undefined}
              onUploadImage={node.type === 'doc' ? async (file) => {
                const result = await docApi.uploadFile(file, node.rawId);
                return result.url;
              } : undefined}
              onClose={() => setShowIconPicker(false)}
            />
          )}
        </div>

        {/* Title — drag handle */}
        {isRenaming ? (
          <input
            ref={renameInputRef}
            className="flex-1 min-w-0 bg-transparent border-b border-sidebar-primary outline-none text-sm font-medium"
            value={renameValue}
            onChange={e => setRenameValue(e.target.value)}
            onBlur={handleRenameCommit}
            onKeyDown={e => {
              if (e.key === 'Enter') { e.preventDefault(); handleRenameCommit(); }
              if (e.key === 'Escape') { e.preventDefault(); setIsRenaming(false); }
            }}
            onClick={e => e.stopPropagation()}
          />
        ) : (
          <span className="truncate flex-1 select-none" {...attributes} {...listeners}>{node.title}</span>
        )}

        {/* Hover actions: Add + More (desktop only — mobile uses long-press context menu) */}
        <div className="hidden md:flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 pointer-events-none group-hover:pointer-events-auto transition-opacity">
          <div className="relative">
            <button
              ref={addBtnRef}
              onClick={(e) => { e.stopPropagation(); setShowAddMenu(v => !v); }}
              className="p-0.5 text-muted-foreground hover:text-foreground rounded"
              title={t('tree.addChild')}
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
            {showAddMenu && (
              <>
                <div className="fixed inset-0 z-10" onClick={(e) => { e.stopPropagation(); setShowAddMenu(false); }} />
                <div ref={addMenuRef} className="fixed z-50 bg-card border border-border rounded-lg shadow-lg py-1 w-36 overflow-y-auto" style={getMenuPos(addBtnRef, addMenuRef, 144)}>
                  {CREATE_CONTENT_ITEMS.map((item) => {
                    const Icon = item.icon;
                    return (
                      <button
                        key={item.type}
                        onClick={(e) => { e.stopPropagation(); setShowAddMenu(false); onCreateChild(item.type); }}
                        disabled={creating}
                        className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-foreground hover:bg-accent transition-colors disabled:opacity-50"
                      >
                        <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                        {item.label(t)}
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </div>
          <div className="relative">
            <button
              ref={moreBtnRef}
              onClick={(e) => { e.stopPropagation(); setShowMoreMenu(v => !v); }}
              className="p-0.5 text-muted-foreground hover:text-foreground rounded"
              title={t('toolbar.more')}
            >
              <MoreHorizontal className="h-3.5 w-3.5" />
            </button>
            {showMoreMenu && (
              <>
                <div className="fixed inset-0 z-10" onClick={(e) => { e.stopPropagation(); setShowMoreMenu(false); }} />
                <div ref={moreMenuRef} className="fixed z-50 bg-white dark:bg-card border border-black/10 dark:border-white/10 rounded-lg shadow-[0px_2px_10px_0px_rgba(0,0,0,0.05)] py-1 w-[172px] overflow-y-auto" style={getMenuPos(moreBtnRef, moreMenuRef, 172)}>
                  <ContentMenuList
                    items={toContentMenuItems(contentItemSurfaces.topBarMore, contentActionMap, buildContentItemCtx(), t, isMobile)}
                    onItemClick={(item) => {
                      setShowMoreMenu(false);
                      item.onClick();
                    }}
                    showShortcut={false}
                  />
                </div>
              </>
            )}
          </div>
        </div>
      </div>
      {/* Drop indicator: after (desktop only) */}
      {!isMobile && dropPosition === 'after' && (
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
          ? 'bg-sidebar-primary/10 text-sidebar-primary'
          : 'text-black/70 dark:text-white/70 hover:bg-black/[0.03] dark:hover:bg-accent/50'
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
        ? <Table2 className={cn('h-4 w-4 shrink-0', isSelected ? 'text-sidebar-primary' : 'text-[#939493] dark:text-[#818181]')} />
        : (node.type as string) === 'presentation'
        ? <Presentation className={cn('h-4 w-4 shrink-0', isSelected ? 'text-sidebar-primary' : 'text-[#939493] dark:text-[#818181]')} />
        : (node.type as string) === 'diagram'
        ? <GitBranch className={cn('h-4 w-4 shrink-0', isSelected ? 'text-sidebar-primary' : 'text-[#939493] dark:text-[#818181]')} />
        : <FileText className={cn('h-4 w-4 shrink-0', isSelected ? 'text-sidebar-primary' : 'text-[#939493] dark:text-[#818181]')} />
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
  const { t } = useT();

  const handleAction = async (action: () => Promise<void>) => {
    if (loading) return;
    setLoading(true);
    try { await action(); } finally { setLoading(false); }
  };

  const deletedDate = deletedAt ? formatDate(deletedAt) : '';

  return (
    <div className={cn(
      'group flex items-center gap-1.5 py-1.5 px-2 text-sm rounded-lg',
      loading ? 'opacity-50' : 'hover:bg-black/[0.03] dark:hover:bg-accent/50'
    )}>
      {icon}
      <div className="flex-1 min-w-0">
        <span className="truncate block select-none">{title || t('content.untitled')}</span>
        {deletedDate && (
          <span className="text-[10px] text-muted-foreground/60">{deletedDate}</span>
        )}
      </div>
      <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={() => handleAction(onRestore)}
          disabled={loading}
          className="p-1 text-muted-foreground hover:text-foreground rounded"
          title={t('trash.restore')}
        >
          <RotateCcw className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={() => handleAction(onPermanentDelete)}
          disabled={loading}
          className="p-1 text-destructive hover:text-destructive/80 rounded"
          title={t('trash.deletePermanently')}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

// formatDate and formatRelativeTime are now imported from @/lib/utils/time
// END_OF_EXTRACTED_MARKER
