'use client';

/**
 * useContentLink — Hook for inserting content links in any editor context.
 *
 * Provides a unified API for all editors (Docs, Table, PPT, Diagram)
 * to insert links to other content items. Manages the picker state
 * and delegates to the appropriate adapter.
 *
 * Usage:
 *   const { showPicker, hidePicker, isPickerOpen, handleSelect } = useContentLink({
 *     onInsert: (contentId, item) => { ... insert into editor ... }
 *   });
 */

import { useState, useCallback } from 'react';
import type { ContentItem } from '@/lib/api/gateway';

interface UseContentLinkOptions {
  /** Called when user selects a content item from the picker */
  onInsert: (contentId: string, item: ContentItem) => void;
  /** Filter picker to specific content type */
  filterType?: 'doc' | 'table' | 'presentation' | 'diagram';
}

interface UseContentLinkReturn {
  /** Whether the picker is currently open */
  isPickerOpen: boolean;
  /** Open the content link picker */
  showPicker: () => void;
  /** Close the content link picker */
  hidePicker: () => void;
  /** Handle selection from the picker */
  handleSelect: (contentId: string, item: ContentItem) => void;
}

export function useContentLink({
  onInsert,
  filterType,
}: UseContentLinkOptions): UseContentLinkReturn {
  const [isPickerOpen, setIsPickerOpen] = useState(false);

  const showPicker = useCallback(() => {
    setIsPickerOpen(true);
  }, []);

  const hidePicker = useCallback(() => {
    setIsPickerOpen(false);
  }, []);

  const handleSelect = useCallback(
    (contentId: string, item: ContentItem) => {
      onInsert(contentId, item);
      setIsPickerOpen(false);
    },
    [onInsert],
  );

  return {
    isPickerOpen,
    showPicker,
    hidePicker,
    handleSelect,
  };
}

/**
 * Content type helpers for building content IDs and navigation URLs.
 */
export function buildContentId(type: string, rawId: string): string {
  return `${type}:${rawId}`;
}

export function parseContentId(contentId: string): { type: string; rawId: string } {
  const colonIdx = contentId.indexOf(':');
  if (colonIdx <= 0) return { type: 'doc', rawId: contentId };
  return {
    type: contentId.substring(0, colonIdx),
    rawId: contentId.substring(colonIdx + 1),
  };
}

export function getContentUrl(contentId: string): string {
  return `/content?id=${encodeURIComponent(contentId)}`;
}
