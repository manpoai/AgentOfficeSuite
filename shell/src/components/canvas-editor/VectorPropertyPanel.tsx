'use client';

import {
  X,
  AlignStartHorizontal, AlignHorizontalJustifyCenter, AlignEndHorizontal,
  AlignStartVertical, AlignVerticalJustifyCenter, AlignEndVertical,
  AlignHorizontalSpaceAround, AlignVerticalSpaceAround,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { VectorSelectionInfo } from './VectorEditor';
import type { PathPoint } from '@/components/shared/svg-path-utils';
import { NumberInput } from './NumberInput';

function IconBtn({ icon: Icon, onClick, title }: {
  icon: React.ElementType; onClick: () => void; title: string;
}) {
  return (
    <button onClick={onClick} title={title}
      className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors">
      <Icon className="h-3.5 w-3.5" />
    </button>
  );
}

interface VectorPropertyPanelProps {
  selectionInfo: VectorSelectionInfo;
  onUpdatePoints: (changes: Partial<PathPoint>) => void;
  cornerRadius: number;
  onCornerRadiusChange: (v: number) => void;
  onClose: () => void;
}

export function VectorPropertyPanel({
  selectionInfo, onUpdatePoints, cornerRadius, onCornerRadiusChange, onClose,
}: VectorPropertyPanelProps) {
  const { points, count } = selectionInfo;
  const isSingle = count === 1;
  const isMulti = count > 1;

  const singlePt = isSingle ? points[0]?.point : null;

  return (
    <div className="w-[260px] min-w-[260px] border-l border-border flex flex-col shrink-0 bg-card h-full shadow-lg">
      <div className="px-3 py-2 border-b border-border flex items-center justify-between shrink-0">
        <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
          {isMulti ? `${count} Points` : 'Anchor Point'}
        </span>
        <button onClick={onClose} className="p-0.5 text-muted-foreground hover:text-foreground transition-colors">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        {isSingle && singlePt && (
          <>
            <div className="px-3 py-1.5 border-b border-border">
              <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Position</span>
            </div>
            <div className="p-3 space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <div className="flex items-center gap-1">
                  <span className="text-[11px] text-muted-foreground w-4">X</span>
                  <NumberInput value={Math.round(singlePt.x * 10) / 10} onChange={v => onUpdatePoints({ x: v })} step={1} />
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-[11px] text-muted-foreground w-4">Y</span>
                  <NumberInput value={Math.round(singlePt.y * 10) / 10} onChange={v => onUpdatePoints({ y: v })} step={1} />
                </div>
              </div>
              <div className="flex items-center gap-1">
                <span className="text-[11px] text-muted-foreground w-14">Type</span>
                <span className="text-[11px] text-foreground capitalize">{singlePt.type}</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="text-[11px] text-muted-foreground w-14">Radius</span>
                <NumberInput value={cornerRadius} min={0} onChange={v => onCornerRadiusChange(v)} step={1} />
              </div>
            </div>
          </>
        )}

        {isMulti && (
          <>
            <div className="px-3 py-1.5 border-b border-border">
              <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Align</span>
            </div>
            <div className="p-3 flex flex-wrap gap-0.5">
              <IconBtn icon={AlignStartHorizontal} onClick={() => {
                const minX = Math.min(...points.map(p => p.point.x));
                points.forEach(p => { if (p.point.x !== minX) onUpdatePoints({ x: minX }); });
              }} title="Align left" />
              <IconBtn icon={AlignHorizontalJustifyCenter} onClick={() => {
                const avg = points.reduce((s, p) => s + p.point.x, 0) / count;
                points.forEach(() => onUpdatePoints({ x: avg }));
              }} title="Align center H" />
              <IconBtn icon={AlignEndHorizontal} onClick={() => {
                const maxX = Math.max(...points.map(p => p.point.x));
                points.forEach(p => { if (p.point.x !== maxX) onUpdatePoints({ x: maxX }); });
              }} title="Align right" />
              <IconBtn icon={AlignStartVertical} onClick={() => {
                const minY = Math.min(...points.map(p => p.point.y));
                points.forEach(p => { if (p.point.y !== minY) onUpdatePoints({ y: minY }); });
              }} title="Align top" />
              <IconBtn icon={AlignVerticalJustifyCenter} onClick={() => {
                const avg = points.reduce((s, p) => s + p.point.y, 0) / count;
                points.forEach(() => onUpdatePoints({ y: avg }));
              }} title="Align center V" />
              <IconBtn icon={AlignEndVertical} onClick={() => {
                const maxY = Math.max(...points.map(p => p.point.y));
                points.forEach(p => { if (p.point.y !== maxY) onUpdatePoints({ y: maxY }); });
              }} title="Align bottom" />
              {count >= 3 && (
                <>
                  <IconBtn icon={AlignHorizontalSpaceAround} onClick={() => {
                    const sorted = [...points].sort((a, b) => a.point.x - b.point.x);
                    const minX = sorted[0].point.x;
                    const maxX = sorted[sorted.length - 1].point.x;
                    const gap = (maxX - minX) / (count - 1);
                    sorted.forEach((p, i) => {
                      if (i > 0 && i < sorted.length - 1) onUpdatePoints({ x: minX + gap * i });
                    });
                  }} title="Distribute H" />
                  <IconBtn icon={AlignVerticalSpaceAround} onClick={() => {
                    const sorted = [...points].sort((a, b) => a.point.y - b.point.y);
                    const minY = sorted[0].point.y;
                    const maxY = sorted[sorted.length - 1].point.y;
                    const gap = (maxY - minY) / (count - 1);
                    sorted.forEach((p, i) => {
                      if (i > 0 && i < sorted.length - 1) onUpdatePoints({ y: minY + gap * i });
                    });
                  }} title="Distribute V" />
                </>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
