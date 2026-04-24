import type { DesignToken } from './types';

export interface ProjectedProps {
  textContent?: string;
  backgroundColor?: string;
  color?: string;
  fontSize?: number;
  fontFamily?: string;
  fontWeight?: string;
  textAlign?: 'left' | 'center' | 'right' | 'justify';
  lineHeight?: number;
  letterSpacing?: number;
  textDecoration?: 'none' | 'underline' | 'line-through';
  borderRadius?: number;
  opacity?: number;
  imageSrc?: string;
  svgFill?: string;
  svgStroke?: string;
  svgStrokeWidth?: number;
  svgStrokeDasharray?: string;
  svgStrokeAlignment?: 'center' | 'inside' | 'outside';
  isSvgShape?: boolean;
}

export function projectElement(html: string): ProjectedProps & { rawHTML: string } {
  if (typeof document === 'undefined') return { rawHTML: html };

  const div = document.createElement('div');
  div.innerHTML = html;
  const el = div.firstElementChild as HTMLElement | null;
  if (!el) return { rawHTML: html, textContent: html };

  const style = el.style;

  const bgRaw = style.background || style.backgroundColor || '';
  let backgroundColor: string | undefined;
  if (bgRaw) {
    const hexMatch = bgRaw.match(/#[0-9a-fA-F]{3,8}/);
    const rgbMatch = bgRaw.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
    if (hexMatch) backgroundColor = hexMatch[0];
    else if (rgbMatch) {
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
  let svgStroke: string | undefined;
  let svgStrokeWidth: number | undefined;
  if (isSvgShape) {
    const fillMatch = html.match(/<(?:path|rect|circle|ellipse|polygon)[^>]*\sfill="([^"]*)"/);
    const strokeMatch = html.match(/<(?:path|rect|circle|ellipse|polygon)[^>]*\sstroke="([^"]*)"/);
    const swMatch = html.match(/<(?:path|rect|circle|ellipse|polygon)[^>]*\sstroke-width="([^"]*)"/);
    svgFill = fillMatch?.[1] ?? undefined;
    svgStroke = strokeMatch?.[1] ?? undefined;
    if (swMatch) { const v = parseFloat(swMatch[1]); svgStrokeWidth = isNaN(v) ? undefined : v; }
  }

  let svgStrokeDasharray: string | undefined;
  let svgStrokeAlignment: 'center' | 'inside' | 'outside' | undefined;
  if (isSvgShape) {
    const dashMatch = html.match(/<(?:path|rect|circle|ellipse|polygon)[^>]*\sstroke-dasharray="([^"]*)"/);
    svgStrokeDasharray = dashMatch?.[1] ?? undefined;
    const paintMatch = html.match(/<(?:path|rect|circle|ellipse|polygon)[^>]*\spaint-order="([^"]*)"/);
    const alignMatch = html.match(/data-stroke-align="([^"]*)"/);
    if (alignMatch?.[1] === 'outside') svgStrokeAlignment = 'outside';
    else if (alignMatch?.[1] === 'inside') svgStrokeAlignment = 'inside';
    else svgStrokeAlignment = 'center';
  }

  const textAlignRaw = style.textAlign as string;
  const textAlign: ProjectedProps['textAlign'] =
    textAlignRaw === 'left' || textAlignRaw === 'center' || textAlignRaw === 'right' || textAlignRaw === 'justify'
      ? textAlignRaw
      : undefined;

  const lineHeightRaw = style.lineHeight;
  const lineHeight = lineHeightRaw && lineHeightRaw !== 'normal'
    ? (parseFloat(lineHeightRaw) || undefined)
    : undefined;

  const letterSpacingRaw = style.letterSpacing;
  const letterSpacing = letterSpacingRaw && letterSpacingRaw !== 'normal'
    ? (parseFloat(letterSpacingRaw) || undefined)
    : undefined;

  const textDecorationRaw = style.textDecoration;
  const textDecoration: ProjectedProps['textDecoration'] =
    textDecorationRaw === 'underline' || textDecorationRaw === 'line-through'
      ? textDecorationRaw
      : textDecorationRaw === 'none' ? 'none' : undefined;

  return {
    textContent: hasContentEditable || (!img && !isSvgShape && innerText.trim()) ? innerText : undefined,
    backgroundColor: isSvgShape ? undefined : backgroundColor,
    color: isSvgShape ? undefined : (style.color || undefined),
    fontSize: isSvgShape ? undefined : (style.fontSize ? parseFloat(style.fontSize) || undefined : undefined),
    fontFamily: isSvgShape ? undefined : (style.fontFamily || undefined),
    fontWeight: isSvgShape ? undefined : (style.fontWeight || undefined),
    textAlign: isSvgShape ? undefined : textAlign,
    lineHeight: isSvgShape ? undefined : lineHeight,
    letterSpacing: isSvgShape ? undefined : letterSpacing,
    textDecoration: isSvgShape ? undefined : textDecoration,
    borderRadius: style.borderRadius ? parseFloat(style.borderRadius) || undefined : undefined,
    opacity: style.opacity ? parseFloat(style.opacity) : undefined,
    imageSrc,
    svgFill,
    svgStroke,
    svgStrokeWidth,
    svgStrokeDasharray,
    svgStrokeAlignment,
    isSvgShape,
    rawHTML: html,
  };
}

export function applyProjection(rawHTML: string, changes: Partial<ProjectedProps>): string {
  if (typeof document === 'undefined') return rawHTML;

  let html = rawHTML;

  if (changes.svgFill !== undefined) {
    html = html.replace(
      /(<(?:path|rect|circle|ellipse|polygon)\b[^>]*\s)fill="[^"]*"/,
      `$1fill="${changes.svgFill}"`
    );
  }
  if (changes.svgStroke !== undefined) {
    html = html.replace(
      /(<(?:path|rect|circle|ellipse|polygon)\b[^>]*\s)stroke="[^"]*"/,
      `$1stroke="${changes.svgStroke}"`
    );
  }
  if (changes.svgStrokeWidth !== undefined) {
    html = html.replace(
      /(<(?:path|rect|circle|ellipse|polygon)\b[^>]*\s)stroke-width="[^"]*"/,
      `$1stroke-width="${changes.svgStrokeWidth}"`
    );
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
    const shapeTag = /<(path|rect|circle|ellipse|polygon)\b([^>]*)>/;
    const m = html.match(shapeTag);
    if (m) {
      let attrs = m[2];
      attrs = attrs.replace(/\spaint-order="[^"]*"/, '');
      if (changes.svgStrokeAlignment === 'outside') attrs += ' paint-order="stroke"';
      html = html.replace(shapeTag, `<${m[1]}${attrs}>`);
    }
    const svgTag = /<svg\b([^>]*)>/;
    const sm = html.match(svgTag);
    if (sm) {
      let svgAttrs = sm[1];
      svgAttrs = svgAttrs.replace(/\soverflow="[^"]*"/, '');
      svgAttrs = svgAttrs.replace(/\sdata-stroke-align="[^"]*"/, '');
      if (changes.svgStrokeAlignment === 'inside') {
        svgAttrs += ' overflow="hidden" data-stroke-align="inside"';
      } else {
        svgAttrs += ' overflow="visible"';
        svgAttrs += ` data-stroke-align="${changes.svgStrokeAlignment}"`;
      }
      html = html.replace(svgTag, `<svg${svgAttrs}>`);
    }
  }

  const div = document.createElement('div');
  div.innerHTML = html;
  const el = div.firstElementChild as HTMLElement | null;
  if (!el) return html;

  if (changes.backgroundColor !== undefined) {
    el.style.background = changes.backgroundColor;
  }
  if (changes.color !== undefined) el.style.color = changes.color;
  if (changes.fontSize !== undefined) el.style.fontSize = changes.fontSize + 'px';
  if (changes.fontFamily !== undefined) el.style.fontFamily = changes.fontFamily;
  if (changes.fontWeight !== undefined) el.style.fontWeight = changes.fontWeight;
  if (changes.textAlign !== undefined) el.style.textAlign = changes.textAlign;
  if (changes.lineHeight !== undefined) el.style.lineHeight = String(changes.lineHeight);
  if (changes.letterSpacing !== undefined) el.style.letterSpacing = changes.letterSpacing + 'px';
  if (changes.textDecoration !== undefined) el.style.textDecoration = changes.textDecoration;
  if (changes.borderRadius !== undefined) el.style.borderRadius = changes.borderRadius + 'px';
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
