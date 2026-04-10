import { toggleMark, setBlockType, wrapIn, lift } from 'prosemirror-commands';
import { pickFile } from '@/lib/utils/pick-file';
import { liftListItem, wrapInList } from 'prosemirror-schema-list';
import type { EditorView } from 'prosemirror-view';
import type { NodeType } from 'prosemirror-model';
import * as docApi from '@/lib/api/documents';
import { showError } from '@/lib/utils/error';
import { getT } from '@/lib/i18n';
import {
  CellSelection, mergeCells, splitCell, toggleHeaderRow, toggleHeaderColumn,
  deleteRow, deleteColumn,
} from 'prosemirror-tables';
import type { ToolbarHandler, ToolbarState } from '@/components/shared/FloatingToolbar/types';
import { schema } from './schema';

const LIST_NODE_TYPES = new Set(['bullet_list', 'ordered_list', 'checkbox_list']);

function isMarkActive(view: EditorView, markName: string): boolean {
  const { state } = view;
  const { from, $from, to, empty } = state.selection;
  const markType = schema.marks[markName];
  if (!markType) return false;
  if (empty) return !!markType.isInSet(state.storedMarks || $from.marks());
  return state.doc.rangeHasMark(from, to, markType);
}

function isBlockActive(view: EditorView, nodeType: NodeType, attrs?: Record<string, any>): boolean {
  const { $from } = view.state.selection;
  const isListCheck = LIST_NODE_TYPES.has(nodeType.name);
  for (let d = $from.depth; d > 0; d--) {
    const node = $from.node(d);
    if (isListCheck && LIST_NODE_TYPES.has(node.type.name)) return node.type === nodeType;
    if (node.type === nodeType) {
      if (attrs) return Object.keys(attrs).every(k => node.attrs[k] === attrs[k]);
      return true;
    }
  }
  if ($from.parent.type === nodeType) {
    if (attrs) return Object.keys(attrs).every(k => $from.parent.attrs[k] === attrs[k]);
    return true;
  }
  return false;
}

function isInList(view: EditorView): boolean {
  const { $from } = view.state.selection;
  for (let d = $from.depth; d > 0; d--) {
    const t = $from.node(d).type;
    if (t === schema.nodes.bullet_list || t === schema.nodes.ordered_list || t === schema.nodes.checkbox_list) return true;
  }
  return false;
}

function liftOutOfWrapping(view: EditorView): boolean {
  let changed = false;
  for (let i = 0; i < 5; i++) {
    const { state } = view;
    const { $from } = state.selection;
    let lifted = false;
    for (let d = $from.depth; d > 0; d--) {
      const node = $from.node(d);
      if (node.type === schema.nodes.list_item || node.type === schema.nodes.checkbox_item) {
        if (liftListItem(node.type)(state, view.dispatch)) { lifted = true; changed = true; break; }
      }
    }
    if (!lifted) break;
  }
  if (lift(view.state, view.dispatch)) changed = true;
  return changed;
}

function convertNestedListContent(content: any, targetListType: NodeType): any {
  const targetItemType = targetListType === schema.nodes.checkbox_list
    ? schema.nodes.checkbox_item : schema.nodes.list_item;
  const LIST_TYPES = new Set([schema.nodes.bullet_list, schema.nodes.ordered_list, schema.nodes.checkbox_list]);
  const result: any[] = [];
  content.forEach((child: any) => {
    if (LIST_TYPES.has(child.type)) {
      const items: any[] = [];
      child.forEach((item: any) => {
        items.push(targetItemType.create(
          targetListType === schema.nodes.checkbox_list ? { checked: (item.attrs as any)?.checked ?? false } : null,
          convertNestedListContent(item.content, targetListType),
        ));
      });
      result.push(targetListType.create(child.attrs, items));
    } else {
      result.push(child);
    }
  });
  return result;
}

function convertParentListType(view: EditorView, targetListType: NodeType) {
  const { state } = view;
  const { $from } = state.selection;
  const targetItemType = targetListType === schema.nodes.checkbox_list
    ? schema.nodes.checkbox_item : schema.nodes.list_item;
  const LIST_TYPES = new Set([schema.nodes.bullet_list, schema.nodes.ordered_list, schema.nodes.checkbox_list]);
  for (let d = $from.depth; d > 0; d--) {
    const node = $from.node(d);
    if (LIST_TYPES.has(node.type)) {
      const listPos = $from.before(d);
      const convertedItems: any[] = [];
      node.forEach((item: any) => {
        const newItem = targetItemType.create(
          targetListType === schema.nodes.checkbox_list ? { checked: (item.attrs as any)?.checked ?? false } : null,
          convertNestedListContent(item.content, targetListType),
        );
        convertedItems.push(newItem);
      });
      const newList = targetListType.create(node.attrs, convertedItems);
      view.dispatch(state.tr.replaceWith(listPos, listPos + node.nodeSize, newList));
      return;
    }
  }
}

function doToggleList(view: EditorView, listType: NodeType) {
  if (isBlockActive(view, listType)) {
    for (let i = 0; i < 10; i++) {
      const { $from } = view.state.selection;
      let lifted = false;
      for (let d = $from.depth; d > 0; d--) {
        const node = $from.node(d);
        if (node.type === schema.nodes.list_item || node.type === schema.nodes.checkbox_item) {
          if (liftListItem(node.type)(view.state, view.dispatch)) lifted = true;
          break;
        }
      }
      if (!lifted) break;
    }
  } else if (isInList(view)) {
    convertParentListType(view, listType);
  } else {
    wrapInList(listType)(view.state, view.dispatch);
  }
  view.focus();
}

function doToggleBlockquote(view: EditorView) {
  if (isBlockActive(view, schema.nodes.blockquote)) {
    lift(view.state, view.dispatch);
  } else {
    if (isInList(view)) liftOutOfWrapping(view);
    wrapIn(schema.nodes.blockquote)(view.state, view.dispatch);
  }
  view.focus();
}

function doSetHeading(view: EditorView, level: number) {
  if (isBlockActive(view, schema.nodes.heading, { level })) {
    setBlockType(schema.nodes.paragraph)(view.state, view.dispatch);
  } else {
    setBlockType(schema.nodes.heading, { level })(view.state, view.dispatch);
  }
  view.focus();
}

export function createDocsTextHandler(view: EditorView): ToolbarHandler {
  return {
    getState(): ToolbarState {
      return {
        bold: isMarkActive(view, 'strong'),
        italic: isMarkActive(view, 'em'),
        strikethrough: isMarkActive(view, 'strikethrough'),
        underline: isMarkActive(view, 'underline'),
        highlight: isMarkActive(view, 'highlight'),
        code: isMarkActive(view, 'code'),
        blockquote: isBlockActive(view, schema.nodes.blockquote),
        heading1: isBlockActive(view, schema.nodes.heading, { level: 1 }),
        heading2: isBlockActive(view, schema.nodes.heading, { level: 2 }),
        heading3: isBlockActive(view, schema.nodes.heading, { level: 3 }),
        checkboxList: isBlockActive(view, schema.nodes.checkbox_list),
        orderedList: isBlockActive(view, schema.nodes.ordered_list),
        bulletList: isBlockActive(view, schema.nodes.bullet_list),
      };
    },

    execute(key: string, value?: unknown) {
      switch (key) {
        case 'bold': toggleMark(schema.marks.strong)(view.state, view.dispatch); view.focus(); break;
        case 'italic': toggleMark(schema.marks.em)(view.state, view.dispatch); view.focus(); break;
        case 'strikethrough': toggleMark(schema.marks.strikethrough)(view.state, view.dispatch); view.focus(); break;
        case 'underline': toggleMark(schema.marks.underline)(view.state, view.dispatch); view.focus(); break;
        case 'code': toggleMark(schema.marks.code)(view.state, view.dispatch); view.focus(); break;
        case 'highlight': {
          const { from, to } = view.state.selection;
          if (from === to) break;
          if (value) {
            let tr = view.state.tr.removeMark(from, to, schema.marks.highlight);
            tr = tr.addMark(from, to, schema.marks.highlight.create({ color: value as string }));
            view.dispatch(tr);
          } else {
            view.dispatch(view.state.tr.removeMark(from, to, schema.marks.highlight));
          }
          view.focus();
          break;
        }
        case 'blockquote': doToggleBlockquote(view); break;
        case 'heading1': doSetHeading(view, 1); break;
        case 'heading2': doSetHeading(view, 2); break;
        case 'heading3': doSetHeading(view, 3); break;
        case 'checkboxList': doToggleList(view, schema.nodes.checkbox_list); break;
        case 'orderedList': doToggleList(view, schema.nodes.ordered_list); break;
        case 'bulletList': doToggleList(view, schema.nodes.bullet_list); break;
        case 'link': {
          const { state, dispatch } = view;
          const { from, to } = state.selection;
          if (from === to) break;
          if (state.doc.rangeHasMark(from, to, schema.marks.link)) {
            dispatch(state.tr.removeMark(from, to, schema.marks.link));
          } else {
            const href = prompt('Enter URL:');
            if (href) dispatch(state.tr.addMark(from, to, schema.marks.link.create({ href })));
          }
          view.focus();
          break;
        }
        case 'comment': {
          const { from, to } = view.state.selection;
          if (from === to) break;
          const selectedText = view.state.doc.textBetween(from, to, ' ');
          // Collect heading path for context
          const headingPath: string[] = [];
          const $from = view.state.doc.resolve(from);
          for (let d = $from.depth; d > 0; d--) {
            const node = $from.node(d);
            if (node.type.name === 'heading') headingPath.unshift(node.textContent);
          }
          window.dispatchEvent(new CustomEvent('editor-comment', {
            detail: {
              text: selectedText,
              anchorType: 'text-range',
              anchorId: `textrange_${Date.now()}`,
              anchorMeta: {
                quote: selectedText,
                from,
                to,
                heading_path: headingPath.length > 0 ? headingPath : null,
              },
            },
          }));
          view.focus();
          break;
        }
      }
    },
  };
}

// ── Docs Table Toolbar Handler ──

function toggleMarkOnCellSelection(view: EditorView, markName: string) {
  const markType = schema.marks[markName];
  if (!markType) return;
  const sel = view.state.selection;
  const { tr } = view.state;

  if (sel instanceof CellSelection) {
    (sel as any).forEachCell((cell: any, pos: number) => {
      const from = pos + 1;
      const to = pos + cell.nodeSize - 1;
      if (tr.doc.rangeHasMark(from, to, markType)) {
        tr.removeMark(from, to, markType);
      } else {
        tr.addMark(from, to, markType.create());
      }
    });
  } else {
    const { from, to } = sel;
    if (tr.doc.rangeHasMark(from, to, markType)) {
      tr.removeMark(from, to, markType);
    } else {
      tr.addMark(from, to, markType.create());
    }
  }
  view.dispatch(tr);
}

export function createDocsTableHandler(view: EditorView): ToolbarHandler {
  return {
    getState(): ToolbarState {
      const sel = view.state.selection;
      const isCellSel = sel instanceof CellSelection;
      const canMerge = isCellSel && !!mergeCells(view.state);
      const canSplit = !!splitCell(view.state);

      return {
        bold: isMarkActive(view, 'strong'),
        italic: isMarkActive(view, 'em'),
        strikethrough: isMarkActive(view, 'strikethrough'),
        underline: isMarkActive(view, 'underline'),
        code: isMarkActive(view, 'code'),
        canMerge: canMerge,
        canSplit: canSplit,
      };
    },

    execute(key: string, value?: unknown) {
      switch (key) {
        case 'toggleHeaderRow':
          toggleHeaderRow(view.state, view.dispatch);
          break;
        case 'toggleHeaderCol':
          toggleHeaderColumn(view.state, view.dispatch);
          break;
        case 'mergeCells':
          mergeCells(view.state, view.dispatch);
          break;
        case 'splitCell':
          splitCell(view.state, view.dispatch);
          break;
        case 'cellBgColor': {
          const sel = view.state.selection;
          const { tr } = view.state;
          if (sel instanceof CellSelection) {
            (sel as any).forEachCell((_cell: any, pos: number) => {
              const node = tr.doc.nodeAt(pos);
              if (node) tr.setNodeMarkup(pos, undefined, { ...node.attrs, background: value || null });
            });
          } else {
            const { $from } = sel;
            for (let d = $from.depth; d > 0; d--) {
              const n = $from.node(d);
              if (n.type.name === 'table_cell' || n.type.name === 'table_header') {
                tr.setNodeMarkup($from.before(d), undefined, { ...n.attrs, background: value || null });
                break;
              }
            }
          }
          view.dispatch(tr);
          break;
        }
        case 'bold': toggleMarkOnCellSelection(view, 'strong'); break;
        case 'italic': toggleMarkOnCellSelection(view, 'em'); break;
        case 'strikethrough': toggleMarkOnCellSelection(view, 'strikethrough'); break;
        case 'underline': toggleMarkOnCellSelection(view, 'underline'); break;
        case 'highlight': {
          const sel = view.state.selection;
          const { tr } = view.state;
          const hlMark = schema.marks.highlight;
          if (!hlMark) break;
          if (sel instanceof CellSelection) {
            (sel as any).forEachCell((cell: any, pos: number) => {
              const from = pos + 1;
              const to = pos + cell.nodeSize - 1;
              tr.removeMark(from, to, hlMark);
              if (value) tr.addMark(from, to, hlMark.create({ color: value }));
            });
          } else {
            const { from, to } = sel;
            tr.removeMark(from, to, hlMark);
            if (value) tr.addMark(from, to, hlMark.create({ color: value }));
          }
          view.dispatch(tr);
          break;
        }
        case 'code': toggleMarkOnCellSelection(view, 'code'); break;
        case 'blockquote': {
          // Toggle blockquote — reuse the existing logic
          const bqType = schema.nodes.blockquote;
          if (isBlockActive(view, bqType)) {
            lift(view.state, view.dispatch);
          } else {
            wrapIn(bqType)(view.state, view.dispatch);
          }
          break;
        }
        case 'heading': {
          // value: '1', '2', '3', or 'paragraph'
          const level = Number(value);
          if (level >= 1 && level <= 3) {
            setBlockType(schema.nodes.heading, { level })(view.state, view.dispatch);
          } else {
            setBlockType(schema.nodes.paragraph)(view.state, view.dispatch);
          }
          break;
        }
        case 'list': {
          // value: 'checkbox', 'ordered', 'bullet'
          const listType = schema.nodes[value === 'checkbox' ? 'checkbox_list' : value === 'ordered' ? 'ordered_list' : 'bullet_list'];
          if (listType && isBlockActive(view, listType)) {
            liftListItem(schema.nodes.list_item || schema.nodes.checkbox_item)(view.state, view.dispatch);
          } else if (listType) {
            const itemType = value === 'checkbox' ? schema.nodes.checkbox_item : schema.nodes.list_item;
            wrapInList(listType)(view.state, view.dispatch);
          }
          break;
        }
        case 'comment': {
          const sel = view.state.selection;
          let text = '';
          if (sel instanceof CellSelection) {
            const parts: string[] = [];
            (sel as any).forEachCell((cell: any) => { parts.push(cell.textContent); });
            text = parts.join(' | ');
          } else {
            const { from, to } = sel;
            text = view.state.doc.textBetween(from, to, ' ');
          }
          if (text.length > 100) text = text.slice(0, 100) + '…';
          window.dispatchEvent(new CustomEvent('editor-comment', { detail: { text } }));
          break;
        }
        case 'deleteRow':
          deleteRow(view.state, view.dispatch);
          break;
        case 'deleteCol':
          deleteColumn(view.state, view.dispatch);
          break;
      }
      view.focus();
    },
  };
}

// ── Docs Image Toolbar Handler ──

export function createDocsImageHandler(view: EditorView, nodePos: number, getDocId?: () => string | undefined): ToolbarHandler {
  return {
    getState(): ToolbarState {
      const node = view.state.doc.nodeAt(nodePos);
      if (!node) return {};
      return {
        align: node.attrs.align || 'center',
      };
    },

    async execute(key: string, value?: unknown) {
      const node = view.state.doc.nodeAt(nodePos);
      if (!node) return;

      switch (key) {
        case 'alignLeft':
        case 'alignCenter':
        case 'alignRight':
        case 'alignFull':
        case 'alignFit': {
          const alignMap: Record<string, string> = {
            alignLeft: 'left', alignCenter: 'center', alignRight: 'right',
            alignFull: 'full', alignFit: 'fit',
          };
          const tr = view.state.tr.setNodeMarkup(nodePos, undefined, { ...node.attrs, align: alignMap[key] });
          view.dispatch(tr);
          break;
        }
        case 'replace': {
          const files = await pickFile({ accept: 'image/*' });
          const file = files[0];
          if (!file) break;
          const imageType = view.state.schema.nodes.image;
          const uploadId = crypto.randomUUID();
          // Mark as uploading
          const currentNode = view.state.doc.nodeAt(nodePos);
          if (currentNode) {
            view.dispatch(view.state.tr.setNodeMarkup(nodePos, undefined, { ...currentNode.attrs, uploading: uploadId }));
          }
          try {
            const result = await docApi.uploadFile(file, getDocId?.());
            let found = false;
            view.state.doc.descendants((n, nPos) => {
              if (found) return false;
              if (n.type === imageType && n.attrs.uploading === uploadId) {
                view.dispatch(view.state.tr.setNodeMarkup(nPos, undefined, { ...n.attrs, src: result.url, uploading: undefined }));
                found = true;
                return false;
              }
              return true;
            });
          } catch (e) {
            showError(getT()('errors.imageUploadFailed'), e);
            let found = false;
            view.state.doc.descendants((n, nPos) => {
              if (found) return false;
              if (n.type === imageType && n.attrs.uploading === uploadId) {
                view.dispatch(view.state.tr.setNodeMarkup(nPos, undefined, { ...n.attrs, uploading: undefined }));
                found = true;
                return false;
              }
              return true;
            });
          }
          break;
        }
        case 'download': {
          const a = document.createElement('a');
          a.href = node.attrs.src;
          a.download = node.attrs.alt || 'image';
          a.click();
          break;
        }
        case 'delete': {
          const tr = view.state.tr.delete(nodePos, nodePos + node.nodeSize);
          view.dispatch(tr);
          break;
        }
        case 'altText': {
          const alt = prompt('Alt text:', node.attrs.alt || '');
          if (alt !== null) {
            const tr = view.state.tr.setNodeMarkup(nodePos, undefined, { ...node.attrs, alt });
            view.dispatch(tr);
          }
          break;
        }
        case 'comment': {
          window.dispatchEvent(new CustomEvent('editor-comment', {
            detail: {
              text: node.attrs.alt || '',
              anchorType: 'image',
              anchorId: `image_${nodePos}`,
              anchorMeta: { alt_text: node.attrs.alt || null, image_url: node.attrs.src || null },
            },
          }));
          break;
        }
      }
      view.focus();
    },
  };
}
