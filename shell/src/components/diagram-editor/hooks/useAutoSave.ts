'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
import type { Graph } from '@antv/x6';
import * as gw from '@/lib/api/gateway';
import { showError } from '@/lib/utils/error';
import { getT } from '@/lib/i18n';

const AUTOSAVE_DEBOUNCE_MS = 500;

export function useAutoSave(graph: Graph | null, diagramId: string) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastRevisionRef = useRef<number>(0);
  const REVISION_INTERVAL = 5 * 60 * 1000; // 5 minutes
  const [lastSaved, setLastSaved] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  const saveRef = useRef<() => Promise<void> | void>(() => {});
  const dirtyRef = useRef(false);

  const save = useCallback(async () => {
    if (!graph) return;
    if (!dirtyRef.current) return; // Nothing changed
    setSaving(true);
    try {
      const json = graph.toJSON();
      // Filter out transient preview cells (port hover previews)
      if (json.cells) {
        json.cells = json.cells.filter((c: any) => !c.data?._isPreview);
      }
      const { sx } = graph.scale();
      const { tx, ty } = graph.translate();
      const diagramData = {
        nodes: [], edges: [], // Legacy compat — gateway ignores these if cells present
        ...json,
        viewport: { x: tx, y: ty, zoom: sx },
      } as any;
      await gw.saveDiagram(diagramId, diagramData);
      dirtyRef.current = false;
      setLastSaved(Date.now());
      // Auto-create revision every 5 minutes
      const now = Date.now();
      if (now - lastRevisionRef.current > REVISION_INTERVAL) {
        lastRevisionRef.current = now;
        gw.createContentRevision(`diagram:${diagramId}`, diagramData).catch(() => {});
      }
    } catch (e) {
      showError(getT()('errors.autoSaveFailed'), e);
    } finally {
      setSaving(false);
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
    const handler = () => { dirtyRef.current = true; scheduleSave(); };
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
    const onBeforeUnload = () => {
      if (!dirtyRef.current || !graph) return;
      try {
        const json = graph.toJSON();
        if (json.cells) json.cells = json.cells.filter((c: any) => !c.data?._isPreview);
        const { sx } = graph.scale();
        const { tx, ty } = graph.translate();
        const payload = JSON.stringify({
          data: { nodes: [], edges: [], ...json, viewport: { x: tx, y: ty, zoom: sx } },
        });
        fetch(`/api/gateway/diagrams/${diagramId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', ...gw.gwAuthHeaders() },
          body: payload,
          keepalive: true,
        }).catch(() => {});
        dirtyRef.current = false;
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
      if (dirtyRef.current) {
        saveRef.current();
      }
    };
  }, [graph, scheduleSave, diagramId]);

  return { save, lastSaved, saving, flushSave };
}
