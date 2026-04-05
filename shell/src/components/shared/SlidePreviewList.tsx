'use client';

import React, { useRef, useEffect } from 'react';
import { cn } from '@/lib/utils';

// ─── Types ──────────────────────────────────────────
interface SlideElement {
  type?: string;
  left?: number;
  top?: number;
  width?: number;
  height?: number;
  scaleX?: number;
  scaleY?: number;
  fill?: string;
  text?: string;
  fontSize?: number;
  rx?: number;
  src?: string;
  [key: string]: any;
}

interface SlideData {
  elements: SlideElement[];
  background: string;
  backgroundImage?: string;
  notes: string;
}

export interface SlidePreviewListProps {
  slides: Array<{ id?: string; data: SlideData; thumbnail?: string }>;
  currentSlideIndex: number;
  onSlideSelect: (index: number) => void;
  className?: string;
}

// ─── Aspect ratio constants ─────────────────────────
const SLIDE_WIDTH = 960;
const SLIDE_HEIGHT = 540;

// ─── Mini slide renderer ────────────────────────────
// Renders a scaled-down preview of slide elements (matches SlideThumb logic)
function SlidePreview({ slide, thumbnail }: { slide: SlideData; thumbnail?: string }) {
  if (thumbnail) {
    return (
      <img
        src={thumbnail}
        alt="Slide preview"
        className="absolute inset-0 w-full h-full object-contain"
        draggable={false}
      />
    );
  }

  // Scale factor: preview card is full-width on mobile (~350px typically)
  // We render elements relative to the SLIDE_WIDTH using percentage positioning
  return (
    <div
      className="absolute inset-0 w-full h-full overflow-hidden"
      style={{ backgroundColor: slide.background || '#ffffff' }}
    >
      {slide.backgroundImage && (
        <img
          src={slide.backgroundImage}
          alt=""
          className="absolute inset-0 w-full h-full object-cover"
          draggable={false}
        />
      )}
      {slide.elements.slice(0, 12).map((el, i) => {
        const leftPct = ((el.left || 0) / SLIDE_WIDTH) * 100;
        const topPct = ((el.top || 0) / SLIDE_HEIGHT) * 100;
        const widthPct = (((el.width || 100) * (el.scaleX || 1)) / SLIDE_WIDTH) * 100;
        const heightPct = (((el.height || 50) * (el.scaleY || 1)) / SLIDE_HEIGHT) * 100;

        const style: React.CSSProperties = {
          position: 'absolute',
          left: `${leftPct}%`,
          top: `${topPct}%`,
          width: `${widthPct}%`,
          height: `${heightPct}%`,
          overflow: 'hidden',
        };

        if (el.type === 'textbox') {
          // Use a relative font size based on container
          const fontSizePct = ((el.fontSize || 24) / SLIDE_HEIGHT) * 100;
          if (fontSizePct < 2) {
            // Too small to read -- show placeholder bars
            return (
              <div key={i} style={style}>
                {(el.text || '').split('\n').slice(0, 4).map((line: string, li: number) => (
                  <div
                    key={li}
                    style={{
                      height: '18%',
                      maxHeight: 4,
                      width: `${Math.min(100, Math.max(20, (line.length / 30) * 100))}%`,
                      backgroundColor: el.fill || '#333',
                      opacity: 0.35,
                      borderRadius: 1,
                      marginBottom: '4%',
                    }}
                  />
                ))}
              </div>
            );
          }
          return (
            <div
              key={i}
              style={{
                ...style,
                fontSize: `${fontSizePct}cqh`,
                lineHeight: '1.2',
                color: el.fill || '#333',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}
            >
              {el.text?.slice(0, 60)}
            </div>
          );
        }

        if (el.type === 'rect') {
          return (
            <div
              key={i}
              style={{
                ...style,
                backgroundColor: el.fill || '#e2e8f0',
                borderRadius: el.rx ? `${(el.rx / SLIDE_WIDTH) * 100}%` : undefined,
              }}
            />
          );
        }

        if (el.type === 'circle') {
          return <div key={i} style={{ ...style, backgroundColor: el.fill || '#e2e8f0', borderRadius: '50%' }} />;
        }

        if (el.type === 'triangle') {
          return (
            <div
              key={i}
              style={{
                ...style,
                backgroundColor: el.fill || '#e2e8f0',
                clipPath: 'polygon(50% 0%, 0% 100%, 100% 100%)',
              }}
            />
          );
        }

        if (el.type === 'image' && el.src) {
          return <img key={i} src={el.src} alt="" style={{ ...style, objectFit: 'cover' }} draggable={false} />;
        }

        // Fallback: generic shape
        return <div key={i} style={{ ...style, backgroundColor: el.fill || '#e2e8f0' }} />;
      })}
    </div>
  );
}

// ─── Main Component ─────────────────────────────────
export function SlidePreviewList({
  slides,
  currentSlideIndex,
  onSlideSelect,
  className,
}: SlidePreviewListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const slideRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // Scroll the current slide into view when it changes
  useEffect(() => {
    const el = slideRefs.current[currentSlideIndex];
    if (el && scrollRef.current) {
      el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [currentSlideIndex]);

  return (
    <div
      ref={scrollRef}
      className={cn(
        'flex-1 overflow-y-auto bg-[#f0f0f0] dark:bg-zinc-900 px-4 py-4 space-y-4',
        className,
      )}
    >
      {slides.map((slideItem, i) => (
        <button
          key={slideItem.id ?? i}
          ref={(el) => { slideRefs.current[i] = el; }}
          onClick={() => onSlideSelect(i)}
          className={cn(
            'relative block w-full rounded-lg overflow-hidden shadow-md transition-all',
            'active:scale-[0.98] touch-manipulation',
            i === currentSlideIndex
              ? 'ring-2 ring-primary ring-offset-2 ring-offset-[#f0f0f0] dark:ring-offset-zinc-900'
              : 'border border-border/50',
          )}
          style={{
            aspectRatio: `${SLIDE_WIDTH} / ${SLIDE_HEIGHT}`,
            containerType: 'size',
          }}
        >
          {/* Slide number badge */}
          <span className="absolute top-2 left-2 z-10 flex items-center justify-center min-w-[24px] h-6 px-1.5 rounded bg-black/50 text-white text-xs font-medium backdrop-blur-sm">
            {i + 1}
          </span>

          {/* Slide content preview */}
          <div className="absolute inset-0 bg-white">
            <SlidePreview slide={slideItem.data} thumbnail={slideItem.thumbnail} />
          </div>
        </button>
      ))}
    </div>
  );
}
