import {
  Bold, Italic, Strikethrough, Underline, Highlighter, Code2, Quote,
  Heading1, Heading2, Heading3, ListTodo, ListOrdered, List,
  Link, MessageSquare,
} from 'lucide-react';
import type { ToolbarItem } from './types';
import { createElement } from 'react';

const icon = (Icon: any) => createElement(Icon, { className: 'h-4 w-4' });

const HIGHLIGHT_COLORS = [
  { name: 'Yellow', value: 'hsl(50 90% 60% / 0.3)' },
  { name: 'Orange', value: 'hsl(25 90% 60% / 0.3)' },
  { name: 'Red', value: 'hsl(0 80% 60% / 0.3)' },
  { name: 'Pink', value: 'hsl(330 80% 65% / 0.3)' },
  { name: 'Purple', value: 'hsl(270 60% 60% / 0.3)' },
  { name: 'Blue', value: 'hsl(210 70% 55% / 0.3)' },
  { name: 'Green', value: 'hsl(142 50% 50% / 0.3)' },
];

export const DOCS_TEXT_ITEMS: ToolbarItem[] = [
  { key: 'bold', type: 'toggle', icon: icon(Bold), label: 'Bold (Cmd+B)', group: 'inline' },
  { key: 'italic', type: 'toggle', icon: icon(Italic), label: 'Italic (Cmd+I)', group: 'inline' },
  { key: 'strikethrough', type: 'toggle', icon: icon(Strikethrough), label: 'Strikethrough', group: 'inline' },
  { key: 'underline', type: 'toggle', icon: icon(Underline), label: 'Underline (Cmd+U)', group: 'inline' },
  { key: 'highlight', type: 'color', icon: icon(Highlighter), label: 'Highlight', group: 'style', colors: HIGHLIGHT_COLORS, colorClearable: true },
  { key: 'code', type: 'toggle', icon: icon(Code2), label: 'Inline code', group: 'style' },
  { key: 'blockquote', type: 'toggle', icon: icon(Quote), label: 'Quote', group: 'style' },
  { key: 'heading1', type: 'toggle', icon: icon(Heading1), label: 'Heading 1', group: 'heading' },
  { key: 'heading2', type: 'toggle', icon: icon(Heading2), label: 'Heading 2', group: 'heading' },
  { key: 'heading3', type: 'toggle', icon: icon(Heading3), label: 'Heading 3', group: 'heading' },
  { key: 'checkboxList', type: 'toggle', icon: icon(ListTodo), label: 'Checkbox list', group: 'list' },
  { key: 'orderedList', type: 'toggle', icon: icon(ListOrdered), label: 'Ordered list', group: 'list' },
  { key: 'bulletList', type: 'toggle', icon: icon(List), label: 'Bullet list', group: 'list' },
  { key: 'link', type: 'action', icon: icon(Link), label: 'Link', group: 'insert' },
  { key: 'comment', type: 'action', icon: icon(MessageSquare), label: 'Comment', group: 'insert' },
];
