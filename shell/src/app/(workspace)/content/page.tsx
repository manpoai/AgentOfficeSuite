'use client';

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as ol from '@/lib/api/outline';
import * as nc from '@/lib/api/nocodb';
import { FileText, Table2, Plus, ArrowLeft, Trash2, X, Search, Clock, MoreHorizontal, MessageSquare as MessageSquareIcon, Star, Copy, Download, ChevronRight, Share2, FolderOpen, Smile } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Editor } from '@/components/editor';
import { Comments } from '@/components/comments/Comments';
import { TableEditor } from '@/components/table-editor/TableEditor';
import * as gw from '@/lib/api/gateway';
import { useT } from '@/lib/i18n';
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
  type: 'doc' | 'table';
  title: string;
  emoji?: string;
  createdAt: number;
  updatedAt?: string;
  parentId: string | null;  // parent node id (doc:<id> or table:<id>)
};

type Selection = { type: 'doc'; id: string } | { type: 'table'; id: string } | null;

/** Tree ordering stored in localStorage */
interface TreeState {
  /** parentId → ordered child IDs */
  children: Record<string, string[]>;
  /** nodeId → parentId */
  parents: Record<string, string>;
}

const TREE_STATE_KEY = 'asuite-content-tree';

function loadTreeState(): TreeState {
  try {
    const raw = localStorage.getItem(TREE_STATE_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return { children: {}, parents: {} };
}

function saveTreeState(state: TreeState) {
  localStorage.setItem(TREE_STATE_KEY, JSON.stringify(state));
}

// ═══════════════════════════════════════════════════
// Main Page
// ═══════════════════════════════════════════════════

export default function ContentPage() {
  const { t } = useT();
  const [selection, setSelection] = useState<Selection>(() => {
    try {
      const saved = localStorage.getItem('asuite-content-selection');
      if (saved) return JSON.parse(saved);
    } catch { /* ignore */ }
    return null;
  });
  const [mobileView, setMobileView] = useState<'list' | 'detail'>('list');
  const [showNewMenu, setShowNewMenu] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [treeState, setTreeState] = useState<TreeState>(() => loadTreeState());
  const [dragActiveId, setDragActiveId] = useState<string | null>(null);
  const [dropIntent, setDropIntent] = useState<DropIntent>(null);
  const queryClient = useQueryClient();

  const { data: docs, isLoading: docsLoading } = useQuery({
    queryKey: ['outline-docs'],
    queryFn: () => ol.listDocuments(),
  });

  const { data: collections } = useQuery({
    queryKey: ['outline-collections'],
    queryFn: ol.listCollections,
  });

  const { data: tables, isLoading: tablesLoading } = useQuery({
    queryKey: ['nc-tables'],
    queryFn: nc.listTables,
  });

  const { data: searchResults } = useQuery({
    queryKey: ['outline-search', searchQuery],
    queryFn: () => ol.searchDocuments(searchQuery),
    enabled: searchQuery.length >= 2,
  });

  const selectedDocId = selection?.type === 'doc' ? selection.id : null;
  const selectedTableId = selection?.type === 'table' ? selection.id : null;

  const { data: selectedDoc } = useQuery({
    queryKey: ['outline-doc', selectedDocId],
    queryFn: () => ol.getDocument(selectedDocId!),
    enabled: !!selectedDocId,
  });

  // Build unified node map
  const nodeMap = useMemo(() => {
    const map = new Map<string, ContentNode>();
    (docs || []).forEach(doc => {
      const nodeId = `doc:${doc.id}`;
      map.set(nodeId, {
        id: nodeId,
        rawId: doc.id,
        type: 'doc',
        title: doc.title || t('content.untitled'),
        emoji: doc.emoji,
        createdAt: new Date(doc.createdAt || 0).getTime(),
        updatedAt: doc.updatedAt,
        parentId: doc.parentDocumentId ? `doc:${doc.parentDocumentId}` : null,
      });
    });
    (tables || []).forEach(tbl => {
      const nodeId = `table:${tbl.id}`;
      map.set(nodeId, {
        id: nodeId,
        rawId: tbl.id,
        type: 'table',
        title: tbl.title || t('content.untitledTable'),
        createdAt: new Date(tbl.created_at || 0).getTime(),
        parentId: null, // tables don't have native parent; use treeState
      });
    });
    return map;
  }, [docs, tables, t]);

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
  const { childrenMap, rootIds } = useMemo(() => {
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

    // Sort children by treeState order, then by createdAt
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

    // Sort roots by treeState order, then by createdAt
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

    return { childrenMap: cMap, rootIds: roots };
  }, [effectiveNodes, treeState]);

  const toggleExpand = (id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
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
            emoji: r.document.emoji,
            createdAt: 0,
            parentId: null,
          }))
        : [])
    : null;

  const handleSelect = (nodeId: string) => {
    const node = effectiveNodes.get(nodeId);
    if (!node) return;
    const sel = { type: node.type, id: node.rawId };
    setSelection(sel);
    localStorage.setItem('asuite-content-selection', JSON.stringify(sel));
    setMobileView('detail');
  };

  // Auto-select first item if nothing is selected
  useEffect(() => {
    if (selection || rootIds.length === 0) return;
    const firstId = rootIds[0];
    const firstNode = effectiveNodes.get(firstId);
    if (firstNode) {
      const sel = { type: firstNode.type, id: firstNode.rawId } as Selection;
      setSelection(sel);
      localStorage.setItem('asuite-content-selection', JSON.stringify(sel));
    }
  }, [rootIds, selection, effectiveNodes]);

  const refreshDocs = () => {
    queryClient.invalidateQueries({ queryKey: ['outline-docs'] });
    if (selectedDocId) queryClient.invalidateQueries({ queryKey: ['outline-doc', selectedDocId] });
  };

  const refreshTables = () => {
    queryClient.invalidateQueries({ queryKey: ['nc-tables'] });
  };

  const handleCreateDoc = async (parentNodeId?: string) => {
    if (creating) return;
    const collectionId = collections?.[0]?.id;
    if (!collectionId) return;
    setCreating(true);

    // Optimistic: generate a temp ID and insert into cache immediately
    const tempId = `temp-${Date.now()}`;
    const optimisticDoc: ol.OLDocument = {
      id: tempId,
      title: t('content.untitled'),
      text: '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      publishedAt: null,
      archivedAt: null,
      deletedAt: null,
      collectionId,
      parentDocumentId: parentNodeId ? (effectiveNodes.get(parentNodeId)?.type === 'doc' ? effectiveNodes.get(parentNodeId)!.rawId : null) : null,
      createdBy: { id: '', name: '' },
      updatedBy: { id: '', name: '' },
      revision: 0,
    };

    // Insert optimistic doc into cache
    queryClient.setQueryData<ol.OLDocument[]>(['outline-docs'], old => [...(old || []), optimisticDoc]);

    if (parentNodeId) {
      const parentNode = effectiveNodes.get(parentNodeId);
      if (parentNode?.type === 'table') {
        updateTreeParent(`doc:${tempId}`, parentNodeId);
      }
      setExpandedIds(prev => new Set(prev).add(parentNodeId));
    }

    try {
      let parentDocId: string | undefined;
      if (parentNodeId) {
        const parentNode = effectiveNodes.get(parentNodeId);
        if (parentNode?.type === 'doc') parentDocId = parentNode.rawId;
      }
      const doc = await ol.createDocument(t('content.untitled'), '', collectionId, parentDocId);

      // Replace temp doc with real one in cache
      queryClient.setQueryData<ol.OLDocument[]>(['outline-docs'], old =>
        (old || []).map(d => d.id === tempId ? doc : d)
      );

      // Fix treeState if parent was a table (replace temp ID)
      if (parentNodeId && effectiveNodes.get(parentNodeId)?.type === 'table') {
        setTreeState(prev => {
          const next = { children: { ...prev.children }, parents: { ...prev.parents } };
          delete next.parents[`doc:${tempId}`];
          next.parents[`doc:${doc.id}`] = parentNodeId;
          for (const [k, v] of Object.entries(next.children)) {
            next.children[k] = v.map(id => id === `doc:${tempId}` ? `doc:${doc.id}` : id);
          }
          saveTreeState(next);
          return next;
        });
      }

      setSelection({ type: 'doc', id: doc.id });
      setMobileView('detail');
    } catch (e) {
      console.error('Create doc failed:', e);
      // Remove optimistic doc on error
      queryClient.setQueryData<ol.OLDocument[]>(['outline-docs'], old =>
        (old || []).filter(d => d.id !== tempId)
      );
    } finally {
      setCreating(false);
    }
  };

  const handleCreateTable = async (parentNodeId?: string) => {
    if (creating) return;
    setCreating(true);

    // Optimistic: insert temp table into cache
    const tempId = `temp-${Date.now()}`;
    const optimisticTable: nc.NCTable = {
      id: tempId,
      title: t('content.untitledTable'),
      created_at: new Date().toISOString(),
    };
    queryClient.setQueryData<nc.NCTable[]>(['nc-tables'], old => [...(old || []), optimisticTable]);

    if (parentNodeId) {
      updateTreeParent(`table:${tempId}`, parentNodeId);
      setExpandedIds(prev => new Set(prev).add(parentNodeId));
    }

    try {
      const table = await nc.createTable(t('content.untitledTable'), [
        { title: 'Name', uidt: 'SingleLineText' },
        { title: 'Notes', uidt: 'LongText' },
      ]);
      const tableId = table.id || (table as any).table_id;

      // Replace temp with real in cache
      queryClient.setQueryData<nc.NCTable[]>(['nc-tables'], old =>
        (old || []).map(t => t.id === tempId ? { ...table, id: tableId } : t)
      );

      // Fix treeState (replace temp ID)
      if (parentNodeId) {
        setTreeState(prev => {
          const next = { children: { ...prev.children }, parents: { ...prev.parents } };
          delete next.parents[`table:${tempId}`];
          next.parents[`table:${tableId}`] = parentNodeId;
          for (const [k, v] of Object.entries(next.children)) {
            next.children[k] = v.map(id => id === `table:${tempId}` ? `table:${tableId}` : id);
          }
          saveTreeState(next);
          return next;
        });
      }

      setSelection({ type: 'table', id: tableId });
      setMobileView('detail');
    } catch (e) {
      console.error('Create table failed:', e);
      queryClient.setQueryData<nc.NCTable[]>(['nc-tables'], old =>
        (old || []).filter(t => t.id !== tempId)
      );
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

  const isLoading = docsLoading || tablesLoading;

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

      // If both are docs, also move in Outline API
      if (activeNode.type === 'doc' && overNode.type === 'doc') {
        ol.moveDocument(activeNode.rawId, overNode.rawId).catch(e => console.error('Move doc failed:', e));
      }

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

        // If doc moving to/from doc parent, update in Outline
        if (activeNode.type === 'doc') {
          if (overParent !== '__root__') {
            const newParentNode = effectiveNodes.get(overParent);
            if (newParentNode?.type === 'doc') {
              ol.moveDocument(activeNode.rawId, newParentNode.rawId).catch(e => console.error('Move doc failed:', e));
            }
          } else {
            // Moving to root
            ol.moveDocument(activeNode.rawId, null).catch(e => console.error('Move doc failed:', e));
          }
        }
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
    <div className="flex h-full overflow-hidden flex-col md:flex-row">
      {/* Document Library sidebar */}
      <div className={cn(
        'w-full md:w-[260px] border-r border-border bg-[#F5F5F5] dark:bg-sidebar flex flex-col md:shrink-0 min-h-0 overflow-hidden',
        mobileView === 'list' ? 'flex' : 'hidden md:flex'
      )}>
        {/* Header */}
        <div className="px-3 pt-3 pb-2 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FolderOpen className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-xs font-medium text-muted-foreground">Document Library</h2>
          </div>
          <div className="flex items-center gap-1 relative">
            <button
              onClick={() => setShowNewMenu(v => !v)}
              className="p-1 text-muted-foreground hover:text-foreground"
              title={t('common.new')}
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
            {showNewMenu && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setShowNewMenu(false)} />
                <div className="absolute right-0 top-full mt-1 z-20 bg-card border border-border rounded-lg shadow-lg py-1 w-36">
                  <button
                    onClick={() => { setShowNewMenu(false); handleCreateDoc(); }}
                    disabled={creating}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-foreground hover:bg-accent transition-colors disabled:opacity-50"
                  >
                    <FileText className="h-4 w-4 text-muted-foreground" />
                    {t('content.newDoc')}
                  </button>
                  <button
                    onClick={() => { setShowNewMenu(false); handleCreateTable(); }}
                    disabled={creating}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-foreground hover:bg-accent transition-colors disabled:opacity-50"
                  >
                    <Table2 className="h-4 w-4 text-muted-foreground" />
                    {t('content.newTable')}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>

        <ScrollArea className="flex-1 min-h-0">
          <div className="px-2 py-1">
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
                {rootIds.map(nodeId => (
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
                        : <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                      }
                      <span className="truncate">{dragActiveNode.title}</span>
                    </div>
                  )}
                </DragOverlay>
              </DndContext>
            )}
          </div>
        </ScrollArea>
      </div>

      {/* Detail area */}
      <div className={cn(
        'flex-1 flex flex-col min-w-0 min-h-0 bg-white dark:bg-card',
        mobileView === 'detail' ? 'flex' : 'hidden md:flex'
      )}>
        {selectedDoc && selection?.type === 'doc' ? (
          <DocPanel
            doc={selectedDoc}
            breadcrumb={getBreadcrumb(selectedDoc.id)}
            onBack={() => setMobileView('list')}
            onSaved={refreshDocs}
            onDeleted={() => { setSelection(null); refreshDocs(); setMobileView('list'); }}
            onNavigate={(docId) => setSelection({ type: 'doc', id: docId })}
          />
        ) : selectedTableId ? (
          <TableEditor
            tableId={selectedTableId}
            onBack={() => setMobileView('list')}
            onDeleted={() => { setSelection(null); setMobileView('list'); }}
          />
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground gap-2">
            <div className="flex gap-3 mb-2">
              <FileText className="h-8 w-8 opacity-20" />
              <Table2 className="h-8 w-8 opacity-20" />
            </div>
            <p className="text-sm">{t('content.selectHint')}</p>
            <p className="text-xs text-muted-foreground/50">{t('content.createHint')}</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════
// Recursive tree node
// ═══════════════════════════════════════════════════

function TreeNodeRecursive({
  nodeId, nodes, childrenMap, selection, expandedIds, onSelect, onToggle,
  onCreateDoc, onCreateTable, depth, creating, dropIntent, dragActiveId,
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
          else onCreateTable(nodeId);
        }}
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
  nodeId, node, isSelected, onSelect, hasChildren, isExpanded, onToggle, depth, onCreateChild, creating, dropPosition, isDragActive,
}: {
  nodeId: string;
  node: ContentNode;
  isSelected: boolean;
  onSelect: () => void;
  hasChildren: boolean;
  isExpanded: boolean;
  onToggle: () => void;
  depth: number;
  onCreateChild: (type: 'doc' | 'table') => void;
  creating?: boolean;
  dropPosition?: 'before' | 'after' | 'inside' | null;
  isDragActive?: boolean;
}) {
  const { t } = useT();
  const { attributes, listeners, setNodeRef } = useDraggable({ id: nodeId });
  const [showAddMenu, setShowAddMenu] = useState(false);

  return (
    <div ref={setNodeRef} className="relative" data-tree-id={nodeId}>
      {/* Drop indicator: before */}
      {dropPosition === 'before' && (
        <div className="absolute top-0 left-2 right-2 h-0.5 bg-blue-500 rounded-full z-10" />
      )}
      <div
        className={cn(
          'group relative flex items-center gap-1 py-1.5 px-1 text-sm transition-colors rounded-lg cursor-pointer',
          isDragActive && 'opacity-40',
          isSelected && !isDragActive
            ? 'bg-[#D6DFF6] dark:bg-sidebar-accent text-sidebar-primary dark:text-sidebar-primary-foreground'
            : !isDragActive && 'text-foreground hover:bg-black/[0.03] dark:hover:bg-accent/50',
          dropPosition === 'inside' && 'ring-2 ring-blue-500 ring-inset bg-blue-50 dark:bg-blue-950/30'
        )}
        style={{ paddingLeft: `${4 + depth * 16}px` }}
        onClick={onSelect}
      >
        {/* Expand/collapse toggle */}
        {hasChildren ? (
          <button
            onClick={(e) => { e.stopPropagation(); onToggle(); }}
            className="p-0.5 shrink-0 text-muted-foreground hover:text-foreground"
          >
            <ChevronRight className={cn('h-3 w-3 transition-transform', isExpanded && 'rotate-90')} />
          </button>
        ) : (
          <span className="w-4 shrink-0" />
        )}

        {/* Icon — emoji overrides default for docs */}
        {node.emoji ? (
          <span className="text-sm shrink-0 leading-none">{node.emoji}</span>
        ) : node.type === 'table'
          ? <Table2 className={cn('h-4 w-4 shrink-0', isSelected ? 'text-sidebar-primary' : 'text-muted-foreground')} />
          : <FileText className={cn('h-4 w-4 shrink-0', isSelected ? 'text-sidebar-primary' : 'text-muted-foreground')} />
        }

        {/* Title — drag handle */}
        <span className="truncate flex-1" {...attributes} {...listeners}>{node.title}</span>

        {/* Hover actions: Add + More */}
        <div className="hidden group-hover:flex items-center gap-0.5 shrink-0">
          <div className="relative">
            <button
              onClick={(e) => { e.stopPropagation(); setShowAddMenu(v => !v); }}
              className="p-0.5 text-muted-foreground hover:text-foreground rounded"
              title="Add child"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
            {showAddMenu && (
              <>
                <div className="fixed inset-0 z-10" onClick={(e) => { e.stopPropagation(); setShowAddMenu(false); }} />
                <div className="absolute right-0 top-full mt-1 z-20 bg-card border border-border rounded-lg shadow-lg py-1 w-36">
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
                </div>
              </>
            )}
          </div>
          <button
            onClick={(e) => e.stopPropagation()}
            className="p-0.5 text-muted-foreground hover:text-foreground rounded"
            title="More"
          >
            <MoreHorizontal className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      {/* Drop indicator: after */}
      {dropPosition === 'after' && (
        <div className="absolute bottom-0 left-2 right-2 h-0.5 bg-blue-500 rounded-full z-10" />
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
          ? 'bg-[#D6DFF6] dark:bg-sidebar-accent text-sidebar-primary dark:text-sidebar-primary-foreground'
          : 'text-foreground hover:bg-black/[0.03] dark:hover:bg-accent/50'
      )}
      style={{ paddingLeft: `${8 + depth * 16}px` }}
    >
      <span className="w-4 shrink-0" />
      {node.emoji ? (
        <span className="text-sm shrink-0 leading-none">{node.emoji}</span>
      ) : node.type === 'table'
        ? <Table2 className={cn('h-4 w-4 shrink-0', isSelected ? 'text-sidebar-primary' : 'text-muted-foreground')} />
        : <FileText className={cn('h-4 w-4 shrink-0', isSelected ? 'text-sidebar-primary' : 'text-muted-foreground')} />
      }
      <span className="truncate">{node.title}</span>
    </button>
  );
}

// ═══════════════════════════════════════════════════
// Document sub-components
// ═══════════════════════════════════════════════════

/** Common emoji list for quick selection */
const COMMON_EMOJIS = [
  '😀', '😊', '🎉', '🚀', '💡', '📝', '📚', '🔥', '⭐', '✅',
  '❤️', '👍', '🎯', '🔧', '📊', '🌟', '💻', '🎨', '📌', '🗂️',
  '🏗️', '📋', '🧪', '🔍', '💬', '📖', '🎓', '🌍', '⚡', '🛠️',
];

function DocPanel({ doc, breadcrumb, onBack, onSaved, onDeleted, onNavigate }: {
  doc: ol.OLDocument;
  breadcrumb: { id: string; title: string }[];
  onBack: () => void;
  onSaved: () => void;
  onDeleted: () => void;
  onNavigate: (docId: string) => void;
}) {
  const { t } = useT();
  const queryClient = useQueryClient();
  const [showComments, setShowComments] = useState(false);
  const [showDocMenu, setShowDocMenu] = useState(false);
  const [commentQuote, setCommentQuote] = useState('');
  const [title, setTitle] = useState(doc.title);
  const [emoji, setEmoji] = useState<string | null>(doc.emoji?.trim() || null);
  const [text, setText] = useState(doc.text);
  const [deleting, setDeleting] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'unsaved' | 'error'>('saved');
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showTitleIcon, setShowTitleIcon] = useState(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestRef = useRef({ title: doc.title, text: doc.text, emoji: doc.emoji || null as string | null });
  const emojiPickerRef = useRef<HTMLDivElement>(null);

  // Optimistically update sidebar doc list cache when title/emoji change
  const updateDocCache = useCallback((newTitle: string, newEmoji: string | null) => {
    queryClient.setQueryData<ol.OLDocument[]>(['outline-docs'], old =>
      (old || []).map(d => d.id === doc.id ? { ...d, title: newTitle, emoji: newEmoji || undefined } : d)
    );
  }, [doc.id, queryClient]);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.text) {
        setCommentQuote(detail.text);
        setShowComments(true);
      }
    };
    window.addEventListener('editor-comment', handler);
    return () => window.removeEventListener('editor-comment', handler);
  }, []);

  useEffect(() => {
    setTitle(doc.title);
    setEmoji(doc.emoji?.trim() || null);
    setText(doc.text);
    latestRef.current = { title: doc.title, text: doc.text, emoji: doc.emoji?.trim() || null };
    setSaveStatus('saved');
  }, [doc.id, doc.title, doc.text, doc.emoji]);

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

  const scheduleSave = useCallback((newTitle: string, newText: string, newEmoji?: string | null) => {
    latestRef.current = { title: newTitle, text: newText, emoji: newEmoji !== undefined ? newEmoji : latestRef.current.emoji };
    setSaveStatus('unsaved');
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      setSaveStatus('saving');
      try {
        await ol.updateDocument(doc.id, latestRef.current.title, latestRef.current.text, latestRef.current.emoji);
        setSaveStatus('saved');
        onSaved();
      } catch (e) {
        console.error('Auto-save failed:', e);
        setSaveStatus('error');
      }
    }, 1500);
  }, [doc.id, onSaved]);

  useEffect(() => {
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); };
  }, []);

  const handleTitleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newTitle = e.target.value;
    setTitle(newTitle);
    updateDocCache(newTitle, emoji);
    scheduleSave(newTitle, text);
  };

  const handleEmojiSelect = (selectedEmoji: string | null) => {
    setEmoji(selectedEmoji);
    setShowEmojiPicker(false);
    updateDocCache(title, selectedEmoji);
    scheduleSave(title, text, selectedEmoji);
  };

  const handleTextChange = (newText: string) => {
    setText(newText);
    scheduleSave(title, newText);
  };

  const handleDelete = async () => {
    if (!confirm(t('content.deleteConfirm'))) return;
    setDeleting(true);
    try {
      await ol.deleteDocument(doc.id);
      onDeleted();
    } catch (e) {
      console.error('Delete failed:', e);
    } finally {
      setDeleting(false);
    }
  };

  const statusText = saveStatus === 'saving' ? t('content.saving') : saveStatus === 'unsaved' ? t('content.unsaved') : saveStatus === 'error' ? t('content.saveFailed') : '';

  return (
    <>
      {/* Top bar — breadcrumb + actions */}
      <div className="flex items-center px-4 py-2 border-b border-border bg-white dark:bg-card shrink-0">
        <button onClick={onBack} className="md:hidden p-1.5 -ml-1 text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1 text-sm">
            {breadcrumb.map((crumb, i) => (
              <span key={crumb.id} className="flex items-center gap-1 min-w-0">
                {i > 0 && <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />}
                {i < breadcrumb.length - 1 ? (
                  <button onClick={() => onNavigate(crumb.id)} className="text-muted-foreground hover:text-foreground truncate">
                    {crumb.title}
                  </button>
                ) : (
                  <span className="text-foreground font-medium truncate">{title || crumb.title}</span>
                )}
              </span>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {statusText && (
            <span className={cn('text-[10px]', saveStatus === 'error' ? 'text-destructive' : 'text-muted-foreground')}>{statusText}</span>
          )}
          <button className="flex items-center gap-1.5 h-8 px-3 rounded bg-black/10 dark:bg-accent text-sm text-foreground/80 hover:bg-black/15 dark:hover:bg-accent/80 transition-colors">
            <Share2 className="h-3.5 w-3.5" />
            <span>Share</span>
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
                  <DocMenuBtn icon={Star} label={t('content.favorite')} onClick={() => setShowDocMenu(false)} />
                  <DocMenuBtn icon={Clock} label={t('content.versionHistory')} onClick={() => setShowDocMenu(false)} />
                  <DocMenuBtn icon={Copy} label={t('content.copy')} onClick={() => { navigator.clipboard.writeText(doc.text); setShowDocMenu(false); }} />
                  <DocMenuBtn icon={Download} label={t('content.download')} onClick={() => {
                    const blob = new Blob([doc.text], { type: 'text/markdown' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a'); a.href = url; a.download = `${title}.md`; a.click();
                    URL.revokeObjectURL(url);
                    setShowDocMenu(false);
                  }} />
                  <div className="border-t border-border my-1" />
                  <DocMenuBtn icon={Trash2} label={t('content.delete')} onClick={() => { setShowDocMenu(false); handleDelete(); }} danger />
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Content area */}
      <div className="flex-1 min-h-0 flex flex-row overflow-hidden">
        <div className="flex-1 min-h-0 min-w-0 flex flex-col overflow-y-auto">
          {/* Title area — Outline style: emoji inline when set, hover icon positioned outside */}
          <div className="doc-title-wrap">
          <div
            className="doc-title-area group/title"
            onMouseEnter={() => setShowTitleIcon(true)}
            onMouseLeave={() => { if (!showEmojiPicker) setShowTitleIcon(false); }}
          >
            <div className="relative flex items-center" ref={emojiPickerRef}>
              {/* Emoji or hover icon — absolute positioned to the LEFT, outside content area */}
              {emoji ? (
                <button
                  onClick={() => setShowEmojiPicker(v => !v)}
                  className="absolute -left-12 top-1/2 -translate-y-1/2 text-4xl leading-none hover:opacity-70 transition-opacity"
                  title="Change icon"
                >
                  {emoji}
                </button>
              ) : showTitleIcon ? (
                <button
                  onClick={() => setShowEmojiPicker(v => !v)}
                  className="absolute -left-10 top-1/2 -translate-y-1/2 p-1 rounded text-muted-foreground/30 hover:text-muted-foreground hover:bg-black/5 transition-all"
                  title="Add icon"
                >
                  <Smile className="h-6 w-6" />
                </button>
              ) : null}
              {/* Title input — left-aligned with body content */}
              <input
                value={title}
                onChange={handleTitleChange}
                placeholder={t('content.untitled')}
                className="flex-1 min-w-0 text-[2.5rem] font-bold text-foreground bg-transparent border-none outline-none placeholder:text-muted-foreground/30 leading-tight"
              />
              {/* Emoji picker dropdown */}
              {showEmojiPicker && (
                <div className="absolute left-0 top-full mt-1 z-50 bg-card border border-border rounded-lg shadow-xl p-3 w-[280px]">
                  <div className="grid grid-cols-10 gap-1">
                    {COMMON_EMOJIS.map(em => (
                      <button
                        key={em}
                        onClick={() => handleEmojiSelect(em)}
                        className="w-7 h-7 flex items-center justify-center rounded hover:bg-accent text-lg leading-none"
                      >
                        {em}
                      </button>
                    ))}
                  </div>
                  {emoji && (
                    <>
                      <div className="border-t border-border my-2" />
                      <button
                        onClick={() => handleEmojiSelect(null)}
                        className="w-full text-xs text-muted-foreground hover:text-foreground py-1.5 rounded hover:bg-accent transition-colors"
                      >
                        Remove icon
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
            {/* Meta info below title */}
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground/60 mt-3 mb-4">
              <span>{formatRelativeTime(doc.updatedAt)}</span>
              {doc.updatedBy?.name && <span>· {doc.updatedBy.name}</span>}
            </div>
          </div>
          </div>

          {/* Editor */}
          <Editor key={doc.id} defaultValue={doc.text} onChange={handleTextChange} placeholder={t('content.editorPlaceholder')} documentId={doc.id} />
        </div>

        {showComments && (
          <div className="w-72 border-l border-border bg-card flex flex-col shrink-0 overflow-hidden">
            <div className="px-3 py-2 border-b border-border flex items-center justify-between">
              <h3 className="text-xs font-semibold text-foreground">{t('content.comments')}</h3>
              <button onClick={() => setShowComments(false)} className="text-muted-foreground hover:text-foreground">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            <Comments
              queryKey={['doc-comments', doc.id]}
              fetchComments={() => gw.listDocComments(doc.id)}
              postComment={(text) => gw.commentOnDoc(doc.id, text)}
              initialQuote={commentQuote}
              onQuoteConsumed={() => setCommentQuote('')}
            />
          </div>
        )}
      </div>
    </>
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

function formatDate(isoStr: string): string {
  const d = new Date(isoStr);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return d.toLocaleDateString(undefined, { month: '2-digit', day: '2-digit' });
}

function formatRelativeTime(isoStr: string): string {
  const d = new Date(isoStr);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} minutes ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hours ago`;
  const days = Math.floor(hours / 24);
  return `${days} days ago`;
}
