'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
import type { Graph } from '@antv/x6';
import * as gw from '@/lib/api/gateway';
import { showError } from '@/lib/utils/error';
import { getT } from '@/lib/i18n';

const AUTOSAVE_DEBOUNCE_MS = 500;

export function useAutoSave(graph: Graph | null, diagramId: string) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [reliabilityStatus, setReliabilityStatus] = useState<'clean' | 'dirty' | 'flushing' | 'flush_failed'>('clean');
  const [flushRetryCount, setFlushRetryCount] = useState(0);
  const [lastSaved, setLastSaved] = useState<number | null>(null);
  const reliabilityStatusRef = useRef<string>('clean');
  reliabilityStatusRef.current = reliabilityStatus;

  const saveRef = useRef<(attempt?: number) => Promise<void> | void>(() => {});
  const dirtyRef = useRef(false);

  const save = useCallback(async (attempt = 0) => {
    if (!graph) return;
    if (!dirtyRef.current && attempt === 0) return; // Nothing changed
    setReliabilityStatus('flushing');
    try {
      const json = graph.toJSON();
      // Filter out transient preview cells (port hover previews)
      if (json.cells) {
        json.cells = json.cells.filter((c: any) => !c.data?._isPreview);
      }
      const { sx } = graph.scale();
      const { tx, ty } = graph.translate();
      const diagramData = {
        ...json,
        viewport: { x: tx, y: ty, zoom: sx },
      } as any;
      await gw.saveDiagram(diagramId, diagramData);
      dirtyRef.current = false;
      setLastSaved(Date.now());
      setReliabilityStatus('clean');
      setFlushRetryCount(0);
    } catch (e) {
      if (attempt < 2) {
        setFlushRetryCount(attempt + 1);
        setTimeout(() => save(attempt + 1), 400 * (attempt + 1));
        return;
      }
      showError(getT()('errors.autoSaveFailed'), e);
      setReliabilityStatus('flush_failed');
      setFlushRetryCount(attempt + 1);
    }
  }, [graph, diagramId]);

  saveRef.current = save;

  const scheduleSave = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(save, AUTOSAVE_DEBOUNCE_MS);
  }, [save]);

  // Immediate flush helper (for visibility change, unmount)
  // Returns the save promise so callers can await completion
  const flushSave = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (dirtyRef.current) {
      return saveRef.current();
    }
  }, []);

  useEffect(() => {
    if (!graph) return;

    // Listen to model changes
    const handler = () => {
      dirtyRef.current = true;
      setReliabilityStatus(prev => prev === 'flush_failed' ? prev : 'dirty');
      scheduleSave();
    };
    graph.on('cell:added', handler);
    graph.on('cell:removed', handler);
    graph.on('cell:changed', handler);
    graph.on('node:moved', handler);
    graph.on('node:resized', handler);
    graph.on('edge:connected', handler);

    // Flush on page visibility change (tab switch, window switch)
    const onVisibilityChange = () => {
      if (document.hidden && dirtyRef.current) {
        saveRef.current();
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    // Flush on page unload using fetch with keepalive for reliability
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      // Prevent leaving in dirty or flush_failed state
      if (dirtyRef.current || reliabilityStatusRef.current === 'flush_failed') {
        e.preventDefault();
        e.returnValue = '';
      }
      // Attempt keepalive flush without changing local state
      // (keepalive not guaranteed to succeed; dirtyRef stays true for retry on cancel)
      if (!dirtyRef.current || !graph) return;
      try {
        const json = graph.toJSON();
        if (json.cells) json.cells = json.cells.filter((c: any) => !c.data?._isPreview);
        const { sx } = graph.scale();
        const { tx, ty } = graph.translate();
        const payload = JSON.stringify({
          data: { ...json, viewport: { x: tx, y: ty, zoom: sx } },
        });
        // keepalive fetch aligned with gw.saveDiagram (gateway.ts:405-410)
        fetch(`/api/gateway/diagrams/${diagramId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', ...gw.gwAuthHeaders() },
          body: payload,
          keepalive: true,
        }).catch(() => {});
        // Note: do NOT set dirtyRef.current = false — keepalive may fail
      } catch {}
    };
    window.addEventListener('beforeunload', onBeforeUnload);

    return () => {
      graph.off('cell:added', handler);
      graph.off('cell:removed', handler);
      graph.off('cell:changed', handler);
      graph.off('node:moved', handler);
      graph.off('node:resized', handler);
      graph.off('edge:connected', handler);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('beforeunload', onBeforeUnload);
      // Flush pending save on unmount (e.g., switching to another content item)
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      if (dirtyRef.current && graph) {
        // Normal save (may not complete before unmount destroys graph)
        saveRef.current();
        // Backup: keepalive fetch survives unmount (same as beforeunload)
        try {
          const json = graph.toJSON();
          if (json.cells) json.cells = json.cells.filter((c: any) => !c.data?._isPreview);
          const { sx } = graph.scale();
          const { tx, ty } = graph.translate();
          const payload = JSON.stringify({
            data: { ...json, viewport: { x: tx, y: ty, zoom: sx } },
          });
          fetch(`/api/gateway/diagrams/${diagramId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', ...gw.gwAuthHeaders() },
            body: payload,
            keepalive: true,
          }).catch(() => {});
        } catch {}
      }
    };
  }, [graph, scheduleSave, diagramId]);

  return { save, lastSaved, reliabilityStatus, flushRetryCount, flushSave };
}
