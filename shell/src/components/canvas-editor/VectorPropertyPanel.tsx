'use client';

import { X } from 'lucide-react';
import type { VectorSelectionInfo } from './VectorEditor';
import type { PathPoint } from '@/components/shared/svg-path-utils';

function NumberInput({ label, value, onChange, min, step = 1, mixed }: {
  label: string; value: number; onChange: (v: number) => void; min?: number; step?: number; mixed?: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <label className="text-[11px] text-muted-foreground w-10 shrink-0">{label}</label>
      <input type="number" value={mixed ? '' : Math.round(value * 100) / 100} min={min} step={step}
        placeholder={mixed ? 'mixed' : undefined}
        onChange={e => onChange(parseFloat(e.target.value) || 0)}
        className="flex-1 text-[11px] px-1.5 py-1 rounded border bg-background font-mono" />
    </div>
  );
}

const MIRROR_OPTIONS: { value: PathPoint['type']; label: string; desc: string }[] = [
  { value: 'corner', label: 'None', desc: 'Independent handles' },
  { value: 'smooth', label: 'Angle', desc: 'Same angle, free length' },
  { value: 'symmetric', label: 'Angle & Length', desc: 'Fully mirrored' },
];

export function VectorPropertyPanel({
  selectionInfo,
  onUpdatePoints,
  onClose,
  cornerRadius,
  onCornerRadiusChange,
}: {
  selectionInfo: VectorSelectionInfo;
  onUpdatePoints: (changes: Partial<PathPoint>) => void;
  onClose: () => void;
  cornerRadius?: number;
  onCornerRadiusChange?: (v: number) => void;
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
    <div className="w-[280px] min-w-[280px] border-l border-border flex flex-col shrink-0 bg-card overflow-y-auto h-full shadow-lg">
      <div className="px-3 py-2 border-b border-border flex items-center justify-between">
        <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
          {points.length === 1 ? 'Anchor Point' : `${points.length} Points`}
        </span>
        <button onClick={onClose} className="p-0.5 text-muted-foreground hover:text-foreground transition-colors">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Position */}
      <div className="px-3 py-1.5 border-b border-border">
        <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Position</span>
      </div>
      <div className="p-3 space-y-2">
        <div className="grid grid-cols-2 gap-2">
          <NumberInput label="X" value={x} mixed={xMixed}
            onChange={v => onUpdatePoints({ x: v })} />
          <NumberInput label="Y" value={y} mixed={yMixed}
            onChange={v => onUpdatePoints({ y: v })} />
        </div>
      </div>

      {/* Mirroring */}
      <div className="px-3 py-1.5 border-b border-border">
        <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Mirroring</span>
      </div>
      <div className="p-3">
        <div className="flex gap-1">
          {MIRROR_OPTIONS.map(opt => {
            const isActive = !typeMixed && type === opt.value;
            return (
              <button
                key={opt.value}
                onClick={() => onUpdatePoints({ type: opt.value })}
                className={`flex-1 px-2 py-1.5 rounded text-[10px] transition-colors ${
                  isActive
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted/50 text-muted-foreground hover:bg-muted'
                }`}
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

      {/* Corner Radius */}
      {onCornerRadiusChange && (
        <>
          <div className="px-3 py-1.5 border-b border-border">
            <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Corner Radius</span>
          </div>
          <div className="p-3">
            <NumberInput label="Radius" value={cornerRadius ?? 0} min={0}
              onChange={v => onCornerRadiusChange(v)} />
          </div>
        </>
      )}

      {/* Point info */}
      {points.length === 1 && (
        <>
          <div className="px-3 py-1.5 border-b border-border">
            <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Handles</span>
          </div>
          <div className="p-3 space-y-1">
            {points[0].point.handleIn ? (
              <p className="text-[10px] text-muted-foreground">
                In: ({Math.round(points[0].point.handleIn.x * 10) / 10}, {Math.round(points[0].point.handleIn.y * 10) / 10})
              </p>
            ) : (
              <p className="text-[10px] text-muted-foreground italic">No handle in</p>
            )}
            {points[0].point.handleOut ? (
              <p className="text-[10px] text-muted-foreground">
                Out: ({Math.round(points[0].point.handleOut.x * 10) / 10}, {Math.round(points[0].point.handleOut.y * 10) / 10})
              </p>
            ) : (
              <p className="text-[10px] text-muted-foreground italic">No handle out</p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
