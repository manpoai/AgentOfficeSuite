'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
import type { Graph } from '@antv/x6';
import * as gw from '@/lib/api/gateway';
import { AUTOSAVE_DEBOUNCE_MS } from '../constants';

export function useAutoSave(graph: Graph | null, diagramId: string) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastRevisionRef = useRef<number>(0);
  const REVISION_INTERVAL = 5 * 60 * 1000; // 5 minutes
  const [lastSaved, setLastSaved] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  const save = useCallback(async () => {
    if (!graph) return;
    setSaving(true);
    try {
      const json = graph.toJSON();
      // Filter out transient preview cells (port hover previews)
      if (json.cells) {
        json.cells = json.cells.filter((c: any) => !c.data?._isPreview);
      }
      const { sx, sy } = graph.scale();
      const { tx, ty } = graph.translate();
      const diagramData = {
        nodes: [], edges: [], // Legacy compat — gateway ignores these if cells present
        ...json,
        viewport: { x: tx, y: ty, zoom: sx },
      } as any;
      await gw.saveDiagram(diagramId, diagramData);
      setLastSaved(Date.now());
      // Auto-create revision every 5 minutes
      const now = Date.now();
      if (now - lastRevisionRef.current > REVISION_INTERVAL) {
        lastRevisionRef.current = now;
        gw.createContentRevision(`diagram:${diagramId}`, diagramData).catch(() => {});
      }
    } catch (e) {
      console.error('Auto-save failed:', e);
    } finally {
      setSaving(false);
    }
  }, [graph, diagramId]);

  const scheduleSave = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(save, AUTOSAVE_DEBOUNCE_MS);
  }, [save]);

  useEffect(() => {
    if (!graph) return;

    // Listen to model changes
    const handler = () => scheduleSave();
    graph.on('cell:added', handler);
    graph.on('cell:removed', handler);
    graph.on('cell:changed', handler);
    graph.on('node:moved', handler);
    graph.on('node:resized', handler);
    graph.on('edge:connected', handler);

    return () => {
      graph.off('cell:added', handler);
      graph.off('cell:removed', handler);
      graph.off('cell:changed', handler);
      graph.off('node:moved', handler);
      graph.off('node:resized', handler);
      graph.off('edge:connected', handler);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [graph, scheduleSave]);

  return { save, lastSaved, saving };
}
