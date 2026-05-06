'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
import type { Graph } from '@antv/x6';
import * as gw from '@/lib/api/gateway';
import { API_BASE } from '@/lib/api/config';
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

  const dirtyRef = useRef(false);
  const diagramIdRef = useRef(diagramId);
  diagramIdRef.current = diagramId;

  // Cache last-known graph snapshot so cleanup can save even after graph.dispose().
  // Updated eagerly on every graph change — the only reliable source of truth
  // during unmount, since graph.toJSON() returns {cells:[]} after dispose().
  const lastSnapshotRef = useRef<string | null>(null);

  // Suppress dirty-marking during initial data load (fromJSON triggers cell:added
  // events for every cell, which would mark the graph dirty immediately).
  const suppressDirtyRef = useRef(false);

  // Track whether a save-in-flight is happening (to avoid double-save on unmount)
  const saveInFlightRef = useRef(false);

  // ── Core save: reads from graph (live) or snapshot (fallback) ──
  // This is the primary save path for debounced saves and manual flushes.
  const doSave = useCallback(async (attempt = 0): Promise<void> => {
    if (!dirtyRef.current && attempt === 0) return;
    saveInFlightRef.current = true;
    setReliabilityStatus('flushing');
    try {
      let payload: string | null = null;
      // Prefer live graph data; fall back to cached snapshot.
      // After graph.dispose(), toJSON() returns {cells:[]} which would
      // overwrite real data with empty. Detect this and use snapshot instead.
      if (graph) {
        try {
          const json = graph.toJSON();
          // Guard against disposed graph returning empty cells
          if (json.cells && json.cells.length > 0) {
            json.cells = json.cells.filter((c: any) => !c.data?._isPreview);
            if (json.cells.length > 0) {
              const { sx } = graph.scale();
              const { tx, ty } = graph.translate();
              payload = JSON.stringify({
                data: { ...json, viewport: { x: tx, y: ty, zoom: sx } },
              });
            }
          }
        } catch { /* graph may be disposed — fall through to snapshot */ }
      }
      // Fall back to eagerly-cached snapshot
      if (!payload) {
        if (lastSnapshotRef.current) {
          payload = lastSnapshotRef.current;
        } else {
          saveInFlightRef.current = false;
          return;
        }
      }

      await fetch(`${API_BASE}/diagrams/${diagramIdRef.current}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...gw.gwAuthHeaders() },
        body: payload,
      }).then(r => { if (!r.ok) throw new Error(`Save failed: ${r.status}`); });

      dirtyRef.current = false;
      lastSnapshotRef.current = null;
      setLastSaved(Date.now());
      setReliabilityStatus('clean');
      setFlushRetryCount(0);
    } catch (e) {
      if (attempt < 2) {
        setFlushRetryCount(attempt + 1);
        setTimeout(() => doSave(attempt + 1), 400 * (attempt + 1));
        return;
      }
      showError(getT()('errors.autoSaveFailed'), e);
      setReliabilityStatus('flush_failed');
      setFlushRetryCount(attempt + 1);
    } finally {
      saveInFlightRef.current = false;
    }
  }, [graph]);

  const saveRef = useRef(doSave);
  saveRef.current = doSave;

  const scheduleSave = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => saveRef.current(), AUTOSAVE_DEBOUNCE_MS);
  }, []);

  // ── Immediate flush: cancel timer + save now ──
  // Can be called by parent (via ref) BEFORE unmount to guarantee save while graph is alive.
  const flushSave = useCallback((): Promise<void> | void => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (dirtyRef.current) {
      return saveRef.current();
    }
  }, []);

  // ── Suppress dirty during initial load ──
  const beginSuppressDirty = useCallback(() => { suppressDirtyRef.current = true; }, []);
  const endSuppressDirty = useCallback(() => { suppressDirtyRef.current = false; }, []);

  useEffect(() => {
    if (!graph) return;

    // ── Listen to model changes ──
    const handler = () => {
      // Skip events from initial data load (fromJSON triggers cell:added for all cells)
      if (suppressDirtyRef.current) return;

      dirtyRef.current = true;
      // Eagerly snapshot graph data so cleanup can save after graph.dispose()
      try {
        const json = graph.toJSON();
        if (json.cells) json.cells = json.cells.filter((c: any) => !c.data?._isPreview);
        const { sx } = graph.scale();
        const { tx, ty } = graph.translate();
        lastSnapshotRef.current = JSON.stringify({
          data: { ...json, viewport: { x: tx, y: ty, zoom: sx } },
        });
      } catch { /* graph may be in transitional state — keep previous snapshot */ }
      setReliabilityStatus(prev => prev === 'flush_failed' ? prev : 'dirty');
      scheduleSave();
    };
    graph.on('cell:added', handler);
    graph.on('cell:removed', handler);
    graph.on('cell:changed', handler);
    graph.on('node:moved', handler);
    graph.on('node:resized', handler);
    graph.on('edge:connected', handler);

    // ── Flush on page visibility change (tab switch) ──
    const onVisibilityChange = () => {
      if (document.hidden && dirtyRef.current) {
        saveRef.current();
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    // ── Flush on page unload ──
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (dirtyRef.current || reliabilityStatusRef.current === 'flush_failed') {
        e.preventDefault();
        e.returnValue = '';
      }
      // keepalive fetch — best-effort for tab/window close
      const snapshot = lastSnapshotRef.current;
      if (!dirtyRef.current || !snapshot) return;
      try {
        fetch(`${API_BASE}/diagrams/${diagramIdRef.current}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', ...gw.gwAuthHeaders() },
          body: snapshot,
          keepalive: true,
        }).catch(() => {});
      } catch {}
    };
    window.addEventListener('beforeunload', onBeforeUnload);

    // ── Listen for flush requests from parent (selection change) ──
    const onFlushRequest = () => {
      if (dirtyRef.current) {
        saveRef.current();
      }
    };
    window.addEventListener('flush-diagram-save', onFlushRequest);

    return () => {
      graph.off('cell:added', handler);
      graph.off('cell:removed', handler);
      graph.off('cell:changed', handler);
      graph.off('node:moved', handler);
      graph.off('node:resized', handler);
      graph.off('edge:connected', handler);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('beforeunload', onBeforeUnload);
      window.removeEventListener('flush-diagram-save', onFlushRequest);

      // ── Cleanup: flush pending save ──
      // This is the LAST LINE OF DEFENSE. By this point, graph.dispose() may
      // have already run (useX6Graph cleanup runs first in effect order).
      // The preferred save path is via 'flush-diagram-save' event dispatched
      // by page.tsx before selection change, which runs while graph is alive.
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      // Only attempt cleanup save if there's dirty data AND no save already in flight
      // (the flush-diagram-save handler may have already started a save)
      if (dirtyRef.current && lastSnapshotRef.current && !saveInFlightRef.current) {
        fetch(`${API_BASE}/diagrams/${diagramIdRef.current}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', ...gw.gwAuthHeaders() },
          body: lastSnapshotRef.current,
          keepalive: true,
        }).catch(() => {});
        lastSnapshotRef.current = null;
      }
    };
  }, [graph, scheduleSave]);

  return {
    save: doSave,
    lastSaved,
    reliabilityStatus,
    flushRetryCount,
    flushSave,
    beginSuppressDirty,
    endSuppressDirty,
  };
}
