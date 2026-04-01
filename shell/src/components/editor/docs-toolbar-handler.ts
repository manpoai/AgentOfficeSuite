import { toggleMark, setBlockType, wrapIn, lift } from 'prosemirror-commands';
import { liftListItem, wrapInList } from 'prosemirror-schema-list';
import type { EditorView } from 'prosemirror-view';
import type { NodeType } from 'prosemirror-model';
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
          window.dispatchEvent(new CustomEvent('editor-comment', { detail: { text: selectedText } }));
          view.focus();
          break;
        }
      }
    },
  };
}
