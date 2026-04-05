'use client';

/**
 * ContentLink — Displays a clickable link to another content item.
 *
 * Supports two display modes:
 * - Inline chip: compact link embedded in text
 * - Block card: larger card with type info and timestamp
 *
 * Hover triggers a preview card showing content snippet.
 */

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { FileText, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatRelativeTime } from '@/lib/utils/time';
import { getContentItem, type ContentItem } from '@/lib/api/gateway';
import { TYPE_ICONS, TYPE_LABELS } from './constants';

export interface ContentLinkProps {
  contentId: string;   // e.g. "doc:abc123", "table:xyz456"
  className?: string;
  inline?: boolean;    // true = inline chip, false = block card
  showPreview?: boolean; // whether to show hover preview (default true)
}

function getContentType(id: string): string {
  const colonIdx = id.indexOf(':');
  return colonIdx > 0 ? id.substring(0, colonIdx) : 'doc';
}

export function ContentLink({
  contentId,
  className,
  inline = false,
  showPreview = true,
}: ContentLinkProps) {
  const router = useRouter();
  const anchorRef = useRef<HTMLButtonElement>(null);
  const [hovered, setHovered] = useState(false);
  const hoverTimeout = useRef<ReturnType<typeof setTimeout>>();

  // Clear hover timeout on unmount
  useEffect(() => {
    return () => clearTimeout(hoverTimeout.current);
  }, []);

  const { data: item, isLoading, isError } = useQuery<ContentItem>({
    queryKey: ['content-item', contentId],
    queryFn: () => getContentItem(contentId),
    staleTime: 30_000,
    retry: 1,
  });

  const type = item?.type ?? getContentType(contentId);
  const TypeIcon = TYPE_ICONS[type] ?? FileText;

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    router.push(`/content?id=${encodeURIComponent(contentId)}`);
  };

  const onMouseEnter = useCallback(() => {
    if (!showPreview) return;
    hoverTimeout.current = setTimeout(() => setHovered(true), 300);
  }, [showPreview]);

  const onMouseLeave = useCallback(() => {
    clearTimeout(hoverTimeout.current);
    setHovered(false);
  }, []);

  const previewCard = hovered && item && anchorRef.current ? (
    <PreviewCard
      item={item}
      type={type}
      anchorEl={anchorRef.current}
      onMouseEnter={() => clearTimeout(hoverTimeout.current)}
      onMouseLeave={onMouseLeave}
    />
  ) : null;

  // -- Inline chip mode --
  if (inline) {
    return (
      <>
        <button
          ref={anchorRef}
          onClick={handleClick}
          onMouseEnter={onMouseEnter}
          onMouseLeave={onMouseLeave}
          className={cn(
            'inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md',
            'bg-muted/60 hover:bg-muted text-sm font-medium',
            'transition-colors cursor-pointer border border-transparent hover:border-border',
            'max-w-[240px] truncate',
            className,
          )}
          title={item?.title || contentId}
        >
          {isLoading ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />
          ) : (
            <>
              {item?.icon ? (
                <span className="text-xs shrink-0">{item.icon}</span>
              ) : (
                <TypeIcon className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
              )}
              <span className="truncate">
                {isError ? contentId : (item?.title || 'Untitled')}
              </span>
            </>
          )}
        </button>
        {previewCard}
      </>
    );
  }

  // -- Block card mode --
  return (
    <>
      <button
        ref={anchorRef}
        onClick={handleClick}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
        className={cn(
          'flex items-center gap-3 w-full px-3 py-2.5 rounded-lg',
          'bg-card border border-border hover:border-foreground/20 hover:shadow-sm',
          'transition-all cursor-pointer text-left',
          className,
        )}
      >
        {isLoading ? (
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        ) : (
          <>
            <div className="flex items-center justify-center w-8 h-8 rounded-md bg-muted shrink-0">
              {item?.icon ? (
                <span className="text-base">{item.icon}</span>
              ) : (
                <TypeIcon className="w-4 h-4 text-muted-foreground" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium truncate">
                {isError ? contentId : (item?.title || 'Untitled')}
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="capitalize">{type}</span>
                {item?.updated_at && (
                  <>
                    <span>&middot;</span>
                    <span>{formatRelativeTime(item.updated_at)}</span>
                  </>
                )}
              </div>
            </div>
          </>
        )}
      </button>
      {previewCard}
    </>
  );
}

/**
 * Hover preview card — shows content snippet above the link.
 */
function PreviewCard({
  item,
  type,
  anchorEl,
  onMouseEnter,
  onMouseLeave,
}: {
  item: ContentItem;
  type: string;
  anchorEl: HTMLElement;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}) {
  // Dismiss preview on scroll — position would be stale otherwise
  useEffect(() => {
    const handleScroll = () => onMouseLeave();
    window.addEventListener('scroll', handleScroll, { capture: true, passive: true });
    return () => window.removeEventListener('scroll', handleScroll, { capture: true });
  }, [onMouseLeave]);

  const rect = anchorEl.getBoundingClientRect();
  const TypeIcon = TYPE_ICONS[type] ?? FileText;
  const typeLabel = TYPE_LABELS[type] ?? type;

  // Position above the anchor, centered horizontally
  const style: React.CSSProperties = {
    position: 'fixed',
    left: rect.left + rect.width / 2,
    top: rect.top - 8,
    transform: 'translate(-50%, -100%)',
    zIndex: 9999,
  };

  return createPortal(
    <div
      style={style}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      className={cn(
        'w-64 bg-popover border border-border rounded-lg shadow-lg p-3',
        'animate-in fade-in-0 zoom-in-95 duration-150',
      )}
    >
      <div className="flex items-center gap-2 mb-2">
        {item.icon ? (
          <span className="text-sm">{item.icon}</span>
        ) : (
          <TypeIcon className="w-4 h-4 text-muted-foreground" />
        )}
        <span className="text-sm font-medium truncate flex-1">
          {item.title || 'Untitled'}
        </span>
      </div>
      {/* Preview snippet: rendered when ContentItem includes a snippet field */}
      <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
        <span>{typeLabel}</span>
        {item.updated_at && (
          <>
            <span>&middot;</span>
            <span>{formatRelativeTime(item.updated_at)}</span>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}

export default ContentLink;
