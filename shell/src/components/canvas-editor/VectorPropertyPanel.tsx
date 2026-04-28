'use client';

import { Trash } from 'lucide-react';
import type { VectorSelectionInfo } from './VectorEditor';
import type { PathPoint } from '@/components/shared/svg-path-utils';
import { cn } from '@/lib/utils';
import {
  SectionHeader,
  LabeledNumberInput,
  CornerRadiusField,
  IconBtn,
} from './CanvasPropertyPanel';

const MIRROR_OPTIONS: { value: PathPoint['type']; label: string; desc: string }[] = [
  { value: 'corner', label: 'None', desc: 'Independent handles' },
  { value: 'smooth', label: 'Angle', desc: 'Same angle, free length' },
  { value: 'symmetric', label: 'Both', desc: 'Fully mirrored' },
];

export function VectorPropertyPanel({
  selectionInfo,
  onUpdatePoints,
  onClose,
  cornerRadius,
  onCornerRadiusChange,
  onDeletePoints,
}: {
  selectionInfo: VectorSelectionInfo;
  onUpdatePoints: (changes: Partial<PathPoint>) => void;
  onClose: () => void;
  cornerRadius?: number;
  onCornerRadiusChange?: (v: number) => void;
  onDeletePoints?: () => void;
}) {
  const { points } = selectionInfo;
  if (points.length === 0) return null;

  const allX = points.map(p => p.point.x);
  const allY = points.map(p => p.point.y);
  const allTypes = points.map(p => p.point.type);

  const xMixed = !allX.every(v => v === allX[0]);
  const yMixed = !allY.every(v => v === allY[0]);
  const typeMixed = !allTypes.every(v => v === allTypes[0]);

  const x = allX[0];
  const y = allY[0];
  const type = allTypes[0];

  return (
    <div className="w-[240px] min-w-[240px] border-l border-border flex flex-col shrink-0 bg-card h-full shadow-lg">
      {/* Header: "N selected" + actions on same row, right-aligned */}
      <div className="px-3 py-2 flex items-center gap-1 shrink-0">
        <span className="text-[12px] font-medium text-foreground">
          {points.length} selected
        </span>
        <div className="flex-1" />
        {onDeletePoints && (
          <IconBtn icon={Trash} onClick={onDeletePoints} title="Delete points" danger />
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">

        {/* §1 Position */}
        <SectionHeader>Position</SectionHeader>
        <div className="px-3 pb-3">
          <div className="grid grid-cols-[1fr_1fr_24px] gap-2 items-center">
            <LabeledNumberInput
              label="X"
              value={xMixed ? null : Math.round(x * 100) / 100}
              onChange={v => onUpdatePoints({ x: v })}
              placeholder="Mixed"
            />
            <LabeledNumberInput
              label="Y"
              value={yMixed ? null : Math.round(y * 100) / 100}
              onChange={v => onUpdatePoints({ y: v })}
              placeholder="Mixed"
            />
            <div />
          </div>
        </div>

        {/* §2 Mirroring */}
        <SectionHeader>Mirroring</SectionHeader>
        <div className="px-3 pb-3">
          <div className="flex gap-1">
            {MIRROR_OPTIONS.map(opt => {
              const isActive = !typeMixed && type === opt.value;
              return (
                <button
                  key={opt.value}
                  onClick={() => onUpdatePoints({ type: opt.value })}
                  className={cn('flex-1 h-6 text-[10px] flex items-center justify-center rounded transition-colors',
                    isActive
                      ? 'bg-white text-foreground ring-1 ring-border'
                      : 'bg-[#F5F5F5] text-muted-foreground hover:bg-[#EBEBEB] hover:text-foreground')}
                  title={opt.desc}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
          {typeMixed && (
            <p className="text-[10px] text-muted-foreground mt-1 italic">Mixed mirroring modes</p>
          )}
        </div>

        {/* §3 Appearance — corner radius lives on each anchor point */}
        {onCornerRadiusChange && (
          <>
            <SectionHeader>Appearance</SectionHeader>
            <div className="px-3 pb-3">
              <div className="grid grid-cols-[1fr_1fr_24px] gap-2 items-end">
                <CornerRadiusField
                  value={cornerRadius ?? 0}
                  onChange={v => onCornerRadiusChange(v)}
                />
                <div />
                <div />
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
