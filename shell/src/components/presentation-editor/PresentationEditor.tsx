'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as gw from '@/lib/api/gateway';
import {
  ArrowLeft, ArrowLeftToLine, ArrowRightToLine,
  MoreHorizontal, Link2, Download, Trash2, ChevronRight,
  Plus, Type, Hexagon,
  Image as ImageIcon, Play, Copy, ChevronUp, ChevronDown,
  Minus,
  MousePointer2, Bold, Italic, Underline, Strikethrough,
  AlignLeft, AlignCenter, AlignRight, AlignJustify,
  ArrowUpToLine, ArrowDownToLine, MoveUp, MoveDown,
  FlipHorizontal2, FlipVertical2, RotateCcw,
  Replace, PanelRightClose, PanelRight, X,
  Table2, Trash, MessageSquare, Clock, Workflow,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useT } from '@/lib/i18n';
import { ContentTopBar } from '@/components/shared/ContentTopBar';
import { ColorPicker } from '@/components/ui/color-picker';
import { CommentPanel } from '@/components/shared/CommentPanel';
import { RevisionHistory } from '@/components/shared/RevisionHistory';
import { BottomSheet } from '@/components/shared/BottomSheet';
import { usePinchZoom } from '@/lib/hooks/use-pinch-zoom';
import { SlidePreviewList } from '@/components/shared/SlidePreviewList';
import { EditFAB } from '@/components/shared/EditFAB';
import { ShapePicker } from '@/components/shared/ShapeSet';
import type { ShapeType } from '@/components/shared/ShapeSet/shapes';
import { renderCellsToSVG } from '@/components/shared/EmbeddedDiagram/renderCellsToSVG';
import { DiagramPicker } from '@/components/shared/EmbeddedDiagram/DiagramPicker';
import { DiagramEditorDialog } from '@/components/shared/EmbeddedDiagram/DiagramEditorDialog';
import { createFabricShape } from '@/components/shared/ShapeSet/adapters/FabricShape';
import { RichTable } from '@/components/shared/RichTable';
import { FloatingToolbar } from '@/components/shared/FloatingToolbar';
import { PPT_TEXT_ITEMS, PPT_IMAGE_ITEMS, PPT_SHAPE_ITEMS, DOCS_TABLE_ITEMS } from '@/components/shared/FloatingToolbar/presets';
import { createPPTTextHandler, createPPTImageHandler, createPPTShapeHandler } from './ppt-toolbar-handler';
import { createDocsTableHandler } from '@/components/editor/docs-toolbar-handler';

// ─── Types ──────────────────────────────────────────
interface SlideData {
  elements: any[];
  background: string;
  backgroundImage?: string;
  notes: string;
}

interface PresentationData {
  slides: SlideData[];
}

interface PresentationEditorProps {
  presentationId: string;
  breadcrumb?: { id: string; title: string }[];
  onBack?: () => void;
  onDeleted?: () => void;
  onCopyLink?: () => void;
  docListVisible?: boolean;
  onToggleDocList?: () => void;
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

// ─── Constants ──────────────────────────────────────
const SLIDE_WIDTH = 960;
const SLIDE_HEIGHT = 540;
const THUMB_WIDTH = 180;
const THUMB_HEIGHT = Math.round(THUMB_WIDTH * (SLIDE_HEIGHT / SLIDE_WIDTH));

const DEFAULT_SLIDE: SlideData = {
  elements: [],
  background: '#ffffff',
  notes: '',
};

const FONT_FAMILIES = [
  { label: 'Inter', value: 'Inter, system-ui, sans-serif' },
  { label: 'Arial', value: 'Arial, Helvetica, sans-serif' },
  { label: 'Georgia', value: 'Georgia, serif' },
  { label: 'Times New Roman', value: '"Times New Roman", Times, serif' },
  { label: 'Courier New', value: '"Courier New", Courier, monospace' },
  { label: 'Verdana', value: 'Verdana, Geneva, sans-serif' },
  { label: 'Trebuchet MS', value: '"Trebuchet MS", sans-serif' },
  { label: 'Comic Sans MS', value: '"Comic Sans MS", cursive' },
  { label: '\u601D\u6E90\u9ED1\u4F53', value: '"Noto Sans SC", "Source Han Sans SC", sans-serif' },
  { label: '\u601D\u6E90\u5B8B\u4F53', value: '"Noto Serif SC", "Source Han Serif SC", serif' },
  { label: '\u5FAE\u8F6F\u96C5\u9ED1', value: '"Microsoft YaHei", sans-serif' },
  { label: '\u82F9\u679C\u82F9\u65B9', value: '"PingFang SC", sans-serif' },
];

const FONT_SIZES = [10, 12, 14, 16, 18, 20, 24, 28, 32, 36, 42, 48, 56, 64, 72, 96];

const STROKE_DASH_STYLES: { label: string; value: number[] | undefined }[] = [
  { label: 'Solid', value: undefined },
  { label: 'Dashed', value: [8, 4] },
  { label: 'Dotted', value: [2, 4] },
];

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

// ─── Fit canvas to container using Fabric.js zoom ────
function fitCanvasToContainer(canvas: any, container: HTMLElement | null) {
  if (!canvas || !container) return;
  const rect = container.getBoundingClientRect();
  const { width, height } = rect;
  if (width < 50 || height < 50) return;
  const padding = 40;
  const scale = Math.min((width - padding) / SLIDE_WIDTH, (height - padding) / SLIDE_HEIGHT);
  if (scale <= 0 || !isFinite(scale)) return;

  const canvasW = Math.round(SLIDE_WIDTH * scale);
  const canvasH = Math.round(SLIDE_HEIGHT * scale);

  canvas.setDimensions({ width: canvasW, height: canvasH });
  canvas.setZoom(scale);
  canvas.renderAll();

  const wrapper = container.querySelector('.canvas-wrapper') as HTMLElement;
  if (wrapper) {
    wrapper.style.marginLeft = `${Math.max(0, Math.round((width - canvasW) / 2))}px`;
    wrapper.style.marginTop = `${Math.max(0, Math.round((height - canvasH) / 2))}px`;
  }
}

// ─── Helper: get object type normalized ──────────────
function getObjType(obj: any): string {
  if (obj?.__isTable) return 'table';
  const t = (obj?.type || '').toLowerCase();
  if (t === 'textbox') return 'textbox';
  if (t === 'rect') return 'rect';
  if (t === 'circle') return 'circle';
  if (t === 'triangle') return 'triangle';
  if (t === 'image') return 'image';
  return t;
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
}: PresentationEditorProps) {
  const { t } = useT();
  const queryClient = useQueryClient();

  // State
  const [ready, setReady] = useState(fabricLoaded);
  const [showMenu, setShowMenu] = useState(false);
  // Title editing now handled by ContentTopBar
  const [slides, setSlides] = useState<SlideData[]>([]);
  const [currentSlideIndex, setCurrentSlideIndex] = useState(0);
  const [selectedTool, setSelectedTool] = useState<'select' | 'text' | 'rect' | 'circle' | 'triangle'>('select');
  const [isPresenting, setIsPresenting] = useState(false);
  const [selectedObj, setSelectedObj] = useState<any>(null);
  // Counter to force property panel re-render when object properties change
  const [propVersion, setPropVersion] = useState(0);
  const [showPropertyPanel, setShowPropertyPanel] = useState(true);
  const [showComments, setShowComments] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
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

  // Auto-save revision tracking
  const lastRevisionRef = useRef<number>(0);
  const REVISION_INTERVAL = 5 * 60 * 1000; // 5 minutes

  // Refs
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const canvasRef = useRef<any>(null);
  const canvasHostRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasContainerRef = useRef<HTMLDivElement>(null);
  // titleInputRef removed — title editing handled by ContentTopBar
  const undoStackRef = useRef<string[]>([]);
  const redoStackRef = useRef<string[]>([]);
  const isLoadingSlideRef = useRef(false);
  const saveCurrentSlideToStateRef = useRef<() => void>(() => {});
  const modifiedDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ─── Pinch-to-zoom & touch pan for mobile ──────────
  usePinchZoom(canvasContainerRef, {
    onZoom: (newScale, center) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      // Fabric.js zoom: setZoom sets an absolute zoom level.
      // We need to clamp and apply relative to SLIDE_WIDTH fitting.
      canvas.setZoom(newScale);
      canvas.renderAll();
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
      const s = presentation.data.slides.length > 0 ? presentation.data.slides : [{ ...DEFAULT_SLIDE }];
      setSlides(s);
      setCurrentSlideIndex(0);
    }
  }, [presentation]);

  const currentTitle = breadcrumb?.[breadcrumb.length - 1]?.title || '';

  // ─── Auto-save ────────────────────────────────────
  const triggerSave = useCallback((updatedSlides: SlideData[]) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      gw.savePresentation(presentationId, { slides: updatedSlides }).catch((err) => {
        console.error('Presentation auto-save failed:', err);
      });
      // Auto-create revision every 5 minutes
      const now = Date.now();
      if (now - lastRevisionRef.current > REVISION_INTERVAL) {
        lastRevisionRef.current = now;
        gw.createContentRevision(`presentation:${presentationId}`, { slides: updatedSlides }).catch(() => {});
      }
    }, 800);
  }, [presentationId]);

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

    // Track changes for undo and auto-save
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

  // ─── Load slide onto canvas ───────────────────────
  const loadSlideToCanvas = useCallback((slide: SlideData) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    // FIX 1: Set loading flag BEFORE clear to prevent object:removed from writing empty data
    isLoadingSlideRef.current = true;

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
      } else if (el.type === 'image' && el.src) {
        // FIX 2: Use saved scaleX/scaleY directly instead of recalculating
        pendingImages++;
        const imgEl = new window.Image();
        imgEl.crossOrigin = 'anonymous';
        imgEl.onload = () => {
          const fabricImg = new FabricImage(imgEl, {
            left: el.left || 0,
            top: el.top || 0,
            // Use saved scale values directly (preserves original)
            scaleX: el.scaleX || ((el.displayWidth || el.width || 200) / imgEl.width),
            scaleY: el.scaleY || ((el.displayHeight || el.height || 200) / imgEl.height),
            angle: el.angle || 0,
            opacity: el.opacity ?? 1,
          });
          // Apply clipPath for border radius if saved
          if (el.borderRadius && el.borderRadius > 0 && fabricModule.Rect) {
            fabricImg.clipPath = new fabricModule.Rect({
              width: imgEl.width,
              height: imgEl.height,
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
          // Restore diagram metadata for embedded diagrams
          if (el.__diagramId) {
            (fabricImg as any).__diagramId = el.__diagramId;
          }
          canvas.add(fabricImg);
          canvas.renderAll();
          pendingImages--;
          if (pendingImages === 0) {
            isLoadingSlideRef.current = false;
          }
        };
        imgEl.onerror = () => {
          pendingImages--;
          if (pendingImages === 0) {
            isLoadingSlideRef.current = false;
          }
        };
        imgEl.src = el.src;
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
  }, [currentSlideIndex, loadSlideToCanvas]);

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
        }
        elements.push(imgData);
      } else if (objType === 'table') {
        elements.push({
          ...base,
          type: 'table',
          tableJSON: obj.__tableJSON || null,
        });
      }
    }

    return {
      elements,
      background: canvas.backgroundColor || '#ffffff',
      backgroundImage: slides[currentSlideIndex]?.backgroundImage || undefined,
      notes: slides[currentSlideIndex]?.notes || '',
    };
  }, [currentSlideIndex, slides]);

  const saveCurrentSlideToState = useCallback(() => {
    const serialized = serializeCanvas();
    if (!serialized) return;

    setSlides(prev => {
      const updated = [...prev];
      updated[currentSlideIndex] = serialized;
      triggerSave(updated);
      return updated;
    });
  }, [currentSlideIndex, serializeCanvas, triggerSave]);

  saveCurrentSlideToStateRef.current = saveCurrentSlideToState;

  // ─── Slide Operations ─────────────────────────────
  const addSlide = useCallback(() => {
    saveCurrentSlideToState();
    setSlides(prev => {
      const updated = [...prev, { ...DEFAULT_SLIDE }];
      triggerSave(updated);
      return updated;
    });
    setCurrentSlideIndex(slides.length);
  }, [slides.length, saveCurrentSlideToState, triggerSave]);

  const duplicateSlide = useCallback(() => {
    const serialized = serializeCanvas();
    if (!serialized) return;
    setSlides(prev => {
      const updated = [...prev];
      updated.splice(currentSlideIndex + 1, 0, JSON.parse(JSON.stringify(serialized)));
      triggerSave(updated);
      return updated;
    });
    setCurrentSlideIndex(currentSlideIndex + 1);
  }, [currentSlideIndex, serializeCanvas, triggerSave]);

  const deleteSlide = useCallback(() => {
    if (slides.length <= 1) return;
    setSlides(prev => {
      const updated = prev.filter((_, i) => i !== currentSlideIndex);
      triggerSave(updated);
      return updated;
    });
    setCurrentSlideIndex(Math.min(currentSlideIndex, slides.length - 2));
  }, [currentSlideIndex, slides.length, triggerSave]);

  const moveSlide = useCallback((dir: -1 | 1) => {
    const newIdx = currentSlideIndex + dir;
    if (newIdx < 0 || newIdx >= slides.length) return;
    saveCurrentSlideToState();
    setSlides(prev => {
      const updated = [...prev];
      [updated[currentSlideIndex], updated[newIdx]] = [updated[newIdx], updated[currentSlideIndex]];
      triggerSave(updated);
      return updated;
    });
    setCurrentSlideIndex(newIdx);
  }, [currentSlideIndex, slides.length, saveCurrentSlideToState, triggerSave]);

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
    canvas.add(text);
    canvas.setActiveObject(text);
    canvas.renderAll();
    setSelectedTool('select');
  }, []);

  const [showShapePicker, setShowShapePicker] = useState(false);

  const addShape = useCallback((shapeType: ShapeType) => {
    const canvas = canvasRef.current;
    if (!canvas || !fabricModule) return;

    const obj = createFabricShape(fabricModule, shapeType, {
      left: 100, top: 100,
      fill: '#e2e8f0', stroke: '#94a3b8', strokeWidth: 1,
    });
    if (!obj) return;

    canvas.add(obj);
    canvas.setActiveObject(obj);
    canvas.renderAll();
    setSelectedTool('select');
    setShowShapePicker(false);
  }, [fabricModule]);

  // FIX 3: Upload images to server instead of base64
  const addImage = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async () => {
      const file = input.files?.[0];
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
          body: formData,
        });
        if (!resp.ok) throw new Error('Upload failed');
        const data = await resp.json();
        // Prefix with gateway base URL for full URL
        imgSrc = data.url?.startsWith('http') ? data.url : `/api/gateway${data.url?.replace(/^\/api/, '')}`;
      } catch (err) {
        console.error('Image upload failed, falling back to base64:', err);
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
        canvas.add(fabricImg);
        canvas.setActiveObject(fabricImg);
        canvas.renderAll();
      };
      imgEl.src = imgSrc;
    };
    input.click();
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

    // Store table data as ProseMirror JSON
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
      const res = await fetch(`/api/gateway/diagrams/${diagramId}`);
      if (!res.ok) throw new Error('Failed to load diagram');
      const data = await res.json();
      const cells = data.data?.cells || data.data?.nodes || [];

      const svgStr = renderCellsToSVG(cells);
      const blob = new Blob([svgStr], { type: 'image/svg+xml' });
      const url = URL.createObjectURL(blob);

      const { FabricImage } = fabricModule;
      const imgEl = new window.Image();
      imgEl.onload = () => {
        const scale = Math.min(400 / (imgEl.width || 400), 300 / (imgEl.height || 300), 1);
        const fabricImg = new FabricImage(imgEl, {
          left: 100,
          top: 100,
          scaleX: scale,
          scaleY: scale,
        });
        (fabricImg as any).__diagramId = diagramId;
        canvas.add(fabricImg);
        canvas.setActiveObject(fabricImg);
        canvas.renderAll();
        URL.revokeObjectURL(url);
      };
      imgEl.onerror = () => {
        console.error('Failed to load diagram SVG as image');
        URL.revokeObjectURL(url);
      };
      imgEl.src = url;
    } catch (err) {
      console.error('Failed to insert diagram:', err);
    }
  }, [fabricModule]);

  const handleDiagramEditorClose = useCallback(async () => {
    const closingId = editingDiagramId;
    setEditingDiagramId(null);

    const canvas = canvasRef.current;
    if (!canvas || !closingId || !fabricModule) return;

    try {
      const res = await fetch(`/api/gateway/diagrams/${closingId}`);
      if (!res.ok) return;
      const data = await res.json();
      const cells = data.data?.cells || data.data?.nodes || [];
      const svgStr = renderCellsToSVG(cells);
      const blob = new Blob([svgStr], { type: 'image/svg+xml' });
      const url = URL.createObjectURL(blob);

      const objects = canvas.getObjects();
      const target = objects.find((o: any) => (o as any).__diagramId === closingId);
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
          (newImg as any).__diagramId = closingId;
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
      console.error('Failed to refresh diagram preview:', err);
    }
  }, [editingDiagramId, fabricModule]);

  const deleteSelected = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const active = canvas.getActiveObjects();
    if (active.length > 0) {
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

  // Title editing now handled by ContentTopBar

  // ─── Delete Presentation ──────────────────────────
  const handleDelete = useCallback(async () => {
    setShowMenu(false);
    await gw.deleteContentItem(`presentation:${presentationId}`);
    queryClient.invalidateQueries({ queryKey: ['content-items'] });
    onDeleted?.();
  }, [presentationId, queryClient, onDeleted]);

  // ─── Export PNG ───────────────────────────────────
  const handleDownload = useCallback(() => {
    setShowMenu(false);
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
      triggerSave(updated);
      return updated;
    });
  }, [currentSlideIndex, triggerSave]);

  const handleApplyBackgroundToAll = useCallback(() => {
    const bg = slides[currentSlideIndex]?.background || '#ffffff';
    setSlides(prev => {
      const updated = prev.map(s => ({ ...s, background: bg }));
      triggerSave(updated);
      return updated;
    });
  }, [currentSlideIndex, slides, triggerSave]);

  const handleSlideBackgroundImageChange = useCallback((bgImage: string | undefined) => {
    setSlides(prev => {
      const updated = [...prev];
      updated[currentSlideIndex] = { ...updated[currentSlideIndex], backgroundImage: bgImage };
      triggerSave(updated);
      return updated;
    });
  }, [currentSlideIndex, triggerSave]);

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
        <div className="text-sm">{t('common.loading') || 'Loading...'}</div>
      </div>
    );
  }

  if (!presentation) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground">
        <div className="text-sm">Presentation not found</div>
      </div>
    );
  }

  // ─── Mobile Vertical Preview Mode ────────────────
  if (isMobileView && !mobileEditMode) {
    const previewSlides = slides.map((slide, i) => ({
      id: String(i),
      data: slide,
    }));

    return (
      <div ref={containerRef} className="flex-1 flex flex-col min-h-0 bg-card">
        {/* Header */}
        <div className="flex items-center border-b border-border shrink-0">
          <ContentTopBar
            breadcrumb={breadcrumb}
            onBack={onBack}
            docListVisible={docListVisible}
            onToggleDocList={onToggleDocList}
            title={currentTitle || t('content.untitledPresentation') || 'Untitled Presentation'}
            titlePlaceholder={t('content.untitledPresentation') || 'Untitled Presentation'}
            onTitleChange={async (newTitle) => {
              if (newTitle !== currentTitle) {
                await gw.updateContentItem(`presentation:${presentationId}`, { title: newTitle });
                queryClient.invalidateQueries({ queryKey: ['content-items'] });
              }
            }}
            actions={<>
              <button
                onClick={startPresentation}
                className="flex items-center gap-1 px-2 py-1 rounded text-sm bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                title="Present"
              >
                <Play className="h-3.5 w-3.5" />
              </button>
            </>}
          />
        </div>
        {/* Vertical scroll preview */}
        <SlidePreviewList
          slides={previewSlides}
          currentSlideIndex={currentSlideIndex}
          onSlideSelect={(i) => {
            setCurrentSlideIndex(i);
            setMobileEditMode(true);
          }}
        />
        {/* Edit FAB */}
        <EditFAB
          isEditing={false}
          onEdit={() => setMobileEditMode(true)}
          onSave={() => {}}
          onCancel={() => {}}
        />
      </div>
    );
  }

  return (
    <div ref={containerRef} className="flex-1 flex flex-row min-h-0 bg-card">
      {/* Left column: TopBar + Toolbar + main area */}
      <div className="flex-1 flex flex-col min-h-0 min-w-0">
      {/* ─── Header Bar ─── */}
      <div className="flex items-center border-b border-border shrink-0">
        <ContentTopBar
          breadcrumb={breadcrumb}
          onBack={isMobileView && mobileEditMode ? () => setMobileEditMode(false) : onBack}
          docListVisible={docListVisible}
          onToggleDocList={onToggleDocList}
          title={currentTitle || t('content.untitledPresentation') || 'Untitled Presentation'}
          titlePlaceholder={t('content.untitledPresentation') || 'Untitled Presentation'}
          onTitleChange={async (newTitle) => {
            if (newTitle !== currentTitle) {
              await gw.updateContentItem(`presentation:${presentationId}`, { title: newTitle });
              queryClient.invalidateQueries({ queryKey: ['content-items'] });
            }
          }}
          metaLine={
            <div className="text-[11px] text-muted-foreground/50">
              {formatRelativeTime(presentation.updated_at)}
              {presentation.updated_by && <span> &middot; {presentation.updated_by}</span>}
            </div>
          }
          actions={<>
            <button
              onClick={startPresentation}
              className="flex items-center gap-1 px-2 py-1 rounded text-sm bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
              title="Present"
            >
              <Play className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Present</span>
            </button>
            <button
              onClick={() => { setShowComments(v => !v); setShowHistory(false); }}
              className={cn('p-1.5 rounded transition-colors', showComments ? 'text-[#2fcc71] bg-[#2fcc71]/10' : 'text-[#2fcc71] hover:text-[#27ae60]')}
              title={t('content.comments') || 'Comments'}
            >
              <MessageSquare className="h-5 w-5 md:h-4 md:w-4" />
            </button>
            <div className="relative">
              <button
                onClick={() => setShowMenu(v => !v)}
                className="p-1.5 text-muted-foreground hover:text-foreground shrink-0"
                title={t('content.moreActions') || 'More'}
              >
                <MoreHorizontal className="h-5 w-5 md:h-4 md:w-4" />
              </button>
              {showMenu && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setShowMenu(false)} />
                  <div className="absolute right-0 top-full mt-1 z-20 bg-card border border-border rounded-lg shadow-xl py-1 w-52">
                    <MenuBtn icon={Clock} label={t('content.versionHistory') || 'Version History'} onClick={() => {
                      setShowMenu(false);
                      setShowHistory(true);
                      setShowComments(false);
                    }} />
                    <MenuBtn icon={Link2} label={t('content.copyLink') || 'Copy Link'} onClick={() => {
                      setShowMenu(false);
                      onCopyLink?.();
                    }} />
                    <MenuBtn icon={Download} label={t('content.download') || 'Download PNG'} onClick={handleDownload} />
                    <div className="border-t border-border my-1" />
                    <MenuBtn icon={Trash2} label={t('content.delete') || 'Delete'} onClick={handleDelete} danger />
                  </div>
                </>
              )}
            </div>
          </>}
        />
      </div>

      {/* ─── Toolbar (simplified) ──────────────────────── */}
      <div className="flex items-center gap-1 px-3 py-1.5 border-b border-border shrink-0 bg-muted/30">
        <ToolBtn icon={MousePointer2} active={selectedTool === 'select'} onClick={() => setSelectedTool('select')} title="Select" />
        <div className="w-px h-5 bg-border mx-1" />
        <ToolBtn icon={Type} onClick={addTextbox} title="Text" />
        <div className="relative">
          <ToolBtn icon={Hexagon} active={showShapePicker} onClick={() => setShowShapePicker(v => !v)} title="Shapes" />
          {showShapePicker && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setShowShapePicker(false)} />
              <div className="absolute left-0 top-full mt-1 z-20">
                <ShapePicker onSelect={addShape} columns={6} />
              </div>
            </>
          )}
        </div>
        <ToolBtn icon={ImageIcon} onClick={addImage} title="Image" />
        <ToolBtn icon={Table2} onClick={() => addTable(3, 3)} title="Table" />
        <ToolBtn icon={Workflow} onClick={insertDiagram} title="Insert Diagram" />
        <div className="w-px h-5 bg-border mx-1" />
        {/* Spacer to push format toggle to the right */}
        <div className="flex-1" />
        <button
          onClick={() => setShowPropertyPanel(v => !v)}
          className={cn(
            'p-1 rounded transition-colors',
            showPropertyPanel ? 'text-primary bg-primary/10' : 'text-muted-foreground hover:text-foreground'
          )}
          title={showPropertyPanel ? 'Hide properties' : 'Show properties'}
        >
          {showPropertyPanel ? <PanelRightClose className="h-4 w-4" /> : <PanelRight className="h-4 w-4" />}
        </button>
      </div>

      {/* ─── Main Area: Slide List + Canvas + Property Panel ── */}
      <div className="flex-1 flex min-h-0">
        {/* Slide List (left) — hidden on mobile */}
        <div className="w-[220px] border-r border-border flex-col shrink-0 bg-muted/20 hidden md:flex">
          <div className="flex items-center justify-between px-3 py-2 border-b border-border">
            <span className="text-xs font-medium text-muted-foreground">Slides ({slides.length})</span>
            <button onClick={addSlide} className="p-1 text-muted-foreground hover:text-foreground" title="Add slide">
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-2 space-y-2">
            {slides.map((slide, i) => (
              <button
                key={i}
                onClick={() => {
                  if (i !== currentSlideIndex) {
                    saveCurrentSlideToState();
                    setCurrentSlideIndex(i);
                  }
                }}
                className={cn(
                  'w-full rounded-lg border-2 transition-all overflow-hidden',
                  i === currentSlideIndex
                    ? 'border-primary shadow-sm'
                    : 'border-transparent hover:border-border'
                )}
              >
                <div className="flex items-center gap-2 px-2">
                  <span className="text-[10px] text-muted-foreground shrink-0 w-4 text-right">{i + 1}</span>
                  <div
                    className="flex-1 rounded overflow-hidden my-1"
                    style={{
                      aspectRatio: `${SLIDE_WIDTH}/${SLIDE_HEIGHT}`,
                      backgroundColor: slide.background || '#fff',
                    }}
                  >
                    <SlideThumb slide={slide} />
                  </div>
                </div>
              </button>
            ))}
          </div>
          {/* Slide actions */}
          <div className="flex items-center justify-center gap-1 px-2 py-1.5 border-t border-border">
            <button onClick={duplicateSlide} className="p-1 text-muted-foreground hover:text-foreground" title="Duplicate slide">
              <Copy className="h-3.5 w-3.5" />
            </button>
            <button onClick={() => moveSlide(-1)} disabled={currentSlideIndex === 0} className="p-1 text-muted-foreground hover:text-foreground disabled:opacity-30" title="Move up">
              <ChevronUp className="h-3.5 w-3.5" />
            </button>
            <button onClick={() => moveSlide(1)} disabled={currentSlideIndex >= slides.length - 1} className="p-1 text-muted-foreground hover:text-foreground disabled:opacity-30" title="Move down">
              <ChevronDown className="h-3.5 w-3.5" />
            </button>
            <button onClick={deleteSlide} disabled={slides.length <= 1} className="p-1 text-muted-foreground hover:text-destructive disabled:opacity-30" title="Delete slide">
              <Minus className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {/* Canvas Area (center) */}
        <div ref={canvasContainerRef} className="flex-1 min-w-0 overflow-hidden bg-[#f0f0f0] dark:bg-zinc-900 relative">
          <div className="canvas-wrapper absolute">
            <div ref={canvasHostRef} className="shadow-xl rounded-sm" />
          </div>
          {/* Floating toolbar — adapts to object type */}
          {selectedObj && canvasRef.current && canvasContainerRef.current && (() => {
            const objType = getObjType(selectedObj);
            if (objType === 'table') return null; // table handled by PPTTableOverlay

            const canvas = canvasRef.current!;
            const container = canvasContainerRef.current!;
            const zoom = canvas.getZoom() || 1;
            const wrapper = container.querySelector('.canvas-wrapper') as HTMLElement;
            const containerRect = container.getBoundingClientRect();
            const wrapperLeft = wrapper ? parseFloat(wrapper.style.marginLeft || '0') : 0;
            const wrapperTop = wrapper ? parseFloat(wrapper.style.marginTop || '0') : 0;
            const objLeft = (selectedObj.left || 0) * zoom + wrapperLeft;
            const objTop = (selectedObj.top || 0) * zoom + wrapperTop;
            const objWidth = (selectedObj.width || 0) * (selectedObj.scaleX || 1) * zoom;
            const anchor = {
              top: containerRect.top + objTop,
              left: containerRect.left + objLeft,
              width: objWidth,
            };

            let items, handler;
            if (objType === 'textbox') {
              items = PPT_TEXT_ITEMS;
              handler = createPPTTextHandler({ obj: selectedObj, canvas });
            } else if (objType === 'image') {
              items = PPT_IMAGE_ITEMS;
              handler = createPPTImageHandler({ obj: selectedObj, canvas });
            } else if (objType === 'rect' || objType === 'circle' || objType === 'triangle') {
              items = PPT_SHAPE_ITEMS;
              handler = createPPTShapeHandler({ obj: selectedObj, canvas });
            } else {
              return null;
            }

            return (
              <FloatingToolbar
                items={items}
                handler={handler}
                anchor={anchor}
                visible={true}
              />
            );
          })()}
          {/* Table DOM overlays — always visible for all table objects */}
          {tableObjects.map((tObj, idx) => (
            <PPTTableOverlay
              key={tObj.__uid || idx}
              obj={tObj}
              canvas={canvasRef.current}
              containerRef={canvasContainerRef}
              propVersion={propVersion}
              isSelected={selectedObj === tObj}
            />
          ))}
        </div>

        {/* Property Panel (right) */}
        {showPropertyPanel && (
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
          <div className="hidden md:flex w-80 border-l border-border bg-card flex-col shrink-0 overflow-hidden h-full">
            <CommentPanel
              targetType="presentation"
              targetId={`presentation:${presentationId}`}
              onClose={() => setShowComments(false)}
            />
          </div>
          <BottomSheet open={true} onClose={() => setShowComments(false)} title="Comments" initialHeight="full">
            <CommentPanel
              targetType="presentation"
              targetId={`presentation:${presentationId}`}
              onClose={() => setShowComments(false)}
            />
          </BottomSheet>
        </>
      )}

      {showHistory && (
        <>
          <div className="hidden md:flex w-72 border-l border-border bg-card flex-col shrink-0 overflow-hidden h-full">
            <RevisionHistory
              contentType="presentation"
              contentId={presentationId}
              onClose={() => setShowHistory(false)}
              onRestore={async (data) => {
                if (data?.slides) {
                  setSlides(data.slides);
                  setCurrentSlideIndex(0);
                  await gw.savePresentation(presentationId, { slides: data.slides });
                  queryClient.invalidateQueries({ queryKey: ['presentation', presentationId] });
                }
              }}
            />
          </div>
          {/* Mobile: RevisionHistory renders its own BottomSheet internally via portal */}
          <div className="contents md:hidden">
            <RevisionHistory
              contentType="presentation"
              contentId={presentationId}
              onClose={() => setShowHistory(false)}
              onRestore={async (data) => {
                if (data?.slides) {
                  setSlides(data.slides);
                  setCurrentSlideIndex(0);
                  await gw.savePresentation(presentationId, { slides: data.slides });
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
          {selectedObj ? `${objType || 'Object'} Properties` : 'Slide Properties'}
        </span>
        <button onClick={onClose} className="p-0.5 text-muted-foreground hover:text-foreground transition-colors" title="Close panel">
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
          title="Bring to front"
        >
          <ArrowUpToLine className="h-3 w-3" /> Front
        </button>
        <button
          onClick={() => { canvas?.bringObjectForward(obj); canvas?.renderAll(); canvas?.fire('object:modified', { target: obj }); }}
          className="flex-1 py-1 rounded border border-border text-muted-foreground hover:text-foreground hover:bg-accent transition-colors flex items-center justify-center gap-1"
          title="Bring forward"
        >
          <MoveUp className="h-3 w-3" />
        </button>
        <button
          onClick={() => { canvas?.sendObjectBackwards(obj); canvas?.renderAll(); canvas?.fire('object:modified', { target: obj }); }}
          className="flex-1 py-1 rounded border border-border text-muted-foreground hover:text-foreground hover:bg-accent transition-colors flex items-center justify-center gap-1"
          title="Send backward"
        >
          <MoveDown className="h-3 w-3" />
        </button>
        <button
          onClick={() => { canvas?.sendObjectToBack(obj); canvas?.renderAll(); canvas?.fire('object:modified', { target: obj }); }}
          className="flex-1 py-1 rounded border border-border text-muted-foreground hover:text-foreground hover:bg-accent transition-colors flex items-center justify-center gap-1"
          title="Send to back"
        >
          <ArrowDownToLine className="h-3 w-3" /> Back
        </button>
      </div>

      {/* Flip */}
      <div className="flex items-center gap-1">
        <button
          onClick={() => { obj.set('flipX', !obj.flipX); canvas?.renderAll(); canvas?.fire('object:modified', { target: obj }); }}
          className="flex-1 py-1 rounded border border-border text-muted-foreground hover:text-foreground hover:bg-accent transition-colors flex items-center justify-center gap-1"
          title="Flip horizontal"
        >
          <FlipHorizontal2 className="h-3 w-3" /> Flip H
        </button>
        <button
          onClick={() => { obj.set('flipY', !obj.flipY); canvas?.renderAll(); canvas?.fire('object:modified', { target: obj }); }}
          className="flex-1 py-1 rounded border border-border text-muted-foreground hover:text-foreground hover:bg-accent transition-colors flex items-center justify-center gap-1"
          title="Flip vertical"
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
              <option key={f.value} value={f.value} style={{ fontFamily: f.value }}>{f.label}</option>
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
            title="Bold"
          >
            <Bold className="h-3.5 w-3.5" />
          </ToggleBtn>
          <ToggleBtn
            active={obj.fontStyle === 'italic'}
            onClick={() => updateAndSave('fontStyle', obj.fontStyle === 'italic' ? 'normal' : 'italic')}
            title="Italic"
          >
            <Italic className="h-3.5 w-3.5" />
          </ToggleBtn>
          <ToggleBtn
            active={!!obj.underline}
            onClick={() => updateAndSave('underline', !obj.underline)}
            title="Underline"
          >
            <Underline className="h-3.5 w-3.5" />
          </ToggleBtn>
          <ToggleBtn
            active={!!obj.linethrough}
            onClick={() => updateAndSave('linethrough', !obj.linethrough)}
            title="Strikethrough"
          >
            <Strikethrough className="h-3.5 w-3.5" />
          </ToggleBtn>
        </div>

        {/* Text align */}
        <div className="flex items-center gap-1">
          <ToggleBtn active={obj.textAlign === 'left'} onClick={() => updateAndSave('textAlign', 'left')} title="Left">
            <AlignLeft className="h-3.5 w-3.5" />
          </ToggleBtn>
          <ToggleBtn active={obj.textAlign === 'center'} onClick={() => updateAndSave('textAlign', 'center')} title="Center">
            <AlignCenter className="h-3.5 w-3.5" />
          </ToggleBtn>
          <ToggleBtn active={obj.textAlign === 'right'} onClick={() => updateAndSave('textAlign', 'right')} title="Right">
            <AlignRight className="h-3.5 w-3.5" />
          </ToggleBtn>
          <ToggleBtn active={obj.textAlign === 'justify'} onClick={() => updateAndSave('textAlign', 'justify')} title="Justify">
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
          items={DOCS_TABLE_ITEMS}
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
