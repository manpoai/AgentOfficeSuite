import {
  Copy, ClipboardPaste, Scissors, Trash2,
  ArrowUpToLine, ArrowUp, ArrowDown, ArrowDownToLine, MessageSquare, Settings,
} from 'lucide-react';
import type { ActionDef } from './types';

export interface PPTObjectCtx {
  canvas: any; // fabric.Canvas (v6)
  activeObject: any; // fabric.FabricObject
  clipboardRef: React.MutableRefObject<any>;
  setShowComments: (v: boolean) => void;
}

export const pptObjectActions: ActionDef<PPTObjectCtx>[] = [
  {
    id: 'ppt-cut',
    label: t => t('actions.cut'),
    icon: Scissors,
    shortcut: '⌘X',
    group: 'clipboard',
    execute: async ctx => {
      const { canvas, activeObject, clipboardRef } = ctx;
      canvas.fire('before:modified', { target: activeObject });
      const cloned = await activeObject.clone();
      clipboardRef.current = cloned;
      canvas.remove(activeObject);
      canvas.renderAll();
      canvas.fire('object:modified', { target: activeObject });
    },
  },
  {
    id: 'ppt-copy',
    label: t => t('actions.copy'),
    icon: Copy,
    shortcut: '⌘C',
    group: 'clipboard',
    execute: async ctx => {
      const cloned = await ctx.activeObject.clone();
      ctx.clipboardRef.current = cloned;
    },
  },
  {
    id: 'ppt-paste',
    label: t => t('actions.paste'),
    icon: ClipboardPaste,
    shortcut: '⌘V',
    group: 'clipboard',
    execute: async ctx => {
      const { canvas, clipboardRef } = ctx;
      const src = clipboardRef.current;
      if (!src) return;
      const pasted = await src.clone();
      canvas.fire('before:modified', { target: pasted });
      pasted.set({ left: (pasted.left || 0) + 20, top: (pasted.top || 0) + 20, evented: true });
      canvas.add(pasted);
      canvas.setActiveObject(pasted);
      canvas.renderAll();
      canvas.fire('object:modified', { target: pasted });
    },
  },
  {
    id: 'ppt-delete',
    label: t => t('actions.delete'),
    icon: Trash2,
    shortcut: 'Delete',
    danger: true,
    group: 'danger',
    execute: ctx => {
      const { canvas, activeObject } = ctx;
      canvas.fire('before:modified', { target: activeObject });
      canvas.remove(activeObject);
      canvas.renderAll();
      canvas.fire('object:modified', { target: activeObject });
    },
  },
  {
    id: 'ppt-bring-to-front',
    label: t => t('actions.bringToFront'),
    icon: ArrowUpToLine,
    group: 'zorder',
    execute: ctx => {
      ctx.canvas.fire('before:modified', { target: ctx.activeObject });
      ctx.canvas.bringObjectToFront(ctx.activeObject);
      ctx.canvas.renderAll();
      ctx.canvas.fire('object:modified', { target: ctx.activeObject });
    },
  },
  {
    id: 'ppt-bring-forward',
    label: t => t('actions.bringForward'),
    icon: ArrowUp,
    group: 'zorder',
    execute: ctx => {
      ctx.canvas.fire('before:modified', { target: ctx.activeObject });
      ctx.canvas.bringObjectForward(ctx.activeObject);
      ctx.canvas.renderAll();
      ctx.canvas.fire('object:modified', { target: ctx.activeObject });
    },
  },
  {
    id: 'ppt-send-backward',
    label: t => t('actions.sendBackward'),
    icon: ArrowDown,
    group: 'zorder',
    execute: ctx => {
      ctx.canvas.fire('before:modified', { target: ctx.activeObject });
      ctx.canvas.sendObjectBackwards(ctx.activeObject);
      ctx.canvas.renderAll();
      ctx.canvas.fire('object:modified', { target: ctx.activeObject });
    },
  },
  {
    id: 'ppt-send-to-back',
    label: t => t('actions.sendToBack'),
    icon: ArrowDownToLine,
    group: 'zorder',
    execute: ctx => {
      ctx.canvas.fire('before:modified', { target: ctx.activeObject });
      ctx.canvas.sendObjectToBack(ctx.activeObject);
      ctx.canvas.renderAll();
      ctx.canvas.fire('object:modified', { target: ctx.activeObject });
    },
  },
  {
    id: 'ppt-comment',
    label: t => t('actions.comment'),
    icon: MessageSquare,
    group: 'other',
    execute: ctx => ctx.setShowComments(true),
  },
];

export interface PPTCanvasCtx {
  canvas: any;
  clipboardRef: React.MutableRefObject<any>;
  setShowComments: (v: boolean) => void;
  openBackground: () => void;
}

export const pptCanvasActions: ActionDef<PPTCanvasCtx>[] = [
  {
    id: 'ppt-canvas-paste',
    label: t => t('actions.paste'),
    icon: ClipboardPaste,
    shortcut: '⌘V',
    group: 'clipboard',
    execute: async ctx => {
      const { canvas, clipboardRef } = ctx;
      const src = clipboardRef.current;
      if (!src) return;
      const pasted = await src.clone();
      canvas.fire('before:modified', { target: pasted });
      pasted.set({ left: (pasted.left || 0) + 20, top: (pasted.top || 0) + 20, evented: true });
      canvas.add(pasted);
      canvas.setActiveObject(pasted);
      canvas.renderAll();
      canvas.fire('object:modified', { target: pasted });
    },
  },
  {
    id: 'ppt-canvas-background',
    label: t => t('actions.background'),
    icon: Settings,
    group: 'canvas',
    execute: ctx => ctx.openBackground(),
  },
  {
    id: 'ppt-canvas-comment',
    label: t => t('actions.comment'),
    icon: MessageSquare,
    group: 'other',
    execute: ctx => ctx.setShowComments(true),
  },
];
