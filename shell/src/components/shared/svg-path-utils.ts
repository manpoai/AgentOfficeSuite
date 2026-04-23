export interface PathPoint {
  x: number;
  y: number;
  handleIn?: { x: number; y: number };
  handleOut?: { x: number; y: number };
  type: 'corner' | 'smooth' | 'symmetric';
}

export interface ParsedPath {
  points: PathPoint[];
  closed: boolean;
}

interface PathCmd {
  type: string;
  values: number[];
}

function tokenize(d: string): PathCmd[] {
  const cmds: PathCmd[] = [];
  const re = /([MLHVCSQTAZmlhvcsqtaz])([^MLHVCSQTAZmlhvcsqtaz]*)/g;
  let match;
  while ((match = re.exec(d)) !== null) {
    const type = match[1];
    const nums = match[2].trim().split(/[\s,]+/).filter(Boolean).map(Number);
    cmds.push({ type, values: nums.some(isNaN) ? [] : nums });
  }
  return cmds;
}

export function parsePath(d: string): ParsedPath {
  const cmds = tokenize(d);
  const points: PathPoint[] = [];
  let cx = 0, cy = 0;
  let closed = false;
  let prevControlX = 0, prevControlY = 0;

  for (const cmd of cmds) {
    const { type, values } = cmd;
    const isRel = type === type.toLowerCase();
    const abs = type.toUpperCase();

    switch (abs) {
      case 'M': {
        const x = isRel ? cx + values[0] : values[0];
        const y = isRel ? cy + values[1] : values[1];
        points.push({ x, y, type: 'corner' });
        cx = x; cy = y;
        for (let i = 2; i < values.length; i += 2) {
          const lx = isRel ? cx + values[i] : values[i];
          const ly = isRel ? cy + values[i + 1] : values[i + 1];
          points.push({ x: lx, y: ly, type: 'corner' });
          cx = lx; cy = ly;
        }
        break;
      }
      case 'L': {
        for (let i = 0; i < values.length; i += 2) {
          const x = isRel ? cx + values[i] : values[i];
          const y = isRel ? cy + values[i + 1] : values[i + 1];
          points.push({ x, y, type: 'corner' });
          cx = x; cy = y;
        }
        break;
      }
      case 'H': {
        for (const v of values) {
          const x = isRel ? cx + v : v;
          points.push({ x, y: cy, type: 'corner' });
          cx = x;
        }
        break;
      }
      case 'V': {
        for (const v of values) {
          const y = isRel ? cy + v : v;
          points.push({ x: cx, y, type: 'corner' });
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

          if (points.length > 0) {
            const prev = points[points.length - 1];
            prev.handleOut = { x: c1x - prev.x, y: c1y - prev.y };
            if (prev.handleOut.x !== 0 || prev.handleOut.y !== 0) prev.type = 'smooth';
          }

          points.push({
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

          if (points.length > 0) {
            const prev = points[points.length - 1];
            prev.handleOut = { x: (qx - prev.x) * 2 / 3, y: (qy - prev.y) * 2 / 3 };
            prev.type = 'smooth';
          }
          points.push({
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

          if (points.length > 0) {
            const prev = points[points.length - 1];
            const c1x = 2 * prev.x - prevControlX;
            const c1y = 2 * prev.y - prevControlY;
            prev.handleOut = { x: c1x - prev.x, y: c1y - prev.y };
            prev.type = 'smooth';
          }

          points.push({
            x: ex, y: ey,
            handleIn: { x: c2x - ex, y: c2y - ey },
            type: 'smooth',
          });
          prevControlX = c2x; prevControlY = c2y;
          cx = ex; cy = ey;
        }
        break;
      }
      case 'Z': {
        closed = true;
        if (points.length > 0) { cx = points[0].x; cy = points[0].y; }
        break;
      }
    }
  }

  return { points, closed };
}

export function serializePath(parsed: ParsedPath): string {
  const { points, closed } = parsed;
  if (points.length === 0) return '';

  const parts: string[] = [];
  const r = (n: number) => Math.round(n * 100) / 100;

  for (let i = 0; i < points.length; i++) {
    const pt = points[i];
    if (i === 0) { parts.push(`M${r(pt.x)},${r(pt.y)}`); continue; }

    const prev = points[i - 1];
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

  if (closed && points.length > 1) {
    const last = points[points.length - 1];
    const first = points[0];
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

export function updatePathInHtml(html: string, newD: string): string {
  return html.replace(/(<path\b[^>]*\s)d="[^"]*"/, `$1d="${newD}"`);
}

export function extractPathD(html: string): string | null {
  const match = html.match(/<path\b[^>]*\sd="([^"]*)"/);
  return match ? match[1] : null;
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
  return { ...parsed, points };
}

export function removePoint(parsed: ParsedPath, index: number): ParsedPath {
  if (parsed.points.length <= 2) return parsed;
  const points = parsed.points.filter((_, i) => i !== index);
  return { ...parsed, points };
}
