'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as gw from '@/lib/api/gateway';
import {
  Link2, Download, Trash2,
  Play,
  MessageSquare, Clock,
  ExternalLink, AtSign, Share2, Pin, Search,
  X, Bold, Italic, Underline, Strikethrough, Table2,
  AlignLeft, AlignCenter, AlignRight, AlignJustify,
  Image as ImageIcon, Copy, ChevronUp, ChevronDown,
  ArrowUpToLine, ArrowDownToLine, MoveUp, MoveDown,
  Plus, Minus, Type, Maximize2, RotateCcw,
  ChevronLeft, ChevronRight,
  FlipHorizontal2, FlipVertical2,
  Replace, PanelRightClose, PanelRight,
} from 'lucide-react';
import { RichTable } from '@/components/shared/RichTable';
import { FloatingToolbar } from '@/components/shared/FloatingToolbar';
import { getPptTextItems, getPptImageItems, getPptShapeItems, getDocsTableItems } from '@/components/shared/FloatingToolbar/presets';
import { createDocsTableHandler } from '@/components/editor/docs-toolbar-handler';
import { ColorPicker } from '@/components/ui/color-picker';
import { cn } from '@/lib/utils';
import { showError } from '@/lib/utils/error';
import { useT, getT } from '@/lib/i18n';
import { ContentTopBar } from '@/components/shared/ContentTopBar';
import { buildFixedTopBarActionItems, renderFixedTopBarActions } from '@/actions/content-topbar-fixed.actions';
import { buildContentTopBarCommonMenuItems } from '@/actions/content-topbar-common.actions';
import { CommentPanel } from '@/components/shared/CommentPanel';
import { RevisionHistory } from '@/components/shared/RevisionHistory';
import { RevisionPreviewBanner } from '@/components/shared/RevisionPreviewBanner';
import { BottomSheet } from '@/components/shared/BottomSheet';
import { usePinchZoom } from '@/lib/hooks/use-pinch-zoom';
import { SlidePreviewList } from '@/components/shared/SlidePreviewList';
import { MobileCommentBar } from '@/components/shared/MobileCommentBar';
import type { ShapeType } from '@/components/shared/ShapeSet/shapes';
import { renderCellsToSVG } from '@/components/shared/EmbeddedDiagram/renderCellsToSVG';
import { pickFile } from '@/lib/utils/pick-file';
import { DiagramPicker } from '@/components/shared/EmbeddedDiagram/DiagramPicker';
import { DiagramEditorDialog } from '@/components/shared/EmbeddedDiagram/DiagramEditorDialog';
import { createFabricShape } from '@/components/shared/ShapeSet/adapters/FabricShape';
import { pptObjectActions, pptCanvasActions, type PPTObjectCtx, type PPTCanvasCtx } from '@/actions/ppt-object.actions';
import { pptSlideActions, type PPTSlideCtx } from '@/actions/ppt-slide.actions';
import { pptSurfaces } from '@/surfaces/ppt.surfaces';
import { toContextMenuItems } from '@/surfaces/bridge';
import { buildActionMap } from '@/actions/types';
import { useKeyboardScope } from '@/lib/keyboard';
import type { ShortcutRegistration } from '@/lib/keyboard';
import {
  type SlideData,
  SLIDE_WIDTH, SLIDE_HEIGHT, DEFAULT_SLIDE, generateSlideId,
  fitCanvasToContainer, getObjType, formatRelativeTime, FONT_FAMILIES,
} from './types';
import { SlidePanel } from './SlidePanel';
import { SlideCanvas } from './SlideCanvas';

const pptObjectActionMap = buildActionMap(pptObjectActions);
const pptCanvasActionMap = buildActionMap(pptCanvasActions);
const pptSlideActionMap = buildActionMap(pptSlideActions);

const PPT_SHORTCUTS: ShortcutRegistration[] = [
  {
    id: 'ppt-group',
    key: 'g',
    modifiers: { meta: true },
    handler: () => window.dispatchEvent(new CustomEvent('ppt:group')),
    label: getT()('shortcuts.ppt.group'),
    category: 'Presentation',
    priority: 5,
  },
  {
    id: 'ppt-ungroup',
    key: 'g',
    modifiers: { meta: true, shift: true },
    handler: () => window.dispatchEvent(new CustomEvent('ppt:ungroup')),
    label: getT()('shortcuts.ppt.ungroup'),
    category: 'Presentation',
    priority: 6,
  },
];
// NOTE: ⌘C/⌘X/⌘V/⌘D/Delete/Backspace are handled in onKeyDown (capture phase)
// via action maps — not registered here because they require canvasRef.

const THUMB_WIDTH = 180;
const THUMB_HEIGHT = Math.round(THUMB_WIDTH * (SLIDE_HEIGHT / SLIDE_WIDTH));

interface PresentationEditorProps {
  presentationId: string;
  breadcrumb?: { id: string; title: string }[];
  onBack?: () => void;
  onDeleted?: () => void;
  onCopyLink?: () => void;
  docListVisible?: boolean;
  onToggleDocList?: () => void;
  onNavigate?: (rawId: string) => void;
  focusCommentId?: string;
  showComments: boolean;
  onShowComments: () => void;
  onCloseComments: () => void;
  onToggleComments: () => void;
  isPinned?: boolean;
  onTogglePin?: () => void;
}

// ─── Fabric.js Dynamic Import ───────────────────────
let fabricModule: any = null;
let fabricLoaded = false;

function loadFabric() {
  if (fabricLoaded) return Promise.resolve();
  return import('fabric').then((mod) => {
    fabricModule = mod;
    fabricLoaded = true;
  });
}

// ─── Main Component ─────────────────────────────────
export function PresentationEditor({
  presentationId,
  breadcrumb,
  onBack,
  onDeleted,
  onCopyLink,
  docListVisible,
  onToggleDocList,
  onNavigate,
  focusCommentId,
  showComments,
  onShowComments,
  onCloseComments,
  onToggleComments,
  isPinned,
  onTogglePin,
}: PresentationEditorProps) {
  const { t } = useT();

  // Register presentation keyboard scope + context shortcuts
  useKeyboardScope('presentation', PPT_SHORTCUTS);
  const queryClient = useQueryClient();

  // State
  const [ready, setReady] = useState(fabricLoaded);
  // Title editing now handled by ContentTopBar
  const [slides, setSlides] = useState<SlideData[]>([]);
  const [currentSlideIndex, setCurrentSlideIndex] = useState(0);
  const [selectedTool, setSelectedTool] = useState<'select' | 'text' | 'rect' | 'circle' | 'triangle'>('select');
  const [isPresenting, setIsPresenting] = useState(false);
  const [selectedObj, setSelectedObj] = useState<any>(null);
  // Counter to force property panel re-render when object properties change
  const [propVersion, setPropVersion] = useState(0);
  const [showPropertyPanel, setShowPropertyPanel] = useState(false);
  const [commentAnchor, setCommentAnchor] = useState<{ type: string; id: string; meta?: Record<string, unknown> } | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [previewRevisionData, setPreviewRevisionData] = useState<any>(null);
  const [previewRevisionMeta, setPreviewRevisionMeta] = useState<{ id: string; created_at: string } | null>(null);
  const [selectedSlideIndices, setSelectedSlideIndices] = useState<Set<number>>(new Set([0]));
  const slideClipboardRef = useRef<SlideData[]>([]);
  const [mobileEditMode, setMobileEditMode] = useState(false);
  const [isMobileView, setIsMobileView] = useState(false);
  // All table objects on the current slide (for DOM RichTable overlays)
  const [tableObjects, setTableObjects] = useState<any[]>([]);
  const [diagramPicker, setDiagramPicker] = useState(false);
  const [editingDiagramId, setEditingDiagramId] = useState<string | null>(null);

  // Track screen width for mobile vertical preview
  useEffect(() => {
    const checkMobile = () => setIsMobileView(window.innerWidth < 640);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // ─── Reliability state ────────────────────────────
  const [reliabilityStatus, setReliabilityStatus] = useState<'clean' | 'dirty' | 'flushing' | 'flush_failed'>('clean');
  const [flushRetryCount, setFlushRetryCount] = useState(0);
  const [lastSaved, setLastSaved] = useState<number | null>(null);
  const reliabilityStatusRef = useRef<string>('clean');
  reliabilityStatusRef.current = reliabilityStatus;
  const dirtyRef = useRef(false);

  // Refs
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const canvasRef = useRef<any>(null);
  const canvasHostRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasContainerRef = useRef<HTMLDivElement>(null);
  // titleInputRef removed — title editing handled by ContentTopBar
  const undoStackRef = useRef<string[]>([]);
  const redoStackRef = useRef<string[]>([]);
  const [undoVersion, setUndoVersion] = useState(0); // triggers re-render for canUndo/canRedo
  const UNDO_LIMIT = 50;
  const isLoadingSlideRef = useRef(false);
  const loadGenerationRef = useRef(0);
  const isUndoingRef = useRef(false); // prevent pushSnapshot during undo/redo load
  const saveCurrentSlideToStateRef = useRef<() => void>(() => {});
  const modifiedDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSnapshotRef = useRef<string | null>(null); // last pushed snapshot to avoid duplicates
  const clipboardRef = useRef<any>(null); // fabric.js object clipboard for Cmd+C/V

  // ─── Undo / Redo ──────────────────────────────────
  const pushSnapshot = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || isLoadingSlideRef.current || isUndoingRef.current) return;
    const serialized = canvasRef.current ? JSON.stringify(canvas.toJSON()) : null;
    if (!serialized) return;
    // Skip if identical to last snapshot (e.g. redundant triggers)
    if (serialized === lastSnapshotRef.current) return;
    lastSnapshotRef.current = serialized;
    undoStackRef.current.push(serialized);
    if (undoStackRef.current.length > UNDO_LIMIT) {
      undoStackRef.current.shift();
    }
    redoStackRef.current = [];
    setUndoVersion(v => v + 1);
    console.log('[PPT Undo] pushSnapshot, stack size:', undoStackRef.current.length);
  }, []);

  const pptUndo = useCallback(async () => {
    const canvas = canvasRef.current;
    console.log('[PPT Undo] pptUndo called, stack size:', undoStackRef.current.length);
    if (!canvas || undoStackRef.current.length === 0) {
      console.log('[PPT Undo] pptUndo SKIPPED — canvas:', !!canvas, 'stack:', undoStackRef.current.length);
      return;
    }
    // Save current state to redo stack
    const currentJson = JSON.stringify(canvas.toJSON());
    redoStackRef.current.push(currentJson);
    // Pop previous state
    const prev = undoStackRef.current.pop()!;
    lastSnapshotRef.current = prev;
    // Load it (fabric.js v6 uses Promise API)
    isUndoingRef.current = true;
    try {
      await canvas.loadFromJSON(prev);
      canvas.renderAll();
      console.log('[PPT Undo] loadFromJSON complete, remaining stack:', undoStackRef.current.length);
    } finally {
      isUndoingRef.current = false;
      saveCurrentSlideToStateRef.current();
      setPropVersion(v => v + 1);
    }
    setUndoVersion(v => v + 1);
  }, []);

  const pptRedo = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas || redoStackRef.current.length === 0) return;
    // Save current state to undo stack
    const currentJson = JSON.stringify(canvas.toJSON());
    undoStackRef.current.push(currentJson);
    lastSnapshotRef.current = currentJson;
    // Pop redo state
    const next = redoStackRef.current.pop()!;
    // Load it (fabric.js v6 uses Promise API)
    isUndoingRef.current = true;
    try {
      await canvas.loadFromJSON(next);
      canvas.renderAll();
    } finally {
      isUndoingRef.current = false;
      saveCurrentSlideToStateRef.current();
      setPropVersion(v => v + 1);
    }
    setUndoVersion(v => v + 1);
  }, []);

  // ─── Pinch-to-zoom & touch pan for mobile ──────────
  usePinchZoom(canvasContainerRef, {
    onZoom: (newScale) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      fitCanvasToContainer(canvas, canvasContainerRef.current!, newScale);
    },
    getCurrentScale: () => canvasRef.current?.getZoom() ?? 1,
    minScale: 0.2,
    maxScale: 3,
  });

  // Load Fabric.js
  useEffect(() => {
    if (!fabricLoaded) {
      loadFabric().then(() => setReady(true));
    }
  }, []);

  // Fetch presentation data
  const { data: presentation, isLoading } = useQuery({
    queryKey: ['presentation', presentationId],
    queryFn: () => gw.getPresentation(presentationId),
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  // Initialize slides from fetched data
  useEffect(() => {
    if (presentation?.data?.slides) {
      const raw = presentation.data.slides.length > 0 ? presentation.data.slides : [{ ...DEFAULT_SLIDE }];
      const s = raw.map((slide: SlideData) => slide.id ? slide : { ...slide, id: generateSlideId() });
      setSlides(s);
      setCurrentSlideIndex(0);
    }
  }, [presentation]);

  const navigateToAnchor = useCallback((anchor: { type: string; id: string; meta?: Record<string, unknown> }) => {
    if (anchor.type === 'slide') {
      const idx = Number(anchor.id);
      if (!isNaN(idx) && idx < slides.length) {
        setCurrentSlideIndex(idx);
        setSelectedSlideIndices(new Set([idx]));
      }
    } else if (anchor.type === 'element') {
      const [slideIdx] = anchor.id.split(':').map(Number);
      if (!isNaN(slideIdx) && slideIdx < slides.length) {
        setCurrentSlideIndex(slideIdx);
        setSelectedSlideIndices(new Set([slideIdx]));
      }
    }
  }, [slides]);

  const currentTitle = breadcrumb?.[breadcrumb.length - 1]?.title || '';

  // ─── Auto-save ────────────────────────────────────
  const AUTOSAVE_DEBOUNCE_MS = 800;
  const saveRef = useRef<(attempt?: number) => Promise<void> | void>(() => {});

  /** Get the truly latest slides (with current canvas serialized into the current slide slot) */
  const getLatestSlides = useCallback((): SlideData[] => {
    const serialized = serializeCanvasRef.current?.();
    if (!serialized) return slidesRef.current;
    const updated = [...slidesRef.current];
    updated[currentSlideIndexRef.current] = serialized;
    return updated;
  }, []);
  const getLatestSlidesRef = useRef(getLatestSlides);
  getLatestSlidesRef.current = getLatestSlides;

  const save = useCallback(async (attempt = 0) => {
    if (!dirtyRef.current && attempt === 0) return;
    setReliabilityStatus('flushing');
    try {
      const latestSlides = getLatestSlidesRef.current();
      await gw.savePresentation(presentationId, { slides: latestSlides });
      queryClient.setQueryData(['presentation', presentationId], (old: any) =>
        old ? { ...old, data: { ...old.data, slides: latestSlides } } : old
      );
      dirtyRef.current = false;
      setLastSaved(Date.now());
      setReliabilityStatus('clean');
      setFlushRetryCount(0);
    } catch (e) {
      if (attempt < 2) {
        setFlushRetryCount(attempt + 1);
        setTimeout(() => saveRef.current(attempt + 1), 400 * (attempt + 1));
        return;
      }
      showError(t('errors.presentationAutoSaveFailed'), e);
      setReliabilityStatus('flush_failed');
      setFlushRetryCount(attempt + 1);
    }
  }, [presentationId, t]);

  saveRef.current = save;

  const scheduleSave = useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(save, AUTOSAVE_DEBOUNCE_MS);
  }, [save]);

  const flushSave = useCallback(() => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    if (dirtyRef.current) {
      return saveRef.current();
    }
  }, []);

  // ─── Canvas Setup ─────────────────────────────────
  useEffect(() => {
    if (!ready || !canvasHostRef.current || canvasRef.current) return;

    const canvasEl = document.createElement('canvas');
    canvasEl.width = SLIDE_WIDTH;
    canvasEl.height = SLIDE_HEIGHT;
    canvasHostRef.current.appendChild(canvasEl);

    const { Canvas } = fabricModule;
    const canvas = new Canvas(canvasEl, {
      width: SLIDE_WIDTH,
      height: SLIDE_HEIGHT,
      backgroundColor: '#ffffff',
      selection: true,
    });
    canvasRef.current = canvas;

    requestAnimationFrame(() => {
      fitCanvasToContainer(canvas, canvasContainerRef.current);
    });

    // Scan canvas for table objects and update state for DOM overlays
    const refreshTableObjects = () => {
      const tables = canvas.getObjects().filter((o: any) => o.__isTable);
      setTableObjects([...tables]); // new array ref to trigger re-render
    };

    // ── Undo: capture canvas state BEFORE each interaction ──
    // pushSnapshotRef avoids stale closure — always calls latest pushSnapshot
    const pushSnapshotRef = { current: pushSnapshot };

    // Capture state before a transform (drag/scale/rotate) begins
    const handleBeforeTransform = () => {
      if (isLoadingSlideRef.current || isUndoingRef.current) return;
      pushSnapshotRef.current();
    };

    // Coalesced snapshot for programmatic changes (PropertyPanel sliders, color pickers)
    // Groups rapid consecutive changes into a single undo step (300ms window)
    let lastBeforeModifiedAt = 0;
    const handleBeforeModified = () => {
      console.log('[PPT Undo] before:modified fired, isLoading:', isLoadingSlideRef.current, 'isUndoing:', isUndoingRef.current);
      if (isLoadingSlideRef.current || isUndoingRef.current) return;
      const now = Date.now();
      if (now - lastBeforeModifiedAt < 300) { console.log('[PPT Undo] before:modified COALESCED (within 300ms)'); return; }
      lastBeforeModifiedAt = now;
      pushSnapshotRef.current();
    };

    canvas.on('before:transform', handleBeforeTransform);
    // Capture state before programmatic property changes (PropertyPanel, toolbar handlers)
    canvas.on('before:modified', handleBeforeModified);
    // Text editing: capture state when entering/exiting text edit mode
    canvas.on('text:editing:entered', handleBeforeTransform);
    canvas.on('text:editing:exited', handleBeforeTransform);
    // Note: object:added/removed snapshots are handled via before:modified at call sites
    // (object:added fires AFTER the object is on canvas, capturing wrong state)

    // Track changes for auto-save
    const handleModified = () => {
      if (isLoadingSlideRef.current) return;
      if (modifiedDebounceRef.current) clearTimeout(modifiedDebounceRef.current);
      modifiedDebounceRef.current = setTimeout(() => {
        saveCurrentSlideToStateRef.current();
        // Update property panel to reflect changes
        setPropVersion(v => v + 1);
      }, 300);
    };
    const handleAddRemove = () => {
      if (isLoadingSlideRef.current) return;
      saveCurrentSlideToStateRef.current();
      refreshTableObjects();
    };

    canvas.on('object:modified', handleModified);
    canvas.on('text:changed', handleModified);
    canvas.on('object:added', handleAddRemove);
    canvas.on('object:removed', handleAddRemove);
    // Update property panel on scaling/moving
    canvas.on('object:scaling', () => setPropVersion(v => v + 1));
    canvas.on('object:moving', () => setPropVersion(v => v + 1));
    canvas.on('object:rotating', () => setPropVersion(v => v + 1));

    // Selection tracking
    const onSelect = () => {
      setSelectedObj(canvas.getActiveObject());
      setPropVersion(v => v + 1);
    };
    const onDeselect = () => {
      setSelectedObj(null);
      setPropVersion(v => v + 1);
    };
    canvas.on('selection:created', onSelect);
    canvas.on('selection:updated', onSelect);
    canvas.on('selection:cleared', onDeselect);

    // Double-click to open embedded diagrams
    canvas.on('mouse:dblclick', (e: any) => {
      const obj = e.target;
      if (obj && (obj as any).__diagramId) {
        setEditingDiagramId((obj as any).__diagramId);
        return;
      }
    });

    // ResizeObserver for responsive sizing
    const container = canvasContainerRef.current;
    let observer: ResizeObserver | null = null;
    if (container) {
      observer = new ResizeObserver(() => fitCanvasToContainer(canvas, container));
      observer.observe(container);
    }

    // Table grid lines are rendered by DOM RichTable overlays — no canvas drawing needed
    // Refresh table object list after each render (catches slide loads)
    canvas.on('after:render', refreshTableObjects);

    return () => {
      observer?.disconnect();
      canvas.dispose();
      canvasRef.current = null;
    };
  }, [ready, isLoading]);

  // ─── Context menu: desktop right-click + mobile long-press ──
  useEffect(() => {
    const showMenu = (x: number, y: number) => {
      const canvas = canvasRef.current;
      const activeObj = canvas?.getActiveObject();
      let items;
      if (activeObj) {
        const ctx: PPTObjectCtx = {
          canvas,
          activeObject: activeObj,
          clipboardRef,
          setShowComments: (v) => v ? onShowComments() : onCloseComments(),
          handleSlideComment,
          currentSlideIndex,
        };
        items = toContextMenuItems(pptSurfaces.canvasObject, pptObjectActionMap, ctx, t);
      } else {
        const ctx: PPTCanvasCtx = {
          canvas,
          clipboardRef,
          setShowComments: (v) => v ? onShowComments() : onCloseComments(),
          handleSlideComment,
          currentSlideIndex,
          openBackground: () => {
            canvas?.discardActiveObject();
            canvas?.renderAll();
            setShowPropertyPanel(true);
            setPropVersion(v => v + 1);
          },
        };
        items = toContextMenuItems(pptSurfaces.canvasEmpty, pptCanvasActionMap, ctx, t);
      }
      if (items.length > 0) {
        window.dispatchEvent(new CustomEvent('show-context-menu', { detail: { items, x, y } }));
      }
    };

    // Desktop: right-click — register on document (capture) so it fires even
    // after canvasContainerRef mounts (which happens after isLoading clears).
    const onContextMenu = (e: MouseEvent) => {
      const container = canvasContainerRef.current;
      if (!container || !container.contains(e.target as Node)) return;
      e.preventDefault();
      e.stopPropagation();
      const canvas = canvasRef.current;
      if (canvas) {
        const target = canvas.findTarget(e as any);
        if (target && target !== canvas.getActiveObject()) {
          canvas.setActiveObject(target);
          canvas.renderAll();
        }
      }
      showMenu(e.clientX, e.clientY);
    };
    document.addEventListener('contextmenu', onContextMenu, true);

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
        if (touchStartPos) showMenu(touchStartPos.x, touchStartPos.y);
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

    const touchContainer = canvasContainerRef.current;
    if (touchContainer) {
      touchContainer.addEventListener('touchstart', onTouchStart, { passive: true });
      touchContainer.addEventListener('touchmove', onTouchMove, { passive: true });
      touchContainer.addEventListener('touchend', onTouchEnd);
      touchContainer.addEventListener('touchcancel', onTouchEnd);
    }

    return () => {
      document.removeEventListener('contextmenu', onContextMenu, true);
      if (touchContainer) {
        touchContainer.removeEventListener('touchstart', onTouchStart);
        touchContainer.removeEventListener('touchmove', onTouchMove);
        touchContainer.removeEventListener('touchend', onTouchEnd);
        touchContainer.removeEventListener('touchcancel', onTouchEnd);
      }
      if (longPressTimer) clearTimeout(longPressTimer);
    };
  }, [ready]);

  // ─── Keyboard shortcuts: Undo/Redo (⌘Z/⌘⇧Z), Copy/Paste (⌘C/⌘V) ──
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      // Read canvas inside handler to avoid stale closure
      const canvas = canvasRef.current;
      // Don't intercept if inside a ProseMirror editor or text input
      const el = e.target as HTMLElement;
      if (el?.closest?.('.ProseMirror')) return;
      // Allow fabric.js textarea (text editing) to handle its own Cmd+C/V/Z/Delete
      const activeObj = canvas?.getActiveObject();
      const isFabricTextEditing = !!(activeObj as any)?.isEditing;

      // Delete / Backspace — remove selected canvas object
      if ((e.key === 'Delete' || e.key === 'Backspace') && !isFabricTextEditing) {
        if (!canvas || !activeObj) return;
        e.preventDefault();
        const deleteCtx: PPTObjectCtx = { canvas, activeObject: activeObj, clipboardRef, setShowComments: () => {} };
        pptObjectActionMap['ppt-delete'].execute(deleteCtx);
        return;
      }

      if (!meta) return;

      if (e.key === 'z' && !isFabricTextEditing) {
        e.preventDefault();
        e.stopImmediatePropagation();
        console.log('[PPT Undo] keydown Cmd+Z caught, shift:', e.shiftKey);
        if (e.shiftKey) {
          pptRedo();
        } else {
          pptUndo();
        }
      } else if (e.key === 'c' && !isFabricTextEditing) {
        if (!canvas || !activeObj) return;
        e.preventDefault();
        const copyCtx: PPTObjectCtx = { canvas, activeObject: activeObj, clipboardRef, setShowComments: () => {} };
        pptObjectActionMap['ppt-copy'].execute(copyCtx);
      } else if (e.key === 'x' && !isFabricTextEditing) {
        if (!canvas || !activeObj) return;
        e.preventDefault();
        const cutCtx: PPTObjectCtx = { canvas, activeObject: activeObj, clipboardRef, setShowComments: () => {} };
        pptObjectActionMap['ppt-cut'].execute(cutCtx);
      } else if (e.key === 'v' && !isFabricTextEditing) {
        if (!canvas || !clipboardRef.current) return;
        e.preventDefault();
        const pasteCtx: PPTCanvasCtx = { canvas, clipboardRef, setShowComments: () => {}, openBackground: () => {} };
        pptCanvasActionMap['ppt-canvas-paste'].execute(pasteCtx);
      } else if (e.key === 'd' && !isFabricTextEditing) {
        if (!canvas || !activeObj) return;
        e.preventDefault();
        const dupCtx: PPTObjectCtx = { canvas, activeObject: activeObj, clipboardRef, setShowComments: () => {} };
        pptObjectActionMap['ppt-duplicate'].execute(dupCtx);
      }
    };

    // Also listen for global 'undo'/'redo' custom events from KeyboardManager
    const onUndoEvent = () => { console.log('[PPT Undo] received window "undo" event'); pptUndo(); };
    const onRedoEvent = () => { console.log('[PPT Undo] received window "redo" event'); pptRedo(); };

    window.addEventListener('keydown', onKeyDown, true); // capture phase
    window.addEventListener('undo', onUndoEvent);
    window.addEventListener('redo', onRedoEvent);

    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('undo', onUndoEvent);
      window.removeEventListener('redo', onRedoEvent);
    };
  }, [pptUndo, pptRedo]);

  // ─── Slide panel operations (cut/copy/paste/delete/duplicate) ──
  const handleSlideCut = useCallback((_i: number) => {
    const indices = Array.from(selectedSlideIndices).sort((a, b) => a - b);
    if (slides.length - indices.length === 0) return; // don't delete all
    slideClipboardRef.current = indices.map(i => JSON.parse(JSON.stringify(slides[i])));
    const toDelete = [...indices].reverse();
    const newSlides = [...slides];
    toDelete.forEach(i => { newSlides.splice(i, 1); });
    const newIdx = Math.min(currentSlideIndex, newSlides.length - 1);
    setSlides(newSlides);
    setCurrentSlideIndex(newIdx);
    setSelectedSlideIndices(new Set([newIdx]));
  }, [slides, currentSlideIndex, selectedSlideIndices, setSlides, setCurrentSlideIndex]);

  const handleSlideCopy = useCallback((_i: number) => {
    const indices = Array.from(selectedSlideIndices).sort((a, b) => a - b);
    slideClipboardRef.current = indices.map(i => JSON.parse(JSON.stringify(slides[i])));
  }, [slides, selectedSlideIndices]);

  const handleSlidePaste = useCallback((_i: number) => {
    if (slideClipboardRef.current.length === 0) return;
    const newSlides = [...slides];
    const insertAt = currentSlideIndex + 1;
    const pasted = slideClipboardRef.current.map(s => ({ ...JSON.parse(JSON.stringify(s)), id: generateSlideId() }));
    newSlides.splice(insertAt, 0, ...pasted);
    setSlides(newSlides);
    setCurrentSlideIndex(insertAt);
    setSelectedSlideIndices(new Set([insertAt]));
  }, [slides, currentSlideIndex, setSlides, setCurrentSlideIndex]);

  const handleSlideDelete = useCallback((_i: number) => {
    if (slides.length <= 1) return;
    const indices = Array.from(selectedSlideIndices).sort((a, b) => a - b);
    const toDelete = [...indices].reverse();
    const newSlides = [...slides];
    toDelete.forEach(i => { newSlides.splice(i, 1); });
    const newIdx = Math.min(Math.min(...indices), newSlides.length - 1);
    setSlides(newSlides);
    setCurrentSlideIndex(newIdx);
    setSelectedSlideIndices(new Set([newIdx]));
  }, [slides, selectedSlideIndices, setSlides, setCurrentSlideIndex]);

  const handleSlideDuplicate = useCallback((_i: number) => {
    const indices = Array.from(selectedSlideIndices).sort((a, b) => a - b);
    const dupes = indices.map(i => ({ ...JSON.parse(JSON.stringify(slides[i])), id: generateSlideId() }));
    const newSlides = [...slides];
    const insertAt = Math.max(...indices) + 1;
    newSlides.splice(insertAt, 0, ...dupes);
    setSlides(newSlides);
    setCurrentSlideIndex(insertAt);
    setSelectedSlideIndices(new Set([insertAt]));
  }, [slides, selectedSlideIndices, setSlides, setCurrentSlideIndex]);

  const handleSlideDragEnd = useCallback((fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex) return;
    saveCurrentSlideToState();
    setSlides(prev => {
      const next = [...prev];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return next;
    });
    // Keep current slide tracking the moved slide
    setCurrentSlideIndex(toIndex);
    setSelectedSlideIndices(new Set([toIndex]));
    dirtyRef.current = true;
    setReliabilityStatus(prev => prev === 'flush_failed' ? prev : 'dirty');
    scheduleSave();
  }, [saveCurrentSlideToState, scheduleSave]);

  const handleSlideBackground = useCallback((_i: number) => {
    // Slide background editing is handled via the property panel
    setShowPropertyPanel(true);
    setPropVersion(v => v + 1);
  }, []);

  const handleSlideComment = useCallback((type: 'slide' | 'element', obj: any | null) => {
    if (type === 'element' && obj) {
      const canvas = canvasRef.current;
      const objects = canvas?.getObjects() || [];
      const elementIndex = objects.indexOf(obj);
      const elementType = obj.type || 'element';
      const preview = obj.type === 'textbox' ? (obj.text?.substring(0, 50) || elementType) : elementType;
      setCommentAnchor({
        type: 'element',
        id: `${currentSlideIndex}:${elementIndex}`,
        meta: { slide_index: currentSlideIndex, element_type: elementType, preview },
      });
    } else {
      setCommentAnchor({
        type: 'slide',
        id: String(currentSlideIndex),
        meta: { slide_index: currentSlideIndex, slide_title: slides[currentSlideIndex]?.notes?.substring(0, 50) || `Slide ${currentSlideIndex + 1}` },
      });
    }
    onShowComments();
    setShowHistory(false);
  }, [currentSlideIndex]);

  // ─── Clear undo stack on slide switch ──
  useEffect(() => {
    undoStackRef.current = [];
    redoStackRef.current = [];
    lastSnapshotRef.current = null;
    setUndoVersion(v => v + 1);
  }, [currentSlideIndex]);

  // ─── Load slide onto canvas ───────────────────────
  const loadSlideToCanvas = useCallback((slide: SlideData) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    // FIX 1: Set loading flag BEFORE clear to prevent object:removed from writing empty data
    isLoadingSlideRef.current = true;
    const generation = ++loadGenerationRef.current;

    canvas.clear();
    canvas.backgroundColor = slide.background || '#ffffff';

    // Background image support
    if (slide.backgroundImage && fabricModule.FabricImage) {
      const bgImg = new window.Image();
      bgImg.crossOrigin = 'anonymous';
      bgImg.onload = () => {
        const fImg = new fabricModule.FabricImage(bgImg, {
          originX: 'left',
          originY: 'top',
        });
        // Scale to cover the slide
        const scaleX = SLIDE_WIDTH / bgImg.width;
        const scaleY = SLIDE_HEIGHT / bgImg.height;
        const scale = Math.max(scaleX, scaleY);
        fImg.set({ scaleX: scale, scaleY: scale });
        canvas.backgroundImage = fImg;
        canvas.renderAll();
      };
      bgImg.src = slide.backgroundImage;
    } else {
      canvas.backgroundImage = null;
    }

    const { Textbox, Rect, Circle, Triangle, FabricImage } = fabricModule;

    let pendingImages = 0;

    for (const el of slide.elements) {
      let obj: any = null;
      const common = {
        left: el.left || 0,
        top: el.top || 0,
        width: el.width,
        height: el.height,
        fill: el.fill || '#333333',
        angle: el.angle || 0,
        scaleX: el.scaleX || 1,
        scaleY: el.scaleY || 1,
        opacity: el.opacity ?? 1,
      };

      if (el.type === 'textbox') {
        obj = new Textbox(el.text || '', {
          ...common,
          fontSize: el.fontSize || 24,
          fontWeight: el.fontWeight || 'normal',
          fontStyle: el.fontStyle || 'normal',
          underline: el.underline || false,
          linethrough: el.linethrough || false,
          textAlign: el.textAlign || 'left',
          lineHeight: el.lineHeight || 1.3,
          charSpacing: el.charSpacing || 0,
          fontFamily: el.fontFamily || 'Inter, system-ui, sans-serif',
          padding: el.padding || 0,
        });
      } else if (el.type === 'rect') {
        obj = new Rect({
          ...common,
          rx: el.rx || 0,
          ry: el.ry || 0,
          stroke: el.stroke || '',
          strokeWidth: el.strokeWidth || 0,
          strokeDashArray: el.strokeDashArray || undefined,
          shadow: el.shadow || undefined,
        });
      } else if (el.type === 'circle') {
        obj = new Circle({
          ...common,
          radius: el.radius || 50,
          stroke: el.stroke || '',
          strokeWidth: el.strokeWidth || 0,
          strokeDashArray: el.strokeDashArray || undefined,
          shadow: el.shadow || undefined,
        });
      } else if (el.type === 'triangle') {
        obj = new Triangle({
          ...common,
          stroke: el.stroke || '',
          strokeWidth: el.strokeWidth || 0,
          strokeDashArray: el.strokeDashArray || undefined,
          shadow: el.shadow || undefined,
        });
      } else if (el.type === 'ellipse') {
        obj = new fabricModule.Ellipse({
          ...common,
          rx: el.rx || 50,
          ry: el.ry || 30,
          stroke: el.stroke || '',
          strokeWidth: el.strokeWidth || 0,
          strokeDashArray: el.strokeDashArray || undefined,
          shadow: el.shadow || undefined,
        });
      } else if (el.type === 'shape' && el.shapeType) {
        obj = createFabricShape(fabricModule, el.shapeType, {
          left: el.left || 0,
          top: el.top || 0,
          width: el.width || 120,
          height: el.height || 80,
          fill: el.fill || '#e2e8f0',
          stroke: el.stroke || '#94a3b8',
          strokeWidth: el.strokeWidth || 1,
        });
        if (obj) {
          obj.set({
            angle: el.angle || 0,
            scaleX: el.scaleX || 1,
            scaleY: el.scaleY || 1,
            opacity: el.opacity ?? 1,
            strokeDashArray: el.strokeDashArray || undefined,
          });
          if (el.shadow) obj.set('shadow', el.shadow);
        }
      } else if (el.type === 'image' && el.src) {
        // FIX 2: Use saved scaleX/scaleY directly instead of recalculating
        pendingImages++;

        // For embedded diagrams, regenerate SVG from diagram data (blob URLs die on refresh)
        const diagramMatch = typeof el.src === 'string' && el.src.match(/^diagram:(.+)$/);
        const loadImage = async () => {
          let imgSrc = el.src;
          let diagramId: string | null = null;
          if (diagramMatch) {
            diagramId = diagramMatch[1];
            try {
              const res = await fetch(`/api/gateway/diagrams/${diagramId}`, { headers: gw.gwAuthHeaders() });
              if (res.ok) {
                const data = await res.json();
                const cells = data.data?.cells || data.data?.nodes || [];
                const svgStr = renderCellsToSVG(cells);
                const blob = new Blob([svgStr], { type: 'image/svg+xml' });
                imgSrc = URL.createObjectURL(blob);
              }
            } catch {}
          }
          const imgEl2 = new window.Image();
          imgEl2.crossOrigin = 'anonymous';
          imgEl2.onload = () => {
            if (loadGenerationRef.current !== generation) {
              pendingImages--;
              if (pendingImages === 0) isLoadingSlideRef.current = false;
              return;
            }
            const fabricImg = new FabricImage(imgEl2, {
              left: el.left || 0,
              top: el.top || 0,
              scaleX: el.scaleX || ((el.displayWidth || el.width || 200) / imgEl2.width),
              scaleY: el.scaleY || ((el.displayHeight || el.height || 200) / imgEl2.height),
              angle: el.angle || 0,
              opacity: el.opacity ?? 1,
            });
            if (el.borderRadius && el.borderRadius > 0 && fabricModule.Rect) {
              fabricImg.clipPath = new fabricModule.Rect({
                width: imgEl2.width,
                height: imgEl2.height,
                rx: el.borderRadius / (el.scaleX || 1),
                ry: el.borderRadius / (el.scaleY || 1),
                originX: 'center',
                originY: 'center',
              });
            }
            if (el.stroke) {
              fabricImg.set('stroke', el.stroke);
              fabricImg.set('strokeWidth', el.strokeWidth || 0);
            }
            if (diagramId) {
              (fabricImg as any).__diagramId = diagramId;
            } else if (el.__diagramId) {
              (fabricImg as any).__diagramId = (el.__diagramId as string).replace(/^diagram:/, '');
            }
            canvas.add(fabricImg);
            canvas.renderAll();
            if (diagramMatch && imgSrc.startsWith('blob:')) {
              URL.revokeObjectURL(imgSrc);
            }
            pendingImages--;
            if (pendingImages === 0) {
              isLoadingSlideRef.current = false;
            }
          };
          imgEl2.onerror = () => {
            if (loadGenerationRef.current !== generation) {
              pendingImages--;
              if (pendingImages === 0) isLoadingSlideRef.current = false;
              return;
            }
            pendingImages--;
            if (pendingImages === 0) {
              isLoadingSlideRef.current = false;
            }
          };
          imgEl2.src = imgSrc;
        };
        loadImage();
        continue;
      } else if (el.type === 'table') {
        // Recreate table placeholder rect
        const { Rect: RectCls } = fabricModule;
        obj = new RectCls({
          ...common,
          width: el.width || 360,
          height: el.height || 108,
          fill: 'transparent',
          stroke: 'transparent',
          strokeWidth: 0,
        });
        (obj as any).__tableJSON = el.tableJSON || null;
        (obj as any).__isTable = true;
      }

      if (obj) {
        canvas.add(obj);
      }
    }

    canvas.renderAll();
    if (pendingImages === 0) {
      isLoadingSlideRef.current = false;
    }
  }, []);

  // Keep a ref to slides so loadSlideToCanvas effect doesn't depend on slides state
  const slidesRef = useRef<SlideData[]>(slides);
  slidesRef.current = slides;

  // Load current slide when index changes
  useEffect(() => {
    if (slidesRef.current.length > 0 && canvasRef.current) {
      loadSlideToCanvas(slidesRef.current[currentSlideIndex] || DEFAULT_SLIDE);
    }
  }, [currentSlideIndex, loadSlideToCanvas, slides.length]);

  // ─── Save canvas state back to slides ─────────────
  const serializeCanvas = useCallback((): SlideData | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    // FIX 4: Refuse to serialize during loading
    if (isLoadingSlideRef.current) return null;

    const elements: any[] = [];
    const objects = canvas.getObjects();

    for (const obj of objects) {
      const base: any = {
        left: Math.round(obj.left || 0),
        top: Math.round(obj.top || 0),
        width: Math.round(obj.width || 0),
        height: Math.round(obj.height || 0),
        fill: obj.fill || '#333333',
        angle: obj.angle || 0,
        scaleX: obj.scaleX || 1,
        scaleY: obj.scaleY || 1,
        opacity: obj.opacity ?? 1,
      };

      const objType = getObjType(obj);

      if (objType === 'textbox') {
        elements.push({
          ...base,
          type: 'textbox',
          text: obj.text || '',
          fontSize: obj.fontSize || 24,
          fontWeight: obj.fontWeight || 'normal',
          fontStyle: obj.fontStyle || 'normal',
          underline: obj.underline || false,
          linethrough: obj.linethrough || false,
          textAlign: obj.textAlign || 'left',
          lineHeight: obj.lineHeight || 1.3,
          charSpacing: obj.charSpacing || 0,
          fontFamily: obj.fontFamily || 'Inter, system-ui, sans-serif',
          padding: obj.padding || 0,
        });
      } else if (objType === 'rect') {
        elements.push({
          ...base,
          type: 'rect',
          rx: obj.rx || 0,
          ry: obj.ry || 0,
          stroke: obj.stroke || '',
          strokeWidth: obj.strokeWidth || 0,
          strokeDashArray: obj.strokeDashArray || undefined,
          shadow: obj.shadow ? { color: obj.shadow.color, blur: obj.shadow.blur, offsetX: obj.shadow.offsetX, offsetY: obj.shadow.offsetY } : undefined,
        });
      } else if (objType === 'circle') {
        elements.push({
          ...base,
          type: 'circle',
          radius: obj.radius || 50,
          stroke: obj.stroke || '',
          strokeWidth: obj.strokeWidth || 0,
          strokeDashArray: obj.strokeDashArray || undefined,
          shadow: obj.shadow ? { color: obj.shadow.color, blur: obj.shadow.blur, offsetX: obj.shadow.offsetX, offsetY: obj.shadow.offsetY } : undefined,
        });
      } else if (objType === 'triangle') {
        elements.push({
          ...base,
          type: 'triangle',
          stroke: obj.stroke || '',
          strokeWidth: obj.strokeWidth || 0,
          strokeDashArray: obj.strokeDashArray || undefined,
          shadow: obj.shadow ? { color: obj.shadow.color, blur: obj.shadow.blur, offsetX: obj.shadow.offsetX, offsetY: obj.shadow.offsetY } : undefined,
        });
      } else if (objType === 'image') {
        // FIX 2: Save actual scaleX/scaleY from Fabric object, plus natural dimensions
        const imgData: any = {
          ...base,
          type: 'image',
          src: obj.getSrc?.() || '',
          // Save native image dimensions
          width: obj.width || 0,
          height: obj.height || 0,
          scaleX: obj.scaleX || 1,
          scaleY: obj.scaleY || 1,
          stroke: obj.stroke || '',
          strokeWidth: obj.strokeWidth || 0,
          borderRadius: obj.clipPath?.rx ? Math.round(obj.clipPath.rx * (obj.scaleX || 1)) : 0,
        };
        // Preserve diagram metadata for embedded diagrams
        if ((obj as any).__diagramId) {
          imgData.__diagramId = (obj as any).__diagramId;
          // Save a stable marker instead of blob URL (blob URLs die on page refresh)
          imgData.src = `diagram:${(obj as any).__diagramId}`;
        }
        elements.push(imgData);
      } else if (objType === 'ellipse') {
        elements.push({
          ...base,
          type: 'ellipse',
          rx: obj.rx || 50,
          ry: obj.ry || 30,
          stroke: obj.stroke || '',
          strokeWidth: obj.strokeWidth || 0,
          strokeDashArray: obj.strokeDashArray || undefined,
          shadow: obj.shadow ? { color: obj.shadow.color, blur: obj.shadow.blur, offsetX: obj.shadow.offsetX, offsetY: obj.shadow.offsetY } : undefined,
        });
      } else if (objType === 'shape') {
        // ShapeSet path-based shapes (diamond, star, hexagon, etc.)
        elements.push({
          ...base,
          type: 'shape',
          shapeType: (obj as any).__shapeType,
          stroke: obj.stroke || '',
          strokeWidth: obj.strokeWidth || 0,
          strokeDashArray: obj.strokeDashArray || undefined,
          shadow: obj.shadow ? { color: obj.shadow.color, blur: obj.shadow.blur, offsetX: obj.shadow.offsetX, offsetY: obj.shadow.offsetY } : undefined,
        });
      } else if (objType === 'table') {
        elements.push({
          ...base,
          type: 'table',
          tableJSON: obj.__tableJSON || null,
        });
      }
    }

    return {
      id: slides[currentSlideIndex]?.id || generateSlideId(),
      elements,
      background: canvas.backgroundColor || '#ffffff',
      backgroundImage: slides[currentSlideIndex]?.backgroundImage || undefined,
      notes: slides[currentSlideIndex]?.notes || '',
      thumbnail: slides[currentSlideIndex]?.thumbnail,
    };
  }, [currentSlideIndex, slides]);

  // ─── Thumbnail generation ──────────────────────
  const thumbnailInFlightRef = useRef(false);

  const generateAndUploadThumbnail = useCallback(async (slideIndex: number) => {
    const canvas = canvasRef.current;
    if (!canvas || thumbnailInFlightRef.current) return;
    thumbnailInFlightRef.current = true;
    try {
      const dataUrl: string = canvas.toDataURL({ format: 'png', multiplier: 0.5 });
      const fetchRes = await fetch(dataUrl);
      const blob = await fetchRes.blob();
      const url = await gw.uploadSlideThumbnail(blob, `slide-${slideIndex}-thumb.png`);
      // url from gateway is relative like /api/uploads/thumbnails/xxx.png
      // make it go through the Next.js proxy
      const proxyUrl = `/api/gateway/uploads/thumbnails/${url.split('/').pop()}`;
      setSlides(prev => {
        const updated = [...prev];
        if (updated[slideIndex]) {
          updated[slideIndex] = { ...updated[slideIndex], thumbnail: proxyUrl };
        }
        return updated;
      });
      dirtyRef.current = true;
      setReliabilityStatus(prev => prev === 'flush_failed' ? prev : 'dirty');
      scheduleSave();
    } catch (e) {
      console.warn('[slides] Thumbnail upload failed:', e);
    } finally {
      thumbnailInFlightRef.current = false;
    }
  }, [scheduleSave]);

  const saveCurrentSlideToState = useCallback(() => {
    const serialized = serializeCanvas();
    if (!serialized) return;
    setSlides(prev => {
      const updated = [...prev];
      updated[currentSlideIndex] = serialized;
      return updated;
    });
    dirtyRef.current = true;
    setReliabilityStatus(prev => prev === 'flush_failed' ? prev : 'dirty');
    scheduleSave();
  }, [currentSlideIndex, serializeCanvas, scheduleSave]);

  saveCurrentSlideToStateRef.current = saveCurrentSlideToState;

  // ─── Save on unmount — prevent data loss when navigating away ──
  const serializeCanvasRef = useRef(serializeCanvas);
  serializeCanvasRef.current = serializeCanvas;
  const currentSlideIndexRef = useRef(currentSlideIndex);
  currentSlideIndexRef.current = currentSlideIndex;

  useEffect(() => {
    return () => {
      // Flush any pending debounced canvas→state sync
      if (modifiedDebounceRef.current) clearTimeout(modifiedDebounceRef.current);
      // Flush pending save timer
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      // Final save with latest canvas state
      if (dirtyRef.current) {
        try {
          const latestSlides = getLatestSlidesRef.current();
          gw.savePresentation(presentationId, { slides: latestSlides }).catch(() => {});
          queryClient.invalidateQueries({ queryKey: ['presentation', presentationId] });
        } catch {}
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presentationId]);

  // ─── beforeunload + visibilitychange ─────────────
  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.hidden && dirtyRef.current) {
        saveRef.current();
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (dirtyRef.current || reliabilityStatusRef.current === 'flush_failed') {
        e.preventDefault();
        e.returnValue = '';
      }
      if (!dirtyRef.current) return;
      try {
        const latestSlides = getLatestSlidesRef.current();
        const payload = JSON.stringify({ data: { slides: latestSlides } });
        fetch(`/api/gateway/presentations/${presentationId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', ...gw.gwAuthHeaders() },
          body: payload,
          keepalive: true,
        }).catch(() => {});
      } catch {}
    };
    window.addEventListener('beforeunload', onBeforeUnload);

    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  }, [presentationId]);

  // ─── Slide Operations ─────────────────────────────
  const addSlide = useCallback(() => {
    saveCurrentSlideToState();
    const currentBg = slidesRef.current[currentSlideIndexRef.current];
    setSlides(prev => [...prev, {
      ...DEFAULT_SLIDE,
      id: generateSlideId(),
      background: currentBg?.background || '#ffffff',
      backgroundImage: currentBg?.backgroundImage,
    }]);
    setCurrentSlideIndex(slides.length);
    dirtyRef.current = true;
    setReliabilityStatus(prev => prev === 'flush_failed' ? prev : 'dirty');
    scheduleSave();
  }, [slides.length, saveCurrentSlideToState, scheduleSave]);

  const duplicateSlide = useCallback(() => {
    const serialized = serializeCanvas();
    if (!serialized) return;
    setSlides(prev => {
      const updated = [...prev];
      const dupe = { ...JSON.parse(JSON.stringify(serialized)), id: generateSlideId() };
      updated.splice(currentSlideIndex + 1, 0, dupe);
      return updated;
    });
    setCurrentSlideIndex(currentSlideIndex + 1);
    dirtyRef.current = true;
    setReliabilityStatus(prev => prev === 'flush_failed' ? prev : 'dirty');
    scheduleSave();
  }, [currentSlideIndex, serializeCanvas, scheduleSave]);

  const deleteSlide = useCallback(() => {
    if (slides.length <= 1) return;
    setSlides(prev => prev.filter((_, i) => i !== currentSlideIndex));
    setCurrentSlideIndex(Math.min(currentSlideIndex, slides.length - 2));
    dirtyRef.current = true;
    setReliabilityStatus(prev => prev === 'flush_failed' ? prev : 'dirty');
    scheduleSave();
  }, [currentSlideIndex, slides.length, scheduleSave]);

  const moveSlide = useCallback((dir: -1 | 1) => {
    const newIdx = currentSlideIndex + dir;
    if (newIdx < 0 || newIdx >= slides.length) return;
    saveCurrentSlideToState();
    setSlides(prev => {
      const updated = [...prev];
      [updated[currentSlideIndex], updated[newIdx]] = [updated[newIdx], updated[currentSlideIndex]];
      return updated;
    });
    setCurrentSlideIndex(newIdx);
    dirtyRef.current = true;
    setReliabilityStatus(prev => prev === 'flush_failed' ? prev : 'dirty');
    scheduleSave();
  }, [currentSlideIndex, slides.length, saveCurrentSlideToState, scheduleSave]);

  // ─── Canvas Tool Actions ──────────────────────────
  const addTextbox = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !fabricModule) return;
    const { Textbox } = fabricModule;
    const text = new Textbox('Click to edit', {
      left: 100,
      top: 100,
      width: 300,
      fontSize: 24,
      fontFamily: 'Inter, system-ui, sans-serif',
      fill: '#1a1a1a',
    });
    canvas.fire('before:modified');
    canvas.add(text);
    canvas.setActiveObject(text);
    canvas.renderAll();
    setSelectedTool('select');
  }, []);

  const addShape = useCallback((shapeType: ShapeType) => {
    const canvas = canvasRef.current;
    if (!canvas || !fabricModule) return;

    const obj = createFabricShape(fabricModule, shapeType, {
      left: 100, top: 100,
      fill: '#e2e8f0', stroke: '#94a3b8', strokeWidth: 1,
    });
    if (!obj) return;

    canvas.fire('before:modified');
    canvas.add(obj);
    canvas.setActiveObject(obj);
    canvas.renderAll();
    setSelectedTool('select');
  }, [fabricModule]);

  // FIX 3: Upload images to server instead of base64
  const addImage = useCallback(() => {
    pickFile({ accept: 'image/*' }).then(async (files) => {
      const file = files[0];
      if (!file) return;

      const canvas = canvasRef.current;
      if (!canvas || !fabricModule) return;
      const { FabricImage } = fabricModule;

      let imgSrc: string;

      try {
        // Upload to gateway
        const formData = new FormData();
        formData.append('file', file);
        const resp = await fetch('/api/gateway/uploads', {
          method: 'POST',
          headers: gw.gwAuthHeaders(),
          body: formData,
        });
        if (!resp.ok) throw new Error('Upload failed');
        const data = await resp.json();
        // Prefix with gateway base URL for full URL
        imgSrc = data.url?.startsWith('http') ? data.url : `/api/gateway${data.url?.replace(/^\/api/, '')}`;
      } catch (err) {
        showError(t('errors.imageUploadFallback'), err);
        // Fallback to base64 if upload fails
        imgSrc = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.readAsDataURL(file);
        });
      }

      const imgEl = new window.Image();
      imgEl.crossOrigin = 'anonymous';
      imgEl.onload = () => {
        const scale = Math.min(600 / imgEl.width, 400 / imgEl.height, 1);
        const fabricImg = new FabricImage(imgEl, {
          left: 80,
          top: 80,
          scaleX: scale,
          scaleY: scale,
        });
        canvas.fire('before:modified');
        canvas.add(fabricImg);
        canvas.setActiveObject(fabricImg);
        canvas.renderAll();
      };
      imgEl.src = imgSrc;
    });
  }, []);

  // ─── Table insertion ─────────────────────────────────
  const addTable = useCallback((rows = 3, cols = 3) => {
    const canvas = canvasRef.current;
    if (!canvas || !fabricModule) return;
    const { Rect, Textbox, Group } = fabricModule;

    const cellW = 120;
    const cellH = 36;
    const tableW = cellW * cols;
    const tableH = cellH * rows;

    // Create a placeholder rect for the table on canvas
    const tableBg = new Rect({
      left: 80,
      top: 80,
      width: tableW,
      height: tableH,
      fill: 'transparent',
      stroke: 'transparent',
      strokeWidth: 0,
    });

    // Store table data as ProseMirror JSON — colwidth null, CSS handles equal distribution
    const headerCells = Array.from({ length: cols }, () => ({
      type: 'table_header',
      attrs: { colspan: 1, rowspan: 1, alignment: null, colwidth: null, background: null },
      content: [{ type: 'paragraph' }],
    }));
    const bodyRow = () => ({
      type: 'table_row',
      content: Array.from({ length: cols }, () => ({
        type: 'table_cell',
        attrs: { colspan: 1, rowspan: 1, alignment: null, colwidth: null, background: null },
        content: [{ type: 'paragraph' }],
      })),
    });
    const tableJSON = {
      type: 'doc',
      content: [{ type: 'table', content: [
        { type: 'table_row', content: headerCells },
        ...Array.from({ length: rows - 1 }, bodyRow),
      ]}],
    };
    (tableBg as any).__tableJSON = tableJSON;
    (tableBg as any).__isTable = true;

    canvas.fire('before:modified');
    canvas.add(tableBg);
    canvas.setActiveObject(tableBg);
    canvas.renderAll();
    setSelectedTool('select');
  }, []);

  // ─── Diagram insertion ─────────────────────────────
  const insertDiagram = useCallback(() => {
    setDiagramPicker(true);
  }, []);

  const handleDiagramPickerSelect = useCallback(async (diagramId: string, item: any) => {
    setDiagramPicker(false);
    const canvas = canvasRef.current;
    if (!canvas || !fabricModule) return;

    try {
      // item.id is prefixed (e.g. "diagram:uuid"), API expects raw UUID
      const rawId = item.raw_id || diagramId.replace(/^diagram:/, '');
      const res = await fetch(`/api/gateway/diagrams/${rawId}`, { headers: gw.gwAuthHeaders() });
      if (!res.ok) throw new Error('Failed to load diagram');
      const data = await res.json();
      const cells = data.data?.cells || data.data?.nodes || [];

      const svgStr = renderCellsToSVG(cells);
      const blob = new Blob([svgStr], { type: 'image/svg+xml' });
      const url = URL.createObjectURL(blob);

      const { FabricImage } = fabricModule;
      const imgEl = new window.Image();
      imgEl.onload = () => {
        // Default size: 70% of PPT canvas, centered
        const targetW = SLIDE_WIDTH * 0.7;
        const targetH = SLIDE_HEIGHT * 0.7;
        const scale = Math.min(targetW / (imgEl.width || targetW), targetH / (imgEl.height || targetH));
        const fabricImg = new FabricImage(imgEl, {
          left: (SLIDE_WIDTH - imgEl.width * scale) / 2,
          top: (SLIDE_HEIGHT - imgEl.height * scale) / 2,
          scaleX: scale,
          scaleY: scale,
        });
        (fabricImg as any).__diagramId = rawId;
        canvas.fire('before:modified');
        canvas.add(fabricImg);
        canvas.setActiveObject(fabricImg);
        canvas.renderAll();
        URL.revokeObjectURL(url);
      };
      imgEl.onerror = () => {
        showError(t('errors.loadDiagramPreviewFailed'));
        URL.revokeObjectURL(url);
      };
      imgEl.src = url;
    } catch (err) {
      showError(t('errors.insertDiagramFailed'), err);
    }
  }, [fabricModule]);

  // Dialog close just clears state — the diagram-updated event listener handles preview refresh
  const handleDiagramEditorClose = useCallback(() => {
    setEditingDiagramId(null);
  }, []);

  // Listen for diagram-updated events (from dialog close or external edits)
  // to refresh diagram preview images on the canvas
  useEffect(() => {
    const handler = async (e: Event) => {
      const { diagramId } = (e as CustomEvent).detail || {};
      if (!diagramId) return;
      const canvas = canvasRef.current;
      if (!canvas || !fabricModule) return;

      const rawId = diagramId.replace(/^diagram:/, '');
      try {
        const res = await fetch(`/api/gateway/diagrams/${rawId}`, { headers: gw.gwAuthHeaders() });
        if (!res.ok) return;
        const data = await res.json();
        const cells = data.data?.cells || data.data?.nodes || [];
        const svgStr = renderCellsToSVG(cells);
        const blob = new Blob([svgStr], { type: 'image/svg+xml' });
        const url = URL.createObjectURL(blob);

        const objects = canvas.getObjects();
        const target = objects.find((o: any) => (o as any).__diagramId === rawId);
        if (target) {
          const imgEl = new window.Image();
          imgEl.onload = () => {
            const { FabricImage } = fabricModule;
            const newImg = new FabricImage(imgEl, {
              left: (target as any).left,
              top: (target as any).top,
              scaleX: (target as any).scaleX,
              scaleY: (target as any).scaleY,
              angle: (target as any).angle,
            });
            (newImg as any).__diagramId = rawId;
            canvas.remove(target);
            canvas.add(newImg);
            canvas.renderAll();
            URL.revokeObjectURL(url);
          };
          imgEl.src = url;
        } else {
          URL.revokeObjectURL(url);
        }
      } catch (err) {
        showError(t('errors.refreshDiagramPreviewFailed'), err);
      }
    };
    window.addEventListener('diagram-updated', handler);
    return () => window.removeEventListener('diagram-updated', handler);
  }, [fabricModule]);

  const deleteSelected = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const active = canvas.getActiveObjects();
    if (active.length > 0) {
      canvas.fire('before:modified');
      active.forEach((obj: any) => canvas.remove(obj));
      canvas.discardActiveObject();
      canvas.renderAll();
    }
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Don't delete canvas objects when focus is in an input/select/textarea (e.g. title editing)
      const tag = (document.activeElement?.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const canvas = canvasRef.current;
        if (canvas && !canvas.isEditing) {
          const active = canvas.getActiveObject();
          if (active && !(active.isEditing)) {
            deleteSelected();
          }
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [deleteSelected]);

  useEffect(() => {
    const handler = () => { gw.createContentManualSnapshot(`presentation:${presentationId}`).catch(() => {}); };
    window.addEventListener('save-current', handler);
    return () => window.removeEventListener('save-current', handler);
  }, [presentationId]);

  // Title editing now handled by ContentTopBar

  // ─── Delete Presentation ──────────────────────────
  const handleDelete = useCallback(async () => {
    await gw.deleteContentItem(`presentation:${presentationId}`);
    queryClient.invalidateQueries({ queryKey: ['content-items'] });
    onDeleted?.();
  }, [presentationId, queryClient, onDeleted]);

  // ─── Export PNG ───────────────────────────────────
  const handleDownload = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dataUrl = canvas.toDataURL({ format: 'png', multiplier: 2 });
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = `${currentTitle || 'presentation'}-slide-${currentSlideIndex + 1}.png`;
    a.click();
  }, [currentTitle, currentSlideIndex]);

  // ─── Presenter Mode ───────────────────────────────
  const startPresentation = useCallback(() => {
    saveCurrentSlideToState();
    setIsPresenting(true);
  }, [saveCurrentSlideToState]);

  // ─── Slide background change (for property panel) ──
  const handleSlideBackgroundChange = useCallback((bg: string) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.backgroundColor = bg;
    canvas.renderAll();
    setSlides(prev => {
      const updated = [...prev];
      updated[currentSlideIndex] = { ...updated[currentSlideIndex], background: bg };
      return updated;
    });
    dirtyRef.current = true;
    setReliabilityStatus(prev => prev === 'flush_failed' ? prev : 'dirty');
    scheduleSave();
  }, [currentSlideIndex, scheduleSave]);

  const handleApplyBackgroundToAll = useCallback(() => {
    const bg = slides[currentSlideIndex]?.background || '#ffffff';
    setSlides(prev => prev.map(s => ({ ...s, background: bg })));
    dirtyRef.current = true;
    setReliabilityStatus(prev => prev === 'flush_failed' ? prev : 'dirty');
    scheduleSave();
  }, [currentSlideIndex, slides, scheduleSave]);

  const handleSlideBackgroundImageChange = useCallback((bgImage: string | undefined) => {
    setSlides(prev => {
      const updated = [...prev];
      updated[currentSlideIndex] = { ...updated[currentSlideIndex], backgroundImage: bgImage };
      return updated;
    });
    dirtyRef.current = true;
    setReliabilityStatus(prev => prev === 'flush_failed' ? prev : 'dirty');
    scheduleSave();
  }, [currentSlideIndex, scheduleSave]);

  // ─── Presenter Mode ──────────────────────────────
  if (isPresenting) {
    return (
      <PresenterMode
        slides={slides}
        startIndex={currentSlideIndex}
        onExit={() => setIsPresenting(false)}
        loadSlideToCanvas={loadSlideToCanvas}
      />
    );
  }

  // ─── Loading / Not Found ──────────────────────────
  if (isLoading || !ready) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground">
        <div className="text-sm">{t('common.loading')}</div>
      </div>
    );
  }

  if (!presentation) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground">
        <div className="text-sm">{t('content.presentationNotFound')}</div>
      </div>
    );
  }

  // ─── Mobile Vertical Preview Mode (no editing) ────────────────
  if (isMobileView) {
    const previewSlides = slides.map((slide, i) => ({
      id: slide.id || String(i),
      data: slide,
      thumbnail: slide.thumbnail,
    }));

    return (
      <div ref={containerRef} className="flex-1 flex flex-col min-h-0 bg-card">
        {/* Header */}
        <div className="flex items-center border-b border-border shrink-0 shadow-[0px_0px_20px_0px_rgba(0,0,0,0.02)]">
          <ContentTopBar
            breadcrumb={breadcrumb}
            onNavigate={onNavigate}
            onBack={onBack}
            docListVisible={docListVisible}
            onToggleDocList={onToggleDocList}
            title={currentTitle || t('content.untitledPresentation')}
            titlePlaceholder={t('content.untitledPresentation')}
            onTitleChange={async (newTitle) => {
              if (newTitle !== currentTitle) {
                await gw.updateContentItem(`presentation:${presentationId}`, { title: newTitle });
                queryClient.invalidateQueries({ queryKey: ['content-items'] });
              }
            }}
            statusText={
              reliabilityStatus === 'flushing' ? t('content.saving') :
              reliabilityStatus === 'dirty' ? t('content.unsaved') :
              reliabilityStatus === 'flush_failed' ? t('content.saveFailed') :
              lastSaved ? t('content.saved') :
              undefined
            }
            statusError={reliabilityStatus === 'flush_failed'}
            onRetry={reliabilityStatus === 'flush_failed' ? () => save(0) : undefined}
            onUndo={pptUndo}
            onRedo={pptRedo}
            canUndo={undoStackRef.current.length > 0}
            canRedo={redoStackRef.current.length > 0}
            metaLine={
              <button
                onClick={() => { setShowHistory(true); onCloseComments(); }}
                className="text-xs text-muted-foreground/50 hover:text-muted-foreground transition-colors cursor-pointer"
              >
                {t('content.lastModified')}: {formatRelativeTime(presentation.updated_at)}
                {presentation.updated_by && <span> {t('content.by')} {presentation.updated_by}</span>}
              </button>
            }
            onHistory={() => { setShowHistory(true); onCloseComments(); }}
            onComments={() => { onToggleComments(); setShowHistory(false); }}
            menuItems={[
              ...buildContentTopBarCommonMenuItems(t, {
                id: presentationId,
                type: 'presentation',
                title: currentTitle || '',
                pinned: isPinned ?? false,
                url: '',
                startRename: () => {},
                openIconPicker: () => {},
                togglePin: () => onTogglePin?.(),
                deleteItem: handleDelete,
                downloadItem: () => handleDownload(),
                shareItem: () => {},
                copyLink: () => onCopyLink?.(),
                showHistory: () => { setShowHistory(true); onCloseComments(); },
                showComments: () => { onShowComments(); setShowHistory(false); },
              }),
              { icon: Play, label: t('toolbar.present'), onClick: () => startPresentation() },
            ]}
          />
        </div>
        {/* Vertical scroll preview */}
        <SlidePreviewList
          slides={previewSlides}
          currentSlideIndex={currentSlideIndex}
          onSlideSelect={(i) => {
            if (i !== currentSlideIndex) {
              saveCurrentSlideToState();
              generateAndUploadThumbnail(currentSlideIndex);
            }
            setCurrentSlideIndex(i);
          }}
        />
        {/* Bottom comment bar — no edit FAB for PPT on mobile */}
        <MobileCommentBar
          onClick={() => { onShowComments(); setShowHistory(false); }}
        />
        {/* Mobile: Comments BottomSheet */}
        {showComments && !showHistory && (
          <BottomSheet open={true} onClose={() => onCloseComments()} initialHeight="full">
            <CommentPanel
              targetType="presentation"
              targetId={`presentation:${presentationId}`}
              anchorType={commentAnchor?.type}
              anchorId={commentAnchor?.id}
              anchorMeta={commentAnchor?.meta}
              onClose={() => onCloseComments()}
              focusCommentId={focusCommentId}
              onAnchorUsed={() => setCommentAnchor(null)}
              onNavigateToAnchor={navigateToAnchor}
              autoFocus
            />
          </BottomSheet>
        )}
        {/* Mobile: History BottomSheet */}
        {showHistory && (
          <BottomSheet open={true} onClose={() => setShowHistory(false)} title={t('content.versionHistory')} initialHeight="full">
            <RevisionHistory
              contentType="presentation"
              contentId={`presentation:${presentationId}`}
              onClose={() => { setShowHistory(false); setPreviewRevisionData(null); }}
              onCreateManualVersion={async () => { await flushSave(); await gw.createContentManualSnapshot(`presentation:${presentationId}`); }}
              onSelectRevision={(rev) => { setPreviewRevisionData(rev?.data ?? null); setPreviewRevisionMeta(rev ? { id: rev.id, created_at: rev.created_at } : null); }}
              onRestore={async (data) => {
                setPreviewRevisionData(null);
                if (data?.slides) {
                  setSlides(data.slides);
                  setCurrentSlideIndex(0);
                  dirtyRef.current = true;
                  await save(0);
                  queryClient.invalidateQueries({ queryKey: ['presentation', presentationId] });
                }
              }}
            />
          </BottomSheet>
        )}
      </div>
    );
  }

  return (
    <div ref={containerRef} className="flex-1 flex flex-row min-h-0">
      {/* Left column: TopBar + Toolbar + main area — card style */}
      <div className="flex-1 flex flex-col min-h-0 min-w-0 bg-card md:rounded-lg md:shadow-[0px_0px_20px_0px_rgba(0,0,0,0.08)] md:overflow-hidden relative z-[1]">
      {/* ─── Header Bar ─── */}
      <div className="flex items-center border-b border-border shrink-0 shadow-[0px_0px_20px_0px_rgba(0,0,0,0.02)]">
        <ContentTopBar
          breadcrumb={breadcrumb}
          onNavigate={onNavigate}
          onBack={isMobileView && mobileEditMode ? () => setMobileEditMode(false) : onBack}
          docListVisible={docListVisible}
          onToggleDocList={onToggleDocList}
          title={currentTitle || t('content.untitledPresentation')}
          titlePlaceholder={t('content.untitledPresentation')}
          onTitleChange={async (newTitle) => {
            if (newTitle !== currentTitle) {
              await gw.updateContentItem(`presentation:${presentationId}`, { title: newTitle });
              queryClient.invalidateQueries({ queryKey: ['content-items'] });
            }
          }}
          statusText={
            reliabilityStatus === 'flushing' ? t('content.saving') :
            reliabilityStatus === 'dirty' ? t('content.unsaved') :
            reliabilityStatus === 'flush_failed' ? t('content.saveFailed') :
            lastSaved ? t('content.saved') :
            undefined
          }
          statusError={reliabilityStatus === 'flush_failed'}
          onRetry={reliabilityStatus === 'flush_failed' ? () => save(0) : undefined}
          onUndo={pptUndo}
          onRedo={pptRedo}
          canUndo={undoStackRef.current.length > 0}
          canRedo={redoStackRef.current.length > 0}
          metaLine={
            <button
              onClick={() => { setShowHistory(true); onCloseComments(); }}
              className="text-xs text-muted-foreground/50 hover:text-muted-foreground transition-colors cursor-pointer"
            >
              {t('content.lastModified')}: {formatRelativeTime(presentation.updated_at)}
              {presentation.updated_by && <span> {t('content.by')} {presentation.updated_by}</span>}
            </button>
          }
          onHistory={() => { setShowHistory(true); onCloseComments(); }}
          onComments={() => { onToggleComments(); setShowHistory(false); }}
          menuItems={[
            ...buildContentTopBarCommonMenuItems(t, {
              id: presentationId,
              type: 'presentation',
              title: currentTitle || '',
              pinned: isPinned ?? false,
              url: '',
              startRename: () => {},
              openIconPicker: () => {},
              togglePin: () => onTogglePin?.(),
              deleteItem: handleDelete,
              downloadItem: () => handleDownload(),
              shareItem: () => {},
              copyLink: () => onCopyLink?.(),
              showHistory: () => { setShowHistory(true); onCloseComments(); },
              showComments: () => { onShowComments(); setShowHistory(false); },
            }),
            { icon: Play, label: t('toolbar.present'), onClick: () => startPresentation() },
          ]}
          actions={renderFixedTopBarActions(
            buildFixedTopBarActionItems(t, {
              id: presentationId,
              type: 'slides',
              title: presentation?.title || t('content.presentation'),
              pinned: isPinned ?? false,
              url: typeof window !== 'undefined' ? window.location.href : '',
              startRename: () => {},
              openIconPicker: () => {},
              togglePin: () => onTogglePin?.(),
              deleteItem: handleDelete,
              shareItem: () => {},
              copyLink: onCopyLink,
              showHistory: () => { setShowHistory(v => !v); onCloseComments(); },
              showComments: () => { onToggleComments(); setShowHistory(false); },
              showHistoryActive: showHistory,
              showCommentsActive: showComments,
              present: startPresentation,
            }),
            { t, ctx: { showHistoryActive: showHistory, showCommentsActive: showComments, present: startPresentation } as any, includePresent: true }
          )}
        />
      </div>

      {/* ─── Main Area: Slide List + Canvas + Property Panel ── */}
      <div className="flex-1 flex min-h-0">
        {/* Slide List (left) — hidden on mobile */}
        <SlidePanel
          slides={slides}
          currentSlideIndex={currentSlideIndex}
          selectedIndices={selectedSlideIndices}
          onSlideSelect={(i) => {
            if (i !== currentSlideIndex) {
              saveCurrentSlideToState();
              generateAndUploadThumbnail(currentSlideIndex);
            }
            setCurrentSlideIndex(i);
            setSelectedSlideIndices(new Set([i]));
          }}
          onMultiSelect={setSelectedSlideIndices}
          onAddSlide={addSlide}
          onSlideCut={handleSlideCut}
          onSlideCopy={handleSlideCopy}
          onSlidePaste={handleSlidePaste}
          onSlideDelete={handleSlideDelete}
          onSlideDuplicate={handleSlideDuplicate}
          onSlideBackground={handleSlideBackground}
          onSlideComment={(i: number) => handleSlideComment('slide', null)}
          onSlideDragEnd={handleSlideDragEnd}
        />

        {/* Version Preview Overlay */}
        {previewRevisionData && (
          <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
            <RevisionPreviewBanner
              createdAt={previewRevisionMeta?.created_at || new Date().toISOString()}
              onExit={() => { setPreviewRevisionData(null); setPreviewRevisionMeta(null); }}
              onRestore={previewRevisionMeta ? async () => {
                if (!confirm(t('content.restoreVersionWarning', { type: t('content.typePresentation') }))) return;
                try {
                  const result = await gw.restoreContentRevision(`presentation:${presentationId}`, previewRevisionMeta.id);
                  setPreviewRevisionData(null);
                  setPreviewRevisionMeta(null);
                  setShowHistory(false);
                  // Refresh slides in-place instead of full page reload
                  if (result.data?.slides) {
                    setSlides(result.data.slides);
                    setCurrentSlideIndex(0);
                  }
                  queryClient.invalidateQueries({ queryKey: ['presentation', presentationId] });
                } catch (e: unknown) {
                  alert(e instanceof Error ? e.message : t('content.restoreVersionFailed'));
                }
              } : undefined}
            />
            <div className="flex-1 overflow-auto p-6 bg-muted/30">
              {previewRevisionData?.slides ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-4xl mx-auto">
                  {previewRevisionData.slides.map((slide: any, i: number) => (
                    <div key={i} className="rounded-lg border border-border shadow-sm overflow-hidden">
                      <div className="px-3 py-2 border-b border-border bg-muted/30">
                        <span className="text-xs font-medium">{t('content.slideN', { n: i + 1 })}</span>
                      </div>
                      <div
                        className="relative w-full overflow-hidden bg-white"
                        style={{ aspectRatio: `${SLIDE_WIDTH} / ${SLIDE_HEIGHT}` }}
                      >
                        {slide.thumbnail ? (
                          <img
                            src={slide.thumbnail}
                            alt={t('content.slideN', { n: i + 1 })}
                            className="absolute inset-0 w-full h-full object-contain"
                            draggable={false}
                          />
                        ) : (
                          <div
                            className="absolute inset-0 flex items-center justify-center text-[10px] text-muted-foreground"
                            style={{ backgroundColor: slide.background || '#ffffff' }}
                          >
                            {(slide.elements || []).length} {t('content.objects')}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center text-sm text-muted-foreground py-8">{t('content.noPreviewData')}</div>
              )}
            </div>
          </div>
        )}

        {/* Canvas Area (center) */}
        {!previewRevisionData && <SlideCanvas
          canvasRef={canvasRef}
          canvasHostRef={canvasHostRef}
          canvasContainerRef={canvasContainerRef}
          selectedObj={selectedObj}
          propVersion={propVersion}
          tableObjects={tableObjects}
          showPropertyPanel={showPropertyPanel}
          onTogglePropertyPanel={() => setShowPropertyPanel(v => !v)}
          onAddTextbox={addTextbox}
          onAddShape={addShape}
          onAddImage={addImage}
          onAddTable={() => addTable(3, 3)}
          onInsertDiagram={insertDiagram}
        />}

        {/* Property Panel (right) */}
        {showPropertyPanel && !previewRevisionData && (
          <PropertyPanel
            selectedObj={selectedObj}
            canvas={canvasRef.current}
            currentSlide={slides[currentSlideIndex] || DEFAULT_SLIDE}
            onSlideBackgroundChange={handleSlideBackgroundChange}
            onSlideBackgroundImageChange={handleSlideBackgroundImageChange}
            onApplyBackgroundToAll={handleApplyBackgroundToAll}
            propVersion={propVersion}
            onClose={() => setShowPropertyPanel(false)}
          />
        )}

      </div>
      </div>{/* end left column */}

      {/* Sidebar — full height on desktop, BottomSheet on mobile */}
      {showComments && !showHistory && (
        <>
          <div className="hidden md:flex w-[304px] bg-sidebar flex-col shrink-0 overflow-hidden h-full">
            <CommentPanel
              targetType="presentation"
              targetId={`presentation:${presentationId}`}
              anchorType={commentAnchor?.type}
              anchorId={commentAnchor?.id}
              anchorMeta={commentAnchor?.meta}
              onClose={() => onCloseComments()}
              focusCommentId={focusCommentId}
              onAnchorUsed={() => setCommentAnchor(null)}
              onNavigateToAnchor={navigateToAnchor}
            />
          </div>
          <BottomSheet open={true} onClose={() => onCloseComments()} initialHeight="full">
            <CommentPanel
              targetType="presentation"
              targetId={`presentation:${presentationId}`}
              anchorType={commentAnchor?.type}
              anchorId={commentAnchor?.id}
              anchorMeta={commentAnchor?.meta}
              onClose={() => onCloseComments()}
              focusCommentId={focusCommentId}
              onAnchorUsed={() => setCommentAnchor(null)}
              onNavigateToAnchor={navigateToAnchor}
            />
          </BottomSheet>
        </>
      )}

      {showHistory && (
        <>
          <div className="hidden md:flex w-[304px] bg-sidebar flex-col shrink-0 overflow-hidden h-full">
            <RevisionHistory
              contentType="presentation"
              contentId={`presentation:${presentationId}`}
              onClose={() => { setShowHistory(false); setPreviewRevisionData(null); }}
              onCreateManualVersion={async () => { await flushSave(); await gw.createContentManualSnapshot(`presentation:${presentationId}`); }}
              onSelectRevision={(rev) => { setPreviewRevisionData(rev?.data ?? null); setPreviewRevisionMeta(rev ? { id: rev.id, created_at: rev.created_at } : null); }}
              onRestore={async (data) => {
                setPreviewRevisionData(null);
                if (data?.slides) {
                  setSlides(data.slides);
                  setCurrentSlideIndex(0);
                  dirtyRef.current = true;
                  await save(0);
                  queryClient.invalidateQueries({ queryKey: ['presentation', presentationId] });
                }
              }}
            />
          </div>
          {/* Mobile: RevisionHistory renders its own BottomSheet internally via portal */}
          <div className="contents md:hidden">
            <RevisionHistory
              contentType="presentation"
              contentId={`presentation:${presentationId}`}
              onClose={() => { setShowHistory(false); setPreviewRevisionData(null); }}
              onCreateManualVersion={async () => { await flushSave(); await gw.createContentManualSnapshot(`presentation:${presentationId}`); }}
              onSelectRevision={(rev) => { setPreviewRevisionData(rev?.data ?? null); setPreviewRevisionMeta(rev ? { id: rev.id, created_at: rev.created_at } : null); }}
              onRestore={async (data) => {
                setPreviewRevisionData(null);
                if (data?.slides) {
                  setSlides(data.slides);
                  setCurrentSlideIndex(0);
                  dirtyRef.current = true;
                  await save(0);
                  queryClient.invalidateQueries({ queryKey: ['presentation', presentationId] });
                }
              }}
            />
          </div>
        </>
      )}
      {diagramPicker && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/20">
          <DiagramPicker
            onSelect={handleDiagramPickerSelect}
            onCancel={() => setDiagramPicker(false)}
            embedded
          />
        </div>
      )}
      {editingDiagramId && (
        <DiagramEditorDialog
          diagramId={editingDiagramId}
          onClose={handleDiagramEditorClose}
        />
      )}
    </div>
  );
}

// ─── Property Panel ─────────────────────────────────
function PropertyPanel({
  selectedObj,
  canvas,
  currentSlide,
  onSlideBackgroundChange,
  onSlideBackgroundImageChange,
  onApplyBackgroundToAll,
  propVersion,
  onClose,
}: {
  selectedObj: any;
  canvas: any;
  currentSlide: SlideData;
  onSlideBackgroundChange: (bg: string) => void;
  onSlideBackgroundImageChange: (bgImage: string | undefined) => void;
  onApplyBackgroundToAll: () => void;
  propVersion: number;
  onClose: () => void;
}) {
  const { t } = useT();
  const objType = selectedObj ? getObjType(selectedObj) : null;

  const updateProp = (prop: string, val: any) => {
    if (!selectedObj || !canvas) return;
    selectedObj.set(prop, val);
    canvas.renderAll();
  };

  const updateAndSave = (prop: string, val: any) => {
    updateProp(prop, val);
    // Fire modified event so auto-save picks it up
    canvas?.fire('object:modified', { target: selectedObj });
  };

  // Get visual width/height (accounting for scale)
  const getVisualW = () => selectedObj ? Math.round((selectedObj.width || 0) * (selectedObj.scaleX || 1)) : 0;
  const getVisualH = () => selectedObj ? Math.round((selectedObj.height || 0) * (selectedObj.scaleY || 1)) : 0;

  const setVisualW = (newW: number) => {
    if (!selectedObj || !newW) return;
    const newScaleX = newW / (selectedObj.width || 1);
    updateAndSave('scaleX', newScaleX);
  };

  const setVisualH = (newH: number) => {
    if (!selectedObj || !newH) return;
    const newScaleY = newH / (selectedObj.height || 1);
    updateAndSave('scaleY', newScaleY);
  };

  return (
    <div className="w-[280px] border-l border-border flex flex-col shrink-0 bg-card overflow-y-auto">
      <div className="px-3 py-2 border-b border-border flex items-center justify-between">
        <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
          {selectedObj ? t('ppt.properties.objectPropertiesWithType', { type: objType || t('ppt.properties.objectFallback') }) : t('ppt.properties.slideProperties')}
        </span>
        <button onClick={onClose} className="p-0.5 text-muted-foreground hover:text-foreground transition-colors" title={t('toolbar.closePanel')}>
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="p-3 space-y-4 text-xs">
        {!selectedObj ? (
          /* ─── Slide Properties ─── */
          <SlidePropertiesSection
            currentSlide={currentSlide}
            onBackgroundChange={onSlideBackgroundChange}
            onBackgroundImageChange={onSlideBackgroundImageChange}
            onApplyToAll={onApplyBackgroundToAll}
          />
        ) : (
          <>
            {/* ─── Common Properties ─── */}
            <CommonPropertiesSection
              obj={selectedObj}
              canvas={canvas}
              getVisualW={getVisualW}
              getVisualH={getVisualH}
              setVisualW={setVisualW}
              setVisualH={setVisualH}
              updateAndSave={updateAndSave}
              propVersion={propVersion}
            />

            {/* ─── Type-specific Properties ─── */}
            {objType === 'textbox' && (
              <TextPropertiesSection obj={selectedObj} canvas={canvas} updateAndSave={updateAndSave} propVersion={propVersion} />
            )}
            {(objType === 'rect' || objType === 'circle' || objType === 'triangle') && (
              <ShapePropertiesSection obj={selectedObj} canvas={canvas} updateAndSave={updateAndSave} propVersion={propVersion} />
            )}
            {objType === 'image' && (
              <ImagePropertiesSection obj={selectedObj} canvas={canvas} updateAndSave={updateAndSave} propVersion={propVersion} />
            )}
            {objType === 'table' && (
              <TablePropertiesSection obj={selectedObj} canvas={canvas} propVersion={propVersion} />
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ─── Slide Properties Section ───────────────────────
function SlidePropertiesSection({
  currentSlide,
  onBackgroundChange,
  onBackgroundImageChange,
  onApplyToAll,
}: {
  currentSlide: SlideData;
  onBackgroundChange: (bg: string) => void;
  onBackgroundImageChange: (bgImage: string | undefined) => void;
  onApplyToAll: () => void;
}) {
  const { t } = useT();
  const handleUploadBgImage = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const formData = new FormData();
        formData.append('file', file);
        const resp = await fetch('/api/gateway/uploads', { method: 'POST', body: formData });
        if (!resp.ok) throw new Error('Upload failed');
        const data = await resp.json();
        const url = data.url?.startsWith('http') ? data.url : `/api/gateway${data.url?.replace(/^\/api/, '')}`;
        onBackgroundImageChange(url);
      } catch (err) {
        console.error('Background image upload failed:', err);
      }
    };
    input.click();
  };

  return (
    <>
      <SectionLabel label="Background" />
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <label className="text-muted-foreground w-14 shrink-0">Color</label>
          <ColorPicker
            color={currentSlide.background || '#ffffff'}
            onChange={(c) => onBackgroundChange(c)}
          />
        </div>

        {/* Background Image */}
        <div className="space-y-1.5">
          <label className="text-muted-foreground">Image</label>
          {currentSlide.backgroundImage ? (
            <div className="relative rounded border border-border overflow-hidden" style={{ aspectRatio: '16/9' }}>
              <img src={currentSlide.backgroundImage} alt="Background" className="w-full h-full object-cover" />
              <div className="absolute inset-0 bg-black/0 hover:bg-black/30 transition-colors flex items-center justify-center gap-2 opacity-0 hover:opacity-100">
                <button
                  onClick={handleUploadBgImage}
                  className="px-2 py-1 rounded bg-card/90 text-xs text-foreground hover:bg-card"
                >
                  Replace
                </button>
                <button
                  onClick={() => onBackgroundImageChange(undefined)}
                  className="px-2 py-1 rounded bg-card/90 text-xs text-destructive hover:bg-card"
                >
                  Remove
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={handleUploadBgImage}
              className="w-full py-3 rounded border border-dashed border-border text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors text-xs flex items-center justify-center gap-1.5"
            >
              <ImageIcon className="h-3.5 w-3.5" />
              Upload Background Image
            </button>
          )}
        </div>

        <button
          onClick={onApplyToAll}
          className="w-full py-1.5 rounded border border-border text-muted-foreground hover:text-foreground hover:bg-accent transition-colors text-xs"
        >
          Apply to All Slides
        </button>
      </div>
    </>
  );
}

// ─── Common Properties Section ──────────────────────
function CommonPropertiesSection({
  obj,
  canvas,
  getVisualW,
  getVisualH,
  setVisualW,
  setVisualH,
  updateAndSave,
  propVersion,
}: {
  obj: any;
  canvas: any;
  getVisualW: () => number;
  getVisualH: () => number;
  setVisualW: (w: number) => void;
  setVisualH: (h: number) => void;
  updateAndSave: (prop: string, val: any) => void;
  propVersion: number;
}) {
  const { t } = useT();
  return (
    <>
      <SectionLabel label="Position" />
      <div className="grid grid-cols-2 gap-2">
        <PropInput label="X" value={Math.round(obj.left || 0)} onChange={(v) => updateAndSave('left', v)} />
        <PropInput label="Y" value={Math.round(obj.top || 0)} onChange={(v) => updateAndSave('top', v)} />
      </div>

      <SectionLabel label="Size" />
      <div className="grid grid-cols-2 gap-2">
        <PropInput label="W" value={getVisualW()} onChange={(v) => setVisualW(v)} />
        <PropInput label="H" value={getVisualH()} onChange={(v) => setVisualH(v)} />
      </div>

      <SectionLabel label="Transform" />
      <div className="grid grid-cols-2 gap-2">
        <PropInput label="Angle" value={Math.round(obj.angle || 0)} onChange={(v) => updateAndSave('angle', v)} />
        <div className="flex items-center gap-1">
          <label className="text-muted-foreground w-10 shrink-0">Alpha</label>
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round((obj.opacity ?? 1) * 100)}
            onChange={(e) => updateAndSave('opacity', Number(e.target.value) / 100)}
            className="flex-1 h-1 accent-primary"
          />
          <span className="text-muted-foreground w-7 text-right">{Math.round((obj.opacity ?? 1) * 100)}</span>
        </div>
      </div>

      {/* Layer order */}
      <SectionLabel label="Layer" />
      <div className="flex items-center gap-1">
        <button
          onClick={() => { canvas?.bringObjectToFront(obj); canvas?.renderAll(); canvas?.fire('object:modified', { target: obj }); }}
          className="flex-1 py-1 rounded border border-border text-muted-foreground hover:text-foreground hover:bg-accent transition-colors flex items-center justify-center gap-1"
          title={t('toolbar.bringToFront')}
        >
          <ArrowUpToLine className="h-3 w-3" /> Front
        </button>
        <button
          onClick={() => { canvas?.bringObjectForward(obj); canvas?.renderAll(); canvas?.fire('object:modified', { target: obj }); }}
          className="flex-1 py-1 rounded border border-border text-muted-foreground hover:text-foreground hover:bg-accent transition-colors flex items-center justify-center gap-1"
          title={t('toolbar.bringForward')}
        >
          <MoveUp className="h-3 w-3" />
        </button>
        <button
          onClick={() => { canvas?.sendObjectBackwards(obj); canvas?.renderAll(); canvas?.fire('object:modified', { target: obj }); }}
          className="flex-1 py-1 rounded border border-border text-muted-foreground hover:text-foreground hover:bg-accent transition-colors flex items-center justify-center gap-1"
          title={t('toolbar.sendBackward')}
        >
          <MoveDown className="h-3 w-3" />
        </button>
        <button
          onClick={() => { canvas?.sendObjectToBack(obj); canvas?.renderAll(); canvas?.fire('object:modified', { target: obj }); }}
          className="flex-1 py-1 rounded border border-border text-muted-foreground hover:text-foreground hover:bg-accent transition-colors flex items-center justify-center gap-1"
          title={t('toolbar.sendToBack')}
        >
          <ArrowDownToLine className="h-3 w-3" /> Back
        </button>
      </div>

      {/* Flip */}
      <div className="flex items-center gap-1">
        <button
          onClick={() => { obj.set('flipX', !obj.flipX); canvas?.renderAll(); canvas?.fire('object:modified', { target: obj }); }}
          className="flex-1 py-1 rounded border border-border text-muted-foreground hover:text-foreground hover:bg-accent transition-colors flex items-center justify-center gap-1"
          title={t('toolbar.flipHorizontal')}
        >
          <FlipHorizontal2 className="h-3 w-3" /> Flip H
        </button>
        <button
          onClick={() => { obj.set('flipY', !obj.flipY); canvas?.renderAll(); canvas?.fire('object:modified', { target: obj }); }}
          className="flex-1 py-1 rounded border border-border text-muted-foreground hover:text-foreground hover:bg-accent transition-colors flex items-center justify-center gap-1"
          title={t('toolbar.flipVertical')}
        >
          <FlipVertical2 className="h-3 w-3" /> Flip V
        </button>
      </div>

      <div className="border-t border-border" />
    </>
  );
}

// ─── Text Properties Section ────────────────────────
function TextPropertiesSection({
  obj,
  canvas,
  updateAndSave,
  propVersion,
}: {
  obj: any;
  canvas: any;
  updateAndSave: (prop: string, val: any) => void;
  propVersion: number;
}) {
  const { t } = useT();
  return (
    <>
      <SectionLabel label="Text" />
      <div className="space-y-2">
        {/* Font family */}
        <div className="flex items-center gap-2">
          <label className="text-muted-foreground w-10 shrink-0">Font</label>
          <select
            value={obj.fontFamily || 'Inter, system-ui, sans-serif'}
            onChange={(e) => updateAndSave('fontFamily', e.target.value)}
            className="flex-1 h-7 bg-transparent border border-border rounded px-1.5 text-foreground text-xs"
          >
            {FONT_FAMILIES.map(f => (
              <option key={f.value} value={f.value} style={{ fontFamily: f.value }}>{t((f as any).labelKey || f.label)}</option>
            ))}
          </select>
        </div>

        {/* Font size (editable number input) */}
        <div className="flex items-center gap-2">
          <label className="text-muted-foreground w-10 shrink-0">Size</label>
          <input
            type="number"
            value={obj.fontSize || 24}
            onChange={(e) => updateAndSave('fontSize', Math.max(1, Number(e.target.value)))}
            className="w-16 h-7 bg-transparent border border-border rounded px-1.5 text-foreground text-xs"
            min={1}
            max={200}
          />
          <span className="text-muted-foreground">px</span>
        </div>

        {/* Style toggles */}
        <div className="flex items-center gap-1">
          <ToggleBtn
            active={obj.fontWeight === 'bold'}
            onClick={() => updateAndSave('fontWeight', obj.fontWeight === 'bold' ? 'normal' : 'bold')}
            title={t('toolbar.bold')}
          >
            <Bold className="h-3.5 w-3.5" />
          </ToggleBtn>
          <ToggleBtn
            active={obj.fontStyle === 'italic'}
            onClick={() => updateAndSave('fontStyle', obj.fontStyle === 'italic' ? 'normal' : 'italic')}
            title={t('toolbar.italic')}
          >
            <Italic className="h-3.5 w-3.5" />
          </ToggleBtn>
          <ToggleBtn
            active={!!obj.underline}
            onClick={() => updateAndSave('underline', !obj.underline)}
            title={t('toolbar.underline')}
          >
            <Underline className="h-3.5 w-3.5" />
          </ToggleBtn>
          <ToggleBtn
            active={!!obj.linethrough}
            onClick={() => updateAndSave('linethrough', !obj.linethrough)}
            title={t('toolbar.strikethrough')}
          >
            <Strikethrough className="h-3.5 w-3.5" />
          </ToggleBtn>
        </div>

        {/* Text align */}
        <div className="flex items-center gap-1">
          <ToggleBtn active={obj.textAlign === 'left'} onClick={() => updateAndSave('textAlign', 'left')} title={t('toolbar.alignLeft')}>
            <AlignLeft className="h-3.5 w-3.5" />
          </ToggleBtn>
          <ToggleBtn active={obj.textAlign === 'center'} onClick={() => updateAndSave('textAlign', 'center')} title={t('toolbar.alignCenter')}>
            <AlignCenter className="h-3.5 w-3.5" />
          </ToggleBtn>
          <ToggleBtn active={obj.textAlign === 'right'} onClick={() => updateAndSave('textAlign', 'right')} title={t('toolbar.alignRight')}>
            <AlignRight className="h-3.5 w-3.5" />
          </ToggleBtn>
          <ToggleBtn active={obj.textAlign === 'justify'} onClick={() => updateAndSave('textAlign', 'justify')} title={t('toolbar.alignJustify')}>
            <AlignJustify className="h-3.5 w-3.5" />
          </ToggleBtn>
        </div>

        {/* Line height + char spacing */}
        <div className="grid grid-cols-2 gap-2">
          <PropInput label="LnH" value={Number((obj.lineHeight || 1.3).toFixed(1))} onChange={(v) => updateAndSave('lineHeight', v)} step={0.1} min={0.5} max={5} />
          <PropInput label="Spc" value={Math.round(obj.charSpacing || 0)} onChange={(v) => updateAndSave('charSpacing', v)} />
        </div>

        {/* Fill color */}
        <div className="flex items-center gap-2">
          <label className="text-muted-foreground w-10 shrink-0">Color</label>
          <ColorPicker
            color={obj.fill || '#333333'}
            onChange={(c) => updateAndSave('fill', c)}
          />
        </div>

        {/* Padding */}
        <PropInput label="Padding" value={obj.padding || 0} onChange={(v) => updateAndSave('padding', v)} min={0} max={100} />
      </div>
    </>
  );
}

// ─── Shape Properties Section ───────────────────────
function ShapePropertiesSection({
  obj,
  canvas,
  updateAndSave,
  propVersion,
}: {
  obj: any;
  canvas: any;
  updateAndSave: (prop: string, val: any) => void;
  propVersion: number;
}) {
  const objType = getObjType(obj);
  const [shadowEnabled, setShadowEnabled] = useState(!!obj.shadow);

  return (
    <>
      <SectionLabel label="Shape" />
      <div className="space-y-2">
        {/* Fill color */}
        <div className="flex items-center gap-2">
          <label className="text-muted-foreground w-14 shrink-0">Fill</label>
          <ColorPicker
            color={obj.fill || '#e2e8f0'}
            onChange={(c) => updateAndSave('fill', c)}
          />
        </div>

        {/* Stroke color */}
        <div className="flex items-center gap-2">
          <label className="text-muted-foreground w-14 shrink-0">Stroke</label>
          <ColorPicker
            color={obj.stroke || '#94a3b8'}
            onChange={(c) => {
              updateAndSave('stroke', c);
              if (!obj.strokeWidth) updateAndSave('strokeWidth', 1);
            }}
          />
        </div>

        {/* Stroke width */}
        <PropInput label="Stroke W" value={obj.strokeWidth || 0} onChange={(v) => updateAndSave('strokeWidth', v)} min={0} max={20} />

        {/* Stroke dash style */}
        <div className="flex items-center gap-2">
          <label className="text-muted-foreground w-14 shrink-0">Dash</label>
          <select
            value={
              !obj.strokeDashArray ? 'solid'
                : obj.strokeDashArray[0] === 2 ? 'dotted'
                  : 'dashed'
            }
            onChange={(e) => {
              const val = e.target.value;
              const dash = val === 'dashed' ? [8, 4] : val === 'dotted' ? [2, 4] : undefined;
              updateAndSave('strokeDashArray', dash || null);
            }}
            className="flex-1 h-7 bg-transparent border border-border rounded px-1.5 text-foreground text-xs"
          >
            <option value="solid">Solid</option>
            <option value="dashed">Dashed</option>
            <option value="dotted">Dotted</option>
          </select>
        </div>

        {/* Border radius (for rect) */}
        {objType === 'rect' && (
          <div className="grid grid-cols-2 gap-2">
            <PropInput label="rx" value={obj.rx || 0} onChange={(v) => { updateAndSave('rx', v); updateAndSave('ry', v); }} min={0} max={200} />
            <PropInput label="ry" value={obj.ry || 0} onChange={(v) => updateAndSave('ry', v)} min={0} max={200} />
          </div>
        )}

        {/* Shadow */}
        <div className="flex items-center gap-2">
          <label className="text-muted-foreground w-14 shrink-0">Shadow</label>
          <button
            onClick={() => {
              if (shadowEnabled) {
                obj.set('shadow', null);
                canvas?.renderAll();
                canvas?.fire('object:modified', { target: obj });
                setShadowEnabled(false);
              } else {
                const { Shadow } = fabricModule;
                obj.set('shadow', new Shadow({ color: 'rgba(0,0,0,0.3)', blur: 10, offsetX: 4, offsetY: 4 }));
                canvas?.renderAll();
                canvas?.fire('object:modified', { target: obj });
                setShadowEnabled(true);
              }
            }}
            className={cn(
              'px-2 py-1 rounded border text-xs transition-colors',
              shadowEnabled
                ? 'border-primary text-primary bg-primary/10'
                : 'border-border text-muted-foreground hover:text-foreground'
            )}
          >
            {shadowEnabled ? 'On' : 'Off'}
          </button>
        </div>
        {shadowEnabled && obj.shadow && (
          <div className="space-y-2 pl-4">
            <div className="flex items-center gap-2">
              <label className="text-muted-foreground w-10 shrink-0">Color</label>
              <ColorPicker
                color={obj.shadow.color?.startsWith('rgba') ? '#000000' : (obj.shadow.color || '#000000')}
                onChange={(c) => {
                  const { Shadow } = fabricModule;
                  obj.set('shadow', new Shadow({ ...obj.shadow, color: c }));
                  canvas?.renderAll();
                  canvas?.fire('object:modified', { target: obj });
                }}
              />
            </div>
            <PropInput label="Blur" value={obj.shadow.blur || 0} onChange={(v) => {
              const { Shadow } = fabricModule;
              obj.set('shadow', new Shadow({ ...obj.shadow, blur: v }));
              canvas?.renderAll();
              canvas?.fire('object:modified', { target: obj });
            }} min={0} max={50} />
            <div className="grid grid-cols-2 gap-2">
              <PropInput label="offX" value={obj.shadow.offsetX || 0} onChange={(v) => {
                const { Shadow } = fabricModule;
                obj.set('shadow', new Shadow({ ...obj.shadow, offsetX: v }));
                canvas?.renderAll();
                canvas?.fire('object:modified', { target: obj });
              }} />
              <PropInput label="offY" value={obj.shadow.offsetY || 0} onChange={(v) => {
                const { Shadow } = fabricModule;
                obj.set('shadow', new Shadow({ ...obj.shadow, offsetY: v }));
                canvas?.renderAll();
                canvas?.fire('object:modified', { target: obj });
              }} />
            </div>
          </div>
        )}
      </div>
    </>
  );
}

// ─── Image Properties Section ───────────────────────
function ImagePropertiesSection({
  obj,
  canvas,
  updateAndSave,
  propVersion,
}: {
  obj: any;
  canvas: any;
  updateAndSave: (prop: string, val: any) => void;
  propVersion: number;
}) {
  const [borderRadius, setBorderRadius] = useState(
    obj.clipPath?.rx ? Math.round(obj.clipPath.rx * (obj.scaleX || 1)) : 0
  );
  const [shadowEnabled, setShadowEnabled] = useState(!!obj.shadow);

  const applyBorderRadius = (r: number) => {
    setBorderRadius(r);
    if (r > 0 && fabricModule.Rect) {
      obj.clipPath = new fabricModule.Rect({
        width: obj.width,
        height: obj.height,
        rx: r / (obj.scaleX || 1),
        ry: r / (obj.scaleY || 1),
        originX: 'center',
        originY: 'center',
      });
    } else {
      obj.clipPath = undefined;
    }
    canvas?.renderAll();
    canvas?.fire('object:modified', { target: obj });
  };

  const replaceImage = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;

      let imgSrc: string;
      try {
        const formData = new FormData();
        formData.append('file', file);
        const resp = await fetch('/api/gateway/uploads', { method: 'POST', body: formData });
        if (!resp.ok) throw new Error('Upload failed');
        const data = await resp.json();
        imgSrc = data.url?.startsWith('http') ? data.url : `/api/gateway${data.url?.replace(/^\/api/, '')}`;
      } catch {
        imgSrc = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.readAsDataURL(file);
        });
      }

      const imgEl = new window.Image();
      imgEl.crossOrigin = 'anonymous';
      imgEl.onload = () => {
        // Keep current position, set new image element
        const { FabricImage } = fabricModule;
        const newImg = new FabricImage(imgEl, {
          left: obj.left,
          top: obj.top,
          scaleX: obj.scaleX,
          scaleY: obj.scaleY,
          angle: obj.angle,
          opacity: obj.opacity,
        });
        canvas?.remove(obj);
        canvas?.add(newImg);
        canvas?.setActiveObject(newImg);
        canvas?.renderAll();
      };
      imgEl.src = imgSrc;
    };
    input.click();
  };

  const resetToDefault = () => {
    if (!obj) return;
    const naturalW = obj.width || 200;
    const naturalH = obj.height || 200;
    const scale = Math.min(600 / naturalW, 400 / naturalH, 1);
    obj.set('scaleX', scale);
    obj.set('scaleY', scale);
    canvas?.renderAll();
    canvas?.fire('object:modified', { target: obj });
  };

  return (
    <>
      <SectionLabel label="Image" />
      <div className="space-y-2">
        {/* Border radius */}
        <PropInput label="Radius" value={borderRadius} onChange={(v) => applyBorderRadius(v)} min={0} max={200} />

        {/* Border/stroke */}
        <div className="flex items-center gap-2">
          <label className="text-muted-foreground w-14 shrink-0">Border</label>
          <ColorPicker
            color={obj.stroke || '#000000'}
            onChange={(c) => {
              updateAndSave('stroke', c);
              if (!obj.strokeWidth) updateAndSave('strokeWidth', 1);
            }}
          />
        </div>
        <PropInput label="Border W" value={obj.strokeWidth || 0} onChange={(v) => updateAndSave('strokeWidth', v)} min={0} max={20} />

        {/* Shadow */}
        <div className="flex items-center gap-2">
          <label className="text-muted-foreground w-14 shrink-0">Shadow</label>
          <button
            onClick={() => {
              if (shadowEnabled) {
                obj.set('shadow', null);
                canvas?.renderAll();
                canvas?.fire('object:modified', { target: obj });
                setShadowEnabled(false);
              } else {
                const { Shadow } = fabricModule;
                obj.set('shadow', new Shadow({ color: 'rgba(0,0,0,0.3)', blur: 10, offsetX: 4, offsetY: 4 }));
                canvas?.renderAll();
                canvas?.fire('object:modified', { target: obj });
                setShadowEnabled(true);
              }
            }}
            className={cn(
              'px-2 py-1 rounded border text-xs transition-colors',
              shadowEnabled
                ? 'border-primary text-primary bg-primary/10'
                : 'border-border text-muted-foreground hover:text-foreground'
            )}
          >
            {shadowEnabled ? 'On' : 'Off'}
          </button>
        </div>

        <div className="border-t border-border pt-2 space-y-1.5">
          <button
            onClick={replaceImage}
            className="w-full py-1.5 rounded border border-border text-muted-foreground hover:text-foreground hover:bg-accent transition-colors text-xs flex items-center justify-center gap-1"
          >
            <Replace className="h-3 w-3" /> Replace Image
          </button>
          <button
            onClick={resetToDefault}
            className="w-full py-1.5 rounded border border-border text-muted-foreground hover:text-foreground hover:bg-accent transition-colors text-xs flex items-center justify-center gap-1"
          >
            <RotateCcw className="h-3 w-3" /> Reset to Default
          </button>
        </div>
      </div>
    </>
  );
}

// ─── Table Properties Section ────────────────────────
function TablePropertiesSection({ obj, canvas, propVersion }: {
  obj: any;
  canvas: any;
  propVersion: number;
}) {
  const tJSON = obj.__tableJSON;
  const tableContent = tJSON?.content?.[0]?.content || [];
  const rows = tableContent.length || 3;
  const cols = tableContent[0]?.content?.length || 3;
  return (
    <>
      <SectionLabel label="Table" />
      <div className="space-y-2 text-xs">
        <div className="flex items-center gap-2 text-muted-foreground">
          <span>{rows} rows × {cols} columns</span>
        </div>
        <p className="text-muted-foreground text-[10px]">
          Click the table on canvas to edit. Use the toolbar to add/remove rows and columns, merge cells, and more.
        </p>
      </div>
    </>
  );
}

// ─── Shared UI Components ───────────────────────────

function SectionLabel({ label }: { label: string }) {
  return (
    <div className="text-[11px] text-muted-foreground uppercase tracking-wider font-medium pt-1">
      {label}
    </div>
  );
}

function PropInput({
  label,
  value,
  onChange,
  step = 1,
  min,
  max,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
  max?: number;
}) {
  return (
    <div className="flex items-center gap-1">
      <label className="text-muted-foreground w-10 shrink-0 text-xs">{label}</label>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        step={step}
        min={min}
        max={max}
        className="w-[70px] h-7 bg-transparent border border-border rounded px-1.5 text-foreground text-xs"
      />
    </div>
  );
}

function ToggleBtn({
  active,
  onClick,
  title,
  children,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'p-1.5 rounded transition-colors',
        active ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground hover:bg-accent'
      )}
      title={title}
    >
      {children}
    </button>
  );
}

// ─── Toolbar Button ─────────────────────────────────
function ToolBtn({ icon: Icon, onClick, active, title }: {
  icon: React.ComponentType<{ className?: string }>;
  onClick: () => void;
  active?: boolean;
  title: string;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'p-1.5 rounded transition-colors',
        active ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground hover:bg-accent'
      )}
      title={title}
    >
      <Icon className="h-4 w-4" />
    </button>
  );
}

// ─── PPT Table Overlay — RichTable positioned over Fabric.js table rect ────
function PPTTableOverlay({ obj, canvas, containerRef, propVersion, isSelected }: {
  obj: any;
  canvas: any;
  containerRef: React.RefObject<HTMLDivElement | null>;
  propVersion: number;
  isSelected?: boolean;
}) {
  const [pos, setPos] = useState({ left: 0, top: 0, width: 200, height: 100 });
  const [editing, setEditing] = useState(false);
  const [tableToolbarInfo, setTableToolbarInfo] = useState<{
    anchor: { top: number; left: number; width: number };
    view: any;
  } | null>(null);

  // Get or create default table JSON
  const getTableJSON = useCallback(() => {
    if (obj.__tableJSON) return obj.__tableJSON;
    // Migrate from old string[][] format if present
    const oldData: string[][] = obj.__tableData;
    if (oldData && Array.isArray(oldData) && oldData.length > 0) {
      const rows = oldData.map((row, rowIdx) => ({
        type: 'table_row',
        content: row.map((cell) => ({
          type: rowIdx === 0 ? 'table_header' : 'table_cell',
          attrs: { colspan: 1, rowspan: 1, alignment: null, colwidth: null, background: null },
          content: [{ type: 'paragraph', content: cell ? [{ type: 'text', text: cell }] : undefined }],
        })),
      }));
      return { type: 'doc', content: [{ type: 'table', content: rows }] };
    }
    // Default 3x3 table
    const cols = 3, rowCount = 3;
    const headerCells = Array.from({ length: cols }, () => ({
      type: 'table_header',
      attrs: { colspan: 1, rowspan: 1, alignment: null, colwidth: null, background: null },
      content: [{ type: 'paragraph' }],
    }));
    const bodyRow = () => ({
      type: 'table_row',
      content: Array.from({ length: cols }, () => ({
        type: 'table_cell',
        attrs: { colspan: 1, rowspan: 1, alignment: null, colwidth: null, background: null },
        content: [{ type: 'paragraph' }],
      })),
    });
    return {
      type: 'doc',
      content: [{ type: 'table', content: [
        { type: 'table_row', content: headerCells },
        bodyRow(),
        bodyRow(),
      ]}],
    };
  }, [obj]);

  const [tableJSON, setTableJSON] = useState<Record<string, unknown>>(() => getTableJSON());

  // Sync when object changes externally
  useEffect(() => {
    setTableJSON(getTableJSON());
  }, [obj, propVersion, getTableJSON]);

  // Compute position relative to canvas container
  const updatePos = useCallback(() => {
    const container = containerRef.current;
    if (!container || !canvas) return;
    const zoom = canvas.getZoom() || 1;
    const wrapper = container.querySelector('.canvas-wrapper') as HTMLElement;
    const wrapperLeft = wrapper ? parseFloat(wrapper.style.marginLeft || '0') : 0;
    const wrapperTop = wrapper ? parseFloat(wrapper.style.marginTop || '0') : 0;
    const objW = (obj.width || 200) * (obj.scaleX || 1);
    const objH = (obj.height || 100) * (obj.scaleY || 1);
    setPos({
      left: (obj.left || 0) * zoom + wrapperLeft,
      top: (obj.top || 0) * zoom + wrapperTop,
      width: objW * zoom,
      height: objH * zoom,
    });
  }, [obj, canvas, containerRef]);

  useEffect(() => {
    updatePos();
    if (!canvas) return;
    const handler = () => updatePos();
    canvas.on('after:render', handler);
    return () => { canvas.off('after:render', handler); };
  }, [canvas, updatePos]);

  const handleProsemirrorChange = useCallback((json: Record<string, unknown>) => {
    setTableJSON(json);
    obj.__tableJSON = json;
    // Clean up old format
    delete obj.__tableData;
    delete obj.__tableRows;
    delete obj.__tableCols;
    canvas?.fire('object:modified', { target: obj });
  }, [obj, canvas]);

  // Click on non-selected table overlay → select the Fabric.js object
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (!isSelected && canvas) {
      canvas.setActiveObject(obj);
      canvas.renderAll();
    }
  }, [isSelected, canvas, obj]);

  // Double-click to enter edit mode
  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (isSelected) {
      setEditing(true);
    }
  }, [isSelected]);

  // Exit edit mode on click outside
  useEffect(() => {
    if (!editing) return;
    const handleClickOutside = (e: MouseEvent) => {
      const overlay = (e.target as HTMLElement).closest('.ppt-table-overlay');
      if (!overlay) {
        setEditing(false);
        setTableToolbarInfo(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [editing]);

  // Escape to exit edit mode
  useEffect(() => {
    if (!editing) return;
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setEditing(false);
        setTableToolbarInfo(null);
      }
    };
    document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  }, [editing]);

  return (
    <>
      <div
        className="ppt-table-overlay absolute overflow-visible"
        style={{
          left: pos.left,
          top: pos.top,
          width: pos.width,
          minHeight: pos.height,
          zIndex: editing ? 50 : isSelected ? 30 : 10,
        }}
        onMouseDown={handleMouseDown}
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
          items={getDocsTableItems()}
          handler={createDocsTableHandler(tableToolbarInfo.view)}
          anchor={tableToolbarInfo.anchor}
          visible={true}
        />
      )}
    </>
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

// ─── Slide Thumbnail ────────────────────────────────
function SlideThumb({ slide }: { slide: SlideData }) {
  const scale = THUMB_WIDTH / SLIDE_WIDTH;
  return (
    <div className="relative w-full h-full overflow-hidden" style={{ backgroundColor: slide.background || '#fff' }}>
      {slide.backgroundImage && (
        <img src={slide.backgroundImage} alt="" className="absolute inset-0 w-full h-full object-cover" />
      )}
      {slide.elements.slice(0, 10).map((el, i) => {
        const w = (el.width || 100) * scale * (el.scaleX || 1);
        const h = (el.height || 50) * scale * (el.scaleY || 1);
        const style: React.CSSProperties = {
          position: 'absolute',
          left: (el.left || 0) * scale,
          top: (el.top || 0) * scale,
          width: w,
          height: h,
          overflow: 'hidden',
        };

        if (el.type === 'textbox') {
          const scaledFont = (el.fontSize || 24) * scale;
          if (scaledFont < 6) {
            const barH = Math.max(2, Math.round(scaledFont * 0.8));
            return (
              <div key={i} style={{ ...style }}>
                {(el.text || '').split('\n').slice(0, 3).map((line: string, li: number) => (
                  <div key={li} style={{
                    height: barH,
                    width: `${Math.min(100, Math.max(20, (line.length / 30) * 100))}%`,
                    backgroundColor: el.fill || '#333',
                    opacity: 0.4,
                    borderRadius: 1,
                    marginBottom: 1,
                  }} />
                ))}
              </div>
            );
          }
          return (
            <div key={i} style={{ ...style, fontSize: scaledFont, lineHeight: '1.2', color: el.fill || '#333' }}>
              {el.text?.slice(0, 30)}
            </div>
          );
        }
        if (el.type === 'rect') {
          return <div key={i} style={{ ...style, backgroundColor: el.fill || '#e2e8f0', borderRadius: (el.rx || 0) * scale }} />;
        }
        if (el.type === 'circle') {
          return <div key={i} style={{ ...style, backgroundColor: el.fill || '#e2e8f0', borderRadius: '50%' }} />;
        }
        if (el.type === 'triangle') {
          return <div key={i} style={{ ...style, backgroundColor: el.fill || '#e2e8f0', clipPath: 'polygon(50% 0%, 0% 100%, 100% 100%)' }} />;
        }
        if (el.type === 'image') {
          return <img key={i} src={el.src} alt="" style={{ ...style, objectFit: 'cover' }} />;
        }
        if (el.type === 'table') {
          return (
            <div key={i} style={{ ...style, backgroundColor: '#f9fafb', border: '1px solid #d1d5db' }}>
              <Table2 className="w-full h-full text-muted-foreground/30 p-0.5" />
            </div>
          );
        }
        return <div key={i} style={{ ...style, backgroundColor: el.fill || '#e2e8f0' }} />;
      })}
    </div>
  );
}

// ─── Presenter Mode ─────────────────────────────────
function PresenterMode({
  slides,
  startIndex,
  onExit,
  loadSlideToCanvas,
}: {
  slides: SlideData[];
  startIndex: number;
  onExit: () => void;
  loadSlideToCanvas: (slide: SlideData) => void;
}) {
  const [index, setIndex] = useState(startIndex);
  const canvasElRef = useRef<HTMLCanvasElement>(null);
  const canvasRef = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Fullscreen
  useEffect(() => {
    containerRef.current?.requestFullscreen?.().catch(() => {});
    const handler = () => {
      if (!document.fullscreenElement) onExit();
    };
    document.addEventListener('fullscreenchange', handler);
    return () => document.removeEventListener('fullscreenchange', handler);
  }, [onExit]);

  // Create canvas
  useEffect(() => {
    if (!canvasElRef.current || !fabricModule) return;
    const { Canvas } = fabricModule;
    const canvas = new Canvas(canvasElRef.current, {
      width: SLIDE_WIDTH,
      height: SLIDE_HEIGHT,
      selection: false,
      interactive: false,
    });
    canvasRef.current = canvas;

    // Table grid rendering for presenter mode
    canvas.on('after:render', () => {
      const ctx = canvas.getContext();
      if (!ctx) return;
      for (const o of canvas.getObjects()) {
        if (!(o as any).__isTable) continue;
        const tJSON = (o as any).__tableJSON;
        const tableContent = tJSON?.content?.[0]?.content || [];
        const tRows: number = tableContent.length || 3;
        const tCols: number = tableContent[0]?.content?.length || 3;
        const z = canvas.getZoom() || 1;
        const ox = (o.left || 0) * z;
        const oy = (o.top || 0) * z;
        const cw = 120 * z;
        const ch = 36 * z;
        ctx.save();
        ctx.strokeStyle = '#d1d5db';
        ctx.lineWidth = 1;
        for (let r = 0; r <= tRows; r++) { ctx.beginPath(); ctx.moveTo(ox, oy + r * ch); ctx.lineTo(ox + tCols * cw, oy + r * ch); ctx.stroke(); }
        for (let c = 0; c <= tCols; c++) { ctx.beginPath(); ctx.moveTo(ox + c * cw, oy); ctx.lineTo(ox + c * cw, oy + tRows * ch); ctx.stroke(); }
        ctx.fillStyle = '#f3f4f6';
        ctx.fillRect(ox, oy, tCols * cw, ch);
        ctx.strokeRect(ox, oy, tCols * cw, ch);
        ctx.fillStyle = '#1f2937';
        ctx.font = `${Math.max(10, 12 * z)}px Inter, system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        for (let r = 0; r < tRows; r++) {
          const rowCells = tableContent[r]?.content || [];
          for (let c = 0; c < tCols; c++) {
            const cell = rowCells[c];
            const text = cell?.content?.[0]?.content?.[0]?.text || '';
            if (text) ctx.fillText(text, ox + c * cw + cw / 2, oy + r * ch + ch / 2, cw - 8);
          }
        }
        ctx.restore();
      }
    });

    return () => {
      canvas.dispose();
      canvasRef.current = null;
    };
  }, []);

  // Load current slide
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !slides[index]) return;

    const slide = slides[index];
    canvas.clear();
    canvas.backgroundColor = slide.background || '#ffffff';

    // Background image in presenter mode
    if (slide.backgroundImage && fabricModule.FabricImage) {
      const bgImg = new window.Image();
      bgImg.crossOrigin = 'anonymous';
      bgImg.onload = () => {
        const fImg = new fabricModule.FabricImage(bgImg, { originX: 'left', originY: 'top' });
        const scX = SLIDE_WIDTH / bgImg.width;
        const scY = SLIDE_HEIGHT / bgImg.height;
        const sc = Math.max(scX, scY);
        fImg.set({ scaleX: sc, scaleY: sc });
        canvas.backgroundImage = fImg;
        canvas.renderAll();
      };
      bgImg.src = slide.backgroundImage;
    } else {
      canvas.backgroundImage = null;
    }

    const { Textbox, Rect, Circle, Triangle, FabricImage } = fabricModule;
    for (const el of slide.elements) {
      let obj: any = null;
      const common = {
        left: el.left || 0, top: el.top || 0, width: el.width, height: el.height,
        fill: el.fill || '#333333', angle: el.angle || 0,
        scaleX: el.scaleX || 1, scaleY: el.scaleY || 1, opacity: el.opacity ?? 1,
        selectable: false, evented: false,
      };

      if (el.type === 'textbox') {
        obj = new Textbox(el.text || '', { ...common, fontSize: el.fontSize || 24, fontWeight: el.fontWeight || 'normal', fontStyle: el.fontStyle || 'normal', underline: el.underline || false, textAlign: el.textAlign || 'left', lineHeight: el.lineHeight || 1.3, fontFamily: el.fontFamily || 'Inter, system-ui, sans-serif' });
      } else if (el.type === 'rect') {
        obj = new Rect({ ...common, rx: el.rx || 0, ry: el.ry || 0, stroke: el.stroke || '', strokeWidth: el.strokeWidth || 0 });
      } else if (el.type === 'circle') {
        obj = new Circle({ ...common, radius: el.radius || 50, stroke: el.stroke || '', strokeWidth: el.strokeWidth || 0 });
      } else if (el.type === 'triangle') {
        obj = new Triangle({ ...common, stroke: el.stroke || '', strokeWidth: el.strokeWidth || 0 });
      } else if (el.type === 'image' && el.src) {
        const imgEl = new window.Image();
        imgEl.crossOrigin = 'anonymous';
        imgEl.onload = () => {
          const fi = new FabricImage(imgEl, {
            left: el.left || 0,
            top: el.top || 0,
            scaleX: el.scaleX || ((el.width || 200) / imgEl.width),
            scaleY: el.scaleY || ((el.height || 200) / imgEl.height),
            selectable: false,
            evented: false,
          });
          canvas.add(fi);
          canvas.renderAll();
        };
        imgEl.src = el.src;
        continue;
      } else if (el.type === 'table') {
        // Render table as rect in presenter mode — grid drawn via after:render
        const { Rect: RectPres } = fabricModule;
        const tJSON = el.tableJSON;
        const tc = tJSON?.content?.[0]?.content || [];
        const tRows = tc.length || 3;
        const tCols = tc[0]?.content?.length || 3;
        obj = new RectPres({
          ...common,
          width: el.width || 120 * tCols,
          height: el.height || 36 * tRows,
          fill: '#ffffff',
          stroke: '#d1d5db',
          strokeWidth: 1,
        });
        (obj as any).__tableJSON = el.tableJSON || null;
        (obj as any).__isTable = true;
      }
      if (obj) canvas.add(obj);
    }
    canvas.renderAll();
  }, [index, slides]);

  // Resize canvas to fill screen
  useEffect(() => {
    const resize = () => {
      const el = containerRef.current;
      if (!el) return;
      const scale = Math.min(window.innerWidth / SLIDE_WIDTH, window.innerHeight / SLIDE_HEIGHT);
      const wrapper = el.querySelector('.presenter-canvas') as HTMLElement;
      if (wrapper) {
        wrapper.style.transform = `scale(${scale})`;
        wrapper.style.transformOrigin = 'center center';
      }
    };
    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);

  // Keyboard navigation
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'Enter') {
        setIndex(i => Math.min(i + 1, slides.length - 1));
      } else if (e.key === 'ArrowLeft') {
        setIndex(i => Math.max(i - 1, 0));
      } else if (e.key === 'Escape') {
        document.exitFullscreen?.().catch(() => {});
        onExit();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [slides.length, onExit]);

  return (
    <div ref={containerRef} className="fixed inset-0 bg-black z-50 flex items-center justify-center cursor-none" onClick={(e) => {
      if (e.clientX > window.innerWidth / 2) setIndex(i => Math.min(i + 1, slides.length - 1));
      else setIndex(i => Math.max(i - 1, 0));
    }}>
      <div className="presenter-canvas" style={{ width: SLIDE_WIDTH, height: SLIDE_HEIGHT }}>
        <canvas ref={canvasElRef} />
      </div>
      <div className="fixed bottom-4 right-4 text-white/50 text-sm z-50 cursor-default" onClick={(e) => e.stopPropagation()}>
        {index + 1} / {slides.length}
      </div>
      <button
        className="fixed top-4 right-4 text-white/30 hover:text-white/70 text-sm z-50"
        onClick={(e) => { e.stopPropagation(); document.exitFullscreen?.().catch(() => {}); onExit(); }}
      >
        ESC
      </button>
    </div>
  );
}
