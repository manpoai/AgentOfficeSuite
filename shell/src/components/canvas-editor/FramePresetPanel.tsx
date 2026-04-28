'use client';

import { useState } from 'react';
import { ChevronRight, ChevronDown } from 'lucide-react';

type Preset = { name: string; w: number; h: number };
type Group = { name: string; presets: Preset[] };

const GROUPS: Group[] = [
  {
    name: 'Phone',
    presets: [
      { name: 'iPhone 17', w: 402, h: 874 },
      { name: 'iPhone 16 & 17 Pro', w: 402, h: 874 },
      { name: 'iPhone 16', w: 393, h: 852 },
      { name: 'iPhone 16 & 17 Pro Max', w: 440, h: 956 },
      { name: 'iPhone 16 Plus', w: 430, h: 932 },
      { name: 'iPhone Air', w: 420, h: 912 },
      { name: 'iPhone 14 & 15 Pro Max', w: 430, h: 932 },
      { name: 'iPhone 14 & 15 Pro', w: 393, h: 852 },
      { name: 'iPhone 13 & 14', w: 390, h: 844 },
      { name: 'iPhone 14 Plus', w: 428, h: 926 },
      { name: 'Android Compact', w: 412, h: 917 },
      { name: 'Android Medium', w: 700, h: 840 },
    ],
  },
  {
    name: 'Tablet',
    presets: [
      { name: 'iPad mini 8.3', w: 744, h: 1133 },
      { name: 'Surface Pro 8', w: 1440, h: 960 },
      { name: 'iPad Pro 11"', w: 834, h: 1194 },
      { name: 'iPad Pro 12.9"', w: 1024, h: 1366 },
      { name: 'Android Expanded', w: 1280, h: 800 },
    ],
  },
  {
    name: 'Desktop',
    presets: [
      { name: 'MacBook Air', w: 1280, h: 832 },
      { name: 'MacBook Pro 14"', w: 1512, h: 982 },
      { name: 'MacBook Pro 16"', w: 1728, h: 1117 },
      { name: 'Desktop', w: 1440, h: 1024 },
      { name: 'Wireframes', w: 1440, h: 1024 },
      { name: 'TV', w: 1280, h: 720 },
    ],
  },
  {
    name: 'Presentation',
    presets: [
      { name: 'Slide 16:9', w: 1920, h: 1080 },
      { name: 'Slide 4:3', w: 1024, h: 768 },
    ],
  },
  {
    name: 'Watch',
    presets: [
      { name: 'Apple Watch Series 10 42mm', w: 187, h: 223 },
      { name: 'Apple Watch Series 10 46mm', w: 208, h: 248 },
      { name: 'Apple Watch 41mm', w: 176, h: 215 },
      { name: 'Apple Watch 45mm', w: 198, h: 242 },
      { name: 'Apple Watch 44mm', w: 184, h: 224 },
      { name: 'Apple Watch 40mm', w: 162, h: 197 },
    ],
  },
  {
    name: 'Paper',
    presets: [
      { name: 'A4', w: 595, h: 842 },
      { name: 'A5', w: 420, h: 595 },
      { name: 'A6', w: 297, h: 420 },
      { name: 'Letter', w: 612, h: 792 },
      { name: 'Tabloid', w: 792, h: 1224 },
    ],
  },
  {
    name: 'Social media',
    presets: [
      { name: 'Twitter post', w: 1200, h: 675 },
      { name: 'Twitter header', w: 1500, h: 500 },
      { name: 'Facebook post', w: 1200, h: 630 },
      { name: 'Facebook cover', w: 820, h: 312 },
      { name: 'Instagram post', w: 1080, h: 1350 },
      { name: 'Instagram story', w: 1080, h: 1920 },
      { name: 'Dribbble shot', w: 400, h: 300 },
      { name: 'Dribbble shot HD', w: 800, h: 600 },
      { name: 'LinkedIn cover', w: 1584, h: 396 },
    ],
  },
];

interface FramePresetPanelProps {
  onSelect: (w: number, h: number, name: string) => void;
}

export function FramePresetPanel({ onSelect }: FramePresetPanelProps) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const toggle = (name: string) => setExpanded(prev => {
    const next = new Set(prev);
    if (next.has(name)) next.delete(name); else next.add(name);
    return next;
  });

  return (
    <div className="h-full flex flex-col bg-card text-foreground">
      <div className="px-3 py-2 shrink-0">
        <span className="text-[12px] font-medium">Frame</span>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto">
        {GROUPS.map(group => {
          const isOpen = expanded.has(group.name);
          return (
            <div key={group.name}>
              <button
                onClick={() => toggle(group.name)}
                className="w-full flex items-center gap-1 px-3 py-1.5 text-[12px] hover:bg-accent/50 transition-colors"
              >
                {isOpen
                  ? <ChevronDown className="h-3 w-3 text-muted-foreground shrink-0" />
                  : <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />}
                <span>{group.name}</span>
              </button>
              {isOpen && (
                <div>
                  {group.presets.map(p => (
                    <button
                      key={p.name}
                      onClick={() => onSelect(p.w, p.h, p.name)}
                      className="w-full flex items-center justify-between gap-2 pl-7 pr-3 py-1 text-[11px] hover:bg-accent/50 transition-colors"
                    >
                      <span className="text-foreground truncate">{p.name}</span>
                      <span className="text-muted-foreground tabular-nums shrink-0">{p.w} × {p.h}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
