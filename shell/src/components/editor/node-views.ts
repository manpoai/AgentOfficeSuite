/**
 * Custom ProseMirror NodeViews for rendering:
 * - math_block: KaTeX rendered LaTeX
 */
import type { Node as PMNode } from 'prosemirror-model';
import { NodeSelection } from 'prosemirror-state';
import type { EditorView, NodeView } from 'prosemirror-view';

/**
 * Math block NodeView — renders LaTeX via KaTeX.
 * The math_block node is atom:true, so ProseMirror does not manage its content directly.
 */
class MathBlockView implements NodeView {
  dom: HTMLElement;

  constructor(private node: PMNode, private view: EditorView, private getPos: () => number | undefined) {
    this.dom = document.createElement('div');
    this.dom.className = 'math-block';
    this.renderKatex();
  }

  private async renderKatex() {
    const tex = this.node.textContent.trim();
    if (!tex) {
      this.dom.innerHTML = '<span style="color: hsl(0 0% 60%); font-style: italic;">Empty math block</span>';
      return;
    }

    try {
      const katex = (await import('katex')).default;
      this.dom.innerHTML = katex.renderToString(tex, {
        displayMode: true,
        throwOnError: false,
        output: 'htmlAndMathml',
      });
    } catch {
      // Fallback: show raw source in a code element
      this.dom.textContent = '';
      const code = document.createElement('code');
      code.textContent = tex;
      this.dom.appendChild(code);
    }
  }

  update(node: PMNode) {
    if (node.type.name !== 'math_block') return false;
    this.node = node;
    this.renderKatex();
    return true;
  }

  stopEvent() { return true; }
  ignoreMutation() { return true; }
}

/**
 * Image NodeView — renders image with resize handles and alignment toolbar.
 */
class ImageNodeView implements NodeView {
  dom: HTMLElement;
  private img: HTMLImageElement;
  private toolbar: HTMLElement;
  private sizeLabel: HTMLElement | null = null;
  private resizing = false;

  constructor(private node: PMNode, private view: EditorView, private getPos: () => number | undefined) {
    // Wrapper
    this.dom = document.createElement('div');
    this.dom.className = 'image-node-wrapper';
    const align = node.attrs.align || 'center';
    this.dom.style.textAlign = align;

    // Image
    this.img = document.createElement('img');
    this.img.src = node.attrs.src;
    if (node.attrs.alt) this.img.alt = node.attrs.alt;
    if (node.attrs.width) this.img.style.width = node.attrs.width;
    this.img.style.maxWidth = '100%';
    this.img.style.cursor = 'pointer';
    this.img.style.display = 'inline-block';
    this.img.style.borderRadius = '4px';
    this.img.draggable = false;

    // Click to select this image node
    this.img.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const pos = this.getPos();
      if (pos != null) {
        const tr = this.view.state.tr.setSelection(NodeSelection.create(this.view.state.doc, pos));
        this.view.dispatch(tr);
        this.view.focus();
      }
    });

    // Resize handle
    const resizeHandle = document.createElement('div');
    resizeHandle.className = 'image-resize-handle';
    resizeHandle.style.cssText = 'position:absolute;bottom:0;right:0;width:12px;height:12px;cursor:se-resize;background:hsl(var(--primary));border-radius:2px;opacity:0;transition:opacity 0.15s;';

    const imgContainer = document.createElement('div');
    imgContainer.style.cssText = 'position:relative;display:inline-block;';
    imgContainer.appendChild(this.img);
    imgContainer.appendChild(resizeHandle);

    imgContainer.addEventListener('mouseenter', () => { resizeHandle.style.opacity = '0.6'; });
    imgContainer.addEventListener('mouseleave', () => { if (!this.resizing) resizeHandle.style.opacity = '0'; });

    // Resize drag
    resizeHandle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.resizing = true;
      const startX = e.clientX;
      const startW = this.img.offsetWidth;

      const onMove = (ev: MouseEvent) => {
        const newW = Math.max(50, startW + (ev.clientX - startX));
        this.img.style.width = `${newW}px`;
        this.updateSizeLabel();
      };
      const onUp = () => {
        this.resizing = false;
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        resizeHandle.style.opacity = '0';
        const pos = this.getPos();
        if (pos != null) {
          const tr = this.view.state.tr.setNodeMarkup(pos, undefined, {
            ...this.node.attrs,
            width: `${this.img.offsetWidth}px`,
          });
          this.view.dispatch(tr);
        }
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });

    // Toolbar (Outline-style: layout + dimensions + actions)
    this.toolbar = this.buildToolbar();

    const toolbarContainer = document.createElement('div');
    toolbarContainer.style.cssText = 'position:relative;display:inline-block;';
    toolbarContainer.appendChild(imgContainer);
    toolbarContainer.appendChild(this.toolbar);

    this.dom.appendChild(toolbarContainer);

    // Update dimensions once image loads
    this.img.addEventListener('load', () => this.updateSizeLabel());

    document.addEventListener('click', this.handleOutsideClick);
  }

  private buildToolbar(): HTMLElement {
    const tb = document.createElement('div');
    tb.className = 'image-toolbar';
    tb.style.cssText = 'display:none;position:absolute;top:-44px;left:50%;transform:translateX(-50%);background:hsl(var(--card, 0 0% 100%));border:1px solid hsl(var(--border, 0 0% 90%));border-radius:8px;padding:4px;box-shadow:0 2px 8px rgba(0,0,0,0.12);z-index:20;white-space:nowrap;display:none;';

    const btnStyle = 'padding:6px 8px;border:none;background:transparent;cursor:pointer;border-radius:4px;font-size:13px;color:hsl(var(--foreground, 0 0% 9%));line-height:1;';
    const btnActiveStyle = 'padding:6px 8px;border:none;background:hsl(var(--accent, 0 0% 96%));cursor:pointer;border-radius:4px;font-size:13px;color:hsl(var(--foreground, 0 0% 9%));line-height:1;';

    // Layout/alignment buttons (matching Outline's 5-button layout)
    const layouts = [
      { svg: this.svgIcon('alignLeft'), align: 'left', title: 'Align left' },
      { svg: this.svgIcon('alignCenter'), align: 'center', title: 'Center' },
      { svg: this.svgIcon('alignRight'), align: 'right', title: 'Align right' },
      { svg: this.svgIcon('fullWidth'), align: 'full', title: 'Full width' },
      { svg: this.svgIcon('fitWidth'), align: 'fit', title: 'Fit to page' },
    ];

    for (const layout of layouts) {
      const b = document.createElement('button');
      b.innerHTML = layout.svg;
      b.title = layout.title;
      b.style.cssText = (this.node.attrs.align === layout.align) ? btnActiveStyle : btnStyle;
      b.addEventListener('mouseenter', () => { b.style.background = 'hsl(var(--accent, 0 0% 96%))'; });
      b.addEventListener('mouseleave', () => { b.style.background = (this.node.attrs.align === layout.align) ? 'hsl(var(--accent, 0 0% 96%))' : 'transparent'; });
      b.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const pos = this.getPos();
        if (pos != null) {
          const tr = this.view.state.tr.setNodeMarkup(pos, undefined, {
            ...this.node.attrs,
            align: layout.align,
          });
          this.view.dispatch(tr);
        }
      });
      tb.appendChild(b);
    }

    // Separator
    tb.appendChild(this.createSep());

    // Dimensions display
    this.sizeLabel = document.createElement('span');
    this.sizeLabel.style.cssText = 'padding:4px 8px;font-size:12px;color:hsl(var(--muted-foreground, 0 0% 45%));user-select:none;white-space:nowrap;';
    this.sizeLabel.textContent = '…';
    tb.appendChild(this.sizeLabel);

    // Separator
    tb.appendChild(this.createSep());

    // Action buttons
    const actions = [
      { svg: this.svgIcon('download'), title: 'Download', action: () => this.downloadImage() },
      { svg: this.svgIcon('replace'), title: 'Replace', action: () => this.replaceImage() },
      { svg: this.svgIcon('delete'), title: 'Delete', action: () => this.deleteImage() },
      { svg: this.svgIcon('link'), title: 'Copy link', action: () => this.copyLink() },
      { svg: this.svgIcon('caption'), title: 'Alt text', action: () => this.editAltText() },
    ];

    for (const act of actions) {
      const b = document.createElement('button');
      b.innerHTML = act.svg;
      b.title = act.title;
      b.style.cssText = btnStyle;
      b.addEventListener('mouseenter', () => { b.style.background = 'hsl(var(--accent, 0 0% 96%))'; });
      b.addEventListener('mouseleave', () => { b.style.background = 'transparent'; });
      b.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        act.action();
      });
      tb.appendChild(b);
    }

    return tb;
  }

  private createSep(): HTMLElement {
    const sep = document.createElement('span');
    sep.style.cssText = 'display:inline-block;width:1px;height:20px;background:hsl(var(--border, 0 0% 90%));margin:0 2px;vertical-align:middle;';
    return sep;
  }

  private svgIcon(name: string): string {
    const icons: Record<string, string> = {
      alignLeft: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="3" x2="9" y2="21"/></svg>',
      alignCenter: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="12" y1="3" x2="12" y2="21"/></svg>',
      alignRight: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="15" y1="3" x2="15" y2="21"/></svg>',
      fullWidth: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="12" x2="21" y2="12"/></svg>',
      fitWidth: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="7 8 3 12 7 16"/><polyline points="17 8 21 12 17 16"/><line x1="3" y1="12" x2="21" y2="12"/></svg>',
      download: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
      replace: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 16h5v5"/></svg>',
      delete: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
      link: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>',
      caption: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
    };
    return icons[name] || '';
  }

  private updateSizeLabel() {
    if (!this.sizeLabel) return;
    const w = this.img.naturalWidth || this.img.offsetWidth;
    const h = this.img.naturalHeight || this.img.offsetHeight;
    if (w && h) {
      this.sizeLabel.textContent = `${w} × ${h}`;
    }
  }

  private downloadImage() {
    const a = document.createElement('a');
    a.href = this.img.src;
    a.download = this.node.attrs.alt || 'image';
    a.click();
  }

  private replaceImage() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const pos = this.getPos();
        if (pos != null && typeof reader.result === 'string') {
          const tr = this.view.state.tr.setNodeMarkup(pos, undefined, {
            ...this.node.attrs,
            src: reader.result,
          });
          this.view.dispatch(tr);
        }
      };
      reader.readAsDataURL(file);
    });
    input.click();
  }

  private deleteImage() {
    const pos = this.getPos();
    if (pos == null) return;
    const tr = this.view.state.tr.delete(pos, pos + this.node.nodeSize);
    this.view.dispatch(tr);
  }

  private copyLink() {
    navigator.clipboard.writeText(this.img.src).catch(() => {});
  }

  private editAltText() {
    const current = this.node.attrs.alt || '';
    const alt = prompt('Alt text:', current);
    if (alt !== null && alt !== current) {
      const pos = this.getPos();
      if (pos != null) {
        const tr = this.view.state.tr.setNodeMarkup(pos, undefined, {
          ...this.node.attrs,
          alt,
        });
        this.view.dispatch(tr);
      }
    }
  }

  private handleOutsideClick = (e: MouseEvent) => {
    if (!this.dom.contains(e.target as Node)) {
      this.hideToolbar();
    }
  };

  private showToolbar() {
    this.toolbar.style.display = 'flex';
    this.toolbar.style.alignItems = 'center';
    this.updateSizeLabel();
  }

  private hideToolbar() {
    this.toolbar.style.display = 'none';
  }

  update(node: PMNode) {
    if (node.type.name !== 'image') return false;
    this.node = node;
    this.img.src = node.attrs.src;
    if (node.attrs.alt) this.img.alt = node.attrs.alt;
    if (node.attrs.width) this.img.style.width = node.attrs.width;
    else this.img.style.width = '';
    this.dom.style.textAlign = node.attrs.align || 'center';
    return true;
  }

  selectNode() {
    this.dom.classList.add('image-selected');
    this.img.style.outline = '2px solid hsl(var(--primary, 220 90% 56%))';
    this.img.style.outlineOffset = '2px';
    this.showToolbar();
  }

  deselectNode() {
    this.dom.classList.remove('image-selected');
    this.img.style.outline = 'none';
    this.img.style.outlineOffset = '';
    this.hideToolbar();
  }

  destroy() {
    document.removeEventListener('click', this.handleOutsideClick);
  }

  stopEvent(event: Event) {
    return event.type === 'mousedown' || event.type === 'click';
  }
  ignoreMutation() { return true; }
}

/**
 * Checkbox item NodeView — renders a clickable checkbox before the content.
 */
class CheckboxItemView implements NodeView {
  dom: HTMLElement;
  contentDOM: HTMLElement;
  private checkbox: HTMLInputElement;

  constructor(private node: PMNode, private view: EditorView, private getPos: () => number | undefined) {
    this.dom = document.createElement('li');
    this.dom.className = 'checkbox-item';
    this.dom.dataset.checked = node.attrs.checked ? 'true' : 'false';

    this.checkbox = document.createElement('input');
    this.checkbox.type = 'checkbox';
    this.checkbox.checked = node.attrs.checked;
    this.checkbox.style.cssText = 'margin: 0.3em 0.5rem 0 0; cursor: pointer; flex-shrink: 0; width: 16px; height: 16px; accent-color: hsl(var(--sidebar-primary, 228 80% 50%));';
    this.checkbox.addEventListener('mousedown', (e) => {
      // Prevent ProseMirror from handling this click
      e.preventDefault();
    });
    this.checkbox.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const pos = this.getPos();
      if (pos != null) {
        const tr = this.view.state.tr.setNodeMarkup(pos, undefined, {
          ...this.node.attrs,
          checked: !this.node.attrs.checked,
        });
        this.view.dispatch(tr);
      }
    });

    this.dom.style.cssText = 'display: flex; align-items: flex-start; list-style: none;';
    this.dom.appendChild(this.checkbox);

    this.contentDOM = document.createElement('div');
    this.contentDOM.style.cssText = 'flex: 1; min-width: 0;';
    this.dom.appendChild(this.contentDOM);
  }

  update(node: PMNode) {
    if (node.type.name !== 'checkbox_item') return false;
    this.node = node;
    this.checkbox.checked = node.attrs.checked;
    this.dom.dataset.checked = node.attrs.checked ? 'true' : 'false';
    return true;
  }

  stopEvent(event: Event) {
    return event.target === this.checkbox;
  }
}

/**
 * Factory function to create nodeViews map for ProseMirror EditorView.
 */
export function createNodeViews() {
  return {
    math_block: (node: PMNode, view: EditorView, getPos: () => number | undefined) =>
      new MathBlockView(node, view, getPos),
    image: (node: PMNode, view: EditorView, getPos: () => number | undefined) =>
      new ImageNodeView(node, view, getPos),
    checkbox_item: (node: PMNode, view: EditorView, getPos: () => number | undefined) =>
      new CheckboxItemView(node, view, getPos),
  };
}
