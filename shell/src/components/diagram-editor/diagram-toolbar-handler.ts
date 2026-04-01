import type { ToolbarHandler, ToolbarState } from '@/components/shared/FloatingToolbar/types';
import type { Graph, Cell, Node, Edge } from '@antv/x6';
import { CONNECTOR_META, type ConnectorType } from './constants';

interface DiagramTarget {
  graph: Graph;
  cell: Cell;
}

export function createDiagramNodeHandler({ graph, cell }: DiagramTarget): ToolbarHandler {
  const node = cell as Node;

  return {
    getState(): ToolbarState {
      const data = node.getData() || {};
      return {
        shapeSelect: data.flowchartShape || 'rounded-rect',
        fillColor: data.bgColor || '#ffffff',
        borderColor: data.borderColor || '#374151',
        fontSize: String(data.fontSize || 14),
        bold: data.fontWeight === 'bold',
        italic: data.fontStyle === 'italic',
        strikethrough: !!data.textDecoration?.includes('line-through'),
        underline: !!data.textDecoration?.includes('underline'),
        align: data.textAlign || 'center',
      };
    },

    execute(key: string, value?: unknown) {
      const data = node.getData() || {};
      switch (key) {
        case 'shapeSelect':
          node.setData({ ...data, flowchartShape: value }, { silent: false });
          break;
        case 'fillColor':
          node.setData({ ...data, bgColor: value }, { silent: false });
          break;
        case 'borderColor':
          node.setData({ ...data, borderColor: value }, { silent: false });
          break;
        case 'fontSize':
          node.setData({ ...data, fontSize: Number(value) }, { silent: false });
          break;
        case 'bold':
          node.setData({ ...data, fontWeight: data.fontWeight === 'bold' ? 'normal' : 'bold' }, { silent: false });
          break;
        case 'italic':
          node.setData({ ...data, fontStyle: data.fontStyle === 'italic' ? 'normal' : 'italic' }, { silent: false });
          break;
        case 'strikethrough': {
          const has = data.textDecoration?.includes('line-through');
          node.setData({ ...data, textDecoration: has ? '' : 'line-through' }, { silent: false });
          break;
        }
        case 'underline': {
          const has = data.textDecoration?.includes('underline');
          node.setData({ ...data, textDecoration: has ? '' : 'underline' }, { silent: false });
          break;
        }
        case 'align':
          node.setData({ ...data, textAlign: value }, { silent: false });
          break;
        case 'copy':
          graph.copy([cell]);
          graph.paste();
          break;
        case 'delete':
          graph.removeCells([cell]);
          break;
        case 'zOrder':
          if (value === 'front') cell.toFront();
          else cell.toBack();
          break;
      }
    },
  };
}

export function createDiagramEdgeHandler({ graph, cell }: DiagramTarget): ToolbarHandler {
  const edge = cell as Edge;

  return {
    getState(): ToolbarState {
      const lineAttrs = edge.getAttrs()?.line || {} as any;
      const dashArray = lineAttrs.strokeDasharray || '';
      let lineStyle = 'solid';
      if (dashArray === '8 4' || dashArray === '8,4') lineStyle = 'dashed';
      else if (dashArray === '2 4' || dashArray === '2,4') lineStyle = 'dotted';

      // Detect connector type
      const router = edge.getRouter();
      const connector = edge.getConnector();
      const routerName = typeof router === 'object' ? (router as any).name : (router || 'manhattan');
      const connectorName = typeof connector === 'object' ? (connector as any).name : (connector || 'rounded');
      let connectorType: ConnectorType = 'manhattan';
      if (routerName === 'normal' && connectorName === 'normal') connectorType = 'straight';
      else if (routerName === 'normal' && connectorName === 'smooth') connectorType = 'smooth';
      else if (routerName === 'orth') connectorType = 'rounded';

      // Detect arrow style
      const targetMarker = lineAttrs.targetMarker;
      let arrowStyle = 'classic';
      if (targetMarker === '' || targetMarker === null || (typeof targetMarker === 'object' && targetMarker?.name === 'none')) {
        arrowStyle = 'none';
      } else if (typeof targetMarker === 'object' && targetMarker?.name === 'classic' && targetMarker?.fill === 'none') {
        arrowStyle = 'open';
      }

      const labels = edge.getLabels();
      const hasLabel = labels.length > 0 && !!(labels[0]?.attrs?.text as any)?.text;

      return {
        lineColor: lineAttrs.stroke || '#94a3b8',
        lineWidth: String(lineAttrs.strokeWidth || 2),
        lineStyle,
        connectorType,
        arrowStyle,
        label: hasLabel,
      };
    },

    execute(key: string, value?: unknown) {
      switch (key) {
        case 'lineColor':
          edge.attr('line/stroke', value);
          break;
        case 'lineWidth':
          edge.attr('line/strokeWidth', Number(value));
          break;
        case 'lineStyle': {
          const dashMap: Record<string, string> = { solid: '', dashed: '8 4', dotted: '2 4' };
          edge.attr('line/strokeDasharray', dashMap[value as string] || '');
          break;
        }
        case 'connectorType': {
          const meta = CONNECTOR_META[value as ConnectorType];
          if (meta) {
            edge.setRouter({ name: meta.router });
            edge.setConnector({
              name: meta.connector,
              args: meta.connector === 'rounded' ? { radius: 8 } : undefined,
            });
            if (value === 'manhattan') edge.setVertices([]);
          }
          break;
        }
        case 'arrowStyle': {
          if (value === 'none') {
            edge.attr('line/targetMarker', '');
          } else if (value === 'open') {
            edge.attr('line/targetMarker', { name: 'classic', fill: 'none', size: 8 });
          } else {
            edge.attr('line/targetMarker', { name: 'classic', size: 8 });
          }
          break;
        }
        case 'label': {
          // Trigger inline label editing — same pattern as EdgeLabelButton
          const sourceCell = edge.getSourceCell();
          const targetCell = edge.getTargetCell();
          if (!sourceCell?.isNode() || !targetCell?.isNode()) return;

          const sp = (sourceCell as Node).position();
          const ss = (sourceCell as Node).size();
          const tp = (targetCell as Node).position();
          const ts = (targetCell as Node).size();
          const sx = sp.x + ss.width / 2, sy = sp.y + ss.height / 2;
          const tx = tp.x + ts.width / 2, ty = tp.y + ts.height / 2;
          const midPoint = graph.localToGraph((sx + tx) / 2, (sy + ty) / 2);

          const labels = edge.getLabels();
          const currentText = labels.length > 0 ? String((labels[0]?.attrs?.text as any)?.text || '') : '';

          const input = document.createElement('input');
          input.type = 'text';
          input.value = currentText;
          input.placeholder = '输入标签...';
          input.style.cssText = `
            position: absolute;
            left: ${midPoint.x}px;
            top: ${midPoint.y - 14}px;
            transform: translateX(-50%);
            z-index: 100;
            padding: 2px 8px;
            border: 2px solid #3b82f6;
            border-radius: 4px;
            outline: none;
            font-size: 12px;
            min-width: 80px;
            text-align: center;
            background: white;
          `;

          let committed = false;
          const commit = () => {
            if (committed) return;
            committed = true;
            const text = input.value.trim();
            if (text) {
              edge.setLabels([{
                attrs: {
                  text: { text, fontSize: 12, fill: '#374151' },
                  rect: { fill: '#fff', stroke: '#e5e7eb', strokeWidth: 1, rx: 3, ry: 3 },
                },
                position: 0.5,
              }]);
            } else {
              edge.setLabels([]);
            }
            input.remove();
          };

          input.addEventListener('keydown', (ke) => {
            if (ke.key === 'Enter') { ke.preventDefault(); commit(); }
            if (ke.key === 'Escape') { ke.preventDefault(); input.remove(); }
          });
          input.addEventListener('blur', commit);

          graph.container.parentElement?.appendChild(input);
          input.focus();
          input.select();
          break;
        }
        case 'copy':
          graph.copy([cell]);
          graph.paste();
          break;
        case 'delete':
          graph.removeCells([cell]);
          break;
        case 'zOrder':
          if (value === 'front') cell.toFront();
          else cell.toBack();
          break;
      }
    },
  };
}

export function createDiagramImageHandler({ graph, cell }: DiagramTarget): ToolbarHandler {
  return {
    getState(): ToolbarState {
      return {};
    },

    execute(key: string, value?: unknown) {
      switch (key) {
        case 'replace':
          (cell as Node).trigger('image:replace');
          break;
        case 'copy':
          graph.copy([cell]);
          graph.paste();
          break;
        case 'delete':
          graph.removeCells([cell]);
          break;
        case 'zOrder':
          if (value === 'front') cell.toFront();
          else cell.toBack();
          break;
      }
    },
  };
}
