'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as gw from '@/lib/api/gateway';
import {
  ArrowLeft, ArrowLeftToLine, ArrowRightToLine,
  MoreHorizontal, Link2, Download, Trash2, ChevronRight,
  Plus, Type, Square, Circle as CircleIcon, Triangle as TriangleIcon,
  Image as ImageIcon, Play, Copy, ChevronUp, ChevronDown,
  Undo2, Redo2, Presentation as PresentationIcon, Minus,
  MousePointer2, Bold, Italic, Underline, AlignLeft, AlignCenter, AlignRight,
  ArrowUpToLine, ArrowDownToLine, MoveUp, MoveDown,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useT } from '@/lib/i18n';

// ─── Types ──────────────────────────────────────────
interface SlideData {
  elements: any[];
  background: string;
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

  // Update Fabric canvas dimensions and zoom
  canvas.setDimensions({ width: canvasW, height: canvasH });
  canvas.setZoom(scale);
  canvas.renderAll();

  // Center the Fabric wrapper div within the container
  const wrapper = container.querySelector('.canvas-wrapper') as HTMLElement;
  if (wrapper) {
    wrapper.style.marginLeft = `${Math.max(0, Math.round((width - canvasW) / 2))}px`;
    wrapper.style.marginTop = `${Math.max(0, Math.round((height - canvasH) / 2))}px`;
  }
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
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [slides, setSlides] = useState<SlideData[]>([]);
  const [currentSlideIndex, setCurrentSlideIndex] = useState(0);
  const [selectedTool, setSelectedTool] = useState<'select' | 'text' | 'rect' | 'circle' | 'triangle'>('select');
  const [isPresenting, setIsPresenting] = useState(false);

  // Refs
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const canvasRef = useRef<any>(null);
  const canvasHostRef = useRef<HTMLDivElement>(null); // div where Fabric mounts its canvas
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasContainerRef = useRef<HTMLDivElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const undoStackRef = useRef<string[]>([]);
  const redoStackRef = useRef<string[]>([]);
  const isLoadingSlideRef = useRef(false);
  const saveCurrentSlideToStateRef = useRef<() => void>(() => {});
  const modifiedDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    }, 800);
  }, [presentationId]);

  // ─── Canvas Setup ─────────────────────────────────
  useEffect(() => {
    if (!ready || !canvasHostRef.current || canvasRef.current) return;

    // Create a canvas element outside React's control
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

    // Initial fit to container — use rAF to ensure layout has settled
    requestAnimationFrame(() => {
      fitCanvasToContainer(canvas, canvasContainerRef.current);
    });

    // Track changes for undo and auto-save — use ref to always get latest closure
    // Debounce during text editing to avoid cursor lag
    const handleModified = () => {
      if (isLoadingSlideRef.current) return;
      if (modifiedDebounceRef.current) clearTimeout(modifiedDebounceRef.current);
      modifiedDebounceRef.current = setTimeout(() => {
        saveCurrentSlideToStateRef.current();
      }, 300);
    };
    // Immediate save for add/remove (not frequent like text editing)
    const handleAddRemove = () => {
      if (isLoadingSlideRef.current) return;
      saveCurrentSlideToStateRef.current();
    };

    canvas.on('object:modified', handleModified);
    canvas.on('text:changed', handleModified);
    canvas.on('object:added', handleAddRemove);
    canvas.on('object:removed', handleAddRemove);

    // ResizeObserver for responsive sizing
    const container = canvasContainerRef.current;
    let observer: ResizeObserver | null = null;
    if (container) {
      observer = new ResizeObserver(() => fitCanvasToContainer(canvas, container));
      observer.observe(container);
    }

    return () => {
      observer?.disconnect();
      canvas.dispose();
      canvasRef.current = null;
    };
    // re-run when ready or when loading completes (so canvasHostRef is in DOM)
  }, [ready, isLoading]);

  // ─── Load slide onto canvas ───────────────────────
  const loadSlideToCanvas = useCallback((slide: SlideData) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    isLoadingSlideRef.current = true;

    canvas.clear();
    canvas.backgroundColor = slide.background || '#ffffff';

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
          textAlign: el.textAlign || 'left',
          lineHeight: el.lineHeight || 1.3,
          fontFamily: el.fontFamily || 'Inter, system-ui, sans-serif',
        });
      } else if (el.type === 'rect') {
        obj = new Rect({
          ...common,
          rx: el.rx || 0,
          ry: el.ry || 0,
          stroke: el.stroke || '',
          strokeWidth: el.strokeWidth || 0,
        });
      } else if (el.type === 'circle') {
        obj = new Circle({
          ...common,
          radius: el.radius || 50,
          stroke: el.stroke || '',
          strokeWidth: el.strokeWidth || 0,
        });
      } else if (el.type === 'triangle') {
        obj = new Triangle({
          ...common,
          stroke: el.stroke || '',
          strokeWidth: el.strokeWidth || 0,
        });
      } else if (el.type === 'image' && el.src) {
        // Async image loading — keep isLoadingSlideRef true until all images load
        pendingImages++;
        const imgEl = new window.Image();
        imgEl.crossOrigin = 'anonymous';
        imgEl.onload = () => {
          const fabricImg = new FabricImage(imgEl, {
            left: el.left || 0,
            top: el.top || 0,
            scaleX: (el.width || 200) / imgEl.width,
            scaleY: (el.height || 200) / imgEl.height,
            angle: el.angle || 0,
          });
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
      }

      if (obj) {
        canvas.add(obj);
      }
    }

    canvas.renderAll();
    // Only mark loading done if no async images are pending
    if (pendingImages === 0) {
      isLoadingSlideRef.current = false;
    }
  }, []);

  // Keep a ref to slides so loadSlideToCanvas effect doesn't depend on slides state
  const slidesRef = useRef<SlideData[]>(slides);
  slidesRef.current = slides;

  // Load current slide when index changes (NOT when slides change — that causes infinite loop with images)
  useEffect(() => {
    if (slidesRef.current.length > 0 && canvasRef.current) {
      loadSlideToCanvas(slidesRef.current[currentSlideIndex] || DEFAULT_SLIDE);
    }
  }, [currentSlideIndex, loadSlideToCanvas]);

  // ─── Save canvas state back to slides ─────────────
  const serializeCanvas = useCallback((): SlideData | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;

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

      if (obj.type === 'textbox' || obj.type === 'Textbox') {
        elements.push({
          ...base,
          type: 'textbox',
          text: obj.text || '',
          fontSize: obj.fontSize || 24,
          fontWeight: obj.fontWeight || 'normal',
          fontStyle: obj.fontStyle || 'normal',
          underline: obj.underline || false,
          textAlign: obj.textAlign || 'left',
          lineHeight: obj.lineHeight || 1.3,
          fontFamily: obj.fontFamily || 'Inter, system-ui, sans-serif',
        });
      } else if (obj.type === 'rect' || obj.type === 'Rect') {
        elements.push({
          ...base,
          type: 'rect',
          rx: obj.rx || 0,
          ry: obj.ry || 0,
          stroke: obj.stroke || '',
          strokeWidth: obj.strokeWidth || 0,
        });
      } else if (obj.type === 'circle' || obj.type === 'Circle') {
        elements.push({
          ...base,
          type: 'circle',
          radius: obj.radius || 50,
          stroke: obj.stroke || '',
          strokeWidth: obj.strokeWidth || 0,
        });
      } else if (obj.type === 'triangle' || obj.type === 'Triangle') {
        elements.push({
          ...base,
          type: 'triangle',
          stroke: obj.stroke || '',
          strokeWidth: obj.strokeWidth || 0,
        });
      } else if (obj.type === 'image' || obj.type === 'Image') {
        elements.push({
          ...base,
          type: 'image',
          src: obj.getSrc?.() || '',
        });
      }
    }

    return {
      elements,
      background: canvas.backgroundColor || '#ffffff',
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

  // Keep ref in sync so canvas event handlers always use the latest version
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

  const addShape = useCallback((shape: 'rect' | 'circle' | 'triangle') => {
    const canvas = canvasRef.current;
    if (!canvas || !fabricModule) return;
    const { Rect, Circle, Triangle } = fabricModule;

    let obj: any;
    if (shape === 'rect') {
      obj = new Rect({ left: 100, top: 100, width: 200, height: 150, fill: '#e2e8f0', stroke: '#94a3b8', strokeWidth: 1, rx: 4, ry: 4 });
    } else if (shape === 'circle') {
      obj = new Circle({ left: 100, top: 100, radius: 80, fill: '#e2e8f0', stroke: '#94a3b8', strokeWidth: 1 });
    } else {
      obj = new Triangle({ left: 100, top: 100, width: 160, height: 140, fill: '#e2e8f0', stroke: '#94a3b8', strokeWidth: 1 });
    }

    canvas.add(obj);
    canvas.setActiveObject(obj);
    canvas.renderAll();
    setSelectedTool('select');
  }, []);

  const addImage = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const canvas = canvasRef.current;
        if (!canvas || !fabricModule) return;
        const { FabricImage } = fabricModule;
        const imgEl = new window.Image();
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
        imgEl.src = reader.result as string;
      };
      reader.readAsDataURL(file);
    };
    input.click();
  }, []);

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
      if (isEditingTitle) return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        // Don't delete when editing text inside a textbox
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
  }, [deleteSelected, isEditingTitle]);

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
      await gw.updateContentItem(`presentation:${presentationId}`, { title: newTitle });
      queryClient.invalidateQueries({ queryKey: ['content-items'] });
    }
  }, [editTitle, currentTitle, presentationId, queryClient]);

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

  // (resize observer is set up in canvas setup effect above)

  // ─── Property Panel (selected object) ─────────────
  const [selectedObj, setSelectedObj] = useState<any>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onSelect = () => setSelectedObj(canvas.getActiveObject());
    const onDeselect = () => setSelectedObj(null);
    canvas.on('selection:created', onSelect);
    canvas.on('selection:updated', onSelect);
    canvas.on('selection:cleared', onDeselect);
    return () => {
      canvas.off('selection:created', onSelect);
      canvas.off('selection:updated', onSelect);
      canvas.off('selection:cleared', onDeselect);
    };
  }, [ready, isLoading]);

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

  return (
    <div ref={containerRef} className="flex-1 flex flex-col min-h-0 bg-white dark:bg-card">
      {/* ─── Header Bar (consistent with BoardEditor) ─── */}
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
                    {crumb.title || (t('content.untitledPresentation') || 'Untitled Presentation')}
                  </button>
                )}
              </span>
            ))}
          </div>
          <div className="text-[11px] text-muted-foreground/50 mt-0.5">
            {formatRelativeTime(presentation.updated_at)}
            {presentation.updated_by && <span> &middot; {presentation.updated_by}</span>}
          </div>
        </div>

        {/* Right actions */}
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            onClick={startPresentation}
            className="flex items-center gap-1 px-2 py-1 rounded text-sm bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
            title="Present"
          >
            <Play className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Present</span>
          </button>
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
                  <MenuBtn icon={Download} label={t('content.download') || 'Download PNG'} onClick={handleDownload} />
                  <div className="border-t border-border my-1" />
                  <MenuBtn icon={Trash2} label={t('content.delete') || 'Delete'} onClick={handleDelete} danger />
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* ─── Toolbar ──────────────────────────────────── */}
      <div className="flex items-center gap-1 px-3 py-1.5 border-b border-border shrink-0 bg-muted/30">
        <ToolBtn icon={MousePointer2} active={selectedTool === 'select'} onClick={() => setSelectedTool('select')} title="Select" />
        <div className="w-px h-5 bg-border mx-1" />
        <ToolBtn icon={Type} onClick={addTextbox} title="Text" />
        <ToolBtn icon={Square} onClick={() => addShape('rect')} title="Rectangle" />
        <ToolBtn icon={CircleIcon} onClick={() => addShape('circle')} title="Circle" />
        <ToolBtn icon={TriangleIcon} onClick={() => addShape('triangle')} title="Triangle" />
        <ToolBtn icon={ImageIcon} onClick={addImage} title="Image" />
        <div className="w-px h-5 bg-border mx-1" />
        {selectedObj && (selectedObj.type === 'textbox' || selectedObj.type === 'Textbox') && (
          <TextFormatBar obj={selectedObj} canvas={canvasRef.current} />
        )}
        {selectedObj && (
          <div className="flex items-center gap-1 ml-2">
            <label className="text-xs text-muted-foreground">Fill:</label>
            <input
              type="color"
              value={selectedObj.fill || '#333333'}
              onChange={(e) => {
                selectedObj.set('fill', e.target.value);
                canvasRef.current?.renderAll();
              }}
              className="w-6 h-6 rounded border border-border cursor-pointer"
            />
            {/* Stroke color — for shapes (not textbox) */}
            {selectedObj.type !== 'textbox' && selectedObj.type !== 'Textbox' && (
              <>
                <label className="text-xs text-muted-foreground ml-1">Stroke:</label>
                <input
                  type="color"
                  value={selectedObj.stroke || '#94a3b8'}
                  onChange={(e) => {
                    selectedObj.set('stroke', e.target.value);
                    if (!selectedObj.strokeWidth) selectedObj.set('strokeWidth', 1);
                    canvasRef.current?.renderAll();
                  }}
                  className="w-6 h-6 rounded border border-border cursor-pointer"
                />
                <select
                  value={selectedObj.strokeWidth || 0}
                  onChange={(e) => {
                    selectedObj.set('strokeWidth', Number(e.target.value));
                    canvasRef.current?.renderAll();
                  }}
                  className="text-xs bg-transparent border border-border rounded px-1 py-0.5 text-foreground w-[44px]"
                >
                  {[0, 1, 2, 3, 4, 5, 8].map(w => (
                    <option key={w} value={w}>{w}px</option>
                  ))}
                </select>
              </>
            )}
            {/* Layer ordering */}
            <div className="w-px h-4 bg-border mx-1" />
            <button
              onClick={() => { canvasRef.current?.bringObjectForward(selectedObj); canvasRef.current?.renderAll(); }}
              className="p-1 text-muted-foreground hover:text-foreground" title="Bring forward"
            >
              <MoveUp className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => { canvasRef.current?.sendObjectBackwards(selectedObj); canvasRef.current?.renderAll(); }}
              className="p-1 text-muted-foreground hover:text-foreground" title="Send backward"
            >
              <MoveDown className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => { canvasRef.current?.bringObjectToFront(selectedObj); canvasRef.current?.renderAll(); }}
              className="p-1 text-muted-foreground hover:text-foreground" title="Bring to front"
            >
              <ArrowUpToLine className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => { canvasRef.current?.sendObjectToBack(selectedObj); canvasRef.current?.renderAll(); }}
              className="p-1 text-muted-foreground hover:text-foreground" title="Send to back"
            >
              <ArrowDownToLine className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>

      {/* ─── Main Area: Slide List + Canvas + Properties ── */}
      <div className="flex-1 flex min-h-0">
        {/* Slide List (left) */}
        <div className="w-[220px] border-r border-border flex flex-col shrink-0 bg-muted/20">
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
        </div>
      </div>
    </div>
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

// ─── Text Format Bar ────────────────────────────────
const FONT_FAMILIES = [
  { label: 'Inter', value: 'Inter, system-ui, sans-serif' },
  { label: 'Arial', value: 'Arial, Helvetica, sans-serif' },
  { label: 'Georgia', value: 'Georgia, serif' },
  { label: 'Times New Roman', value: '"Times New Roman", Times, serif' },
  { label: 'Courier New', value: '"Courier New", Courier, monospace' },
  { label: 'Verdana', value: 'Verdana, Geneva, sans-serif' },
  { label: 'Trebuchet MS', value: '"Trebuchet MS", sans-serif' },
  { label: 'Comic Sans MS', value: '"Comic Sans MS", cursive' },
];

function TextFormatBar({ obj, canvas }: { obj: any; canvas: any }) {
  const update = (prop: string, val: any) => {
    obj.set(prop, val);
    canvas?.renderAll();
  };

  return (
    <div className="flex items-center gap-0.5">
      {/* Font family */}
      <select
        value={obj.fontFamily || 'Inter, system-ui, sans-serif'}
        onChange={(e) => update('fontFamily', e.target.value)}
        className="text-xs bg-transparent border border-border rounded px-1 py-0.5 text-foreground max-w-[100px]"
      >
        {FONT_FAMILIES.map(f => (
          <option key={f.value} value={f.value} style={{ fontFamily: f.value }}>{f.label}</option>
        ))}
      </select>
      <div className="w-px h-4 bg-border mx-0.5" />
      {/* Font size */}
      <select
        value={obj.fontSize || 24}
        onChange={(e) => update('fontSize', Number(e.target.value))}
        className="text-xs bg-transparent border border-border rounded px-1 py-0.5 text-foreground w-[44px]"
      >
        {[12, 14, 16, 18, 20, 24, 28, 32, 36, 42, 48, 56, 64, 72].map(s => (
          <option key={s} value={s}>{s}</option>
        ))}
      </select>
      <div className="w-px h-4 bg-border mx-0.5" />
      <button
        onClick={() => update('fontWeight', obj.fontWeight === 'bold' ? 'normal' : 'bold')}
        className={cn('p-1 rounded', obj.fontWeight === 'bold' ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground')}
      >
        <Bold className="h-3.5 w-3.5" />
      </button>
      <button
        onClick={() => update('fontStyle', obj.fontStyle === 'italic' ? 'normal' : 'italic')}
        className={cn('p-1 rounded', obj.fontStyle === 'italic' ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground')}
      >
        <Italic className="h-3.5 w-3.5" />
      </button>
      <button
        onClick={() => update('underline', !obj.underline)}
        className={cn('p-1 rounded', obj.underline ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground')}
      >
        <Underline className="h-3.5 w-3.5" />
      </button>
      <div className="w-px h-4 bg-border mx-0.5" />
      <button onClick={() => update('textAlign', 'left')} className={cn('p-1 rounded', obj.textAlign === 'left' ? 'text-primary' : 'text-muted-foreground')}>
        <AlignLeft className="h-3.5 w-3.5" />
      </button>
      <button onClick={() => update('textAlign', 'center')} className={cn('p-1 rounded', obj.textAlign === 'center' ? 'text-primary' : 'text-muted-foreground')}>
        <AlignCenter className="h-3.5 w-3.5" />
      </button>
      <button onClick={() => update('textAlign', 'right')} className={cn('p-1 rounded', obj.textAlign === 'right' ? 'text-primary' : 'text-muted-foreground')}>
        <AlignRight className="h-3.5 w-3.5" />
      </button>
    </div>
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
          // If text is too small to read, show a colored bar placeholder
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
          // CSS triangle via clip-path
          return <div key={i} style={{ ...style, backgroundColor: el.fill || '#e2e8f0', clipPath: 'polygon(50% 0%, 0% 100%, 100% 100%)' }} />;
        }
        if (el.type === 'image') {
          return <img key={i} src={el.src} alt="" style={{ ...style, objectFit: 'cover' }} />;
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
          const fi = new FabricImage(imgEl, { left: el.left || 0, top: el.top || 0, scaleX: (el.width || 200) / imgEl.width, scaleY: (el.height || 200) / imgEl.height, selectable: false, evented: false });
          canvas.add(fi);
          canvas.renderAll();
        };
        imgEl.src = el.src;
        continue;
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
      {/* Slide counter */}
      <div className="fixed bottom-4 right-4 text-white/50 text-sm z-50 cursor-default" onClick={(e) => e.stopPropagation()}>
        {index + 1} / {slides.length}
      </div>
      {/* Exit button */}
      <button
        className="fixed top-4 right-4 text-white/30 hover:text-white/70 text-sm z-50"
        onClick={(e) => { e.stopPropagation(); document.exitFullscreen?.().catch(() => {}); onExit(); }}
      >
        ESC
      </button>
    </div>
  );
}
