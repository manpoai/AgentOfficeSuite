'use client';

import { useState, useEffect } from 'react';
import {
  X, Bold, Italic, Underline, Strikethrough,
  AlignLeft, AlignCenter, AlignRight, AlignJustify,
  ArrowUpToLine, ArrowDownToLine, MoveUp, MoveDown,
  FlipHorizontal2, FlipVertical2, RotateCcw, Replace,
  Image as ImageIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { showError } from '@/lib/utils/error';
import { useT, getT } from '@/lib/i18n';
import { ColorPicker } from '@/components/ui/color-picker';
import * as gw from '@/lib/api/gateway';
import { SlideData, FONT_FAMILIES, getObjType } from './types';
import { getFabricModule } from './useFabric';
import { pickFile } from '@/lib/utils/pick-file';

const PPT_PROPERTY_T_KEYS = {
  background: 'ppt.properties.background',
  color: 'ppt.properties.color',
  image: 'ppt.properties.image',
  uploadBackgroundImage: 'ppt.properties.uploadBackgroundImage',
  applyToAllSlides: 'ppt.properties.applyToAllSlides',
  position: 'ppt.properties.position',
  size: 'ppt.properties.size',
  transform: 'ppt.properties.transform',
  layer: 'ppt.properties.layer',
  front: 'ppt.properties.front',
  back: 'ppt.properties.back',
  flipHorizontalShort: 'ppt.properties.flipHorizontalShort',
  flipVerticalShort: 'ppt.properties.flipVerticalShort',
  text: 'ppt.properties.text',
  font: 'ppt.properties.font',
  shape: 'ppt.properties.shape',
  fill: 'ppt.properties.fill',
  stroke: 'ppt.properties.stroke',
  dash: 'ppt.properties.dash',
  shadow: 'ppt.properties.shadow',
  border: 'ppt.properties.border',
  imageSection: 'ppt.properties.imageSection',
  replaceImage: 'ppt.properties.replaceImage',
  resetToDefault: 'ppt.properties.resetToDefault',
  table: 'ppt.properties.table',
  tableDimensions: 'ppt.properties.tableDimensions',
  tableEditHint: 'ppt.properties.tableEditHint',
  slideProperties: 'ppt.properties.slideProperties',
  objectPropertiesWithType: 'ppt.properties.objectPropertiesWithType',
  objectFallback: 'ppt.properties.objectFallback',
  radius: 'ppt.properties.radius',
  borderWidthShort: 'ppt.properties.borderWidthShort',
  padding: 'ppt.properties.padding',
} as const;

function SectionLabel({ label }: { label: string }) {
  return (
    <div className="text-[11px] text-muted-foreground uppercase tracking-wider font-medium pt-1">
      {label}
    </div>
  );
}

function PropInput({
  label,
  value,
  onChange,
  step = 1,
  min,
  max,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
  max?: number;
}) {
  const [localValue, setLocalValue] = useState(String(value));

  // Sync from external when not focused
  useEffect(() => {
    setLocalValue(String(value));
  }, [value]);

  const commit = () => {
    const num = Number(localValue);
    if (!isNaN(num) && num !== value) onChange(num);
  };

  return (
    <div className="flex items-center gap-1">
      <label className="text-muted-foreground w-10 shrink-0 text-xs">{label}</label>
      <input
        type="number"
        value={localValue}
        onChange={(e) => setLocalValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') commit(); }}
        step={step}
        min={min}
        max={max}
        className="w-[70px] h-7 bg-transparent border border-border rounded px-1.5 text-foreground text-xs"
      />
    </div>
  );
}

function ToggleBtn({
  active,
  onClick,
  title,
  children,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'p-1.5 rounded transition-colors',
        active ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground hover:bg-accent'
      )}
      title={title}
    >
      {children}
    </button>
  );
}

function SlidePropertiesSection({
  currentSlide,
  onBackgroundChange,
  onBackgroundImageChange,
  onApplyToAll,
}: {
  currentSlide: SlideData;
  onBackgroundChange: (bg: string) => void;
  onBackgroundImageChange: (bgImage: string | undefined) => void;
  onApplyToAll: () => void;
}) {
  const { t } = useT();

  const handleUploadBgImage = () => {
    pickFile({ accept: 'image/*' }).then(async (files) => {
      const file = files[0];
      if (!file) return;
      try {
        const formData = new FormData();
        formData.append('file', file);
        const resp = await fetch('/api/gateway/uploads', { method: 'POST', headers: gw.gwAuthHeaders(), body: formData });
        if (!resp.ok) throw new Error('Upload failed');
        const data = await resp.json();
        const url = data.url?.startsWith('http') ? data.url : `/api/gateway${data.url?.replace(/^\/api/, '')}`;
        onBackgroundImageChange(url);
      } catch (err) {
        showError(getT()('errors.bgImageUploadFailed'), err);
      }
    });
  };

  return (
    <>
      <SectionLabel label={t(PPT_PROPERTY_T_KEYS.background)} />
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <label className="text-muted-foreground w-14 shrink-0">{t(PPT_PROPERTY_T_KEYS.color)}</label>
          <ColorPicker
            color={currentSlide.background || '#ffffff'}
            onChange={(c) => onBackgroundChange(c)}
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-muted-foreground">{t(PPT_PROPERTY_T_KEYS.image)}</label>
          {currentSlide.backgroundImage ? (
            <div className="relative rounded border border-border overflow-hidden" style={{ aspectRatio: '16/9' }}>
              <img src={currentSlide.backgroundImage} alt={t(PPT_PROPERTY_T_KEYS.image)} className="w-full h-full object-cover" />
              <div className="absolute inset-0 bg-black/0 hover:bg-black/30 transition-colors flex items-center justify-center gap-2 opacity-0 hover:opacity-100">
                <button onClick={handleUploadBgImage} className="px-2 py-1 rounded bg-card/90 text-xs text-foreground hover:bg-card">
                  {t('common.replace')}
                </button>
                <button onClick={() => onBackgroundImageChange(undefined)} className="px-2 py-1 rounded bg-card/90 text-xs text-destructive hover:bg-card">
                  {t('common.delete')}
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={handleUploadBgImage}
              className="w-full py-3 rounded border border-dashed border-border text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors text-xs flex items-center justify-center gap-1.5"
            >
              <ImageIcon className="h-3.5 w-3.5" />
              {t(PPT_PROPERTY_T_KEYS.uploadBackgroundImage)}
            </button>
          )}
        </div>

        <button
          onClick={onApplyToAll}
          className="w-full py-1.5 rounded border border-border text-muted-foreground hover:text-foreground hover:bg-accent transition-colors text-xs"
        >
          {t(PPT_PROPERTY_T_KEYS.applyToAllSlides)}
        </button>
      </div>
    </>
  );
}

function CommonPropertiesSection({
  obj,
  canvas,
  getVisualW,
  getVisualH,
  setVisualW,
  setVisualH,
  updateAndSave,
  propVersion,
}: {
  obj: any;
  canvas: any;
  getVisualW: () => number;
  getVisualH: () => number;
  setVisualW: (w: number) => void;
  setVisualH: (h: number) => void;
  updateAndSave: (prop: string, val: any) => void;
  propVersion: number;
}) {
  const { t } = useT();

  return (
    <>
      <SectionLabel label={t(PPT_PROPERTY_T_KEYS.position)} />
      <div className="grid grid-cols-2 gap-2">
        <PropInput label="X" value={Math.round(obj.left || 0)} onChange={(v) => updateAndSave('left', v)} />
        <PropInput label="Y" value={Math.round(obj.top || 0)} onChange={(v) => updateAndSave('top', v)} />
      </div>

      <SectionLabel label={t(PPT_PROPERTY_T_KEYS.size)} />
      <div className="grid grid-cols-2 gap-2">
        <PropInput label="W" value={getVisualW()} onChange={(v) => setVisualW(v)} />
        <PropInput label="H" value={getVisualH()} onChange={(v) => setVisualH(v)} />
      </div>

      <SectionLabel label={t(PPT_PROPERTY_T_KEYS.transform)} />
      <div className="flex flex-col gap-2">
        <PropInput label="Angle" value={Math.round(obj.angle || 0)} onChange={(v) => updateAndSave('angle', v)} />
        <div className="flex items-center gap-1">
          <label className="text-muted-foreground w-10 shrink-0 text-xs">Alpha</label>
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round((obj.opacity ?? 1) * 100)}
            onChange={(e) => updateAndSave('opacity', Number(e.target.value) / 100)}
            className="flex-1 h-1 accent-primary"
          />
          <span className="text-muted-foreground w-7 text-right text-xs">{Math.round((obj.opacity ?? 1) * 100)}</span>
        </div>
      </div>

      <SectionLabel label={t(PPT_PROPERTY_T_KEYS.layer)} />
      <div className="flex items-center gap-1">
        <button
          onClick={() => { canvas?.fire('before:modified', { target: obj }); canvas?.bringObjectToFront(obj); canvas?.renderAll(); canvas?.fire('object:modified', { target: obj }); }}
          className="flex-1 py-1 rounded border border-border text-muted-foreground hover:text-foreground hover:bg-accent transition-colors flex items-center justify-center gap-1"
          title={t('toolbar.bringToFront')}
        >
          <ArrowUpToLine className="h-3 w-3" /> {t(PPT_PROPERTY_T_KEYS.front)}
        </button>
        <button
          onClick={() => { canvas?.fire('before:modified', { target: obj }); canvas?.bringObjectForward(obj); canvas?.renderAll(); canvas?.fire('object:modified', { target: obj }); }}
          className="flex-1 py-1 rounded border border-border text-muted-foreground hover:text-foreground hover:bg-accent transition-colors flex items-center justify-center gap-1"
          title={t('toolbar.bringForward')}
        >
          <MoveUp className="h-3 w-3" />
        </button>
        <button
          onClick={() => { canvas?.fire('before:modified', { target: obj }); canvas?.sendObjectBackwards(obj); canvas?.renderAll(); canvas?.fire('object:modified', { target: obj }); }}
          className="flex-1 py-1 rounded border border-border text-muted-foreground hover:text-foreground hover:bg-accent transition-colors flex items-center justify-center gap-1"
          title={t('toolbar.sendBackward')}
        >
          <MoveDown className="h-3 w-3" />
        </button>
        <button
          onClick={() => { canvas?.fire('before:modified', { target: obj }); canvas?.sendObjectToBack(obj); canvas?.renderAll(); canvas?.fire('object:modified', { target: obj }); }}
          className="flex-1 py-1 rounded border border-border text-muted-foreground hover:text-foreground hover:bg-accent transition-colors flex items-center justify-center gap-1"
          title={t('toolbar.sendToBack')}
        >
          <ArrowDownToLine className="h-3 w-3" /> {t(PPT_PROPERTY_T_KEYS.back)}
        </button>
      </div>

      <div className="flex items-center gap-1">
        <button
          onClick={() => { canvas?.fire('before:modified', { target: obj }); obj.set('flipX', !obj.flipX); canvas?.renderAll(); canvas?.fire('object:modified', { target: obj }); }}
          className="flex-1 py-1 rounded border border-border text-muted-foreground hover:text-foreground hover:bg-accent transition-colors flex items-center justify-center gap-1"
          title={t('toolbar.flipHorizontal')}
        >
          <FlipHorizontal2 className="h-3 w-3" /> {t(PPT_PROPERTY_T_KEYS.flipHorizontalShort)}
        </button>
        <button
          onClick={() => { canvas?.fire('before:modified', { target: obj }); obj.set('flipY', !obj.flipY); canvas?.renderAll(); canvas?.fire('object:modified', { target: obj }); }}
          className="flex-1 py-1 rounded border border-border text-muted-foreground hover:text-foreground hover:bg-accent transition-colors flex items-center justify-center gap-1"
          title={t('toolbar.flipVertical')}
        >
          <FlipVertical2 className="h-3 w-3" /> {t(PPT_PROPERTY_T_KEYS.flipVerticalShort)}
        </button>
      </div>

      <div className="border-t border-border" />
    </>
  );
}

function TextPropertiesSection({
  obj,
  canvas,
  updateAndSave,
  propVersion,
}: {
  obj: any;
  canvas: any;
  updateAndSave: (prop: string, val: any) => void;
  propVersion: number;
}) {
  const { t } = useT();

  return (
    <>
      <SectionLabel label={t(PPT_PROPERTY_T_KEYS.text)} />
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <label className="text-muted-foreground w-10 shrink-0">{t(PPT_PROPERTY_T_KEYS.font)}</label>
          <select
            value={obj.fontFamily || 'Inter, system-ui, sans-serif'}
            onChange={(e) => updateAndSave('fontFamily', e.target.value)}
            className="flex-1 h-7 bg-transparent border border-border rounded px-1.5 text-foreground text-xs"
          >
            {FONT_FAMILIES.map(f => (
              <option key={f.value} value={f.value} style={{ fontFamily: f.value }}>{t((f as any).labelKey || f.label)}</option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2">
          <label className="text-muted-foreground w-10 shrink-0">{t(PPT_PROPERTY_T_KEYS.size)}</label>
          <input
            type="number"
            value={obj.fontSize || 24}
            onChange={(e) => updateAndSave('fontSize', Math.max(1, Number(e.target.value)))}
            className="w-16 h-7 bg-transparent border border-border rounded px-1.5 text-foreground text-xs"
            min={1}
            max={200}
          />
          <span className="text-muted-foreground">px</span>
        </div>

        <div className="flex items-center gap-1">
          <ToggleBtn active={obj.fontWeight === 'bold'} onClick={() => updateAndSave('fontWeight', obj.fontWeight === 'bold' ? 'normal' : 'bold')} title={t('toolbar.bold')}>
            <Bold className="h-3.5 w-3.5" />
          </ToggleBtn>
          <ToggleBtn active={obj.fontStyle === 'italic'} onClick={() => updateAndSave('fontStyle', obj.fontStyle === 'italic' ? 'normal' : 'italic')} title={t('toolbar.italic')}>
            <Italic className="h-3.5 w-3.5" />
          </ToggleBtn>
          <ToggleBtn active={!!obj.underline} onClick={() => updateAndSave('underline', !obj.underline)} title={t('toolbar.underline')}>
            <Underline className="h-3.5 w-3.5" />
          </ToggleBtn>
          <ToggleBtn active={!!obj.linethrough} onClick={() => updateAndSave('linethrough', !obj.linethrough)} title={t('toolbar.strikethrough')}>
            <Strikethrough className="h-3.5 w-3.5" />
          </ToggleBtn>
        </div>

        <div className="flex items-center gap-1">
          <ToggleBtn active={obj.textAlign === 'left'} onClick={() => updateAndSave('textAlign', 'left')} title={t('toolbar.alignLeft')}>
            <AlignLeft className="h-3.5 w-3.5" />
          </ToggleBtn>
          <ToggleBtn active={obj.textAlign === 'center'} onClick={() => updateAndSave('textAlign', 'center')} title={t('toolbar.alignCenter')}>
            <AlignCenter className="h-3.5 w-3.5" />
          </ToggleBtn>
          <ToggleBtn active={obj.textAlign === 'right'} onClick={() => updateAndSave('textAlign', 'right')} title={t('toolbar.alignRight')}>
            <AlignRight className="h-3.5 w-3.5" />
          </ToggleBtn>
          <ToggleBtn active={obj.textAlign === 'justify'} onClick={() => updateAndSave('textAlign', 'justify')} title={t('toolbar.alignJustify')}>
            <AlignJustify className="h-3.5 w-3.5" />
          </ToggleBtn>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <PropInput label="LnH" value={Number((obj.lineHeight || 1.3).toFixed(1))} onChange={(v) => updateAndSave('lineHeight', v)} step={0.1} min={0.5} max={5} />
          <PropInput label="Spc" value={Math.round(obj.charSpacing || 0)} onChange={(v) => updateAndSave('charSpacing', v)} />
        </div>

        <div className="flex items-center gap-2">
          <label className="text-muted-foreground w-10 shrink-0">{t(PPT_PROPERTY_T_KEYS.color)}</label>
          <ColorPicker color={obj.fill || '#333333'} onChange={(c) => updateAndSave('fill', c)} />
        </div>

        <PropInput label={t(PPT_PROPERTY_T_KEYS.padding)} value={obj.padding || 0} onChange={(v) => updateAndSave('padding', v)} min={0} max={100} />
      </div>
    </>
  );
}

function ShapePropertiesSection({
  obj,
  canvas,
  updateAndSave,
  propVersion,
}: {
  obj: any;
  canvas: any;
  updateAndSave: (prop: string, val: any) => void;
  propVersion: number;
}) {
  const { t } = useT();
  const fabricMod = getFabricModule();
  const objType = getObjType(obj);
  const [shadowEnabled, setShadowEnabled] = useState(!!obj.shadow);

  return (
    <>
      <SectionLabel label={t(PPT_PROPERTY_T_KEYS.shape)} />
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <label className="text-muted-foreground w-14 shrink-0">{t(PPT_PROPERTY_T_KEYS.fill)}</label>
          <ColorPicker color={obj.fill || '#e2e8f0'} onChange={(c) => updateAndSave('fill', c)} />
        </div>

        <div className="flex items-center gap-2">
          <label className="text-muted-foreground w-14 shrink-0">{t(PPT_PROPERTY_T_KEYS.stroke)}</label>
          <ColorPicker
            color={obj.stroke || '#94a3b8'}
            onChange={(c) => {
              updateAndSave('stroke', c);
              if (!obj.strokeWidth) updateAndSave('strokeWidth', 1);
            }}
          />
        </div>

        <PropInput label="Stroke W" value={obj.strokeWidth || 0} onChange={(v) => updateAndSave('strokeWidth', v)} min={0} max={20} />

        <div className="flex items-center gap-2">
          <label className="text-muted-foreground w-14 shrink-0">{t(PPT_PROPERTY_T_KEYS.dash)}</label>
          <select
            value={
              !obj.strokeDashArray ? 'solid'
                : obj.strokeDashArray[0] === 2 ? 'dotted'
                  : 'dashed'
            }
            onChange={(e) => {
              const val = e.target.value;
              const dash = val === 'dashed' ? [8, 4] : val === 'dotted' ? [2, 4] : undefined;
              updateAndSave('strokeDashArray', dash || null);
            }}
            className="flex-1 h-7 bg-transparent border border-border rounded px-1.5 text-foreground text-xs"
          >
            <option value="solid">{t('toolbar.common.solidLine')}</option>
            <option value="dashed">{t('toolbar.common.dashedLine')}</option>
            <option value="dotted">{t('toolbar.common.dottedLine')}</option>
          </select>
        </div>

        {objType === 'rect' && (
          <div className="grid grid-cols-2 gap-2">
            <PropInput label="rx" value={obj.rx || 0} onChange={(v) => { updateAndSave('rx', v); updateAndSave('ry', v); }} min={0} max={200} />
            <PropInput label="ry" value={obj.ry || 0} onChange={(v) => updateAndSave('ry', v)} min={0} max={200} />
          </div>
        )}

        <div className="flex items-center gap-2">
          <label className="text-muted-foreground w-14 shrink-0">{t(PPT_PROPERTY_T_KEYS.shadow)}</label>
          <button
            onClick={() => {
              canvas?.fire('before:modified', { target: obj });
              if (shadowEnabled) {
                obj.set('shadow', null);
                canvas?.renderAll();
                canvas?.fire('object:modified', { target: obj });
                setShadowEnabled(false);
              } else {
                const { Shadow } = fabricMod;
                obj.set('shadow', new Shadow({ color: 'rgba(0,0,0,0.3)', blur: 10, offsetX: 4, offsetY: 4 }));
                canvas?.renderAll();
                canvas?.fire('object:modified', { target: obj });
                setShadowEnabled(true);
              }
            }}
            className={cn(
              'px-2 py-1 rounded border text-xs transition-colors',
              shadowEnabled
                ? 'border-primary text-primary bg-primary/10'
                : 'border-border text-muted-foreground hover:text-foreground'
            )}
          >
            {shadowEnabled ? t('common.yes') : t('common.no')}
          </button>
        </div>
        {shadowEnabled && obj.shadow && (
          <div className="space-y-2 pl-4">
            <div className="flex items-center gap-2">
              <label className="text-muted-foreground w-10 shrink-0">{t(PPT_PROPERTY_T_KEYS.color)}</label>
              <ColorPicker
                color={obj.shadow.color?.startsWith('rgba') ? '#000000' : (obj.shadow.color || '#000000')}
                onChange={(c) => {
                  canvas?.fire('before:modified', { target: obj });
                  const { Shadow } = fabricMod;
                  obj.set('shadow', new Shadow({ ...obj.shadow, color: c }));
                  canvas?.renderAll();
                  canvas?.fire('object:modified', { target: obj });
                }}
              />
            </div>
            <PropInput label="Blur" value={obj.shadow.blur || 0} onChange={(v) => {
              canvas?.fire('before:modified', { target: obj });
              const { Shadow } = fabricMod;
              obj.set('shadow', new Shadow({ ...obj.shadow, blur: v }));
              canvas?.renderAll();
              canvas?.fire('object:modified', { target: obj });
            }} min={0} max={50} />
            <div className="grid grid-cols-2 gap-2">
              <PropInput label="offX" value={obj.shadow.offsetX || 0} onChange={(v) => {
                canvas?.fire('before:modified', { target: obj });
                const { Shadow } = fabricMod;
                obj.set('shadow', new Shadow({ ...obj.shadow, offsetX: v }));
                canvas?.renderAll();
                canvas?.fire('object:modified', { target: obj });
              }} />
              <PropInput label="offY" value={obj.shadow.offsetY || 0} onChange={(v) => {
                canvas?.fire('before:modified', { target: obj });
                const { Shadow } = fabricMod;
                obj.set('shadow', new Shadow({ ...obj.shadow, offsetY: v }));
                canvas?.renderAll();
                canvas?.fire('object:modified', { target: obj });
              }} />
            </div>
          </div>
        )}
      </div>
    </>
  );
}

function ImagePropertiesSection({
  obj,
  canvas,
  updateAndSave,
  propVersion,
}: {
  obj: any;
  canvas: any;
  updateAndSave: (prop: string, val: any) => void;
  propVersion: number;
}) {
  const { t } = useT();
  const fabricMod = getFabricModule();
  const [borderRadius, setBorderRadius] = useState(
    obj.clipPath?.rx ? Math.round(obj.clipPath.rx * (obj.scaleX || 1)) : 0
  );
  const [shadowEnabled, setShadowEnabled] = useState(!!obj.shadow);

  const applyBorderRadius = (r: number) => {
    canvas?.fire('before:modified', { target: obj });
    setBorderRadius(r);
    if (r > 0 && fabricMod.Rect) {
      obj.clipPath = new fabricMod.Rect({
        width: obj.width,
        height: obj.height,
        rx: r / (obj.scaleX || 1),
        ry: r / (obj.scaleY || 1),
        originX: 'center',
        originY: 'center',
      });
    } else {
      obj.clipPath = undefined;
    }
    canvas?.renderAll();
    canvas?.fire('object:modified', { target: obj });
  };

  const replaceImage = () => {
    pickFile({ accept: 'image/*' }).then(async (files) => {
      const file = files[0];
      if (!file) return;

      let imgSrc: string;
      try {
        const formData = new FormData();
        formData.append('file', file);
        const resp = await fetch('/api/gateway/uploads', { method: 'POST', headers: gw.gwAuthHeaders(), body: formData });
        if (!resp.ok) throw new Error('Upload failed');
        const data = await resp.json();
        imgSrc = data.url?.startsWith('http') ? data.url : `/api/gateway${data.url?.replace(/^\/api/, '')}`;
      } catch {
        imgSrc = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.readAsDataURL(file);
        });
      }

      const imgEl = new window.Image();
      imgEl.crossOrigin = 'anonymous';
      imgEl.onload = () => {
        const { FabricImage } = fabricMod;
        const newImg = new FabricImage(imgEl, {
          left: obj.left,
          top: obj.top,
          scaleX: obj.scaleX,
          scaleY: obj.scaleY,
          angle: obj.angle,
          opacity: obj.opacity,
        });
        canvas?.remove(obj);
        canvas?.add(newImg);
        canvas?.setActiveObject(newImg);
        canvas?.renderAll();
      };
      imgEl.src = imgSrc;
    });
  };

  const resetToDefault = () => {
    if (!obj) return;
    canvas?.fire('before:modified', { target: obj });
    const naturalW = obj.width || 200;
    const naturalH = obj.height || 200;
    const scale = Math.min(600 / naturalW, 400 / naturalH, 1);
    obj.set('scaleX', scale);
    obj.set('scaleY', scale);
    canvas?.renderAll();
    canvas?.fire('object:modified', { target: obj });
  };

  return (
    <>
      <SectionLabel label={t(PPT_PROPERTY_T_KEYS.imageSection)} />
      <div className="space-y-2">
        <PropInput label={t(PPT_PROPERTY_T_KEYS.radius)} value={borderRadius} onChange={(v) => applyBorderRadius(v)} min={0} max={200} />

        <div className="flex items-center gap-2">
          <label className="text-muted-foreground w-14 shrink-0">{t(PPT_PROPERTY_T_KEYS.border)}</label>
          <ColorPicker
            color={obj.stroke || '#000000'}
            onChange={(c) => {
              updateAndSave('stroke', c);
              if (!obj.strokeWidth) updateAndSave('strokeWidth', 1);
            }}
          />
        </div>
        <PropInput label={t(PPT_PROPERTY_T_KEYS.borderWidthShort)} value={obj.strokeWidth || 0} onChange={(v) => updateAndSave('strokeWidth', v)} min={0} max={20} />

        <div className="flex items-center gap-2">
          <label className="text-muted-foreground w-14 shrink-0">{t(PPT_PROPERTY_T_KEYS.shadow)}</label>
          <button
            onClick={() => {
              canvas?.fire('before:modified', { target: obj });
              if (shadowEnabled) {
                obj.set('shadow', null);
                canvas?.renderAll();
                canvas?.fire('object:modified', { target: obj });
                setShadowEnabled(false);
              } else {
                const { Shadow } = fabricMod;
                obj.set('shadow', new Shadow({ color: 'rgba(0,0,0,0.3)', blur: 10, offsetX: 4, offsetY: 4 }));
                canvas?.renderAll();
                canvas?.fire('object:modified', { target: obj });
                setShadowEnabled(true);
              }
            }}
            className={cn(
              'px-2 py-1 rounded border text-xs transition-colors',
              shadowEnabled
                ? 'border-primary text-primary bg-primary/10'
                : 'border-border text-muted-foreground hover:text-foreground'
            )}
          >
            {shadowEnabled ? t('common.yes') : t('common.no')}
          </button>
        </div>

        <div className="border-t border-border pt-2 space-y-1.5">
          <button
            onClick={replaceImage}
            className="w-full py-1.5 rounded border border-border text-muted-foreground hover:text-foreground hover:bg-accent transition-colors text-xs flex items-center justify-center gap-1"
          >
            <Replace className="h-3 w-3" /> {t(PPT_PROPERTY_T_KEYS.replaceImage)}
          </button>
          <button
            onClick={resetToDefault}
            className="w-full py-1.5 rounded border border-border text-muted-foreground hover:text-foreground hover:bg-accent transition-colors text-xs flex items-center justify-center gap-1"
          >
            <RotateCcw className="h-3 w-3" /> {t(PPT_PROPERTY_T_KEYS.resetToDefault)}
          </button>
        </div>
      </div>
    </>
  );
}

function TablePropertiesSection({ obj, canvas, propVersion }: {
  obj: any;
  canvas: any;
  propVersion: number;
}) {
  const { t } = useT();
  const tJSON = obj.__tableJSON;
  const tableContent = tJSON?.content?.[0]?.content || [];
  const rows = tableContent.length || 3;
  const cols = tableContent[0]?.content?.length || 3;

  return (
    <>
      <SectionLabel label={t(PPT_PROPERTY_T_KEYS.table)} />
      <div className="space-y-2 text-xs">
        <div className="flex items-center gap-2 text-muted-foreground">
          <span>{t(PPT_PROPERTY_T_KEYS.tableDimensions, { rows, cols })}</span>
        </div>
        <p className="text-muted-foreground text-[10px]">
          {t(PPT_PROPERTY_T_KEYS.tableEditHint)}
        </p>
      </div>
    </>
  );
}

export interface PropertyPanelProps {
  selectedObj: any;
  canvas: any;
  currentSlide: SlideData;
  onSlideBackgroundChange: (bg: string) => void;
  onSlideBackgroundImageChange: (bgImage: string | undefined) => void;
  onApplyBackgroundToAll: () => void;
  propVersion: number;
  onClose: () => void;
}

export function PropertyPanel({
  selectedObj,
  canvas,
  currentSlide,
  onSlideBackgroundChange,
  onSlideBackgroundImageChange,
  onApplyBackgroundToAll,
  propVersion,
  onClose,
}: PropertyPanelProps) {
  const { t } = useT();
  const objType = selectedObj ? getObjType(selectedObj) : null;

  const updateProp = (prop: string, val: any) => {
    if (!selectedObj || !canvas) return;
    selectedObj.set(prop, val);
    canvas.renderAll();
  };

  const updateAndSave = (prop: string, val: any) => {
    canvas?.fire('before:modified', { target: selectedObj });
    updateProp(prop, val);
    canvas?.fire('object:modified', { target: selectedObj });
  };

  const getVisualW = () => selectedObj ? Math.round((selectedObj.width || 0) * (selectedObj.scaleX || 1)) : 0;
  const getVisualH = () => selectedObj ? Math.round((selectedObj.height || 0) * (selectedObj.scaleY || 1)) : 0;

  const setVisualW = (newW: number) => {
    if (!selectedObj || !newW) return;
    const newScaleX = newW / (selectedObj.width || 1);
    updateAndSave('scaleX', newScaleX);
  };

  const setVisualH = (newH: number) => {
    if (!selectedObj || !newH) return;
    const newScaleY = newH / (selectedObj.height || 1);
    updateAndSave('scaleY', newScaleY);
  };

  return (
    <div className="w-[280px] border-l border-border flex flex-col shrink-0 bg-card overflow-y-auto">
      <div className="px-3 py-2 border-b border-border flex items-center justify-between">
        <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
          {selectedObj
            ? t(PPT_PROPERTY_T_KEYS.objectPropertiesWithType, { type: objType || t(PPT_PROPERTY_T_KEYS.objectFallback) })
            : t(PPT_PROPERTY_T_KEYS.slideProperties)}
        </span>
        <button onClick={onClose} className="p-0.5 text-muted-foreground hover:text-foreground transition-colors" title={t('toolbar.closePanel')}>
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="p-3 space-y-4 text-xs">
        {!selectedObj ? (
          <SlidePropertiesSection
            currentSlide={currentSlide}
            onBackgroundChange={onSlideBackgroundChange}
            onBackgroundImageChange={onSlideBackgroundImageChange}
            onApplyToAll={onApplyBackgroundToAll}
          />
        ) : (
          <>
            <CommonPropertiesSection
              obj={selectedObj}
              canvas={canvas}
              getVisualW={getVisualW}
              getVisualH={getVisualH}
              setVisualW={setVisualW}
              setVisualH={setVisualH}
              updateAndSave={updateAndSave}
              propVersion={propVersion}
            />

            {objType === 'textbox' && (
              <TextPropertiesSection obj={selectedObj} canvas={canvas} updateAndSave={updateAndSave} propVersion={propVersion} />
            )}
            {(objType === 'rect' || objType === 'circle' || objType === 'ellipse' || objType === 'triangle' || objType === 'shape') && (
              <ShapePropertiesSection obj={selectedObj} canvas={canvas} updateAndSave={updateAndSave} propVersion={propVersion} />
            )}
            {objType === 'image' && (
              <ImagePropertiesSection obj={selectedObj} canvas={canvas} updateAndSave={updateAndSave} propVersion={propVersion} />
            )}
            {objType === 'table' && (
              <TablePropertiesSection obj={selectedObj} canvas={canvas} propVersion={propVersion} />
            )}
          </>
        )}
      </div>
    </div>
  );
}
