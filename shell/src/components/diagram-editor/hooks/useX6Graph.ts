'use client';

import { useEffect, useRef, useState } from 'react';
import { Graph, Shape } from '@antv/x6';
import { registerShapes } from '../shapes/register';
import { DEFAULT_EDGE_COLOR, DEFAULT_EDGE_WIDTH } from '../constants';

export function useX6Graph(
  containerRef: React.RefObject<HTMLDivElement | null>,
  minimapRef: React.RefObject<HTMLDivElement | null>,
) {
  const graphRef = useRef<Graph | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!containerRef.current || graphRef.current) return;

    // Dynamic imports to avoid circular dependency TDZ errors with Next.js bundling.
    // X6 v3 bundles plugins internally but static imports from @antv/x6/es/plugin/*
    // cause "Cannot access before initialization" in production builds.
    async function init() {
      try {
        const [
          { Selection },
          { Snapline },
          { Clipboard },
          { History },
          { Transform },
          { MiniMap },
        ] = await Promise.all([
          import('@antv/x6/es/plugin/selection'),
          import('@antv/x6/es/plugin/snapline'),
          import('@antv/x6/es/plugin/clipboard'),
          import('@antv/x6/es/plugin/history'),
          import('@antv/x6/es/plugin/transform'),
          import('@antv/x6/es/plugin/minimap'),
        ]);

        if (!containerRef.current || graphRef.current) return;

        registerShapes();

        const graph = new Graph({
          container: containerRef.current,
          autoResize: true,

          // Grid
          grid: {
            type: 'dot',
            size: 20,
            visible: true,
            args: [{ color: '#e5e7eb', thickness: 1 }],
          },

          // Canvas navigation
          // Right-click drag = pan; two-finger trackpad scroll = pan (handled below)
          panning: { enabled: true, eventTypes: ['rightMouseDown'] },
          mousewheel: {
            enabled: true,
            modifiers: ['ctrl', 'meta'],
            zoomAtMousePosition: true,
            minScale: 0.2,
            maxScale: 3,
          },
          scaling: { min: 0.2, max: 3 },

          // Connection rules
          connecting: {
            snap: { radius: 30 },
            allowBlank: false,
            allowLoop: false,
            allowMulti: 'withPort',
            highlight: true,
            router: { name: 'manhattan' },
            connector: { name: 'rounded', args: { radius: 8 } },
            createEdge() {
              return new Shape.Edge({
                shape: 'flowchart-edge',
                attrs: {
                  line: {
                    stroke: DEFAULT_EDGE_COLOR,
                    strokeWidth: DEFAULT_EDGE_WIDTH,
                    targetMarker: { name: 'classic', size: 8 },
                  },
                },
              });
            },
            validateConnection({ sourcePort, targetPort }) {
              return !!sourcePort && !!targetPort;
            },
          },

          // Highlight available ports
          highlighting: {
            magnetAvailable: {
              name: 'stroke',
              args: { attrs: { fill: '#5F95FF', stroke: '#5F95FF' } },
            },
            magnetAdsorbed: {
              name: 'stroke',
              args: { attrs: { fill: '#5F95FF', stroke: '#5F95FF' } },
            },
          },

          // Interaction
          interacting: {
            nodeMovable: true,
            edgeMovable: true,
            edgeLabelMovable: true,
          },
        });

        // ── Plugins ──
        graph.use(new Selection({
          enabled: true,
          rubberband: true,
          showNodeSelectionBox: true,
          multiple: true,
          movable: true,
        }));
        graph.use(new Snapline({ enabled: true }));
        // Keyboard shortcuts are handled at DOM level in X6DiagramEditor.tsx
        // to properly support text editing in React node components.
        graph.use(new Clipboard({ enabled: true }));
        graph.use(new History({ enabled: true }));
        graph.use(new Transform({
          resizing: {
            enabled: true,
            minWidth: 40,
            minHeight: 30,
            orthogonal: true,
          },
        }));

        if (minimapRef.current) {
          graph.use(new MiniMap({
            container: minimapRef.current,
            width: 180,
            height: 120,
            padding: 10,
          }));
        }

        // ── Port visibility on hover ──
        const showPorts = (show: boolean) => (e: any) => {
          const node = e.node || e.cell;
          if (!node || !node.isNode()) return;
          const ports = node.getPorts();
          ports.forEach((port: any) => {
            node.portProp(port.id!, 'attrs/circle/style/visibility', show ? 'visible' : 'hidden');
          });
        };
        graph.on('node:mouseenter', showPorts(true));
        graph.on('node:mouseleave', showPorts(false));

        // ── Two-finger trackpad panning ──
        // Trackpad two-finger scroll sends wheel events with deltaX/deltaY.
        // X6's mousewheel plugin only handles zoom (with Ctrl/Meta). We handle
        // plain scroll (no modifier) as canvas panning.
        const container = containerRef.current!;
        const onWheel = (e: WheelEvent) => {
          // Skip if Ctrl/Meta held — let X6's mousewheel handler zoom
          if (e.ctrlKey || e.metaKey) return;
          e.preventDefault();
          const { tx, ty } = graph.translate();
          graph.translate(tx - e.deltaX, ty - e.deltaY);
        };
        container.addEventListener('wheel', onWheel, { passive: false });

        graphRef.current = graph;
        setReady(true);
      } catch (e) {
        console.error('X6 Graph init failed:', e);
        setError(e instanceof Error ? e.message : String(e));
      }
    }

    init();

    return () => {
      if (graphRef.current) {
        graphRef.current.dispose();
        graphRef.current = null;
      }
      // Wheel listener is cleaned up by graph.dispose() removing the container
    };
  }, [containerRef, minimapRef]);

  return { graph: graphRef.current, ready, error };
}
