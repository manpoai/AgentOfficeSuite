'use client';

import { useCallback, useEffect, useState } from 'react';
import type { EditorView } from 'prosemirror-view';
import type { EditorState } from 'prosemirror-state';
import { toggleMark, setBlockType, wrapIn } from 'prosemirror-commands';
import { undo, redo } from 'prosemirror-history';
import { wrapInList } from 'prosemirror-schema-list';
import { schema } from './schema';
import {
  Bold, Italic, Underline, Strikethrough, Code, Heading1, Heading2, Heading3,
  List, ListOrdered, Quote, Minus, Undo2, Redo2, Link as LinkIcon, Image as ImageIcon,
  Highlighter, RemoveFormatting
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface ToolbarProps {
  view: EditorView;
}

function isMarkActive(state: EditorState, type: any) {
  const { from, $from, to, empty } = state.selection;
  if (empty) return !!type.isInSet(state.storedMarks || $from.marks());
  return state.doc.rangeHasMark(from, to, type);
}

function isBlockActive(state: EditorState, nodeType: any, attrs?: Record<string, any>) {
  const { $from } = state.selection;
  for (let d = $from.depth; d > 0; d--) {
    const node = $from.node(d);
    if (node.type === nodeType) {
      if (!attrs) return true;
      return Object.entries(attrs).every(([k, v]) => node.attrs[k] === v);
    }
  }
  // Check the direct parent for block types like heading/paragraph
  const node = $from.parent;
  if (node.type === nodeType) {
    if (!attrs) return true;
    return Object.entries(attrs).every(([k, v]) => node.attrs[k] === v);
  }
  return false;
}

export function EditorToolbar({ view }: ToolbarProps) {
  const [, forceUpdate] = useState(0);

  // Re-render toolbar on state change via polling (safe — no dispatch patching)
  useEffect(() => {
    let raf: number;
    let lastState = view.state;
    const check = () => {
      if (view.state !== lastState) {
        lastState = view.state;
        forceUpdate(n => n + 1);
      }
      raf = requestAnimationFrame(check);
    };
    raf = requestAnimationFrame(check);
    return () => cancelAnimationFrame(raf);
  }, [view]);

  const cmd = useCallback((command: any) => {
    command(view.state, view.dispatch, view);
    view.focus();
  }, [view]);

  const insertLink = useCallback(() => {
    const href = prompt('链接地址:');
    if (!href) return;
    const { from, to, empty } = view.state.selection;
    if (empty) {
      const title = prompt('链接文本:') || href;
      const linkMark = schema.marks.link.create({ href });
      const textNode = schema.text(title, [linkMark]);
      view.dispatch(view.state.tr.replaceSelectionWith(textNode));
    } else {
      const linkMark = schema.marks.link.create({ href });
      view.dispatch(view.state.tr.addMark(from, to, linkMark));
    }
    view.focus();
  }, [view]);

  const insertImage = useCallback(() => {
    const src = prompt('图片地址:');
    if (!src) return;
    const alt = prompt('图片描述:') || '';
    const node = schema.nodes.image.create({ src, alt });
    view.dispatch(view.state.tr.replaceSelectionWith(node));
    view.focus();
  }, [view]);

  const state = view.state;

  return (
    <div className="flex flex-wrap items-center gap-0.5 px-2 py-1.5 border-b border-border bg-card overflow-x-auto">
      <ToolbarGroup>
        <ToolbarBtn icon={Undo2} onClick={() => cmd(undo)} title="撤销 (Cmd+Z)" />
        <ToolbarBtn icon={Redo2} onClick={() => cmd(redo)} title="重做 (Cmd+Shift+Z)" />
      </ToolbarGroup>

      <Separator />

      <ToolbarGroup>
        <ToolbarBtn icon={Heading1} onClick={() => cmd(setBlockType(schema.nodes.heading, { level: 1 }))} active={isBlockActive(state, schema.nodes.heading, { level: 1 })} title="标题1" />
        <ToolbarBtn icon={Heading2} onClick={() => cmd(setBlockType(schema.nodes.heading, { level: 2 }))} active={isBlockActive(state, schema.nodes.heading, { level: 2 })} title="标题2" />
        <ToolbarBtn icon={Heading3} onClick={() => cmd(setBlockType(schema.nodes.heading, { level: 3 }))} active={isBlockActive(state, schema.nodes.heading, { level: 3 })} title="标题3" />
      </ToolbarGroup>

      <Separator />

      <ToolbarGroup>
        <ToolbarBtn icon={Bold} onClick={() => cmd(toggleMark(schema.marks.strong))} active={isMarkActive(state, schema.marks.strong)} title="粗体 (Cmd+B)" />
        <ToolbarBtn icon={Italic} onClick={() => cmd(toggleMark(schema.marks.em))} active={isMarkActive(state, schema.marks.em)} title="斜体 (Cmd+I)" />
        <ToolbarBtn icon={Underline} onClick={() => cmd(toggleMark(schema.marks.underline))} active={isMarkActive(state, schema.marks.underline)} title="下划线 (Cmd+U)" />
        <ToolbarBtn icon={Strikethrough} onClick={() => cmd(toggleMark(schema.marks.strikethrough))} active={isMarkActive(state, schema.marks.strikethrough)} title="删除线" />
        <ToolbarBtn icon={Code} onClick={() => cmd(toggleMark(schema.marks.code))} active={isMarkActive(state, schema.marks.code)} title="行内代码 (Cmd+E)" />
        <ToolbarBtn icon={Highlighter} onClick={() => cmd(toggleMark(schema.marks.highlight))} active={isMarkActive(state, schema.marks.highlight)} title="高亮" />
      </ToolbarGroup>

      <Separator />

      <ToolbarGroup>
        <ToolbarBtn icon={List} onClick={() => cmd(wrapInList(schema.nodes.bullet_list))} title="无序列表" />
        <ToolbarBtn icon={ListOrdered} onClick={() => cmd(wrapInList(schema.nodes.ordered_list))} title="有序列表" />
        <ToolbarBtn icon={Quote} onClick={() => cmd(wrapIn(schema.nodes.blockquote))} active={isBlockActive(state, schema.nodes.blockquote)} title="引用" />
        <ToolbarBtn icon={Minus} onClick={() => {
          const hr = schema.nodes.horizontal_rule.create();
          const tr = view.state.tr.replaceSelectionWith(hr);
          view.dispatch(tr);
          view.focus();
        }} title="分隔线" />
      </ToolbarGroup>

      <Separator />

      <ToolbarGroup>
        <ToolbarBtn icon={LinkIcon} onClick={insertLink} title="插入链接" />
        <ToolbarBtn icon={ImageIcon} onClick={insertImage} title="插入图片" />
      </ToolbarGroup>
    </div>
  );
}

function ToolbarBtn({ icon: Icon, onClick, active, title }: {
  icon: any;
  onClick: () => void;
  active?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={cn(
        'p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors',
        active && 'bg-accent text-foreground'
      )}
    >
      <Icon className="h-4 w-4" />
    </button>
  );
}

function ToolbarGroup({ children }: { children: React.ReactNode }) {
  return <div className="flex items-center gap-0.5">{children}</div>;
}

function Separator() {
  return <div className="w-px h-5 bg-border mx-1" />;
}
