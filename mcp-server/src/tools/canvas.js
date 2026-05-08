import { z } from 'zod';

const SHAPE_TYPES = [
  'rect', 'rounded-rect', 'circle', 'ellipse', 'triangle', 'diamond',
  'parallelogram', 'trapezoid', 'stadium', 'hexagon', 'pentagon', 'octagon',
  'star', 'cross', 'cloud', 'cylinder',
  'arrow-right', 'arrow-left', 'arrow-double', 'chevron-right', 'chevron-left',
  'callout', 'brace-left', 'brace-right', 'polygon',
];

const SHAPE_DEFAULTS = {
  'rect': [120, 60], 'rounded-rect': [120, 60], 'circle': [70, 70], 'ellipse': [120, 70],
  'triangle': [100, 80], 'diamond': [100, 80], 'parallelogram': [130, 60], 'trapezoid': [130, 60],
  'stadium': [130, 50], 'hexagon': [110, 80], 'pentagon': [100, 80], 'octagon': [90, 90],
  'star': [90, 90], 'cross': [80, 80], 'cloud': [130, 80], 'cylinder': [80, 100],
  'arrow-right': [130, 60], 'arrow-left': [130, 60], 'arrow-double': [130, 60],
  'chevron-right': [120, 60], 'chevron-left': [120, 60],
  'callout': [130, 80], 'brace-left': [40, 100], 'brace-right': [40, 100], 'polygon': [100, 100],
};

function regularPolygonPath(w, h, sides) {
  const n = Math.max(3, Math.min(60, Math.round(sides)));
  const cx = w / 2, cy = h / 2, rx = w / 2, ry = h / 2;
  const pts = [];
  for (let i = 0; i < n; i++) {
    const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
    pts.push(`${cx + rx * Math.cos(angle)} ${cy + ry * Math.sin(angle)}`);
  }
  return `M${pts.join('L')}z`;
}

function shapeRenderPath(type, w, h) {
  switch (type) {
    case 'rect': return `M0 0h${w}v${h}H0z`;
    case 'rounded-rect': {
      const r = Math.min(8, w / 6, h / 6);
      return `M${r} 0h${w - 2 * r}a${r} ${r} 0 0 1 ${r} ${r}v${h - 2 * r}a${r} ${r} 0 0 1-${r} ${r}H${r}a${r} ${r} 0 0 1-${r}-${r}V${r}a${r} ${r} 0 0 1 ${r}-${r}z`;
    }
    case 'circle':
    case 'ellipse': {
      const rx = w / 2, ry = h / 2;
      return `M${rx} 0A${rx} ${ry} 0 1 0 ${rx} ${h}A${rx} ${ry} 0 1 0 ${rx} 0z`;
    }
    case 'triangle': return `M${w / 2} 0L${w} ${h}H0z`;
    case 'diamond': return `M${w / 2} 0L${w} ${h / 2}L${w / 2} ${h}L0 ${h / 2}z`;
    case 'parallelogram': {
      const off = w * 0.15;
      return `M${off} 0H${w}L${w - off} ${h}H0z`;
    }
    case 'trapezoid': {
      const off = w * 0.15;
      return `M${off} 0H${w - off}L${w} ${h}H0z`;
    }
    case 'stadium': {
      const r = h / 2;
      return `M${r} 0h${w - 2 * r}a${r} ${r} 0 0 1 0 ${h}H${r}a${r} ${r} 0 0 1 0-${h}z`;
    }
    case 'hexagon': {
      const off = w * 0.2;
      return `M${off} 0H${w - off}L${w} ${h / 2}L${w - off} ${h}H${off}L0 ${h / 2}z`;
    }
    case 'pentagon': {
      const cx = w / 2, cy = h * 0.45, r = Math.min(w, h) * 0.48;
      const pts = [0, 1, 2, 3, 4].map(i => {
        const angle = (Math.PI * 2 * i) / 5 - Math.PI / 2;
        return `${cx + r * Math.cos(angle)} ${cy + r * Math.sin(angle) + h * 0.05}`;
      });
      return `M${pts.join('L')}z`;
    }
    case 'octagon': {
      const ins = Math.min(w, h) * 0.3;
      return `M${ins} 0H${w - ins}L${w} ${ins}V${h - ins}L${w - ins} ${h}H${ins}L0 ${h - ins}V${ins}z`;
    }
    case 'star': {
      const cx = w / 2, cy = h / 2, outerR = Math.min(w, h) / 2, innerR = outerR * 0.4;
      const pts = [];
      for (let i = 0; i < 10; i++) {
        const r = i % 2 === 0 ? outerR : innerR;
        const angle = (Math.PI * i) / 5 - Math.PI / 2;
        pts.push(`${cx + r * Math.cos(angle)} ${cy + r * Math.sin(angle)}`);
      }
      return `M${pts.join('L')}z`;
    }
    case 'cross': {
      const t = Math.min(w, h) / 3;
      return `M${t} 0h${t}v${t}h${t}v${t}h-${t}v${t}h-${t}v-${t}H0v-${t}h${t}z`;
    }
    case 'cloud':
      return `M${w * 0.15} ${h}a${w * 0.15} ${h * 0.2} 0 0 1-${w * 0.02}-${h * 0.35}A${w * 0.3} ${h * 0.35} 0 0 1 ${w * 0.5} ${h * 0.1}a${w * 0.3} ${h * 0.35} 0 0 1 ${w * 0.37} ${h * 0.3}A${w * 0.15} ${h * 0.2} 0 0 1 ${w * 0.85} ${h}z`;
    case 'cylinder': {
      const ry = h * 0.12;
      return `M0 ${ry}A${w / 2} ${ry} 0 0 1 ${w} ${ry}V${h - ry}A${w / 2} ${ry} 0 0 1 0 ${h - ry}z`;
    }
    case 'arrow-right': {
      const notch = w * 0.3, bar = h * 0.25;
      return `M0 ${bar}H${w - notch}V0L${w} ${h / 2}L${w - notch} ${h}V${h - bar}H0z`;
    }
    case 'arrow-left': {
      const notch = w * 0.3, bar = h * 0.25;
      return `M${w} ${bar}H${notch}V0L0 ${h / 2}L${notch} ${h}V${h - bar}H${w}z`;
    }
    case 'arrow-double': {
      const notch = w * 0.2, bar = h * 0.25;
      return `M${notch} 0L0 ${h / 2}L${notch} ${h}V${h - bar}H${w - notch}V${h}L${w} ${h / 2}L${w - notch} 0V${bar}H${notch}z`;
    }
    case 'chevron-right': {
      const notch = w * 0.25;
      return `M0 0H${w - notch}L${w} ${h / 2}L${w - notch} ${h}H0L${notch} ${h / 2}z`;
    }
    case 'chevron-left': {
      const notch = w * 0.25;
      return `M${notch} 0H${w}L${w - notch} ${h / 2}L${w} ${h}H${notch}L0 ${h / 2}z`;
    }
    case 'callout': {
      const bodyH = h * 0.75, tailW = w * 0.15, tailX = w * 0.3;
      return `M0 0H${w}V${bodyH}H${tailX + tailW}L${tailX} ${h}V${bodyH}H0z`;
    }
    case 'brace-left': {
      const mid = h / 2;
      return `M${w} 0C${w * 0.5} 0 ${w * 0.5} ${mid * 0.3} ${w * 0.5} ${mid * 0.5}S0 ${mid * 0.7} 0 ${mid}S${w * 0.5} ${mid * 1.3} ${w * 0.5} ${mid * 1.5}S${w * 0.5} ${h} ${w} ${h}`;
    }
    case 'brace-right': {
      const mid = h / 2;
      return `M0 0C${w * 0.5} 0 ${w * 0.5} ${mid * 0.3} ${w * 0.5} ${mid * 0.5}S${w} ${mid * 0.7} ${w} ${mid}S${w * 0.5} ${mid * 1.3} ${w * 0.5} ${mid * 1.5}S${w * 0.5} ${h} 0 ${h}`;
    }
    case 'polygon': return regularPolygonPath(w, h, 5);
    default: return `M0 0h${w}v${h}H0z`;
  }
}

function buildTextHtml(text, opts = {}) {
  const fontSize = opts.fontSize || 24;
  const fontFamily = opts.fontFamily || '-apple-system, BlinkMacSystemFont, sans-serif';
  const color = opts.color || '#000000';
  const fontWeight = opts.fontWeight || 400;
  const textAlign = opts.textAlign || 'left';
  const fixedWidth = opts.fixedWidth || false;
  const whiteSpace = fixedWidth ? 'white-space: normal; word-wrap: break-word;' : 'white-space: nowrap;';
  const resizeMode = fixedWidth ? 'fixed-width' : 'auto';
  const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<div style="font-family: ${fontFamily}; font-size: ${fontSize}px; font-weight: ${fontWeight}; color: ${color}; text-align: ${textAlign}; box-sizing: border-box; ${whiteSpace}" contenteditable="true" data-text-resize="${resizeMode}">${escaped}</div>`;
}

function buildShapeHtml(shapeType, w, h, opts = {}) {
  const fill = opts.fill || '#D9D9D9';
  const stroke = opts.stroke || 'none';
  const strokeWidth = opts.strokeWidth || 1;
  const pathData = shapeRenderPath(shapeType, w, h);
  const strokeAttr = stroke === 'none' ? 'stroke="none"' : `stroke="${stroke}" stroke-width="${strokeWidth}"`;
  return `<div style="width:100%;height:100%;overflow:visible;"><svg xmlns="http://www.w3.org/2000/svg" viewBox="-1 -1 ${w + 2} ${h + 2}" preserveAspectRatio="none" style="width:100%;height:100%;display:block;overflow:visible;"><path d="${pathData}" fill="${fill}" ${strokeAttr} vector-effect="non-scaling-stroke"/></svg></div>`;
}

const ElementSchema = z.object({
  html: z.string().describe('HTML content for the element'),
  x: z.number().describe('X position in px from left edge'),
  y: z.number().describe('Y position in px from top edge'),
  w: z.number().describe('Width in px'),
  h: z.number().describe('Height in px'),
  z_index: z.number().optional().describe('Stacking order (higher = on top)'),
  locked: z.boolean().optional().describe('If true, element cannot be dragged/resized by human'),
});

function materializeElement(spec, existingElements) {
  return {
    id: crypto.randomUUID(),
    x: spec.x, y: spec.y, w: spec.w, h: spec.h,
    html: spec.html,
    locked: spec.locked ?? false,
    z_index: spec.z_index ?? (existingElements.length > 0
      ? Math.max(...existingElements.map(e => e.z_index ?? 0)) + 1
      : 0),
  };
}

export function registerCanvasTools(server, gw) {
  server.tool(
    'create_canvas',
    'Create a new canvas (free-form design surface). Returns the canvas_id. A canvas starts with one blank page.',
    {
      title: z.string().describe('Canvas title'),
      parent_id: z.string().optional().describe('Parent content item ID to nest under (omit for root level)'),
      width: z.number().optional().describe('First page width in px (default 1920)'),
      height: z.number().optional().describe('First page height in px (default 1080)'),
    },
    async ({ title, parent_id, width, height }) => {
      const body = { title };
      if (parent_id) body.parent_id = parent_id;
      if (width) body.width = width;
      if (height) body.height = height;
      const result = await gw.post('/canvases', body);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
  );

  server.tool(
    'get_canvas',
    'Read a canvas and all its pages/elements. Returns full data including page dimensions, element positions, and HTML content.',
    { canvas_id: z.string().describe('Canvas ID (without canvas: prefix)') },
    async ({ canvas_id }) => {
      const result = await gw.get(`/canvases/${canvas_id}`);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
  );

  server.tool(
    'add_page',
    'Add a new page to a canvas, optionally pre-populated with elements. This is the preferred way to create a full page design in one call. New page inherits dimensions from the last page unless overridden.',
    {
      canvas_id: z.string().describe('Canvas ID'),
      title: z.string().optional().describe('Page title'),
      width: z.number().optional().describe('Page width in px'),
      height: z.number().optional().describe('Page height in px'),
      elements: z.array(ElementSchema).optional().describe('Elements to place on the new page. Each needs html, x, y, w, h.'),
    },
    async ({ canvas_id, title, width, height, elements }) => {
      const res = await gw.get(`/canvases/${canvas_id}`);
      const data = res.data;
      const lastPage = data.pages[data.pages.length - 1];
      const newPage = {
        page_id: crypto.randomUUID(),
        title: title || `Page ${data.pages.length + 1}`,
        width: width || lastPage?.width || 1920,
        height: height || lastPage?.height || 1080,
        head_html: '',
        elements: [],
      };
      const elementIds = [];
      if (elements && elements.length > 0) {
        for (const spec of elements) {
          const el = materializeElement(spec, newPage.elements);
          newPage.elements.push(el);
          elementIds.push(el.id);
        }
      }
      data.pages.push(newPage);
      await gw.patch(`/canvases/${canvas_id}`, { data });
      return { content: [{ type: 'text', text: JSON.stringify({ page_id: newPage.page_id, page_index: data.pages.length - 1, element_count: elementIds.length, element_ids: elementIds }) }] };
    }
  );

  server.tool(
    'delete_page',
    'Delete a page from a canvas. Cannot delete the last remaining page.',
    {
      canvas_id: z.string().describe('Canvas ID'),
      page_id: z.string().describe('Page ID to delete'),
    },
    async ({ canvas_id, page_id }) => {
      const res = await gw.get(`/canvases/${canvas_id}`);
      const data = res.data;
      if (data.pages.length <= 1) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'Cannot delete the last page' }) }] };
      }
      data.pages = data.pages.filter(p => p.page_id !== page_id);
      await gw.patch(`/canvases/${canvas_id}`, { data });
      return { content: [{ type: 'text', text: JSON.stringify({ deleted: true, remaining_pages: data.pages.length }) }] };
    }
  );

  server.tool(
    'insert_element',
    'Insert a single HTML element onto a canvas page. For adding many elements at once, prefer batch_insert_elements or add_page with elements.',
    {
      canvas_id: z.string().describe('Canvas ID'),
      page_id: z.string().describe('Target page ID'),
      html: z.string().describe('HTML content for the element'),
      x: z.number().describe('X position in px from left edge'),
      y: z.number().describe('Y position in px from top edge'),
      w: z.number().describe('Width in px'),
      h: z.number().describe('Height in px'),
      z_index: z.number().optional().describe('Stacking order (higher = on top)'),
      locked: z.boolean().optional().describe('If true, element cannot be dragged/resized by human'),
    },
    async ({ canvas_id, page_id, html, x, y, w, h, z_index, locked }) => {
      const res = await gw.get(`/canvases/${canvas_id}`);
      const data = res.data;
      const page = data.pages.find(p => p.page_id === page_id);
      if (!page) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'Page not found' }) }] };
      }
      const element = materializeElement({ html, x, y, w, h, z_index, locked }, page.elements);
      page.elements.push(element);
      await gw.patch(`/canvases/${canvas_id}`, { data });
      return { content: [{ type: 'text', text: JSON.stringify({ element_id: element.id, page_id }) }] };
    }
  );

  server.tool(
    'batch_insert_elements',
    'Insert multiple HTML elements onto a canvas page in one call. More efficient than calling insert_element repeatedly.',
    {
      canvas_id: z.string().describe('Canvas ID'),
      page_id: z.string().describe('Target page ID'),
      elements: z.array(ElementSchema).describe('Array of elements to insert. Each needs html, x, y, w, h.'),
    },
    async ({ canvas_id, page_id, elements }) => {
      const res = await gw.get(`/canvases/${canvas_id}`);
      const data = res.data;
      const page = data.pages.find(p => p.page_id === page_id);
      if (!page) return { content: [{ type: 'text', text: JSON.stringify({ error: 'Page not found' }) }] };
      const ids = [];
      for (const spec of elements) {
        const el = materializeElement(spec, page.elements);
        page.elements.push(el);
        ids.push(el.id);
      }
      await gw.patch(`/canvases/${canvas_id}`, { data });
      return { content: [{ type: 'text', text: JSON.stringify({ inserted: ids.length, element_ids: ids, page_id }) }] };
    }
  );

  server.tool(
    'replace_page_elements',
    'Replace ALL elements on a canvas page. Use this when redesigning an entire page — more efficient and cleaner than updating individual elements.',
    {
      canvas_id: z.string().describe('Canvas ID'),
      page_id: z.string().describe('Page ID whose elements will be replaced'),
      elements: z.array(ElementSchema).describe('New elements array. Replaces all existing elements on the page.'),
    },
    async ({ canvas_id, page_id, elements }) => {
      const res = await gw.get(`/canvases/${canvas_id}`);
      const data = res.data;
      const page = data.pages.find(p => p.page_id === page_id);
      if (!page) return { content: [{ type: 'text', text: JSON.stringify({ error: 'Page not found' }) }] };
      const oldCount = page.elements.length;
      page.elements = [];
      const ids = [];
      for (const spec of elements) {
        const el = materializeElement(spec, page.elements);
        page.elements.push(el);
        ids.push(el.id);
      }
      await gw.patch(`/canvases/${canvas_id}`, { data });
      return { content: [{ type: 'text', text: JSON.stringify({ replaced: true, old_count: oldCount, new_count: ids.length, element_ids: ids, page_id }) }] };
    }
  );

  server.tool(
    'update_element',
    'Update properties of an existing canvas element. Only provided fields are changed.',
    {
      canvas_id: z.string().describe('Canvas ID'),
      page_id: z.string().describe('Page ID containing the element'),
      element_id: z.string().describe('Element ID to update'),
      html: z.string().optional().describe('New HTML content'),
      x: z.number().optional().describe('New X position'),
      y: z.number().optional().describe('New Y position'),
      w: z.number().optional().describe('New width'),
      h: z.number().optional().describe('New height'),
      z_index: z.number().optional().describe('New stacking order'),
      locked: z.boolean().optional().describe('Lock/unlock the element'),
    },
    async ({ canvas_id, page_id, element_id, html, x, y, w, h, z_index, locked }) => {
      const res = await gw.get(`/canvases/${canvas_id}`);
      const data = res.data;
      const page = data.pages.find(p => p.page_id === page_id);
      if (!page) return { content: [{ type: 'text', text: JSON.stringify({ error: 'Page not found' }) }] };
      const el = page.elements.find(e => e.id === element_id);
      if (!el) return { content: [{ type: 'text', text: JSON.stringify({ error: 'Element not found' }) }] };
      if (html !== undefined) el.html = html;
      if (x !== undefined) el.x = x;
      if (y !== undefined) el.y = y;
      if (w !== undefined) el.w = w;
      if (h !== undefined) el.h = h;
      if (z_index !== undefined) el.z_index = z_index;
      if (locked !== undefined) el.locked = locked;
      await gw.patch(`/canvases/${canvas_id}`, { data });
      return { content: [{ type: 'text', text: JSON.stringify({ updated: true, element_id }) }] };
    }
  );

  server.tool(
    'delete_element',
    'Delete an element from a canvas page.',
    {
      canvas_id: z.string().describe('Canvas ID'),
      page_id: z.string().describe('Page ID containing the element'),
      element_id: z.string().describe('Element ID to delete'),
    },
    async ({ canvas_id, page_id, element_id }) => {
      const res = await gw.get(`/canvases/${canvas_id}`);
      const data = res.data;
      const page = data.pages.find(p => p.page_id === page_id);
      if (!page) return { content: [{ type: 'text', text: JSON.stringify({ error: 'Page not found' }) }] };
      const before = page.elements.length;
      page.elements = page.elements.filter(e => e.id !== element_id);
      if (page.elements.length === before) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'Element not found' }) }] };
      }
      await gw.patch(`/canvases/${canvas_id}`, { data });
      return { content: [{ type: 'text', text: JSON.stringify({ deleted: true }) }] };
    }
  );

  server.tool(
    'insert_text_element',
    'Insert a native text element onto a canvas page. Shows as "Text" in the layer panel (not generic "Element"). Use this instead of insert_element when creating text.',
    {
      canvas_id: z.string().describe('Canvas ID'),
      page_id: z.string().describe('Target page ID'),
      text: z.string().describe('Text content to display'),
      x: z.number().describe('X position in px from left edge'),
      y: z.number().describe('Y position in px from top edge'),
      font_size: z.number().optional().describe('Font size in px (default 24)'),
      font_family: z.string().optional().describe('CSS font family (default system font)'),
      color: z.string().optional().describe('Text color as CSS value (default #000000)'),
      font_weight: z.number().optional().describe('Font weight: 400=normal, 700=bold (default 400)'),
      text_align: z.enum(['left', 'center', 'right']).optional().describe('Text alignment (default left)'),
      width: z.number().optional().describe('Fixed width in px. If set, text wraps. If omitted, text auto-sizes.'),
      locked: z.boolean().optional().describe('If true, element cannot be dragged/resized by human'),
    },
    async ({ canvas_id, page_id, text, x, y, font_size, font_family, color, font_weight, text_align, width, locked }) => {
      const res = await gw.get(`/canvases/${canvas_id}`);
      const data = res.data;
      const page = data.pages.find(p => p.page_id === page_id);
      if (!page) return { content: [{ type: 'text', text: JSON.stringify({ error: 'Page not found' }) }] };
      const fixedWidth = width !== undefined && width > 10;
      const html = buildTextHtml(text, {
        fontSize: font_size, fontFamily: font_family, color, fontWeight: font_weight,
        textAlign: text_align, fixedWidth,
      });
      const el = materializeElement({
        html, x, y, w: fixedWidth ? width : 100, h: (font_size || 24) + 8, locked,
      }, page.elements);
      page.elements.push(el);
      await gw.patch(`/canvases/${canvas_id}`, { data });
      return { content: [{ type: 'text', text: JSON.stringify({ element_id: el.id, page_id }) }] };
    }
  );

  server.tool(
    'insert_shape_element',
    `Insert a native shape element onto a canvas page. Shows as "Shape" in the layer panel (not generic "Element"). Available shapes: ${SHAPE_TYPES.join(', ')}`,
    {
      canvas_id: z.string().describe('Canvas ID'),
      page_id: z.string().describe('Target page ID'),
      shape: z.enum(SHAPE_TYPES).describe('Shape type'),
      x: z.number().optional().describe('X position in px (default: centered on page)'),
      y: z.number().optional().describe('Y position in px (default: centered on page)'),
      w: z.number().optional().describe('Width in px (default: shape default × 2)'),
      h: z.number().optional().describe('Height in px (default: shape default × 2)'),
      fill: z.string().optional().describe('Fill color as CSS value (default #D9D9D9)'),
      stroke: z.string().optional().describe('Stroke color (default none)'),
      stroke_width: z.number().optional().describe('Stroke width in px (default 1)'),
      locked: z.boolean().optional().describe('If true, element cannot be dragged/resized by human'),
    },
    async ({ canvas_id, page_id, shape, x, y, w, h, fill, stroke, stroke_width, locked }) => {
      const res = await gw.get(`/canvases/${canvas_id}`);
      const data = res.data;
      const page = data.pages.find(p => p.page_id === page_id);
      if (!page) return { content: [{ type: 'text', text: JSON.stringify({ error: 'Page not found' }) }] };
      const [defW, defH] = SHAPE_DEFAULTS[shape] || [120, 60];
      const scale = 2;
      const elW = w || defW * scale;
      const elH = h || defH * scale;
      const elX = x ?? Math.round((page.width || 1920) / 2 - elW / 2);
      const elY = y ?? Math.round((page.height || 1080) / 2 - elH / 2);
      const html = buildShapeHtml(shape, elW, elH, { fill, stroke, strokeWidth: stroke_width });
      const el = materializeElement({ html, x: elX, y: elY, w: elW, h: elH, locked }, page.elements);
      page.elements.push(el);
      await gw.patch(`/canvases/${canvas_id}`, { data });
      return { content: [{ type: 'text', text: JSON.stringify({ element_id: el.id, page_id, shape, w: elW, h: elH }) }] };
    }
  );

  server.tool(
    'update_page',
    'Update canvas page properties (dimensions, title, head_html for shared styles).',
    {
      canvas_id: z.string().describe('Canvas ID'),
      page_id: z.string().describe('Page ID to update'),
      title: z.string().optional().describe('New page title'),
      width: z.number().optional().describe('New page width in px'),
      height: z.number().optional().describe('New page height in px'),
      head_html: z.string().optional().describe('Shared HTML/CSS injected into all elements on this page'),
    },
    async ({ canvas_id, page_id, title, width, height, head_html }) => {
      const res = await gw.get(`/canvases/${canvas_id}`);
      const data = res.data;
      const page = data.pages.find(p => p.page_id === page_id);
      if (!page) return { content: [{ type: 'text', text: JSON.stringify({ error: 'Page not found' }) }] };
      if (title !== undefined) page.title = title;
      if (width !== undefined) page.width = width;
      if (height !== undefined) page.height = height;
      if (head_html !== undefined) page.head_html = head_html;
      await gw.patch(`/canvases/${canvas_id}`, { data });
      return { content: [{ type: 'text', text: JSON.stringify({ updated: true, page_id }) }] };
    }
  );
}
