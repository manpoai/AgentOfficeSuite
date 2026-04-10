/**
 * Custom ProseMirror NodeViews for rendering:
 * - math_block: KaTeX rendered LaTeX
 * - mermaid code_block: Mermaid diagrams as SVG
 */
import type { Node as PMNode } from 'prosemirror-model';
import { NodeSelection, Selection } from 'prosemirror-state';
import type { EditorView, NodeView } from 'prosemirror-view';
import DOMPurify from 'dompurify';
import { ContentLinkView } from './content-link-node';
import { DiagramEmbedView } from './diagram-embed-node';
import { pickFile } from '@/lib/utils/pick-file';
import { getT } from '@/lib/i18n';
import * as docApi from '@/lib/api/documents';
import { showError } from '@/lib/utils/error';

/** Lazy-load mermaid via CDN <script> tag (avoids webpack bundling issues). */
let mermaidPromise: Promise<any> | null = null;
function loadMermaid(): Promise<any> {
  if (mermaidPromise) return mermaidPromise;
  if ((window as any).mermaid) return Promise.resolve((window as any).mermaid);
  mermaidPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js';
    script.onload = () => {
      const m = (window as any).mermaid;
      if (m) resolve(m);
      else reject(new Error('Mermaid global not found after script load'));
    };
    script.onerror = () => reject(new Error('Failed to load mermaid from CDN'));
    document.head.appendChild(script);
  });
  return mermaidPromise;
}

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
      this.dom.innerHTML = `<span style="color: hsl(0 0% 60%); font-style: italic;">${getT()('editor.emptyMathBlock')}</span>`;
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
  private captionInput: HTMLInputElement | null = null;
  private captionContainer: HTMLElement | null = null;
  private resizing = false;

  constructor(private node: PMNode, private view: EditorView, private getPos: () => number | undefined, private getDocId?: () => string | undefined) {
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

    // Caption (editable div — wraps text, centered, shown when selected or has content)
    this.captionContainer = document.createElement('div');
    this.captionContainer.style.cssText = 'text-align:center;margin-top:4px;width:100%;';
    this.captionInput = document.createElement('div') as any;
    (this.captionInput as HTMLElement).contentEditable = 'true';
    (this.captionInput as HTMLElement).dataset.placeholder = 'Write a caption';
    (this.captionInput as HTMLElement).textContent = node.attrs.alt || '';
    (this.captionInput as HTMLElement).style.cssText = 'width:100%;box-sizing:border-box;text-align:center;font-size:13px;color:hsl(var(--muted-foreground, 0 0% 45%));background:transparent;border:none;outline:none;padding:4px 8px;user-select:text;-webkit-user-select:text;cursor:text;word-wrap:break-word;overflow-wrap:break-word;min-height:1.5em;';
    // Show placeholder when empty
    const updatePlaceholder = () => {
      const el = this.captionInput as unknown as HTMLElement;
      if (!el.textContent?.trim()) {
        el.style.color = 'hsl(var(--muted-foreground, 0 0% 45%) / 0.5)';
      } else {
        el.style.color = 'hsl(var(--muted-foreground, 0 0% 45%))';
      }
    };
    // Hide caption container if no content and not selected
    const hasCaptionContent = () => !!(node.attrs.alt?.trim());
    if (!hasCaptionContent()) this.captionContainer.style.display = 'none';
    (this.captionInput as HTMLElement).addEventListener('mousedown', (e) => {
      e.stopPropagation();
    });
    (this.captionInput as HTMLElement).addEventListener('dragstart', (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
    (this.captionInput as HTMLElement).addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        e.preventDefault();
        (this.captionInput as unknown as HTMLElement).blur();
      }
    });
    (this.captionInput as HTMLElement).addEventListener('input', updatePlaceholder);
    (this.captionInput as HTMLElement).addEventListener('blur', () => {
      const val = (this.captionInput as unknown as HTMLElement).textContent?.trim() || '';
      if (val !== (this.node.attrs.alt || '')) {
        const pos = this.getPos();
        if (pos != null) {
          const tr = this.view.state.tr.setNodeMarkup(pos, undefined, { ...this.node.attrs, alt: val });
          this.view.dispatch(tr);
        }
      }
      updatePlaceholder();
    });
    updatePlaceholder();
    this.captionContainer.appendChild(this.captionInput as unknown as HTMLElement);
    toolbarContainer.appendChild(this.captionContainer);

    this.dom.appendChild(toolbarContainer);

    // Update dimensions once image loads
    this.img.addEventListener('load', () => this.updateSizeLabel());

    document.addEventListener('click', this.handleOutsideClick);
  }

  private buildToolbar(): HTMLElement {
    const t = getT();
    const tb = document.createElement('div');
    tb.className = 'image-toolbar';
    tb.style.cssText = 'display:none;position:absolute;top:-44px;left:50%;transform:translateX(-50%);background:hsl(var(--card, 0 0% 100%));border:1px solid hsl(var(--border, 0 0% 90%));border-radius:8px;padding:4px;box-shadow:0 2px 8px rgba(0,0,0,0.12);z-index:20;white-space:nowrap;display:none;';

    const btnStyle = 'padding:6px 8px;border:none;background:transparent;cursor:pointer;border-radius:4px;font-size:13px;color:hsl(var(--foreground, 0 0% 9%));line-height:1;';
    const btnActiveStyle = 'padding:6px 8px;border:none;background:hsl(var(--accent, 0 0% 96%));cursor:pointer;border-radius:4px;font-size:13px;color:hsl(var(--foreground, 0 0% 9%));line-height:1;';

    // Layout/alignment buttons (matching Outline's 5-button layout)
    const layouts = [
      { svg: this.svgIcon('alignLeft'), align: 'left', title: t('editor.imageToolbar.alignLeft') },
      { svg: this.svgIcon('alignCenter'), align: 'center', title: t('editor.imageToolbar.center') },
      { svg: this.svgIcon('alignRight'), align: 'right', title: t('editor.imageToolbar.alignRight') },
      { svg: this.svgIcon('fullWidth'), align: 'full', title: t('editor.imageToolbar.fullWidth') },
      { svg: this.svgIcon('fitWidth'), align: 'fit', title: t('editor.imageToolbar.fitToPage') },
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

    // Action buttons (size display and link button removed per spec)
    const actions = [
      { svg: this.svgIcon('download'), title: t('editor.imageToolbar.download'), action: () => this.downloadImage() },
      { svg: this.svgIcon('replace'), title: t('editor.imageToolbar.replace'), action: () => this.replaceImage() },
      { svg: this.svgIcon('delete'), title: t('editor.imageToolbar.delete'), action: () => this.deleteImage() },
      { svg: this.svgIcon('caption'), title: t('editor.imageToolbar.altText'), action: () => this.editAltText() },
      { svg: this.svgIcon('comment'), title: t('editor.imageToolbar.comment'), action: () => this.addComment() },
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
      caption: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>',
      comment: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
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
    pickFile({ accept: 'image/*' }).then(async (files) => {
      const file = files[0];
      if (!file) return;
      const imageType = this.view.state.schema.nodes.image;
      const uploadId = crypto.randomUUID();

      // Mark the current node as uploading (keep original src for display)
      const initPos = this.getPos();
      if (initPos != null) {
        const tr = this.view.state.tr.setNodeMarkup(initPos, undefined, {
          ...this.node.attrs,
          uploading: uploadId,
        });
        this.view.dispatch(tr);
      }

      try {
        const result = await docApi.uploadFile(file, this.getDocId?.());
        // Locate node by uploadId (pos may have shifted during await)
        let found = false;
        this.view.state.doc.descendants((node, nodePos) => {
          if (found) return false;
          if (node.type === imageType && node.attrs.uploading === uploadId) {
            const tr = this.view.state.tr.setNodeMarkup(nodePos, undefined, {
              ...node.attrs,
              src: result.url,
              uploading: undefined,
            });
            this.view.dispatch(tr);
            found = true;
            return false;
          }
          return true;
        });
      } catch (e) {
        showError(getT()('errors.imageUploadFailed'), e);
        // Remove uploading marker, restore original display
        let found = false;
        this.view.state.doc.descendants((node, nodePos) => {
          if (found) return false;
          if (node.type === imageType && node.attrs.uploading === uploadId) {
            const tr = this.view.state.tr.setNodeMarkup(nodePos, undefined, {
              ...node.attrs,
              uploading: undefined,
            });
            this.view.dispatch(tr);
            found = true;
            return false;
          }
          return true;
        });
      }
    });
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

  private addComment() {
    const text = this.node.attrs.alt || '[image]';
    window.dispatchEvent(new CustomEvent('editor-comment', { detail: { text } }));
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
    // Reset to default centered position
    this.toolbar.style.left = '50%';
    this.toolbar.style.transform = 'translateX(-50%)';
    this.updateSizeLabel();
    // Clamp toolbar within viewport after render
    requestAnimationFrame(() => {
      const tbRect = this.toolbar.getBoundingClientRect();
      if (tbRect.left < 8) {
        // Shift right so toolbar starts at left edge + padding
        const parentRect = this.toolbar.offsetParent?.getBoundingClientRect();
        if (parentRect) {
          this.toolbar.style.left = `${8 - parentRect.left}px`;
          this.toolbar.style.transform = 'none';
        }
      } else if (tbRect.right > window.innerWidth - 8) {
        const parentRect = this.toolbar.offsetParent?.getBoundingClientRect();
        if (parentRect) {
          this.toolbar.style.left = `${window.innerWidth - 8 - tbRect.width - parentRect.left}px`;
          this.toolbar.style.transform = 'none';
        }
      }
    });
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
    if (this.captionInput && document.activeElement !== (this.captionInput as unknown as HTMLElement)) {
      (this.captionInput as unknown as HTMLElement).textContent = node.attrs.alt || '';
      // Show caption if has content, hide if empty and not selected
      const hasContent = !!(node.attrs.alt?.trim());
      const isSelected = this.dom.classList.contains('image-selected');
      if (this.captionContainer) this.captionContainer.style.display = (hasContent || isSelected) ? 'block' : 'none';
    }
    return true;
  }

  selectNode() {
    this.dom.classList.add('image-selected');
    // Override ProseMirror's default selectednode outline/background with inline styles
    this.dom.style.outline = 'none';
    this.dom.style.background = 'transparent';
    this.img.style.outline = '2px solid hsl(var(--primary, 220 90% 56%))';
    this.img.style.outlineOffset = '2px';
    // Use unified React toolbar instead of vanilla DOM toolbar
    this.emitImageToolbar(true);
    if (this.captionContainer) this.captionContainer.style.display = 'block';
    if (this.captionInput) {
      (this.captionInput as unknown as HTMLElement).textContent = this.node.attrs.alt || '';
    }
    // Clear any native browser selection to prevent blue overlay
    window.getSelection()?.removeAllRanges();
  }

  deselectNode() {
    this.dom.classList.remove('image-selected');
    this.dom.style.outline = '';
    this.dom.style.background = '';
    this.img.style.outline = 'none';
    this.img.style.outlineOffset = '';
    this.emitImageToolbar(false);
    // Hide caption if no content
    const hasContent = !!(this.node.attrs.alt?.trim());
    if (this.captionContainer) this.captionContainer.style.display = hasContent ? 'block' : 'none';
  }

  private emitImageToolbar(show: boolean) {
    const editorMount = this.view.dom.parentElement;
    if (!editorMount) return;
    if (show) {
      const imgRect = this.img.getBoundingClientRect();
      const pos = this.getPos();
      editorMount.dispatchEvent(new CustomEvent('image-toolbar', {
        detail: {
          anchor: { top: imgRect.top, left: imgRect.left, width: imgRect.width },
          nodePos: pos,
          view: this.view,
        },
      }));
    } else {
      editorMount.dispatchEvent(new CustomEvent('image-toolbar', { detail: null }));
    }
  }

  destroy() {
    document.removeEventListener('click', this.handleOutsideClick);
  }

  stopEvent(event: Event) {
    // Allow mousedown on caption input for text selection
    if (event.type === 'mousedown' && event.target === this.captionInput) {
      return false;
    }
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
  private checkbox: HTMLSpanElement;

  constructor(private node: PMNode, private view: EditorView, private getPos: () => number | undefined) {
    this.dom = document.createElement('li');
    this.dom.className = 'checkbox-item';
    this.dom.dataset.checked = node.attrs.checked ? 'true' : 'false';

    // Use a <span> instead of <input> to avoid native checkbox toggle conflicts with ProseMirror
    this.checkbox = document.createElement('span');
    this.checkbox.setAttribute('role', 'checkbox');
    this.checkbox.setAttribute('aria-checked', node.attrs.checked ? 'true' : 'false');
    this.checkbox.contentEditable = 'false';
    this.updateCheckboxStyle(node.attrs.checked);
    this.checkbox.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const pos = this.getPos();
      if (pos == null) return;
      const currentNode = this.view.state.doc.nodeAt(pos);
      if (!currentNode || currentNode.type.name !== 'checkbox_item') return;
      const newChecked = !currentNode.attrs.checked;
      const tr = this.view.state.tr.setNodeMarkup(pos, undefined, {
        ...currentNode.attrs,
        checked: newChecked,
      });
      this.view.dispatch(tr);
    });

    this.dom.style.cssText = 'display: flex; align-items: flex-start; list-style: none;';
    this.dom.appendChild(this.checkbox);

    this.contentDOM = document.createElement('div');
    this.contentDOM.style.cssText = 'flex: 1; min-width: 0;';
    this.dom.appendChild(this.contentDOM);
  }

  private updateCheckboxStyle(checked: boolean) {
    const accentColor = 'hsl(var(--sidebar-primary, 228 80% 50%))';
    if (checked) {
      this.checkbox.style.cssText = `display: inline-flex; align-items: center; justify-content: center; margin: 0.3em 0.5rem 0 0; cursor: pointer; flex-shrink: 0; width: 16px; height: 16px; border-radius: 3px; background: ${accentColor}; border: none; user-select: none;`;
      this.checkbox.innerHTML = '<svg width="10" height="10" viewBox="0 0 10 10" fill="none" style="display:block"><path d="M1.5 5L4 7.5L8.5 2.5" stroke="white" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    } else {
      this.checkbox.style.cssText = `display: inline-block; margin: 0.3em 0.5rem 0 0; cursor: pointer; flex-shrink: 0; width: 16px; height: 16px; border-radius: 3px; border: 2px solid hsl(var(--muted-foreground, 0 0% 45%)); background: transparent; user-select: none; box-sizing: border-box;`;
      this.checkbox.innerHTML = '';
    }
  }

  update(node: PMNode) {
    if (node.type.name !== 'checkbox_item') return false;
    this.node = node;
    this.dom.dataset.checked = node.attrs.checked ? 'true' : 'false';
    this.checkbox.setAttribute('aria-checked', node.attrs.checked ? 'true' : 'false');
    this.updateCheckboxStyle(node.attrs.checked);
    return true;
  }

  stopEvent(event: Event) {
    return event.target === this.checkbox || this.checkbox.contains(event.target as Node);
  }
}

/**
 * Mermaid code block NodeView — renders mermaid diagrams as SVG.
 * Shows rendered diagram when not focused; shows editable code when focused.
 */
class MermaidBlockView implements NodeView {
  dom: HTMLElement;
  contentDOM: HTMLElement;
  private preview: HTMLElement;
  private codeWrap: HTMLElement;
  private focused = false;
  private renderTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private node: PMNode, private view: EditorView, private getPos: () => number | undefined) {
    this.dom = document.createElement('div');
    this.dom.className = 'mermaid-block';
    this.dom.style.cssText = 'position: relative; margin: 1em 0; border: 1px solid hsl(var(--border)); border-radius: 8px; overflow: hidden;';

    // Label bar with toggle button
    const label = document.createElement('div');
    label.contentEditable = 'false';
    label.style.cssText = 'font-size: 11px; color: hsl(var(--muted-foreground)); padding: 4px 12px; background: hsl(var(--muted)); border-bottom: 1px solid hsl(var(--border)); user-select: none; display: flex; align-items: center; justify-content: space-between;';
    const labelText = document.createElement('span');
    labelText.textContent = 'Mermaid';
    label.appendChild(labelText);
    const toggleBtn = document.createElement('button');
    toggleBtn.style.cssText = 'border: none; background: transparent; cursor: pointer; padding: 2px 6px; border-radius: 4px; font-size: 11px; color: hsl(var(--muted-foreground)); display: flex; align-items: center; gap: 4px;';
    toggleBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg> ${getT()('common.edit')}`;
    toggleBtn.addEventListener('mouseenter', () => { toggleBtn.style.background = 'hsl(var(--accent))'; });
    toggleBtn.addEventListener('mouseleave', () => { toggleBtn.style.background = 'transparent'; });
    toggleBtn.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      console.log('[Mermaid] mousedown on toggle');
    });
    toggleBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      console.log('[Mermaid] click on toggle, focused:', this.focused);
      if (this.focused) {
        this.exitEditMode();
        toggleBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg> ${getT()('common.edit')}`;
      } else {
        this.enterEditMode();
        toggleBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg> ${getT()('editor.preview')}`;
      }
    });
    label.appendChild(toggleBtn);
    this.dom.appendChild(label);

    // Code area (editable)
    this.codeWrap = document.createElement('pre');
    this.codeWrap.style.cssText = 'margin: 0; padding: 12px; font-size: 13px; font-family: monospace; white-space: pre-wrap; display: none;';
    this.contentDOM = document.createElement('code');
    this.codeWrap.appendChild(this.contentDOM);
    this.dom.appendChild(this.codeWrap);

    // Preview area
    this.preview = document.createElement('div');
    this.preview.contentEditable = 'false';
    this.preview.style.cssText = 'padding: 16px; display: flex; justify-content: center; align-items: center; min-height: 60px; cursor: pointer;';
    this.preview.addEventListener('click', () => {
      this.enterEditMode();
    });
    this.dom.appendChild(this.preview);

    this.renderMermaid();
  }

  private enterEditMode() {
    this.focused = true;
    this.codeWrap.style.display = 'block';
    this.preview.style.display = 'none';
    // Focus the code
    const pos = this.getPos();
    if (pos != null) {
      try {
        const clampedPos = Math.min(pos + 1, this.view.state.doc.content.size);
        const $pos = this.view.state.doc.resolve(clampedPos);
        const sel = Selection.near($pos);
        const tr = this.view.state.tr.setSelection(sel);
        this.view.dispatch(tr);
        this.view.focus();
      } catch { /* ignore selection errors at document boundaries */ }
    }
  }

  private exitEditMode() {
    this.focused = false;
    this.codeWrap.style.display = 'none';
    this.preview.style.display = 'flex';
    this.renderMermaid();
  }

  private async renderMermaid() {
    const code = this.node.textContent.trim();
    if (!code) {
      this.preview.innerHTML = `<span style="color: hsl(var(--muted-foreground)); font-style: italic;">${getT()('editor.emptyMermaidDiagram')}</span>`;
      return;
    }

    try {
      // Load mermaid from CDN to avoid bundler issues
      const mermaid = await loadMermaid();
      mermaid.initialize({
        startOnLoad: false,
        theme: document.documentElement.classList.contains('dark') ? 'dark' : 'default',
        securityLevel: 'loose',
      });
      const id = `mermaid-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const { svg } = await mermaid.render(id, code);
      this.preview.innerHTML = DOMPurify.sanitize(svg, { USE_PROFILES: { svg: true, svgFilters: true } });
      // Constrain SVG to its natural size — don't stretch to fill container
      const svgEl = this.preview.querySelector('svg');
      if (svgEl) {
        // Use the intrinsic dimensions from viewBox or width/height attributes
        const vb = svgEl.getAttribute('viewBox');
        const intrinsicW = svgEl.getAttribute('width');
        if (vb) {
          const parts = vb.split(/[\s,]+/);
          const vbW = parseFloat(parts[2]);
          const vbH = parseFloat(parts[3]);
          if (vbW && vbH) {
            // Set width to the smaller of viewBox width or container width
            svgEl.style.width = `${Math.min(vbW, 800)}px`;
            svgEl.style.height = 'auto';
            svgEl.style.maxWidth = '100%';
            svgEl.style.maxHeight = '600px';
          }
        } else if (intrinsicW) {
          const w = parseFloat(intrinsicW);
          if (w) {
            svgEl.style.width = `${Math.min(w, 800)}px`;
            svgEl.style.height = 'auto';
            svgEl.style.maxWidth = '100%';
          }
        }
      }
    } catch (err) {
      const errMsg = document.createElement('span');
      errMsg.textContent = (err as Error).message || getT()('editor.mermaidRenderError');
      this.preview.innerHTML = `<pre style="color: hsl(var(--destructive)); font-size: 12px; margin: 0;"></pre>`;
      this.preview.querySelector('pre')!.appendChild(errMsg);
    }
  }

  update(node: PMNode) {
    if (node.type.name !== 'code_block' || node.attrs.language !== 'mermaid') return false;
    this.node = node;
    if (!this.focused) {
      // Debounce re-render
      if (this.renderTimer) clearTimeout(this.renderTimer);
      this.renderTimer = setTimeout(() => this.renderMermaid(), 300);
    }
    return true;
  }

  selectNode() {
    // Don't auto-enter edit mode on node selection — user clicks Edit button
  }

  deselectNode() {
    // Only exit edit mode if we're not in the middle of entering it
    // (enterEditMode dispatches a TextSelection which triggers deselectNode)
    if (this.focused) {
      // Check if cursor is inside our code block — if so, stay in edit mode
      const pos = this.getPos();
      if (pos != null) {
        const { from } = this.view.state.selection;
        const end = pos + this.node.nodeSize;
        if (from > pos && from < end) return; // cursor inside, stay editing
      }
      this.exitEditMode();
    }
  }

  stopEvent(event: Event) {
    // Prevent ProseMirror from handling events on the label bar (toggle button)
    // and the preview area — only let ProseMirror handle events in the code editing area
    const target = event.target as HTMLElement;
    if (this.contentDOM.contains(target)) return false;
    return true;
  }

  ignoreMutation() {
    return true;
  }

  destroy() {
    if (this.renderTimer) clearTimeout(this.renderTimer);
  }
}

/**
 * Factory function to create nodeViews map for ProseMirror EditorView.
 */
export function createNodeViews(getDocId?: () => string | undefined) {
  return {
    math_block: (node: PMNode, view: EditorView, getPos: () => number | undefined) =>
      new MathBlockView(node, view, getPos),
    image: (node: PMNode, view: EditorView, getPos: () => number | undefined) =>
      new ImageNodeView(node, view, getPos, getDocId),
    checkbox_item: (node: PMNode, view: EditorView, getPos: () => number | undefined) =>
      new CheckboxItemView(node, view, getPos),
    content_link: (node: PMNode, view: EditorView, getPos: () => number | undefined) =>
      new ContentLinkView(node, view, getPos),
    diagram_embed: (node: PMNode, view: EditorView, getPos: () => number | undefined) =>
      new DiagramEmbedView(node, view, getPos),
    code_block: (node: PMNode, view: EditorView, getPos: () => number | undefined) => {
      // Only use MermaidBlockView for mermaid code blocks
      if (node.attrs.language === 'mermaid') {
        return new MermaidBlockView(node, view, getPos);
      }
      // Default code block: use standard DOM rendering (pass-through)
      const dom = document.createElement('pre');
      const contentDOM = document.createElement('code');
      const lang = node.attrs.language;
      if (lang) contentDOM.className = `language-${lang}`;
      dom.appendChild(contentDOM);
      return { dom, contentDOM, update(n: PMNode) {
        if (n.type.name !== 'code_block') return false;
        const newLang = n.attrs.language;
        if (newLang === 'mermaid') return false; // Force recreate as MermaidBlockView
        contentDOM.className = newLang ? `language-${newLang}` : '';
        return true;
      }};
    },
  };
}
