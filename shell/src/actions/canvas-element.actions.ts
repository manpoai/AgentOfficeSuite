import {
  Scissors, Copy, ClipboardPaste, CopyPlus, Trash2,
  ArrowUpToLine, ArrowUp, ArrowDown, ArrowDownToLine,
  Lock, Unlock, Group, Ungroup, MessageSquare, Sparkles,
  MousePointerSquareDashed, Maximize, Search,
} from 'lucide-react';
import type { ActionDef } from './types';
import type { CanvasElement } from '@/components/canvas-editor/types';

export interface CanvasElementCtx {
  selectedIds: Set<string>;
  singleSelected: CanvasElement | null;
  handleCut: () => void;
  handleCopy: () => void;
  handlePaste: () => void;
  deleteSelected: () => void;
  duplicateElement: (id: string) => void;
  bringToFront: (id: string) => void;
  bringForward: (id: string) => void;
  sendBackward: (id: string) => void;
  sendToBack: (id: string) => void;
  groupSelected: () => void;
  ungroupSelected: () => void;
  toggleLock: (id: string) => void;
  openAiEdit: () => void;
  openComments: () => void;
  handleCanvasComment?: (type: 'element', element: CanvasElement | null) => void;
  selectAll: () => void;
  fitToView: () => void;
  resetZoom: () => void;
}

export const canvasElementActions: ActionDef<CanvasElementCtx>[] = [
  {
    id: 'canvas-cut',
    label: _t => 'Cut',
    icon: Scissors,
    shortcut: '⌘X',
    group: 'clipboard',
    execute: ctx => ctx.handleCut(),
  },
  {
    id: 'canvas-copy',
    label: _t => 'Copy',
    icon: Copy,
    shortcut: '⌘C',
    group: 'clipboard',
    execute: ctx => ctx.handleCopy(),
  },
  {
    id: 'canvas-paste',
    label: _t => 'Paste',
    icon: ClipboardPaste,
    shortcut: '⌘V',
    group: 'clipboard',
    execute: ctx => ctx.handlePaste(),
  },
  {
    id: 'canvas-duplicate',
    label: _t => 'Duplicate',
    icon: CopyPlus,
    shortcut: '⌘D',
    group: 'clipboard',
    execute: ctx => { if (ctx.singleSelected) ctx.duplicateElement(ctx.singleSelected.id); },
  },
  {
    id: 'canvas-delete',
    label: _t => 'Delete',
    icon: Trash2,
    danger: true,
    group: 'edit',
    execute: ctx => ctx.deleteSelected(),
  },
  {
    id: 'canvas-bring-to-front',
    label: _t => 'Bring to Front',
    icon: ArrowUpToLine,
    group: 'order',
    execute: ctx => { if (ctx.singleSelected) ctx.bringToFront(ctx.singleSelected.id); },
  },
  {
    id: 'canvas-bring-forward',
    label: _t => 'Bring Forward',
    icon: ArrowUp,
    group: 'order',
    execute: ctx => { if (ctx.singleSelected) ctx.bringForward(ctx.singleSelected.id); },
  },
  {
    id: 'canvas-send-backward',
    label: _t => 'Send Backward',
    icon: ArrowDown,
    group: 'order',
    execute: ctx => { if (ctx.singleSelected) ctx.sendBackward(ctx.singleSelected.id); },
  },
  {
    id: 'canvas-send-to-back',
    label: _t => 'Send to Back',
    icon: ArrowDownToLine,
    group: 'order',
    execute: ctx => { if (ctx.singleSelected) ctx.sendToBack(ctx.singleSelected.id); },
  },
  {
    id: 'canvas-lock',
    label: (_t, ctx) => ctx?.singleSelected?.locked ? 'Unlock' : 'Lock',
    icon: (ctx) => ctx?.singleSelected?.locked ? Unlock : Lock,
    group: 'edit',
    execute: ctx => { if (ctx.singleSelected) ctx.toggleLock(ctx.singleSelected.id); },
  },
  {
    id: 'canvas-group',
    label: _t => 'Group',
    icon: Group,
    shortcut: '⌘G',
    group: 'arrange',
    execute: ctx => ctx.groupSelected(),
  },
  {
    id: 'canvas-ungroup',
    label: _t => 'Ungroup',
    icon: Ungroup,
    shortcut: '⌘⇧G',
    group: 'arrange',
    execute: ctx => ctx.ungroupSelected(),
  },
  {
    id: 'canvas-ai-edit',
    label: _t => 'AI Edit',
    icon: Sparkles,
    group: 'ai',
    execute: ctx => ctx.openAiEdit(),
  },
  {
    id: 'canvas-add-comment',
    label: _t => 'Add Comment',
    icon: MessageSquare,
    group: 'ai',
    execute: ctx => {
      if (ctx.handleCanvasComment && ctx.singleSelected) {
        ctx.handleCanvasComment('element', ctx.singleSelected);
      } else {
        ctx.openComments();
      }
    },
  },
  {
    id: 'canvas-select-all',
    label: _t => 'Select All',
    icon: MousePointerSquareDashed,
    shortcut: '⌘A',
    group: 'selection',
    execute: ctx => ctx.selectAll(),
  },
  {
    id: 'canvas-fit-to-view',
    label: _t => 'Zoom to Fit',
    icon: Maximize,
    group: 'view',
    execute: ctx => ctx.fitToView(),
  },
  {
    id: 'canvas-reset-zoom',
    label: _t => 'Zoom to 100%',
    icon: Search,
    group: 'view',
    execute: ctx => ctx.resetZoom(),
  },
];
