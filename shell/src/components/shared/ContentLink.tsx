'use client';

import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { FileText, Table2, Presentation, GitBranch, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatRelativeTime } from '@/lib/utils/time';
import { getContentItem, type ContentItem } from '@/lib/api/gateway';

interface ContentLinkProps {
  contentId: string;   // e.g. "doc:abc123", "table:xyz456"
  className?: string;
  inline?: boolean;    // true = inline chip, false = block card
}

const TYPE_ICONS: Record<string, React.ComponentType<{ className?: string; size?: number }>> = {
  doc: FileText,
  table: Table2,
  presentation: Presentation,
  diagram: GitBranch,
};

function getContentType(id: string): string {
  const colonIdx = id.indexOf(':');
  return colonIdx > 0 ? id.substring(0, colonIdx) : 'doc';
}

export function ContentLink({ contentId, className, inline = false }: ContentLinkProps) {
  const router = useRouter();

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

  // ── Inline chip mode ──
  if (inline) {
    return (
      <button
        onClick={handleClick}
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
    );
  }

  // ── Block card mode ──
  return (
    <button
      onClick={handleClick}
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
  );
}

export default ContentLink;
