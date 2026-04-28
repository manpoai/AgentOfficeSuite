import type { DesignToken } from './types';
import { parseCornerRadiiFromHtml, applyCornerRadiiToHtml, parsePath, serializeSubPath, expandCornerRadii } from '@/components/shared/svg-path-utils';

export type MarkerType = 'none' | 'arrow' | 'triangle' | 'triangle-reversed' | 'circle' | 'diamond';

export interface SvgDropShadow {
  dx: number;
  dy: number;
  stdDeviation: number;
  color: string;
  opacity: number;
}

export interface ProjectedProps {
  textContent?: string;
  backgroundColor?: string;
  color?: string;
  fontSize?: number;
  fontFamily?: string;
  fontWeight?: string;
  textAlign?: 'left' | 'center' | 'right' | 'justify';
  verticalAlign?: 'top' | 'middle' | 'bottom';
  lineHeight?: number;
  letterSpacing?: number;
  textDecoration?: 'none' | 'underline' | 'line-through';
  borderRadius?: number;
  borderColor?: string;
  borderWidth?: number;
  borderStyle?: 'solid' | 'dashed' | 'dotted' | 'none';
  opacity?: number;
  imageSrc?: string;
  svgFill?: string;
  /** SVG fill alpha (0..1). Maps to <fill-opacity> attribute. */
  svgFillOpacity?: number;
  /** HTML background color alpha (0..1). Stored on the wrapper <div> as the
   *  4th channel of an rgba() background-color when below 1. */
  backgroundColorAlpha?: number;
  svgStroke?: string;
  /** SVG stroke alpha (0..1). Maps to <stroke-opacity> attribute. */
  svgStrokeOpacity?: number;
  svgStrokeWidth?: number;
  svgStrokeDasharray?: string;
  svgStrokeAlignment?: 'center' | 'inside' | 'outside';
  svgStrokeLinecap?: 'butt' | 'round' | 'square';
  svgMarkerStart?: MarkerType;
  svgMarkerEnd?: MarkerType;
  svgDropShadow?: SvgDropShadow | null;
  boxShadow?: string;
  isSvgShape?: boolean;
  /** True if the SVG shape is an open path (line, polyline, or path that
   * doesn't close with Z). Stroke endpoints (cap, start/end markers) only
   * make sense for open paths. */
  isOpenPath?: boolean;
  subLeft?: number;
  subTop?: number;
  subWidth?: number;
  subHeight?: number;
}

function svgBorderRadius(html: string): number | undefined {
  const radii = parseCornerRadiiFromHtml(html, 0);
  if (radii.length === 0) return 0;
  const nonZero = radii.filter(r => r > 0);
  if (nonZero.length === 0) return 0;
  const allSame = radii.every(r => r === radii[0]);
  if (allSame) return radii[0];
  return -1;
}

export function projectElement(html: string, cssPath?: string): ProjectedProps & { rawHTML: string } {
  if (typeof document === 'undefined') return { rawHTML: html };

  const div = document.createElement('div');
  div.innerHTML = html;
  let el = div.firstElementChild as HTMLElement | null;
  if (!el) return { rawHTML: html, textContent: html };

  if (cssPath) {
    const sub = el.querySelector(cssPath) as HTMLElement | null;
    if (sub) {
      const subStyle = sub.style;
      return {
        rawHTML: html,
        backgroundColor: subStyle.background || subStyle.backgroundColor || undefined,
        color: subStyle.color || undefined,
        fontSize: subStyle.fontSize ? parseFloat(subStyle.fontSize) || undefined : undefined,
        opacity: subStyle.opacity ? parseFloat(subStyle.opacity) : undefined,
        subLeft: subStyle.left ? parseFloat(subStyle.left) : undefined,
        subTop: subStyle.top ? parseFloat(subStyle.top) : undefined,
        subWidth: subStyle.width ? parseFloat(subStyle.width) : undefined,
        subHeight: subStyle.height ? parseFloat(subStyle.height) : undefined,
      };
    }
  }

  const style = el.style;

  const bgRaw = style.background || style.backgroundColor || '';
  let backgroundColor: string | undefined;
  let backgroundColorAlpha: number | undefined;
  if (bgRaw) {
    const hexMatch = bgRaw.match(/#[0-9a-fA-F]{3,8}/);
    const rgbMatch = bgRaw.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
    const rgbaMatch = bgRaw.match(/rgba\((\d+),\s*(\d+),\s*(\d+),\s*([0-9.]+)\)/);
    if (rgbaMatch) {
      const r = parseInt(rgbaMatch[1]), g = parseInt(rgbaMatch[2]), b = parseInt(rgbaMatch[3]);
      backgroundColor = `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
      backgroundColorAlpha = parseFloat(rgbaMatch[4]);
    } else if (hexMatch) {
      const hex = hexMatch[0];
      backgroundColor = hex.length === 9 ? hex.slice(0, 7) : hex;
      if (hex.length === 9) {
        backgroundColorAlpha = parseInt(hex.slice(7, 9), 16) / 255;
      }
    } else if (rgbMatch) {
      const r = parseInt(rgbMatch[1]), g = parseInt(rgbMatch[2]), b = parseInt(rgbMatch[3]);
      backgroundColor = `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
    }
  }

  let imageSrc: string | undefined;
  const img = el.querySelector('img');
  if (img) imageSrc = img.getAttribute('src') || undefined;
  else if (el.tagName === 'IMG') imageSrc = el.getAttribute('src') || undefined;

  const innerText = el.textContent || '';
  const hasContentEditable = el.getAttribute('contenteditable') === 'true' ||
    el.querySelector('[contenteditable]') !== null;

  const isSvgShape = html.includes('<svg');
  let svgFill: string | undefined;
  let svgFillOpacity: number | undefined;
  let svgStroke: string | undefined;
  let svgStrokeOpacity: number | undefined;
  let svgStrokeWidth: number | undefined;
  if (isSvgShape) {
    const resolveColor = (c: string | undefined): string | undefined => {
      if (!c || c === 'currentColor') return undefined;
      return c;
    };
    const fillMatch = html.match(/<(?:path|rect|circle|ellipse|polygon)[^>]*?\sfill="([^"]*)"/);
    const fillOpacityMatch = html.match(/<(?:path|rect|circle|ellipse|polygon)[^>]*?\sfill-opacity="([^"]*)"/);
    const strokeMatch = html.match(/<(?:path|rect|circle|ellipse|polygon)[^>]*?\sstroke="([^"]*)"/);
    const swMatch = html.match(/<(?:path|rect|circle|ellipse|polygon)[^>]*?\sstroke-width="([^"]*)"/);
    svgFill = resolveColor(fillMatch?.[1]);
    if (fillOpacityMatch) {
      const v = parseFloat(fillOpacityMatch[1]);
      if (!isNaN(v)) svgFillOpacity = v;
    }
    svgStroke = resolveColor(strokeMatch?.[1]);
    const strokeOpacityMatch = html.match(/<(?:path|rect|circle|ellipse|polygon)[^>]*?\sstroke-opacity="([^"]*)"/);
    if (strokeOpacityMatch) {
      const v = parseFloat(strokeOpacityMatch[1]);
      if (!isNaN(v)) svgStrokeOpacity = v;
    }
    if (!svgFill) {
      const svgFillMatch = html.match(/<svg[^>]*?\sfill="([^"]*)"/);
      svgFill = resolveColor(svgFillMatch?.[1]);
    }
    if (!svgStroke) {
      const svgStrokeMatch = html.match(/<svg[^>]*?\sstroke="([^"]*)"/);
      svgStroke = resolveColor(svgStrokeMatch?.[1]);
    }
    if (swMatch) { const v = parseFloat(swMatch[1]); svgStrokeWidth = isNaN(v) ? undefined : v; }
    if (svgStrokeWidth === undefined) {
      const svgSwMatch = html.match(/<svg[^>]*?\sstroke-width="([^"]*)"/);
      if (svgSwMatch) { const v = parseFloat(svgSwMatch[1]); svgStrokeWidth = isNaN(v) ? undefined : v; }
    }
    const alignAttr = html.match(/data-stroke-align="([^"]*)"/)?.[1];
    if (svgStrokeWidth !== undefined && (alignAttr === 'inside' || alignAttr === 'outside')) {
      svgStrokeWidth = svgStrokeWidth / 2;
    }
  }

  let svgStrokeDasharray: string | undefined;
  let svgStrokeAlignment: 'center' | 'inside' | 'outside' | undefined;
  if (isSvgShape) {
    const dashMatch = html.match(/<(?:path|rect|circle|ellipse|polygon)[^>]*?\sstroke-dasharray="([^"]*)"/);
    svgStrokeDasharray = dashMatch?.[1] ?? undefined;
    const paintMatch = html.match(/<(?:path|rect|circle|ellipse|polygon)[^>]*?\spaint-order="([^"]*)"/);
    const alignMatch = html.match(/data-stroke-align="([^"]*)"/);
    if (alignMatch?.[1] === 'outside') svgStrokeAlignment = 'outside';
    else if (alignMatch?.[1] === 'inside') svgStrokeAlignment = 'inside';
    else svgStrokeAlignment = 'center';
  }

  let svgStrokeLinecap: 'butt' | 'round' | 'square' | undefined;
  let svgMarkerStart: MarkerType | undefined;
  let svgMarkerEnd: MarkerType | undefined;
  let svgDropShadow: SvgDropShadow | null | undefined;
  let isOpenPath: boolean | undefined;
  if (isSvgShape) {
    // Strip <defs> when looking up shape-level attributes, so a marker
    // definition's interior doesn't accidentally match.
    const htmlWithoutDefs = html.replace(/<defs>[\s\S]*?<\/defs>/g, '');
    const lcMatch = htmlWithoutDefs.match(/stroke-linecap="([^"]*)"/);
    svgStrokeLinecap = lcMatch ? lcMatch[1] as 'butt' | 'round' | 'square' : undefined;
    const msMatch = htmlWithoutDefs.match(/marker-start="url\(#marker-([\w-]+)-start\)"/);
    svgMarkerStart = msMatch ? msMatch[1] as MarkerType : 'none';
    const meMatch = htmlWithoutDefs.match(/marker-end="url\(#marker-([\w-]+)-end\)"/);
    svgMarkerEnd = meMatch ? meMatch[1] as MarkerType : 'none';
    // Open path detection: lines, polylines, or path d not ending with Z/z.
    if (html.includes('<line') || html.includes('<polyline')) {
      isOpenPath = true;
    } else {
      const pathDMatch = html.match(/<path\b[^>]*\sd="([^"]*)"/);
      if (pathDMatch) {
        isOpenPath = !/[zZ]\s*$/.test(pathDMatch[1].trim());
      } else {
        isOpenPath = false;
      }
    }
    const filterMatch = html.match(/feDropShadow[^>]*dx="([^"]*)"[^>]*dy="([^"]*)"[^>]*stdDeviation="([^"]*)"[^>]*flood-color="([^"]*)"[^>]*flood-opacity="([^"]*)"/);
    if (filterMatch) {
      svgDropShadow = { dx: parseFloat(filterMatch[1]), dy: parseFloat(filterMatch[2]), stdDeviation: parseFloat(filterMatch[3]), color: filterMatch[4], opacity: parseFloat(filterMatch[5]) };
    } else {
      svgDropShadow = null;
    }
  }

  const boxShadow = !isSvgShape ? (style.boxShadow || undefined) : undefined;

  const textAlignRaw = style.textAlign as string;
  const textAlign: ProjectedProps['textAlign'] =
    textAlignRaw === 'left' || textAlignRaw === 'center' || textAlignRaw === 'right' || textAlignRaw === 'justify'
      ? textAlignRaw
      : undefined;

  const display = style.display;
  const alignItems = style.alignItems;
  const justifyContent = style.justifyContent;
  let verticalAlign: ProjectedProps['verticalAlign'] | undefined;
  if (display === 'flex') {
    const ai = alignItems || justifyContent;
    if (ai === 'center') verticalAlign = 'middle';
    else if (ai === 'flex-end' || ai === 'end') verticalAlign = 'bottom';
    else verticalAlign = 'top';
  }

  const lineHeightRaw = style.lineHeight;
  const lhParsed = parseFloat(lineHeightRaw ?? '');
  const lineHeight = lineHeightRaw && lineHeightRaw !== 'normal' && !isNaN(lhParsed)
    ? lhParsed
    : undefined;

  const letterSpacingRaw = style.letterSpacing;
  const lsParsed = parseFloat(letterSpacingRaw ?? '');
  const letterSpacing = letterSpacingRaw && letterSpacingRaw !== 'normal' && !isNaN(lsParsed)
    ? lsParsed
    : undefined;

  const textDecorationRaw = style.textDecoration;
  const textDecoration: ProjectedProps['textDecoration'] =
    textDecorationRaw === 'underline' || textDecorationRaw === 'line-through'
      ? textDecorationRaw
      : textDecorationRaw === 'none' ? 'none' : undefined;

  const borderColor = !isSvgShape ? (style.borderColor || undefined) : undefined;
  const borderWidth = !isSvgShape && style.borderWidth ? (parseFloat(style.borderWidth) || undefined) : undefined;
  const borderStyleRaw = !isSvgShape ? (style.borderStyle || undefined) : undefined;
  const borderStyleVal: ProjectedProps['borderStyle'] =
    borderStyleRaw === 'solid' || borderStyleRaw === 'dashed' || borderStyleRaw === 'dotted' || borderStyleRaw === 'none'
      ? borderStyleRaw : undefined;

  return {
    textContent: hasContentEditable || (!img && !isSvgShape && innerText.trim()) ? innerText : undefined,
    backgroundColor: isSvgShape ? undefined : backgroundColor,
    color: isSvgShape ? undefined : (style.color || undefined),
    fontSize: isSvgShape ? undefined : (style.fontSize ? parseFloat(style.fontSize) || undefined : undefined),
    fontFamily: isSvgShape ? undefined : (style.fontFamily || undefined),
    fontWeight: isSvgShape ? undefined : (style.fontWeight || undefined),
    textAlign: isSvgShape ? undefined : textAlign,
    verticalAlign: isSvgShape ? undefined : verticalAlign,
    lineHeight: isSvgShape ? undefined : lineHeight,
    letterSpacing: isSvgShape ? undefined : letterSpacing,
    textDecoration: isSvgShape ? undefined : textDecoration,
    borderRadius: isSvgShape ? svgBorderRadius(html) : (style.borderRadius ? parseFloat(style.borderRadius) || undefined : undefined),
    borderColor,
    borderWidth,
    borderStyle: borderStyleVal,
    opacity: style.opacity ? parseFloat(style.opacity) : undefined,
    imageSrc,
    svgFill,
    svgFillOpacity,
    backgroundColorAlpha,
    svgStroke,
    svgStrokeOpacity,
    svgStrokeWidth,
    svgStrokeDasharray,
    svgStrokeAlignment,
    svgStrokeLinecap,
    svgMarkerStart,
    svgMarkerEnd,
    svgDropShadow,
    boxShadow,
    isSvgShape,
    isOpenPath,
    rawHTML: html,
  };
}

export function applyProjection(rawHTML: string, changes: Partial<ProjectedProps>, cssPath?: string): string {
  if (typeof document === 'undefined') return rawHTML;

  if (cssPath) {
    const div = document.createElement('div');
    div.innerHTML = rawHTML;
    const root = div.firstElementChild as HTMLElement | null;
    const sub = root?.querySelector(cssPath) as HTMLElement | null;
    if (sub) {
      if (changes.backgroundColor !== undefined) sub.style.background = changes.backgroundColor;
      if (changes.color !== undefined) sub.style.color = changes.color;
      if (changes.fontSize !== undefined) sub.style.fontSize = changes.fontSize + 'px';
      if (changes.opacity !== undefined) sub.style.opacity = String(changes.opacity);
      if (changes.subLeft !== undefined) sub.style.left = changes.subLeft + 'px';
      if (changes.subTop !== undefined) sub.style.top = changes.subTop + 'px';
      if (changes.subWidth !== undefined) sub.style.width = changes.subWidth + 'px';
      if (changes.subHeight !== undefined) sub.style.height = changes.subHeight + 'px';
    }
    return div.innerHTML;
  }

  let html = rawHTML;

  const replaceAttrOnShapeOrSvg = (h: string, attr: string, val: string): string => {
    const shapeRe = new RegExp(`(<(?:path|rect|circle|ellipse|polygon)\\b[^>]*?)\\s${attr}="[^"]*"`);
    if (shapeRe.test(h)) return h.replace(shapeRe, `$1 ${attr}="${val}"`);
    const svgRe = new RegExp(`(<svg\\b[^>]*?)\\s${attr}="[^"]*"`);
    if (svgRe.test(h)) return h.replace(svgRe, `$1 ${attr}="${val}"`);
    const addRe = /<(path|rect|circle|ellipse|polygon)\b([^>]*?)>/;
    const m = h.match(addRe);
    if (m) return h.replace(addRe, `<${m[1]}${m[2]} ${attr}="${val}">`);
    return h;
  };

  if (changes.svgFill !== undefined) {
    html = replaceAttrOnShapeOrSvg(html, 'fill', changes.svgFill);
    // Defensive: strip any leftover wrapper background that earlier
    // iterations may have written. SVG shapes draw via <path fill>; the
    // wrapper div should never tint behind it.
    html = html.replace(/(<div\s+[^>]*?style="[^"]*?)(?:background(?:-color)?:[^;"]+;?\s*)+/g, '$1');
  }
  if (changes.svgFillOpacity !== undefined) {
    const v = Math.max(0, Math.min(1, changes.svgFillOpacity));
    if (v >= 1) {
      // Drop the attr entirely when fully opaque to keep markup clean.
      html = html.replace(/(<(?:path|rect|circle|ellipse|polygon)\b[^>]*?)\s+fill-opacity="[^"]*"/, '$1');
    } else {
      html = replaceAttrOnShapeOrSvg(html, 'fill-opacity', String(v));
    }
  }
  if (changes.svgStroke !== undefined) {
    html = replaceAttrOnShapeOrSvg(html, 'stroke', changes.svgStroke);
  }
  if (changes.svgStrokeOpacity !== undefined) {
    const v = Math.max(0, Math.min(1, changes.svgStrokeOpacity));
    if (v >= 1) {
      html = html.replace(/(<(?:path|rect|circle|ellipse|polygon)\b[^>]*?)\s+stroke-opacity="[^"]*"/, '$1');
    } else {
      html = replaceAttrOnShapeOrSvg(html, 'stroke-opacity', String(v));
    }
  }
  if (changes.svgStrokeWidth !== undefined) {
    const currentAlign = html.match(/data-stroke-align="([^"]*)"/)?.[1];
    const physical = (currentAlign === 'inside' || currentAlign === 'outside')
      ? changes.svgStrokeWidth * 2
      : changes.svgStrokeWidth;
    html = replaceAttrOnShapeOrSvg(html, 'stroke-width', String(physical));
  }
  if (changes.svgStrokeDasharray !== undefined) {
    const shapeTag = /<(path|rect|circle|ellipse|polygon)\b([^>]*)>/;
    const m = html.match(shapeTag);
    if (m) {
      let attrs = m[2];
      attrs = attrs.replace(/\sstroke-dasharray="[^"]*"/, '');
      if (changes.svgStrokeDasharray) attrs += ` stroke-dasharray="${changes.svgStrokeDasharray}"`;
      html = html.replace(shapeTag, `<${m[1]}${attrs}>`);
    }
  }
  if (changes.svgStrokeAlignment !== undefined) {
    const oldAlign = html.match(/data-stroke-align="([^"]*)"/)?.[1];
    const oldPhysicalSw = (() => {
      const m = html.match(/<(?:path|rect|circle|ellipse|polygon)[^>]*?\sstroke-width="([^"]*)"/);
      const v = m ? parseFloat(m[1]) : NaN;
      return isNaN(v) ? undefined : v;
    })();
    const oldDoubled = oldAlign === 'inside' || oldAlign === 'outside';
    const newDoubled = changes.svgStrokeAlignment === 'inside' || changes.svgStrokeAlignment === 'outside';
    if (oldPhysicalSw !== undefined && oldDoubled !== newDoubled) {
      const visible = oldDoubled ? oldPhysicalSw / 2 : oldPhysicalSw;
      const newPhysical = newDoubled ? visible * 2 : visible;
      html = replaceAttrOnShapeOrSvg(html, 'stroke-width', String(newPhysical));
    }

    // Always strip any prior inside-mode artifacts before applying the new mode.
    html = html.replace(/<clipPath\s+id="inside-stroke-clip"[\s\S]*?<\/clipPath>/g, '');
    // Strip empty <defs></defs> created when only inside-clip was inside.
    html = html.replace(/<defs>\s*<\/defs>/g, '');
    html = html.replace(/(<(?:path|rect|circle|ellipse|polygon)\b[^>]*?)\s+clip-path="url\(#inside-stroke-clip\)"/g, '$1');

    const shapeTag = /<(path|rect|circle|ellipse|polygon)\b([^>]*)>/;
    const m = html.match(shapeTag);
    if (m) {
      let attrs = m[2];
      attrs = attrs.replace(/\spaint-order="[^"]*"/, '');
      if (changes.svgStrokeAlignment === 'outside') attrs += ' paint-order="stroke"';
      // For inside mode, clip the doubled stroke against the path itself so
      // the stroke's outer half follows the path's rounded outline rather than
      // the rectangular SVG bbox.
      if (changes.svgStrokeAlignment === 'inside') {
        const dMatch = m[2].match(/\sd="([^"]*)"/);
        const d = dMatch?.[1];
        if (d) {
          attrs += ' clip-path="url(#inside-stroke-clip)"';
        }
      }
      html = html.replace(shapeTag, `<${m[1]}${attrs}>`);
    }

    if (changes.svgStrokeAlignment === 'inside') {
      // Inject (or refresh) the clipPath that mirrors the current path d.
      const dMatch = html.match(/<(?:path|rect|circle|ellipse|polygon)\b[^>]*?\sd="([^"]*)"/);
      const d = dMatch?.[1];
      if (d) {
        const clipBlock = `<defs><clipPath id="inside-stroke-clip"><path d="${d}"/></clipPath></defs>`;
        if (/<defs>/.test(html)) {
          html = html.replace(/<defs>/, `<defs><clipPath id="inside-stroke-clip"><path d="${d}"/></clipPath>`);
        } else {
          html = html.replace(/<svg([^>]*)>/, `<svg$1>${clipBlock}`);
        }
      }
    }

    const svgTag = /<svg\b([^>]*)>/;
    const sm = html.match(svgTag);
    if (sm) {
      let svgAttrs = sm[1];
      svgAttrs = svgAttrs.replace(/\soverflow="[^"]*"/, '');
      svgAttrs = svgAttrs.replace(/\sdata-stroke-align="[^"]*"/, '');
      // Inside no longer relies on overflow:hidden — clipPath handles it.
      svgAttrs = svgAttrs.replace(/overflow:\s*\w+;?/g, '');
      svgAttrs = svgAttrs.replace(/style="([^"]*)"/, (_, s) => `style="${s}overflow:visible;"`);
      svgAttrs += ` data-stroke-align="${changes.svgStrokeAlignment}"`;
      html = html.replace(svgTag, `<svg${svgAttrs}>`);
    }
  }

  if (changes.borderRadius !== undefined && html.includes('<svg')) {
    const origDMatch = html.match(/<path\b[^>]*\sdata-orig-d="([^"]*)"/);
    const dMatch = html.match(/<path\b[^>]*\sd="([^"]*)"/);
    const sourceD = origDMatch?.[1] || dMatch?.[1];
    if (sourceD) {
      const parsed = parsePath(sourceD);
      const subs = parsed.subPaths && parsed.subPaths.length > 0
        ? parsed.subPaths
        : [{ points: parsed.points, closed: parsed.closed }];
      const r = changes.borderRadius;
      const allRadii: (number | undefined)[] = [];
      for (const sp of subs) {
        for (const _pt of sp.points) {
          allRadii.push(r > 0 ? r : undefined);
        }
      }
      if (r > 0) {
        const expandedSubs = subs.map(sp => {
          const pts = sp.points.map(pt => ({ ...pt, cornerRadius: r }));
          return { points: expandCornerRadii({ points: pts, closed: sp.closed }), closed: sp.closed };
        });
        const expandedD = expandedSubs.map(sp => serializeSubPath(sp)).join('');
        const origD = subs.map(sp => serializeSubPath(sp)).join('');
        html = html.replace(/<path\b([^>]*?)\sd="[^"]*"/, (match, attrs) => {
          let a = attrs.replace(/\sdata-orig-d="[^"]*"/, '');
          a += ` data-orig-d="${origD}"`;
          return `<path${a} d="${expandedD}"`;
        });
      } else {
        const plainD = subs.map(sp => serializeSubPath(sp)).join('');
        html = html.replace(/<path\b([^>]*?)\sd="[^"]*"/, (match, attrs) => {
          let a = attrs.replace(/\sdata-orig-d="[^"]*"/, '');
          return `<path${a} d="${plainD}"`;
        });
      }
      html = applyCornerRadiiToHtml(html, 0, allRadii);
    }
    // If inside-stroke clipPath exists, refresh its d to match the new path.
    if (/<clipPath\s+id="inside-stroke-clip"/.test(html)) {
      const newD = html.match(/<path\b[^>]*\sd="([^"]*)"/)?.[1];
      if (newD) {
        html = html.replace(/(<clipPath\s+id="inside-stroke-clip">)\s*<path\s+d="[^"]*"\s*\/>\s*(<\/clipPath>)/, `$1<path d="${newD}"/>$2`);
      }
    }
  }

  const div = document.createElement('div');
  div.innerHTML = html;
  const el = div.firstElementChild as HTMLElement | null;
  if (!el) return html;

  if (changes.backgroundColor !== undefined || changes.backgroundColorAlpha !== undefined) {
    // Determine the resolved hex (current or new) and the resolved alpha.
    const currentBgRaw = el.style.background || el.style.backgroundColor || '';
    const currentHex = (() => {
      const m = currentBgRaw.match(/#[0-9a-fA-F]{3,8}/);
      if (m) return m[0].length === 9 ? m[0].slice(0, 7) : m[0];
      const rgba = currentBgRaw.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
      if (rgba) {
        const r = parseInt(rgba[1]), g = parseInt(rgba[2]), b = parseInt(rgba[3]);
        return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
      }
      return undefined;
    })();
    const currentAlpha = (() => {
      const m = currentBgRaw.match(/rgba\(\d+,\s*\d+,\s*\d+,\s*([0-9.]+)\)/);
      return m ? parseFloat(m[1]) : 1;
    })();
    const nextHex = changes.backgroundColor !== undefined ? changes.backgroundColor : (currentHex ?? 'none');
    const nextAlpha = changes.backgroundColorAlpha !== undefined
      ? Math.max(0, Math.min(1, changes.backgroundColorAlpha))
      : currentAlpha;
    if (nextHex === 'none' || nextHex === '') {
      el.style.background = nextHex;
    } else if (nextAlpha >= 1) {
      el.style.background = nextHex;
    } else {
      const hex = nextHex.replace(/^#/, '');
      const full = hex.length === 3 ? hex.split('').map(c => c + c).join('') : hex.slice(0, 6);
      const r = parseInt(full.slice(0, 2), 16);
      const g = parseInt(full.slice(2, 4), 16);
      const b = parseInt(full.slice(4, 6), 16);
      el.style.background = `rgba(${r}, ${g}, ${b}, ${nextAlpha})`;
    }
  }
  if (changes.color !== undefined) el.style.color = changes.color;
  if (changes.fontSize !== undefined) el.style.fontSize = changes.fontSize + 'px';
  if (changes.fontFamily !== undefined) el.style.fontFamily = changes.fontFamily;
  if (changes.fontWeight !== undefined) el.style.fontWeight = changes.fontWeight;
  if (changes.textAlign !== undefined) el.style.textAlign = changes.textAlign;
  if (changes.verticalAlign !== undefined) {
    el.style.display = 'flex';
    el.style.flexDirection = 'column';
    if (changes.verticalAlign === 'top') el.style.justifyContent = 'flex-start';
    else if (changes.verticalAlign === 'middle') el.style.justifyContent = 'center';
    else if (changes.verticalAlign === 'bottom') el.style.justifyContent = 'flex-end';
  }
  if (changes.lineHeight !== undefined) el.style.lineHeight = String(changes.lineHeight);
  if (changes.letterSpacing !== undefined) el.style.letterSpacing = changes.letterSpacing + 'px';
  if (changes.textDecoration !== undefined) el.style.textDecoration = changes.textDecoration;
  if (changes.borderRadius !== undefined && !html.includes('<svg')) el.style.borderRadius = changes.borderRadius + 'px';
  if (changes.borderColor !== undefined) el.style.borderColor = changes.borderColor;
  if (changes.borderWidth !== undefined) el.style.borderWidth = changes.borderWidth + 'px';
  if (changes.borderStyle !== undefined) el.style.borderStyle = changes.borderStyle;
  if (changes.opacity !== undefined) el.style.opacity = String(changes.opacity);

  if (changes.imageSrc !== undefined) {
    const img = el.querySelector('img') || (el.tagName === 'IMG' ? el : null);
    if (img) img.setAttribute('src', changes.imageSrc);
  }

  if (changes.textContent !== undefined) {
    const editable = el.querySelector('[contenteditable]') || (el.getAttribute('contenteditable') ? el : null);
    if (editable) {
      editable.textContent = changes.textContent;
    } else if (!el.querySelector('img') && el.tagName !== 'IMG') {
      el.textContent = changes.textContent;
    }
  }

  return div.innerHTML;
}

export function extractDesignTokens(headHtml: string): DesignToken[] {
  const tokens: DesignToken[] = [];
  const varRegex = /--([\w-]+)\s*:\s*([^;]+);/g;
  let match;
  while ((match = varRegex.exec(headHtml)) !== null) {
    tokens.push({ name: `--${match[1]}`, value: match[2].trim(), usageCount: 0 });
  }
  return tokens;
}

export function updateDesignToken(headHtml: string, tokenName: string, newValue: string): string {
  const escaped = tokenName.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
  const re = new RegExp(`(${escaped}\\s*:\\s*)([^;]+)(;)`, 'g');
  return headHtml.replace(re, `$1${newValue}$3`);
}

export function hasGradientFill(html: string): boolean {
  return /linear-gradient|radial-gradient|conic-gradient/.test(html) ||
    /<linearGradient|<radialGradient/.test(html);
}

export function applySvgDropShadow(html: string, shadow: SvgDropShadow | null): string {
  let result = html;
  result = result.replace(/<defs>\s*<filter[^>]*>[\s\S]*?<\/filter>\s*<\/defs>/g, '');
  result = result.replace(/\s*filter="url\(#[^"]*\)"/g, '');

  if (!shadow) return result;

  const filterId = 'drop-shadow';
  const filterDef = `<defs><filter id="${filterId}" x="-50%" y="-50%" width="200%" height="200%"><feDropShadow dx="${shadow.dx}" dy="${shadow.dy}" stdDeviation="${shadow.stdDeviation}" flood-color="${shadow.color}" flood-opacity="${shadow.opacity}"/></filter></defs>`;
  result = result.replace(/<svg([^>]*)>/, `<svg$1>${filterDef}`);
  const shapeTag = /<(path|rect|circle|ellipse|polygon)\b([^>]*)>/;
  const m = result.match(shapeTag);
  if (m) {
    result = result.replace(shapeTag, `<${m[1]}${m[2]} filter="url(#${filterId})">`);
  }
  return result;
}

function markerDef(id: string, type: MarkerType, isStart: boolean): string {
  const orient = isStart ? 'auto-start-reverse' : 'auto';
  switch (type) {
    case 'arrow': return `<marker id="${id}" markerWidth="10" markerHeight="7" refX="10" refY="3.5" orient="${orient}"><polyline points="0 0, 10 3.5, 0 7" fill="none" stroke="currentColor" stroke-width="1"/></marker>`;
    case 'triangle': return `<marker id="${id}" markerWidth="10" markerHeight="7" refX="10" refY="3.5" orient="${orient}"><polygon points="0 0, 10 3.5, 0 7" fill="currentColor"/></marker>`;
    case 'triangle-reversed': return `<marker id="${id}" markerWidth="10" markerHeight="7" refX="0" refY="3.5" orient="${orient}"><polygon points="10 0, 0 3.5, 10 7" fill="currentColor"/></marker>`;
    case 'circle': return `<marker id="${id}" markerWidth="8" markerHeight="8" refX="4" refY="4" orient="${orient}"><circle cx="4" cy="4" r="3" fill="currentColor"/></marker>`;
    case 'diamond': return `<marker id="${id}" markerWidth="10" markerHeight="10" refX="5" refY="5" orient="${orient}"><polygon points="5 0, 10 5, 5 10, 0 5" fill="currentColor"/></marker>`;
    default: return '';
  }
}

export function applySvgMarker(html: string, end: 'start' | 'end', type: MarkerType): string {
  let result = html;
  const attrName = end === 'start' ? 'marker-start' : 'marker-end';
  const markerId = `marker-${type}`;

  // Remove any existing marker-start/end on the user-visible shape (NOT
  // inside defs, where marker definitions live).
  // Strip defs so we only touch the outer shape.
  const defsRe = /<defs>[\s\S]*?<\/defs>/;
  const defsMatch = result.match(defsRe);
  const defsBlock = defsMatch ? defsMatch[0] : '';
  const stripped = defsMatch ? result.replace(defsRe, '__DEFS__') : result;
  const cleanedShape = stripped.replace(new RegExp(`\\s${attrName}="[^"]*"`, 'g'), '');
  result = defsBlock ? cleanedShape.replace('__DEFS__', defsBlock) : cleanedShape;

  // Remove any prior marker definition for this end.
  result = result.replace(new RegExp(`<marker id="marker-[^"]*-${end}"[^>]*>[\\s\\S]*?<\\/marker>`, 'g'), '');

  if (type === 'none') return result;

  const fullId = `${markerId}-${end}`;
  const def = markerDef(fullId, type, end === 'start');
  if (result.includes('<defs>')) {
    result = result.replace('</defs>', `${def}</defs>`);
  } else {
    result = result.replace(/<svg([^>]*)>/, `<svg$1><defs>${def}</defs>`);
  }
  // Find the user-visible shape AFTER the defs block (avoid matching the
  // polyline/polygon inside markers).
  const defsEndIdx = result.indexOf('</defs>');
  const searchStart = defsEndIdx >= 0 ? defsEndIdx + '</defs>'.length : 0;
  const after = result.slice(searchStart);
  const shapeTag = /<(path|line|polyline)\b([^>]*)>/;
  const m = after.match(shapeTag);
  if (m && m.index !== undefined) {
    const absIdx = searchStart + m.index;
    const replaced = `<${m[1]}${m[2]} ${attrName}="url(#${fullId})">`;
    result = result.slice(0, absIdx) + replaced + result.slice(absIdx + m[0].length);
  }
  return result;
}

export function applyStrokeLinecap(html: string, cap: 'butt' | 'round' | 'square'): string {
  const shapeTag = /<(path|line|polyline|rect|circle|ellipse|polygon)\b([^>]*)>/;
  const m = html.match(shapeTag);
  if (!m) return html;
  let attrs = m[2].replace(/\sstroke-linecap="[^"]*"/, '');
  if (cap !== 'butt') attrs += ` stroke-linecap="${cap}"`;
  return html.replace(shapeTag, `<${m[1]}${attrs}>`);
}
