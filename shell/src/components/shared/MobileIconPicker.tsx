'use client';

/**
 * MobileIconPicker — Full-height BottomSheet emoji/icon picker for mobile.
 *
 * Layout:
 * - BottomSheet title={t('toolbar.pageIcon')} with built-in X close
 * - Action row: Remove button + Upload button
 * - Emoji grid: @emoji-mart, large touch-friendly emojis
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import data from '@emoji-mart/data';
import Picker from '@emoji-mart/react';
import { useTheme } from 'next-themes';
import { Upload, Trash2 } from 'lucide-react';
import { BottomSheet } from './BottomSheet';
import { showError } from '@/lib/utils/error';

interface MobileIconPickerProps {
  onSelect: (emoji: string) => void;
  onRemove?: () => void;
  onUploadImage?: (file: File) => Promise<string>;
  onClose: () => void;
}

export function MobileIconPicker({ onSelect, onRemove, onUploadImage, onClose }: MobileIconPickerProps) {
  const { resolvedTheme } = useTheme();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const handleEmojiSelect = useCallback((emoji: any) => {
    // Call onSelect which triggers parent's handleIconSelect → closes picker
    onSelect(emoji.native);
  }, [onSelect]);

  const handleUploadClick = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // Small delay to avoid BottomSheet intercepting the file dialog
    setTimeout(() => {
      fileInputRef.current?.click();
    }, 100);
  }, []);

  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !onUploadImage) return;
    setUploading(true);
    try {
      const url = await onUploadImage(file);
      onSelect(url);
    } catch (err) {
      showError('Custom icon upload failed', err);
    }
    setUploading(false);
    e.target.value = '';
  }, [onSelect, onUploadImage]);

  const handleRemove = useCallback(() => {
    if (onRemove) onRemove();
  }, [onRemove]);

  // Override emoji-mart styles for mobile
  useEffect(() => {
    const style = document.createElement('style');
    style.setAttribute('data-mobile-emoji-picker', '');
    style.textContent = `
      [data-mobile-emoji-picker-container] em-emoji-picker {
        --rgb-accent: none !important;
        --color-border: hsl(var(--border)) !important;
        --color-border-over: hsl(var(--border)) !important;
        --font-family: inherit !important;
        width: 100% !important;
        max-width: 100% !important;
        height: 100% !important;
        max-height: none !important;
        border: none !important;
        border-radius: 0 !important;
      }
    `;
    document.head.appendChild(style);
    return () => { style.remove(); };
  }, []);

  return (
    <BottomSheet open={true} onClose={onClose} title={t('toolbar.pageIcon')} initialHeight="full">
      <div className="flex flex-col h-full" data-mobile-emoji-picker-container="">
        {/* Action buttons row */}
        <div className="flex items-center gap-2 px-4 py-2 shrink-0">
          {onRemove && (
            <button
              onClick={handleRemove}
              className="flex items-center gap-1.5 px-3 py-2 text-sm text-destructive bg-destructive/10 rounded-lg active:opacity-60"
            >
              <Trash2 className="h-4 w-4" />
              Remove
            </button>
          )}
          {onUploadImage && (
            <button
              onClick={handleUploadClick}
              disabled={uploading}
              className="flex items-center gap-1.5 px-3 py-2 text-sm text-sidebar-primary bg-sidebar-primary/10 rounded-lg active:opacity-60 disabled:opacity-50"
            >
              <Upload className="h-4 w-4" />
              {uploading ? 'Uploading...' : 'Upload image'}
            </button>
          )}
        </div>

        {/* Emoji picker — fills remaining space */}
        <div className="flex-1 min-h-0 overflow-hidden">
          <Picker
            data={data}
            onEmojiSelect={handleEmojiSelect}
            theme={resolvedTheme === 'dark' ? 'dark' : 'light'}
            set="native"
            perLine={8}
            emojiSize={32}
            emojiButtonSize={44}
            previewPosition="none"
            skinTonePosition="search"
            categories={[
              'frequent',
              'people',
              'nature',
              'foods',
              'activity',
              'places',
              'objects',
              'symbols',
              'flags',
            ]}
            maxFrequentRows={2}
            navPosition="top"
            searchPosition="sticky"
            dynamicWidth={true}
          />
        </div>

        {/* Hidden file input — placed outside BottomSheet scroll area */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleFileChange}
          className="hidden"
        />
      </div>
    </BottomSheet>
  );
}
