export interface PathPoint {
  x: number;
  y: number;
  handleIn?: { x: number; y: number };
  handleOut?: { x: number; y: number };
  type: 'corner' | 'smooth' | 'symmetric';
  cornerRadius?: number;
}

export interface SubPath {
  points: PathPoint[];
  closed: boolean;
}

export interface ParsedPath {
  points: PathPoint[];
  closed: boolean;
  subPaths?: SubPath[];
}

interface PathCmd {
  type: string;
  values: number[];
}

function parseNumbers(str: string): number[] {
  const nums: number[] = [];
  const re = /[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/g;
  let m;
  while ((m = re.exec(str)) !== null) nums.push(Number(m[0]));
  return nums;
}

function tokenize(d: string): PathCmd[] {
  const cmds: PathCmd[] = [];
  const re = /([MLHVCSQTAZmlhvcsqtaz])([^MLHVCSQTAZmlhvcsqtaz]*)/g;
  let match;
  while ((match = re.exec(d)) !== null) {
    const type = match[1];
    const nums = parseNumbers(match[2]);
    cmds.push({ type, values: nums });
  }
  return cmds;
}

function arcToCubicBeziers(
  x1: number, y1: number, rx: number, ry: number,
  angle: number, largeArc: number, sweep: number, x2: number, y2: number
): number[][] {
  if (rx === 0 || ry === 0) return [[x1, y1, x2, y2, x2, y2]];
  const phi = (angle * Math.PI) / 180;
  const cosPhi = Math.cos(phi), sinPhi = Math.sin(phi);
  const dx = (x1 - x2) / 2, dy = (y1 - y2) / 2;
  const x1p = cosPhi * dx + sinPhi * dy;
  const y1p = -sinPhi * dx + cosPhi * dy;
  rx = Math.abs(rx); ry = Math.abs(ry);
  let lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) { const s = Math.sqrt(lambda); rx *= s; ry *= s; }
  const rxSq = rx * rx, rySq = ry * ry;
  const x1pSq = x1p * x1p, y1pSq = y1p * y1p;
  let sq = Math.max(0, (rxSq * rySq - rxSq * y1pSq - rySq * x1pSq) / (rxSq * y1pSq + rySq * x1pSq));
  let factor = Math.sqrt(sq) * (largeArc === sweep ? -1 : 1);
  const cxp = factor * (rx * y1p) / ry;
  const cyp = factor * -(ry * x1p) / rx;
  const cx = cosPhi * cxp - sinPhi * cyp + (x1 + x2) / 2;
  const cy = sinPhi * cxp + cosPhi * cyp + (y1 + y2) / 2;
  const vecAngle = (ux: number, uy: number, vx: number, vy: number) => {
    const dot = ux * vx + uy * vy;
    const len = Math.sqrt(ux * ux + uy * uy) * Math.sqrt(vx * vx + vy * vy);
    let a = Math.acos(Math.max(-1, Math.min(1, dot / len)));
    if (ux * vy - uy * vx < 0) a = -a;
    return a;
  };
  let theta1 = vecAngle(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let dTheta = vecAngle((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!sweep && dTheta > 0) dTheta -= 2 * Math.PI;
  if (sweep && dTheta < 0) dTheta += 2 * Math.PI;
  const segments = Math.max(1, Math.ceil(Math.abs(dTheta) / (Math.PI / 2)));
  const segAngle = dTheta / segments;
  const result: number[][] = [];
  for (let i = 0; i < segments; i++) {
    const t1 = theta1 + i * segAngle;
    const t2 = theta1 + (i + 1) * segAngle;
    const alpha = (4 / 3) * Math.tan(segAngle / 4);
    const cos1 = Math.cos(t1), sin1 = Math.sin(t1);
    const cos2 = Math.cos(t2), sin2 = Math.sin(t2);
    const ep1x = rx * cos1, ep1y = ry * sin1;
    const ep2x = rx * cos2, ep2y = ry * sin2;
    const c1x = ep1x - alpha * rx * sin1, c1y = ep1y + alpha * ry * cos1;
    const c2x = ep2x + alpha * rx * sin2, c2y = ep2y - alpha * ry * cos2;
    const transform = (px: number, py: number) => [cosPhi * px - sinPhi * py + cx, sinPhi * px + cosPhi * py + cy];
    const [tc1x, tc1y] = transform(c1x, c1y);
    const [tc2x, tc2y] = transform(c2x, c2y);
    const [tex, tey] = transform(ep2x, ep2y);
    result.push([tc1x, tc1y, tc2x, tc2y, tex, tey]);
  }
  return result;
}

export function parsePath(d: string): ParsedPath {
  const cmds = tokenize(d);
  const subPaths: SubPath[] = [];
  let currentPoints: PathPoint[] = [];
  let currentClosed = false;
  let cx = 0, cy = 0;
  let prevControlX = 0, prevControlY = 0;
  let subPathStartX = 0, subPathStartY = 0;

  const finishSubPath = () => {
    if (currentPoints.length > 0) {
      if (currentPoints.length >= 3) {
        const first = currentPoints[0], last = currentPoints[currentPoints.length - 1];
        if (first.x === last.x && first.y === last.y) {
          if (last.handleIn) currentPoints[0] = { ...currentPoints[0], handleIn: last.handleIn };
          currentPoints.pop();
          currentClosed = true;
        }
      }
      subPaths.push({ points: currentPoints, closed: currentClosed });
      currentPoints = [];
      currentClosed = false;
    }
  };

  for (const cmd of cmds) {
    const { type, values } = cmd;
    const isRel = type === type.toLowerCase();
    const abs = type.toUpperCase();

    switch (abs) {
      case 'M': {
        if (currentPoints.length > 0) finishSubPath();
        const x = isRel ? cx + values[0] : values[0];
        const y = isRel ? cy + values[1] : values[1];
        currentPoints.push({ x, y, type: 'corner' });
        cx = x; cy = y;
        subPathStartX = x; subPathStartY = y;
        for (let i = 2; i < values.length; i += 2) {
          const lx = isRel ? cx + values[i] : values[i];
          const ly = isRel ? cy + values[i + 1] : values[i + 1];
          currentPoints.push({ x: lx, y: ly, type: 'corner' });
          cx = lx; cy = ly;
        }
        break;
      }
      case 'L': {
        for (let i = 0; i < values.length; i += 2) {
          const x = isRel ? cx + values[i] : values[i];
          const y = isRel ? cy + values[i + 1] : values[i + 1];
          currentPoints.push({ x, y, type: 'corner' });
          cx = x; cy = y;
        }
        break;
      }
      case 'H': {
        for (const v of values) {
          const x = isRel ? cx + v : v;
          currentPoints.push({ x, y: cy, type: 'corner' });
          cx = x;
        }
        break;
      }
      case 'V': {
        for (const v of values) {
          const y = isRel ? cy + v : v;
          currentPoints.push({ x: cx, y, type: 'corner' });
          cy = y;
        }
        break;
      }
      case 'C': {
        for (let i = 0; i < values.length; i += 6) {
          const c1x = isRel ? cx + values[i] : values[i];
          const c1y = isRel ? cy + values[i + 1] : values[i + 1];
          const c2x = isRel ? cx + values[i + 2] : values[i + 2];
          const c2y = isRel ? cy + values[i + 3] : values[i + 3];
          const ex = isRel ? cx + values[i + 4] : values[i + 4];
          const ey = isRel ? cy + values[i + 5] : values[i + 5];

          if (currentPoints.length > 0) {
            const prev = currentPoints[currentPoints.length - 1];
            prev.handleOut = { x: c1x - prev.x, y: c1y - prev.y };
            if (prev.handleOut.x !== 0 || prev.handleOut.y !== 0) prev.type = 'smooth';
          }

          currentPoints.push({
            x: ex, y: ey,
            handleIn: { x: c2x - ex, y: c2y - ey },
            type: 'smooth',
          });
          prevControlX = c2x; prevControlY = c2y;
          cx = ex; cy = ey;
        }
        break;
      }
      case 'Q': {
        for (let i = 0; i < values.length; i += 4) {
          const qx = isRel ? cx + values[i] : values[i];
          const qy = isRel ? cy + values[i + 1] : values[i + 1];
          const ex = isRel ? cx + values[i + 2] : values[i + 2];
          const ey = isRel ? cy + values[i + 3] : values[i + 3];

          if (currentPoints.length > 0) {
            const prev = currentPoints[currentPoints.length - 1];
            prev.handleOut = { x: (qx - prev.x) * 2 / 3, y: (qy - prev.y) * 2 / 3 };
            prev.type = 'smooth';
          }
          currentPoints.push({
            x: ex, y: ey,
            handleIn: { x: (qx - ex) * 2 / 3, y: (qy - ey) * 2 / 3 },
            type: 'smooth',
          });
          cx = ex; cy = ey;
        }
        break;
      }
      case 'S': {
        for (let i = 0; i < values.length; i += 4) {
          const c2x = isRel ? cx + values[i] : values[i];
          const c2y = isRel ? cy + values[i + 1] : values[i + 1];
          const ex = isRel ? cx + values[i + 2] : values[i + 2];
          const ey = isRel ? cy + values[i + 3] : values[i + 3];

          if (currentPoints.length > 0) {
            const prev = currentPoints[currentPoints.length - 1];
            const c1x = 2 * prev.x - prevControlX;
            const c1y = 2 * prev.y - prevControlY;
            prev.handleOut = { x: c1x - prev.x, y: c1y - prev.y };
            prev.type = 'smooth';
          }

          currentPoints.push({
            x: ex, y: ey,
            handleIn: { x: c2x - ex, y: c2y - ey },
            type: 'smooth',
          });
          prevControlX = c2x; prevControlY = c2y;
          cx = ex; cy = ey;
        }
        break;
      }
      case 'A': {
        for (let i = 0; i < values.length; i += 7) {
          const arx = values[i], ary = values[i + 1];
          const angle = values[i + 2];
          const largeArc = values[i + 3], sweep = values[i + 4];
          const ex = isRel ? cx + values[i + 5] : values[i + 5];
          const ey = isRel ? cy + values[i + 6] : values[i + 6];
          const cubics = arcToCubicBeziers(cx, cy, arx, ary, angle, largeArc, sweep, ex, ey);
          for (const [c1x, c1y, c2x, c2y, epx, epy] of cubics) {
            if (currentPoints.length > 0) {
              const prev = currentPoints[currentPoints.length - 1];
              prev.handleOut = { x: c1x - prev.x, y: c1y - prev.y };
              if (prev.handleOut.x !== 0 || prev.handleOut.y !== 0) prev.type = 'smooth';
            }
            currentPoints.push({
              x: epx, y: epy,
              handleIn: { x: c2x - epx, y: c2y - epy },
              type: 'smooth',
            });
          }
          prevControlX = cubics[cubics.length - 1][2];
          prevControlY = cubics[cubics.length - 1][3];
          cx = ex; cy = ey;
        }
        break;
      }
      case 'Z': {
        currentClosed = true;
        cx = subPathStartX; cy = subPathStartY;
        break;
      }
    }
  }
  finishSubPath();

  const allPoints = subPaths.flatMap(sp => sp.points);
  const firstClosed = subPaths.length > 0 ? subPaths[0].closed : false;
  return { points: allPoints, closed: firstClosed, subPaths };
}

export function expandCornerRadii(sp: SubPath): PathPoint[] {
  const { points, closed } = sp;
  if (points.length < 3) return points;
  const KAPPA = 0.5522847498;
  const len = points.length;
  const result: PathPoint[] = [];

  for (let i = 0; i < len; i++) {
    const pt = points[i];
    const cr = pt.cornerRadius;
    if (!cr || cr <= 0) { result.push(pt); continue; }

    const prevIdx = closed ? (i - 1 + len) % len : i - 1;
    const nextIdx = closed ? (i + 1) % len : i + 1;
    if (prevIdx < 0 || nextIdx >= len) { result.push(pt); continue; }

    const prev = points[prevIdx];
    const next = points[nextIdx];
    const dxA = prev.x - pt.x, dyA = prev.y - pt.y;
    const dxB = next.x - pt.x, dyB = next.y - pt.y;
    const lenA = Math.sqrt(dxA * dxA + dyA * dyA);
    const lenB = Math.sqrt(dxB * dxB + dyB * dyB);
    if (lenA < 0.01 || lenB < 0.01) { result.push(pt); continue; }

    const offset = Math.min(cr, lenA / 2, lenB / 2);
    const handleLen = offset * KAPPA;
    const uAx = dxA / lenA, uAy = dyA / lenA;
    const uBx = dxB / lenB, uBy = dyB / lenB;

    result.push({
      x: pt.x + uAx * offset, y: pt.y + uAy * offset,
      type: 'smooth',
      handleOut: { x: -uAx * handleLen, y: -uAy * handleLen },
    });
    result.push({
      x: pt.x + uBx * offset, y: pt.y + uBy * offset,
      type: 'smooth',
      handleIn: { x: -uBx * handleLen, y: -uBy * handleLen },
    });
  }
  return result;
}

export function serializeSubPath(sp: SubPath): string {
  const expanded = expandCornerRadii(sp);
  const { closed } = sp;
  if (expanded.length === 0) return '';
  const parts: string[] = [];
  const r = (n: number) => Math.round(n * 100) / 100;

  for (let i = 0; i < expanded.length; i++) {
    const pt = expanded[i];
    if (i === 0) { parts.push(`M${r(pt.x)},${r(pt.y)}`); continue; }
    const prev = expanded[i - 1];
    const hasHandleOut = prev.handleOut && (prev.handleOut.x !== 0 || prev.handleOut.y !== 0);
    const hasHandleIn = pt.handleIn && (pt.handleIn.x !== 0 || pt.handleIn.y !== 0);
    if (hasHandleOut || hasHandleIn) {
      const c1x = prev.x + (prev.handleOut?.x ?? 0);
      const c1y = prev.y + (prev.handleOut?.y ?? 0);
      const c2x = pt.x + (pt.handleIn?.x ?? 0);
      const c2y = pt.y + (pt.handleIn?.y ?? 0);
      parts.push(`C${r(c1x)},${r(c1y)} ${r(c2x)},${r(c2y)} ${r(pt.x)},${r(pt.y)}`);
    } else {
      parts.push(`L${r(pt.x)},${r(pt.y)}`);
    }
  }

  if (closed && expanded.length > 1) {
    const last = expanded[expanded.length - 1];
    const first = expanded[0];
    const hasHandleOut = last.handleOut && (last.handleOut.x !== 0 || last.handleOut.y !== 0);
    const hasHandleIn = first.handleIn && (first.handleIn.x !== 0 || first.handleIn.y !== 0);
    if (hasHandleOut || hasHandleIn) {
      const c1x = last.x + (last.handleOut?.x ?? 0);
      const c1y = last.y + (last.handleOut?.y ?? 0);
      const c2x = first.x + (first.handleIn?.x ?? 0);
      const c2y = first.y + (first.handleIn?.y ?? 0);
      parts.push(`C${r(c1x)},${r(c1y)} ${r(c2x)},${r(c2y)} ${r(first.x)},${r(first.y)}`);
    }
    parts.push('Z');
  }
  return parts.join('');
}

export function serializePath(parsed: ParsedPath): string {
  if (parsed.subPaths && parsed.subPaths.length > 0) {
    return parsed.subPaths.map(sp => serializeSubPath(sp)).join('');
  }
  return serializeSubPath({ points: parsed.points, closed: parsed.closed });
}

export function updatePathInHtml(html: string, newD: string): string {
  return html.replace(/(<path\b[^>]*\s)d="[^"]*"/, `$1d="${newD}"`);
}

export function updateAllPathsInHtml(html: string, subPathDs: string[]): string {
  let idx = 0;
  return html.replace(/(<path\b[^>]*\s)d="[^"]*"/g, (match, prefix) => {
    if (idx < subPathDs.length) {
      return `${prefix}d="${subPathDs[idx++]}"`;
    }
    return match;
  });
}

export function applyCornerRadiiToHtml(html: string, pathElIdx: number, radii: (number | undefined)[]): string {
  const radiiStr = radii.map(r => r ?? 0).join(',');
  const allZero = radii.every(r => !r || r <= 0);
  let count = 0;
  return html.replace(/<path\b([^>]*?)\s*(\/?>)/g, (match, attrs, close) => {
    if (count++ !== pathElIdx) return match;
    let a = attrs.replace(/\sdata-corner-radii="[^"]*"/, '');
    if (!allZero) a += ` data-corner-radii="${radiiStr}"`;
    return `<path${a} ${close}`;
  });
}

export function parseCornerRadiiFromHtml(html: string, pathElIdx: number): number[] {
  const re = /<path\b[^>]*\sdata-corner-radii="([^"]*)"[^>]*/g;
  let count = 0;
  let m;
  while ((m = re.exec(html)) !== null) {
    if (count++ === pathElIdx) {
      return m[1].split(',').map(v => parseFloat(v) || 0);
    }
  }
  return [];
}

export function extractPathD(html: string): string | null {
  const match = html.match(/<path\b[^>]*\sd="([^"]*)"/);
  return match ? match[1] : null;
}

export function extractAllPathDs(html: string): string[] {
  // Strip <defs>...</defs> first so marker/pattern interior paths don't leak
  // into the user-visible path list.
  const stripped = html.replace(/<defs>[\s\S]*?<\/defs>/g, '');
  const re = /<path\b[^>]*\sd="([^"]*)"/g;
  const results: string[] = [];
  let m;
  while ((m = re.exec(stripped)) !== null) results.push(m[1]);
  return results;
}

export function extractCombinedPathD(html: string): string | null {
  const ds = extractAllPathDs(html);
  if (ds.length === 0) return null;
  return ds.join(' ');
}

export function updateNthPathInHtml(html: string, index: number, newD: string): string {
  let count = 0;
  return html.replace(/(<path\b[^>]*\s)d="[^"]*"/g, (match, prefix) => {
    if (count++ === index) return `${prefix}d="${newD}"`;
    return match;
  });
}

export function insertPoint(parsed: ParsedPath, afterIndex: number, t = 0.5): ParsedPath {
  const points = [...parsed.points];
  const p1 = points[afterIndex];
  const p2Idx = parsed.closed && afterIndex === points.length - 1 ? 0 : afterIndex + 1;
  const p2 = points[p2Idx];
  if (!p2) return parsed;

  const newPt: PathPoint = {
    x: p1.x + (p2.x - p1.x) * t,
    y: p1.y + (p2.y - p1.y) * t,
    type: 'corner',
  };

  points.splice(afterIndex + 1, 0, newPt);
  return { ...parsed, points, closed: parsed.closed };
}

export function removePoint(parsed: ParsedPath, index: number): ParsedPath {
  if (parsed.points.length <= 2) return parsed;
  const points = parsed.points.filter((_, i) => i !== index);
  return { ...parsed, points, closed: parsed.closed };
}

function circleToPath(cx: number, cy: number, r: number): string {
  const k = 0.5522847498;
  const kr = k * r;
  return [
    `M${cx - r},${cy}`,
    `C${cx - r},${cy - kr} ${cx - kr},${cy - r} ${cx},${cy - r}`,
    `C${cx + kr},${cy - r} ${cx + r},${cy - kr} ${cx + r},${cy}`,
    `C${cx + r},${cy + kr} ${cx + kr},${cy + r} ${cx},${cy + r}`,
    `C${cx - kr},${cy + r} ${cx - r},${cy + kr} ${cx - r},${cy}`,
    'Z',
  ].join('');
}

function ellipseToPath(cx: number, cy: number, rx: number, ry: number): string {
  const kx = 0.5522847498 * rx;
  const ky = 0.5522847498 * ry;
  return [
    `M${cx - rx},${cy}`,
    `C${cx - rx},${cy - ky} ${cx - kx},${cy - ry} ${cx},${cy - ry}`,
    `C${cx + kx},${cy - ry} ${cx + rx},${cy - ky} ${cx + rx},${cy}`,
    `C${cx + rx},${cy + ky} ${cx + kx},${cy + ry} ${cx},${cy + ry}`,
    `C${cx - kx},${cy + ry} ${cx - rx},${cy + ky} ${cx - rx},${cy}`,
    'Z',
  ].join('');
}

function rectToPath(x: number, y: number, w: number, h: number, rx = 0, ry = 0): string {
  if (rx === 0 && ry === 0) {
    return `M${x},${y}L${x + w},${y}L${x + w},${y + h}L${x},${y + h}Z`;
  }
  rx = Math.min(rx, w / 2);
  ry = Math.min(ry || rx, h / 2);
  return [
    `M${x + rx},${y}`,
    `L${x + w - rx},${y}`,
    `A${rx},${ry} 0 0 1 ${x + w},${y + ry}`,
    `L${x + w},${y + h - ry}`,
    `A${rx},${ry} 0 0 1 ${x + w - rx},${y + h}`,
    `L${x + rx},${y + h}`,
    `A${rx},${ry} 0 0 1 ${x},${y + h - ry}`,
    `L${x},${y + ry}`,
    `A${rx},${ry} 0 0 1 ${x + rx},${y}`,
    'Z',
  ].join('');
}

function lineToPath(x1: number, y1: number, x2: number, y2: number): string {
  return `M${x1},${y1}L${x2},${y2}`;
}

function polyToPath(pointsStr: string, closed: boolean): string {
  const nums = pointsStr.trim().split(/[\s,]+/).map(Number);
  if (nums.length < 4) return '';
  const parts = [`M${nums[0]},${nums[1]}`];
  for (let i = 2; i < nums.length; i += 2) {
    parts.push(`L${nums[i]},${nums[i + 1]}`);
  }
  if (closed) parts.push('Z');
  return parts.join('');
}

function getAttr(tag: string, name: string): number {
  const m = tag.match(new RegExp(`${name}="([^"]*)"`));
  return m ? parseFloat(m[1]) || 0 : 0;
}

function getStrAttr(tag: string, name: string): string {
  const m = tag.match(new RegExp(`${name}="([^"]*)"`));
  return m ? m[1] : '';
}

function copyAttrs(origTag: string, exclude: string[]): string {
  const attrs: string[] = [];
  const re = /(\w[\w-]*)="([^"]*)"/g;
  let m;
  while ((m = re.exec(origTag)) !== null) {
    if (!exclude.includes(m[1])) attrs.push(`${m[1]}="${m[2]}"`);
  }
  return attrs.join(' ');
}

export function convertShapesToPaths(html: string): string {
  // Skip <defs>...</defs> block — markers and patterns inside it must keep
  // their original element types so they don't pollute path extraction.
  const defsRe = /<defs>[\s\S]*?<\/defs>/;
  const defsMatch = html.match(defsRe);
  const defsBlock = defsMatch ? defsMatch[0] : '';
  const placeholder = ' DEFS ';
  const stripped = defsMatch ? html.replace(defsRe, placeholder) : html;

  const converted = stripped
    .replace(/<circle\b([^>]*)\/?>(\s*<\/circle>)?/g, (match, attrs) => {
      const tag = `<circle ${attrs}>`;
      const d = circleToPath(getAttr(tag, 'cx'), getAttr(tag, 'cy'), getAttr(tag, 'r'));
      const other = copyAttrs(tag, ['cx', 'cy', 'r']);
      return `<path d="${d}" ${other}/>`;
    })
    .replace(/<ellipse\b([^>]*)\/?>(\s*<\/ellipse>)?/g, (match, attrs) => {
      const tag = `<ellipse ${attrs}>`;
      const d = ellipseToPath(getAttr(tag, 'cx'), getAttr(tag, 'cy'), getAttr(tag, 'rx'), getAttr(tag, 'ry'));
      const other = copyAttrs(tag, ['cx', 'cy', 'rx', 'ry']);
      return `<path d="${d}" ${other}/>`;
    })
    .replace(/<rect\b([^>]*)\/?>(\s*<\/rect>)?/g, (match, attrs) => {
      const tag = `<rect ${attrs}>`;
      const d = rectToPath(getAttr(tag, 'x'), getAttr(tag, 'y'), getAttr(tag, 'width'), getAttr(tag, 'height'), getAttr(tag, 'rx'), getAttr(tag, 'ry'));
      const other = copyAttrs(tag, ['x', 'y', 'width', 'height', 'rx', 'ry']);
      return `<path d="${d}" ${other}/>`;
    })
    .replace(/<line\b([^>]*)\/?>(\s*<\/line>)?/g, (match, attrs) => {
      const tag = `<line ${attrs}>`;
      const d = lineToPath(getAttr(tag, 'x1'), getAttr(tag, 'y1'), getAttr(tag, 'x2'), getAttr(tag, 'y2'));
      const other = copyAttrs(tag, ['x1', 'y1', 'x2', 'y2']);
      return `<path d="${d}" ${other}/>`;
    })
    .replace(/<polygon\b([^>]*)\/?>(\s*<\/polygon>)?/g, (match, attrs) => {
      const tag = `<polygon ${attrs}>`;
      const d = polyToPath(getStrAttr(tag, 'points'), true);
      const other = copyAttrs(tag, ['points']);
      return `<path d="${d}" ${other}/>`;
    })
    .replace(/<polyline\b([^>]*)\/?>(\s*<\/polyline>)?/g, (match, attrs) => {
      const tag = `<polyline ${attrs}>`;
      const d = polyToPath(getStrAttr(tag, 'points'), false);
      const other = copyAttrs(tag, ['points']);
      return `<path d="${d}" ${other}/>`;
    });

  return defsBlock ? converted.replace(placeholder, defsBlock) : converted;
}

export function roundPathCorners(d: string, radius: number): string {
  if (radius <= 0) return d;
  const parsed = parsePath(d);
  const subs = parsed.subPaths && parsed.subPaths.length > 0
    ? parsed.subPaths
    : [{ points: parsed.points, closed: parsed.closed }];

  return subs.map(sp => {
    const pts = sp.points;
    if (pts.length < 3) return serializeSubPath(sp);

    const newPoints: PathPoint[] = [];
    const len = pts.length;

    for (let i = 0; i < len; i++) {
      const pt = pts[i];
      const hasHandles = (pt.handleIn && (pt.handleIn.x !== 0 || pt.handleIn.y !== 0)) ||
                         (pt.handleOut && (pt.handleOut.x !== 0 || pt.handleOut.y !== 0));
      if (hasHandles || pt.type !== 'corner') {
        newPoints.push(pt);
        continue;
      }

      const prevIdx = sp.closed ? (i - 1 + len) % len : i - 1;
      const nextIdx = sp.closed ? (i + 1) % len : i + 1;
      if (prevIdx < 0 || nextIdx >= len) {
        newPoints.push(pt);
        continue;
      }

      const prev = pts[prevIdx];
      const next = pts[nextIdx];
      const dxA = prev.x - pt.x, dyA = prev.y - pt.y;
      const dxB = next.x - pt.x, dyB = next.y - pt.y;
      const lenA = Math.sqrt(dxA * dxA + dyA * dyA);
      const lenB = Math.sqrt(dxB * dxB + dyB * dyB);
      if (lenA < 0.01 || lenB < 0.01) { newPoints.push(pt); continue; }

      const offset = Math.min(radius, lenA / 2, lenB / 2);
      const startX = pt.x + (dxA / lenA) * offset;
      const startY = pt.y + (dyA / lenA) * offset;
      const endX = pt.x + (dxB / lenB) * offset;
      const endY = pt.y + (dyB / lenB) * offset;

      const k = 0.5522847498;
      const handleLen = offset * k;

      newPoints.push({
        x: startX, y: startY, type: 'smooth',
        handleOut: { x: -(dxA / lenA) * handleLen, y: -(dyA / lenA) * handleLen },
      });
      newPoints.push({
        x: endX, y: endY, type: 'smooth',
        handleIn: { x: -(dxB / lenB) * handleLen, y: -(dyB / lenB) * handleLen },
      });
    }

    return serializeSubPath({ points: newPoints, closed: sp.closed });
  }).join('');
}

export type BooleanOp = 'union' | 'difference' | 'intersection' | 'exclusion';

function normalizeClosedPaths(d: string): string {
  const parsed = parsePath(d);
  const subs = parsed.subPaths && parsed.subPaths.length > 0
    ? parsed.subPaths
    : [{ points: parsed.points, closed: parsed.closed }];
  return subs.map(sp => serializeSubPath(sp)).join('');
}

export function rescaleSvgHtml(html: string, oldW: number, oldH: number, newW: number, newH: number): string {
  if (!html.includes('<svg') || oldW <= 0 || oldH <= 0 || newW <= 0 || newH <= 0) return html;
  if (oldW === newW && oldH === newH) return html;

  if (!html.match(/viewBox="([^"]*)"/)) return html;

  const sx = newW / oldW;
  const sy = newH / oldH;

  // Scale all path points by sx/sy first; then recompute the viewBox to
  // tightly fit the scaled paths plus a fixed 1-unit padding. This keeps
  // padding constant in viewBox units regardless of element size, so the
  // visual gap between the path and the element box stays sub-pixel
  // (critical for selection box alignment), while still working for
  // vector-edited shapes whose AABB is offset from (0,0).
  let result = html;

  const scaleD = (d: string): string => {
    const parsed = parsePath(d);
    const subs = parsed.subPaths && parsed.subPaths.length > 0
      ? parsed.subPaths
      : [{ points: parsed.points, closed: parsed.closed }];
    for (const sp of subs) {
      for (const pt of sp.points) {
        pt.x *= sx;
        pt.y *= sy;
        if (pt.handleIn) { pt.handleIn.x *= sx; pt.handleIn.y *= sy; }
        if (pt.handleOut) { pt.handleOut.x *= sx; pt.handleOut.y *= sy; }
      }
    }
    return subs.map(sp => serializeSubPath(sp)).join('');
  };

  const scaleDWithRadii = (d: string, radii: number[]): string => {
    const parsed = parsePath(d);
    const subs = parsed.subPaths && parsed.subPaths.length > 0
      ? parsed.subPaths
      : [{ points: parsed.points, closed: parsed.closed }];
    let ri = 0;
    for (const sp of subs) {
      for (const pt of sp.points) {
        pt.x *= sx;
        pt.y *= sy;
        if (pt.handleIn) { pt.handleIn.x *= sx; pt.handleIn.y *= sy; }
        if (pt.handleOut) { pt.handleOut.x *= sx; pt.handleOut.y *= sy; }
        const cr = radii[ri++];
        if (cr && cr > 0) pt.cornerRadius = cr;
      }
    }
    return subs.map(sp => serializeSubPath(sp)).join('');
  };

  const pathDs = extractAllPathDs(result);
  pathDs.forEach((d, i) => {
    const radii = parseCornerRadiiFromHtml(result, i);
    const hasRadii = radii.some(r => r > 0);

    const origDRe = /<path\b[^>]*?\sdata-orig-d="([^"]*)"[^>]*/g;
    const origDs: string[] = [];
    let om;
    while ((om = origDRe.exec(result)) !== null) origDs.push(om[1]);
    const origD = origDs[i];

    if (hasRadii && origD) {
      const newExpandedD = scaleDWithRadii(origD, radii);
      const newOrigD = scaleD(origD);
      result = updateNthPathInHtml(result, i, newExpandedD);
      let oi = 0;
      result = result.replace(/data-orig-d="[^"]*"/g, (m) => {
        if (oi++ === i) return `data-orig-d="${newOrigD}"`;
        return m;
      });
    } else {
      result = updateNthPathInHtml(result, i, scaleD(d));
      if (origD) {
        const newOrigD = scaleD(origD);
        let oi = 0;
        result = result.replace(/data-orig-d="[^"]*"/g, (m) => {
          if (oi++ === i) return `data-orig-d="${newOrigD}"`;
          return m;
        });
      }
    }
  });

  // Recompute viewBox to tightly fit all scaled paths + 1 unit padding.
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const d of extractAllPathDs(result)) {
    const parsed = parsePath(d);
    const subs = parsed.subPaths && parsed.subPaths.length > 0
      ? parsed.subPaths : [{ points: parsed.points, closed: parsed.closed }];
    for (const sp of subs) for (const pt of sp.points) {
      if (pt.x < minX) minX = pt.x; if (pt.x > maxX) maxX = pt.x;
      if (pt.y < minY) minY = pt.y; if (pt.y > maxY) maxY = pt.y;
      if (pt.handleIn) {
        const hx = pt.x + pt.handleIn.x, hy = pt.y + pt.handleIn.y;
        if (hx < minX) minX = hx; if (hx > maxX) maxX = hx;
        if (hy < minY) minY = hy; if (hy > maxY) maxY = hy;
      }
      if (pt.handleOut) {
        const hx = pt.x + pt.handleOut.x, hy = pt.y + pt.handleOut.y;
        if (hx < minX) minX = hx; if (hx > maxX) maxX = hx;
        if (hy < minY) minY = hy; if (hy > maxY) maxY = hy;
      }
    }
  }
  if (isFinite(minX)) {
    const pad = 1;
    const newVb = [minX - pad, minY - pad, (maxX - minX) + pad * 2, (maxY - minY) + pad * 2];
    result = result.replace(/viewBox="[^"]*"/, `viewBox="${newVb.map(v => Math.round(v * 100) / 100).join(' ')}"`);
  }

  return result;
}

export async function booleanPathOp(d1: string, d2: string, op: BooleanOp): Promise<string> {
  const { pathFromPathData, pathToPathData, pathBoolean, FillRule, PathBooleanOperation } = await import('path-bool');

  const ops = {
    union: PathBooleanOperation.Union,
    difference: PathBooleanOperation.Difference,
    intersection: PathBooleanOperation.Intersection,
    exclusion: PathBooleanOperation.Exclusion,
  } as const;

  const p1 = pathFromPathData(d1);
  const p2 = pathFromPathData(d2);
  const result = pathBoolean(p1, FillRule.EvenOdd, p2, FillRule.EvenOdd, ops[op]);
  const rawD = result.map(p => pathToPathData(p)).join(' ');
  return normalizeClosedPaths(rawD);
}

/**
 * Bake a rotation (degrees) into the path geometry of an SVG html string.
 * Rotates around the viewBox content center (w/2, h/2) — the same center
 * that CSS `transform: rotate()` with `transform-origin: center center` uses.
 *
 * The viewBox stays unchanged; the rotated path may extend outside it, which
 * is fine because the SVG host has overflow:visible.
 *
 * Each path's data-orig-d (used to reapply corner radii) is also rotated.
 */
/**
 * Bake a rotation into the path geometry of an SVG html string.
 * Rotates around (cx, cy) given in viewBox local coordinates. Caller is
 * responsible for translating CSS transform-origin into viewBox coords.
 * If centerX / centerY are omitted, defaults to (w/2, h/2) (the viewBox
 * content's geometric center).
 */
export function bakeRotation(html: string, rotation: number, w: number, h: number, centerX?: number, centerY?: number): string {
  if (!html.includes('<svg') || !rotation) return html;
  const rad = (rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const cx = centerX !== undefined ? centerX : w / 2;
  const cy = centerY !== undefined ? centerY : h / 2;

  const rotatePt = (x: number, y: number): { x: number; y: number } => {
    const dx = x - cx;
    const dy = y - cy;
    return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos };
  };
  // handleIn / handleOut are stored as deltas relative to the anchor.
  // Rotate them as vectors (no translation), so the bezier handles rotate
  // along with the anchor.
  const rotateDelta = (dx: number, dy: number): { x: number; y: number } => ({
    x: dx * cos - dy * sin,
    y: dx * sin + dy * cos,
  });

  const rotateD = (d: string): string => {
    const parsed = parsePath(d);
    const subs = parsed.subPaths && parsed.subPaths.length > 0
      ? parsed.subPaths
      : [{ points: parsed.points, closed: parsed.closed }];
    for (const sp of subs) {
      for (const pt of sp.points) {
        const r = rotatePt(pt.x, pt.y);
        pt.x = r.x; pt.y = r.y;
        if (pt.handleIn) { const h1 = rotateDelta(pt.handleIn.x, pt.handleIn.y); pt.handleIn.x = h1.x; pt.handleIn.y = h1.y; }
        if (pt.handleOut) { const h2 = rotateDelta(pt.handleOut.x, pt.handleOut.y); pt.handleOut.x = h2.x; pt.handleOut.y = h2.y; }
      }
    }
    return subs.map(sp => serializeSubPath(sp)).join('');
  };

  let result = html;
  const pathDs = extractAllPathDs(result);
  pathDs.forEach((d, i) => {
    result = updateNthPathInHtml(result, i, rotateD(d));
  });
  // Also rotate any data-orig-d (used to re-expand corner radii on radius changes)
  result = result.replace(/data-orig-d="([^"]*)"/g, (_m, dOrig) => {
    return `data-orig-d="${rotateD(dOrig)}"`;
  });
  return result;
}

/**
 * Bake a rotation delta into the element's geometry around its current center,
 * and return the new html plus the new element x/y/w/h that snaps to the
 * rotated path's bounding box. The visual center (oldCx, oldCy) is preserved.
 *
 * Caller passes element's current x/y/w/h. The result element is axis-aligned
 * (it contains the rotated path geometry directly) and has rotation = 0 conceptually.
 */
export function bakeRotationOnElement(
  html: string,
  rotation: number,
  x: number,
  y: number,
  w: number,
  h: number,
): { html: string; x: number; y: number; w: number; h: number } {
  if (!html.includes('<svg') || !rotation) return { html, x, y, w, h };
  // Step 1: rotate path points around the viewBox content center (w/2, h/2).
  const baked = bakeRotation(html, rotation, w, h);

  // Step 2: compute new viewBox to fit the rotated path AABB + padding.
  const pad = 1;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const d of extractAllPathDs(baked)) {
    const parsed = parsePath(d);
    const subs = parsed.subPaths && parsed.subPaths.length > 0
      ? parsed.subPaths : [{ points: parsed.points, closed: parsed.closed }];
    for (const sp of subs) for (const pt of sp.points) {
      if (pt.x < minX) minX = pt.x; if (pt.x > maxX) maxX = pt.x;
      if (pt.y < minY) minY = pt.y; if (pt.y > maxY) maxY = pt.y;
    }
  }
  if (!isFinite(minX)) return { html: baked, x, y, w, h };

  const newVbX = Math.round((minX - pad) * 100) / 100;
  const newVbY = Math.round((minY - pad) * 100) / 100;
  const newVbW = Math.max(Math.round((maxX - minX + pad * 2) * 100) / 100, 1);
  const newVbH = Math.max(Math.round((maxY - minY + pad * 2) * 100) / 100, 1);

  // Step 3: compute new element box. Preserve scale (1 viewBox unit = 1 canvas
  // unit pre-rotation), so newW/newH equal newVbW/newVbH minus padding.
  // The new element box's center should equal the OLD element box's center
  // (the user perceives the rotation as happening around the element's center).
  const oldCx = x + w / 2;
  const oldCy = y + h / 2;
  const newW = Math.max(1, Math.round(newVbW - pad * 2));
  const newH = Math.max(1, Math.round(newVbH - pad * 2));
  const newX = Math.round(oldCx - newW / 2);
  const newY = Math.round(oldCy - newH / 2);

  // Step 4: write new viewBox into html.
  const finalHtml = baked.replace(/viewBox="[^"]*"/, `viewBox="${newVbX} ${newVbY} ${newVbW} ${newVbH}"`);

  return { html: finalHtml, x: newX, y: newY, w: newW, h: newH };
}
