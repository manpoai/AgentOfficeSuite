'use client';

import { useEffect, useRef, useCallback } from 'react';
import data from '@emoji-mart/data';
import Picker from '@emoji-mart/react';
import { useTheme } from 'next-themes';
import { Upload } from 'lucide-react';
import { showError } from '@/lib/utils/error';
import { useT } from '@/lib/i18n';

interface EmojiPickerProps {
  onSelect: (emoji: string) => void;
  onRemove?: () => void;
  /** Called when user uploads a custom image. Returns the image URL string. */
  onUploadImage?: (file: File) => Promise<string>;
}

export function EmojiPicker({ onSelect, onRemove, onUploadImage }: EmojiPickerProps) {
  const { t } = useT();
  const { resolvedTheme } = useTheme();
  const containerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleEmojiSelect = useCallback((emoji: any) => {
    onSelect(emoji.native);
  }, [onSelect]);

  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !onUploadImage) return;
    try {
      const url = await onUploadImage(file);
      onSelect(url);
    } catch (err) {
      showError(t('errors.customIconUploadFailed'), err);
    }
    // Reset input so same file can be re-selected
    e.target.value = '';
  }, [onSelect, onUploadImage]);

  // Inject custom CSS to override emoji-mart styles to match app theme
  useEffect(() => {
    const style = document.createElement('style');
    style.setAttribute('data-emoji-picker-theme', '');
    style.textContent = `
      em-emoji-picker {
        --rgb-accent: none !important;
        --color-border: hsl(var(--border)) !important;
        --color-border-over: hsl(var(--border)) !important;
        --font-family: inherit !important;
      }
    `;
    document.head.appendChild(style);
    return () => { style.remove(); };
  }, []);

  return (
    <div ref={containerRef} className="flex flex-col">
      <Picker
        data={data}
        onEmojiSelect={handleEmojiSelect}
        theme={resolvedTheme === 'dark' ? 'dark' : 'light'}
        set="native"
        perLine={9}
        emojiSize={22}
        emojiButtonSize={32}
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
        dynamicWidth={false}
      />
      <div className="flex border-t border-border bg-card">
        {onUploadImage && (
          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex-1 flex items-center justify-center gap-1.5 text-xs text-muted-foreground hover:text-foreground py-2 hover:bg-accent transition-colors"
          >
            <Upload className="h-3.5 w-3.5" />
            Upload image
          </button>
        )}
        {onRemove && (
          <button
            onClick={onRemove}
            className="flex-1 text-xs text-muted-foreground hover:text-foreground py-2 hover:bg-accent transition-colors"
          >
            Remove icon
          </button>
        )}
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleFileChange}
        className="hidden"
      />
    </div>
  );
}
