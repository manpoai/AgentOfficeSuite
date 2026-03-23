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

    // Click to select this image node (shows blue border + image toolbar)
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
      };
      const onUp = () => {
        this.resizing = false;
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        resizeHandle.style.opacity = '0';
        // Commit width
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

    // Toolbar (hidden by default)
    this.toolbar = document.createElement('div');
    this.toolbar.className = 'image-toolbar';
    this.toolbar.style.cssText = 'display:none;position:absolute;top:-36px;left:50%;transform:translateX(-50%);background:hsl(var(--card));border:1px solid hsl(var(--border));border-radius:8px;padding:2px;box-shadow:0 2px 8px rgba(0,0,0,0.12);z-index:20;white-space:nowrap;';

    const alignBtns = [
      { label: '◀', align: 'left', title: 'Align left' },
      { label: '▬', align: 'center', title: 'Center' },
      { label: '▶', align: 'right', title: 'Align right' },
    ];
    for (const btn of alignBtns) {
      const b = document.createElement('button');
      b.textContent = btn.label;
      b.title = btn.title;
      b.style.cssText = `padding:4px 8px;border:none;background:${node.attrs.align === btn.align ? 'hsl(var(--accent))' : 'transparent'};cursor:pointer;border-radius:4px;font-size:12px;color:hsl(var(--foreground));`;
      b.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const pos = this.getPos();
        if (pos != null) {
          const tr = this.view.state.tr.setNodeMarkup(pos, undefined, {
            ...this.node.attrs,
            align: btn.align,
          });
          this.view.dispatch(tr);
        }
        this.hideToolbar();
      });
      this.toolbar.appendChild(b);
    }

    // Size presets
    const sizes = ['25%', '50%', '75%', '100%'];
    const sep = document.createElement('span');
    sep.style.cssText = 'display:inline-block;width:1px;height:20px;background:hsl(var(--border));margin:0 2px;vertical-align:middle;';
    this.toolbar.appendChild(sep);
    for (const size of sizes) {
      const b = document.createElement('button');
      b.textContent = size;
      b.style.cssText = 'padding:4px 6px;border:none;background:transparent;cursor:pointer;border-radius:4px;font-size:11px;color:hsl(var(--muted-foreground));';
      b.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const pos = this.getPos();
        if (pos != null) {
          const tr = this.view.state.tr.setNodeMarkup(pos, undefined, {
            ...this.node.attrs,
            width: size,
          });
          this.view.dispatch(tr);
        }
        this.hideToolbar();
      });
      this.toolbar.appendChild(b);
    }

    const toolbarContainer = document.createElement('div');
    toolbarContainer.style.cssText = 'position:relative;display:inline-block;';
    toolbarContainer.appendChild(imgContainer);
    toolbarContainer.appendChild(this.toolbar);

    this.dom.appendChild(toolbarContainer);

    // Close toolbar on outside click
    document.addEventListener('click', this.handleOutsideClick);
  }

  private handleOutsideClick = (e: MouseEvent) => {
    if (!this.dom.contains(e.target as Node)) {
      this.hideToolbar();
    }
  };

  private showToolbar() {
    this.toolbar.style.display = 'block';
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
    this.img.style.outline = '2px solid hsl(var(--primary))';
    this.showToolbar();
  }

  deselectNode() {
    this.img.style.outline = 'none';
    this.hideToolbar();
  }

  destroy() {
    document.removeEventListener('click', this.handleOutsideClick);
  }

  stopEvent(event: Event) {
    // Stop click/mousedown from reaching ProseMirror so our NodeSelection handler works
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
