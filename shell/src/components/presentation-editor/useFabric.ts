'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { SLIDE_WIDTH, SLIDE_HEIGHT, fitCanvasToContainer } from './types';

// ─── Fabric.js Dynamic Import (singleton) ───────────
let fabricModule: any = null;
let fabricLoaded = false;

function loadFabric() {
  if (fabricLoaded) return Promise.resolve();
  return import('fabric').then((mod) => {
    fabricModule = mod;
    fabricLoaded = true;
  });
}

export function getFabricModule() {
  return fabricModule;
}

export function isFabricLoaded() {
  return fabricLoaded;
}

// ─── useFabric Hook ─────────────────────────────────
// Creates and manages a Fabric.js canvas instance.
// Returns { ready, canvasRef, canvasHostRef, canvasContainerRef, fabricModule }
export function useFabric({
  isDataLoading,
  onCanvasCreated,
}: {
  isDataLoading: boolean;
  onCanvasCreated?: (canvas: any) => void;
}) {
  const [ready, setReady] = useState(fabricLoaded);
  const canvasRef = useRef<any>(null);
  const canvasHostRef = useRef<HTMLDivElement>(null);
  const canvasContainerRef = useRef<HTMLDivElement>(null);

  // Load Fabric.js
  useEffect(() => {
    if (!fabricLoaded) {
      loadFabric().then(() => setReady(true));
    }
  }, []);

  // Create canvas
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

    // ResizeObserver for responsive sizing
    const container = canvasContainerRef.current;
    let observer: ResizeObserver | null = null;
    if (container) {
      observer = new ResizeObserver(() => fitCanvasToContainer(canvas, container));
      observer.observe(container);
    }

    onCanvasCreated?.(canvas);

    return () => {
      observer?.disconnect();
      canvas.dispose();
      canvasRef.current = null;
    };
  }, [ready, isDataLoading]);

  return {
    ready,
    canvasRef,
    canvasHostRef,
    canvasContainerRef,
    fabricModule: fabricModule as any,
  };
}
