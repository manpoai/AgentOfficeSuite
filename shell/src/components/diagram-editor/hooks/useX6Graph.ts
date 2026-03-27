'use client';

import { useEffect, useRef, useState } from 'react';
import { Graph, Shape } from '@antv/x6';
import { Selection } from '@antv/x6/es/plugin/selection';
import { Snapline } from '@antv/x6/es/plugin/snapline';
import { Keyboard } from '@antv/x6/es/plugin/keyboard';
import { Clipboard } from '@antv/x6/es/plugin/clipboard';
import { History } from '@antv/x6/es/plugin/history';
import { Transform } from '@antv/x6/es/plugin/transform';
import { MiniMap } from '@antv/x6/es/plugin/minimap';
import { registerShapes } from '../shapes/register';
import { DEFAULT_EDGE_COLOR, DEFAULT_EDGE_WIDTH } from '../constants';

export function useX6Graph(
  containerRef: React.RefObject<HTMLDivElement | null>,
  minimapRef: React.RefObject<HTMLDivElement | null>,
) {
  const graphRef = useRef<Graph | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
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
      modifiers: ['shift'],
    }));
    graph.use(new Snapline({ enabled: true }));
    graph.use(new Keyboard({ enabled: true, global: false }));
    graph.use(new Clipboard({ enabled: true }));
    graph.use(new History({ enabled: true }));
    graph.use(new Transform({ resizing: { enabled: true, minWidth: 40, minHeight: 30 } }));

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

    graphRef.current = graph;
    setReady(true);

    return () => {
      graph.dispose();
      graphRef.current = null;
    };
  }, [containerRef, minimapRef]);

  return { graph: graphRef.current, ready };
}
