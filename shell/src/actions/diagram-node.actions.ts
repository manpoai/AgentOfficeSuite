import { Copy, ClipboardPaste, Trash2, ArrowUpToLine, ArrowUp, ArrowDown, ArrowDownToLine, MessageSquare } from 'lucide-react';
import type { ActionDef } from './types';
import type { Graph, Cell } from '@antv/x6';

export interface DiagramNodeCtx {
  graph: Graph;
  cell: Cell;
}

export const diagramNodeActions: ActionDef<DiagramNodeCtx>[] = [
  {
    id: 'diagram-copy',
    label: t => t('actions.copy'),
    icon: Copy,
    shortcut: '⌘C',
    group: 'clipboard',
    execute: ctx => {
      ctx.graph.copy([ctx.cell]);
    },
  },
  {
    id: 'diagram-paste',
    label: t => t('actions.paste'),
    icon: ClipboardPaste,
    shortcut: '⌘V',
    group: 'clipboard',
    execute: ctx => {
      const cells = ctx.graph.paste({ offset: 20 });
      if (cells.length) {
        ctx.graph.cleanSelection();
        ctx.graph.select(cells);
      }
    },
  },
  {
    id: 'diagram-delete',
    label: t => t('actions.delete'),
    icon: Trash2,
    shortcut: 'Del',
    danger: true,
    group: 'danger',
    execute: ctx => {
      ctx.graph.removeCells([ctx.cell]);
    },
  },
  {
    id: 'diagram-to-front',
    label: t => t('actions.bringToFront'),
    icon: ArrowUpToLine,
    group: 'zorder',
    execute: ctx => {
      ctx.cell.toFront();
    },
  },
  {
    id: 'diagram-bring-forward',
    label: t => t('actions.bringForward'),
    icon: ArrowUp,
    group: 'zorder',
    execute: ctx => {
      ctx.cell.toFront(); // X6 does not have bringForward, use toFront
    },
  },
  {
    id: 'diagram-send-backward',
    label: t => t('actions.sendBackward'),
    icon: ArrowDown,
    group: 'zorder',
    execute: ctx => {
      ctx.cell.toBack(); // X6 does not have sendBackward, use toBack
    },
  },
  {
    id: 'diagram-to-back',
    label: t => t('actions.sendToBack'),
    icon: ArrowDownToLine,
    group: 'zorder',
    execute: ctx => {
      ctx.cell.toBack();
    },
  },
  {
    id: 'diagram-comment',
    label: t => t('actions.comment'),
    icon: MessageSquare,
    group: 'other',
    execute: _ctx => {
      window.dispatchEvent(new CustomEvent('diagram:open-comments'));
    },
  },
];

export interface DiagramCanvasCtx {
  graph: Graph;
}

export const diagramCanvasActions: ActionDef<DiagramCanvasCtx>[] = [
  {
    id: 'diagram-canvas-paste',
    label: t => t('actions.paste'),
    icon: ClipboardPaste,
    shortcut: '⌘V',
    group: 'clipboard',
    execute: ctx => {
      const cells = ctx.graph.paste({ offset: 20 });
      if (cells.length) {
        ctx.graph.cleanSelection();
        ctx.graph.select(cells);
      }
    },
  },
  {
    id: 'diagram-canvas-comment',
    label: t => t('actions.comment'),
    icon: MessageSquare,
    group: 'other',
    execute: _ctx => {
      window.dispatchEvent(new CustomEvent('diagram:open-comments'));
    },
  },
];
