import { Scissors, Copy, ClipboardPaste, Trash2, CopyPlus, Settings, MessageSquare } from 'lucide-react';
import type { ActionDef } from './types';

export interface PPTSlideCtx {
  slideIndex: number;
  isMultiSelect: boolean;
  onSlideCut: (i: number) => void;
  onSlideCopy: (i: number) => void;
  onSlidePaste: (i: number) => void;
  onSlideDelete: (i: number) => void;
  onSlideDuplicate: (i: number) => void;
  onSlideBackground: (i: number) => void;
  onSlideComment: (i: number) => void;
}

export const pptSlideActions: ActionDef<PPTSlideCtx>[] = [
  {
    id: 'slide-cut',
    label: t => t('actions.cut'),
    icon: Scissors,
    group: 'clipboard',
    execute: ctx => ctx.onSlideCut(ctx.slideIndex),
  },
  {
    id: 'slide-copy',
    label: t => t('actions.copy'),
    icon: Copy,
    group: 'clipboard',
    execute: ctx => ctx.onSlideCopy(ctx.slideIndex),
  },
  {
    id: 'slide-paste',
    label: t => t('actions.paste'),
    icon: ClipboardPaste,
    group: 'clipboard',
    execute: ctx => ctx.onSlidePaste(ctx.slideIndex),
  },
  {
    id: 'slide-delete',
    label: t => t('actions.delete'),
    icon: Trash2,
    danger: true,
    group: 'danger',
    execute: ctx => ctx.onSlideDelete(ctx.slideIndex),
  },
  {
    id: 'slide-duplicate',
    label: t => t('actions.duplicate'),
    icon: CopyPlus,
    group: 'edit',
    execute: ctx => ctx.onSlideDuplicate(ctx.slideIndex),
  },
  {
    id: 'slide-background',
    label: t => t('actions.background'),
    icon: Settings,
    group: 'canvas',
    execute: ctx => ctx.onSlideBackground(ctx.slideIndex),
  },
  {
    id: 'slide-comment',
    label: t => t('actions.comment'),
    icon: MessageSquare,
    group: 'other',
    execute: ctx => ctx.onSlideComment(ctx.slideIndex),
  },
];
