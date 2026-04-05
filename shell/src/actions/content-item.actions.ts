import { ExternalLink, Pencil, Smile, Link2, Pin, PinOff, Trash2, Download, Share2 } from 'lucide-react';
import type { ActionDef } from './types';

export interface ContentItemCtx {
  id: string;
  type: string;
  title: string;
  pinned: boolean;
  url: string;
  startRename: () => void;
  openIconPicker: () => void;
  togglePin: () => void;
  deleteItem: () => void;
  downloadItem?: () => void;
  shareItem?: () => void;
}

export const contentItemActions: ActionDef<ContentItemCtx>[] = [
  {
    id: 'open-new-tab',
    label: t => t('actions.openNewTab'),
    icon: ExternalLink,
    platform: 'desktop',
    group: 'navigate',
    execute: ctx => { window.open(ctx.url, '_blank'); },
  },
  {
    id: 'rename',
    label: t => t('actions.rename'),
    icon: Pencil,
    group: 'edit',
    execute: ctx => ctx.startRename(),
  },
  {
    id: 'change-icon',
    label: t => t('actions.changeIcon'),
    icon: Smile,
    group: 'edit',
    execute: ctx => ctx.openIconPicker(),
  },
  {
    id: 'copy-link',
    label: t => t('actions.copyLink'),
    icon: Link2,
    group: 'share',
    execute: ctx => navigator.clipboard.writeText(ctx.url).catch(() => {}),
  },
  {
    id: 'pin',
    label: (t, ctx) => ctx?.pinned ? t('actions.unpin') : t('actions.pin'),
    icon: (ctx?: ContentItemCtx) => ctx?.pinned ? PinOff : Pin,
    group: 'share',
    execute: ctx => ctx.togglePin(),
  },
  {
    id: 'download',
    label: t => t('actions.download'),
    icon: Download,
    group: 'share',
    execute: ctx => ctx.downloadItem?.(),
  },
  {
    id: 'share',
    label: t => t('actions.share'),
    icon: Share2,
    group: 'share',
    execute: ctx => ctx.shareItem?.(),
  },
  {
    id: 'delete',
    label: t => t('actions.moveToTrash'),
    icon: Trash2,
    danger: true,
    group: 'danger',
    execute: ctx => ctx.deleteItem(),
  },
];
