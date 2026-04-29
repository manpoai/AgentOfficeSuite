import { Pencil, CopyPlus, Trash2, Image, FileCode, MessageSquare } from 'lucide-react';
import type { ActionDef } from './types';

export interface CanvasFrameCtx {
  frameId: string;
  frameTitle?: string;
  frameIndex?: number;
  renameFrame: (id: string) => void;
  duplicateFrame: (id: string) => void;
  deleteFrame: (id: string) => void;
  exportFramePng: (id: string) => void;
  exportFrameSvg?: (id: string) => void;
  canExportSvg?: boolean;
  handlePageComment?: (frameId: string, frameTitle: string, frameIndex: number) => void;
}

export const canvasFrameActions: ActionDef<CanvasFrameCtx>[] = [
  {
    id: 'canvas-frame-rename',
    label: _t => 'Rename',
    icon: Pencil,
    group: 'edit',
    execute: ctx => ctx.renameFrame(ctx.frameId),
  },
  {
    id: 'canvas-frame-duplicate',
    label: _t => 'Duplicate Frame',
    icon: CopyPlus,
    group: 'edit',
    execute: ctx => ctx.duplicateFrame(ctx.frameId),
  },
  {
    id: 'canvas-frame-delete',
    label: _t => 'Delete Frame',
    icon: Trash2,
    danger: true,
    group: 'edit',
    execute: ctx => ctx.deleteFrame(ctx.frameId),
  },
  {
    id: 'canvas-frame-export-png',
    label: _t => 'Export PNG',
    icon: Image,
    group: 'export',
    execute: ctx => ctx.exportFramePng(ctx.frameId),
  },
  {
    id: 'canvas-frame-export-svg',
    label: _t => 'Export SVG',
    icon: FileCode,
    group: 'export',
    execute: ctx => ctx.exportFrameSvg?.(ctx.frameId),
  },
  {
    id: 'canvas-frame-comment',
    label: _t => 'Add Comment',
    icon: MessageSquare,
    group: 'other',
    execute: ctx => ctx.handlePageComment?.(ctx.frameId, ctx.frameTitle ?? '', ctx.frameIndex ?? 0),
  },
];
