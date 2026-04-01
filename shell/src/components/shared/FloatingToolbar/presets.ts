import {
  Bold, Italic, Strikethrough, Underline, Highlighter, Code2, Quote,
  Heading1, Heading2, Heading3, ListTodo, ListOrdered, List,
  Link, MessageSquare, Type, Palette,
  AlignLeft, AlignCenter, AlignRight, AlignJustify,
  Paintbrush, Square, Copy, Trash2, Layers, ImageIcon,
  Minus, ArrowRight,
  TableProperties, Columns, Merge, Split, Download, Pencil,
  Maximize, Minimize,
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

// ── Docs Table Toolbar ──

const CELL_BG_COLORS = [
  { name: 'None', value: '' },
  { name: 'Yellow', value: '#fef3c7' },
  { name: 'Blue', value: '#dbeafe' },
  { name: 'Green', value: '#d1fae5' },
  { name: 'Pink', value: '#fce7f3' },
  { name: 'Purple', value: '#ede9fe' },
  { name: 'Orange', value: '#ffedd5' },
  { name: 'Gray', value: '#f3f4f6' },
];

export const DOCS_TABLE_ITEMS: ToolbarItem[] = [
  { key: 'toggleHeaderRow', type: 'action', icon: icon(TableProperties), label: 'Toggle header row', group: 'table' },
  { key: 'toggleHeaderCol', type: 'action', icon: icon(Columns), label: 'Toggle header column', group: 'table' },
  { key: 'mergeCells', type: 'action', icon: icon(Merge), label: 'Merge cells', group: 'table' },
  { key: 'splitCell', type: 'action', icon: icon(Split), label: 'Split cell', group: 'table' },
  { key: 'cellBgColor', type: 'color', icon: icon(Paintbrush), label: 'Cell background', group: 'cellStyle', colors: CELL_BG_COLORS, colorClearable: true },
  { key: 'bold', type: 'toggle', icon: icon(Bold), label: 'Bold', group: 'format' },
  { key: 'italic', type: 'toggle', icon: icon(Italic), label: 'Italic', group: 'format' },
  { key: 'strikethrough', type: 'toggle', icon: icon(Strikethrough), label: 'Strikethrough', group: 'format' },
  { key: 'underline', type: 'toggle', icon: icon(Underline), label: 'Underline', group: 'format' },
  { key: 'highlight', type: 'color', icon: icon(Highlighter), label: 'Highlight', group: 'style', colors: HIGHLIGHT_COLORS, colorClearable: true },
  { key: 'code', type: 'toggle', icon: icon(Code2), label: 'Code', group: 'style' },
  { key: 'blockquote', type: 'toggle', icon: icon(Quote), label: 'Quote', group: 'style' },
  { key: 'heading', type: 'dropdown', icon: icon(Heading1), label: 'Heading', group: 'block',
    options: [
      { value: '1', label: 'H1', icon: icon(Heading1) },
      { value: '2', label: 'H2', icon: icon(Heading2) },
      { value: '3', label: 'H3', icon: icon(Heading3) },
      { value: 'paragraph', label: 'Paragraph', icon: icon(Type) },
    ]},
  { key: 'list', type: 'dropdown', icon: icon(List), label: 'List', group: 'block',
    options: [
      { value: 'checkbox', label: 'Checkbox', icon: icon(ListTodo) },
      { value: 'ordered', label: 'Ordered', icon: icon(ListOrdered) },
      { value: 'bullet', label: 'Bullet', icon: icon(List) },
    ]},
  { key: 'comment', type: 'action', icon: icon(MessageSquare), label: 'Comment', group: 'insert' },
  { key: 'deleteRow', type: 'action', icon: icon(Trash2), label: 'Delete row', group: 'delete' },
  { key: 'deleteCol', type: 'action', icon: icon(Trash2), label: 'Delete column', group: 'delete' },
];

// ── Docs Image Toolbar ──

export const DOCS_IMAGE_ITEMS: ToolbarItem[] = [
  { key: 'alignLeft', type: 'action', icon: icon(AlignLeft), label: 'Left', group: 'align' },
  { key: 'alignCenter', type: 'action', icon: icon(AlignCenter), label: 'Center', group: 'align' },
  { key: 'alignRight', type: 'action', icon: icon(AlignRight), label: 'Right', group: 'align' },
  { key: 'alignFull', type: 'action', icon: icon(Maximize), label: 'Full width', group: 'align' },
  { key: 'alignFit', type: 'action', icon: icon(Minimize), label: 'Fit width', group: 'align' },
  { key: 'replace', type: 'action', icon: icon(ImageIcon), label: 'Replace', group: 'action' },
  { key: 'download', type: 'action', icon: icon(Download), label: 'Download', group: 'action' },
  { key: 'delete', type: 'action', icon: icon(Trash2), label: 'Delete', group: 'action' },
  { key: 'altText', type: 'action', icon: icon(Pencil), label: 'Alt text', group: 'action' },
  { key: 'comment', type: 'action', icon: icon(MessageSquare), label: 'Comment', group: 'action' },
];

// ── PPT Text Toolbar ──

const TEXT_COLORS = [
  { name: 'Black', value: '#1f2937' },
  { name: 'Red', value: '#ef4444' },
  { name: 'Orange', value: '#f97316' },
  { name: 'Yellow', value: '#eab308' },
  { name: 'Green', value: '#22c55e' },
  { name: 'Blue', value: '#3b82f6' },
  { name: 'Purple', value: '#a855f7' },
  { name: 'Pink', value: '#ec4899' },
];

const FONT_FAMILIES = [
  { value: 'Inter, system-ui, sans-serif', label: 'Inter' },
  { value: 'Arial, Helvetica, sans-serif', label: 'Arial' },
  { value: 'Georgia, serif', label: 'Georgia' },
  { value: '"Times New Roman", Times, serif', label: 'Times New Roman' },
  { value: '"Courier New", Courier, monospace', label: 'Courier New' },
  { value: 'Verdana, Geneva, sans-serif', label: 'Verdana' },
  { value: '"Trebuchet MS", sans-serif', label: 'Trebuchet MS' },
  { value: '"Noto Sans SC", "Source Han Sans SC", sans-serif', label: '思源黑体' },
  { value: '"Noto Serif SC", "Source Han Serif SC", serif', label: '思源宋体' },
  { value: '"Microsoft YaHei", sans-serif', label: '微软雅黑' },
  { value: '"PingFang SC", sans-serif', label: '苹果苹方' },
];

const FONT_SIZES = [10, 12, 14, 16, 18, 20, 24, 28, 32, 36, 42, 48, 56, 64, 72, 96].map(
  s => ({ value: String(s), label: String(s) }),
);

export const PPT_TEXT_ITEMS: ToolbarItem[] = [
  { key: 'fontFamily', type: 'dropdown', icon: null, label: 'Font', group: 'font', options: FONT_FAMILIES },
  { key: 'fontSize', type: 'dropdown', icon: null, label: 'Size', group: 'font', options: FONT_SIZES },
  { key: 'bold', type: 'toggle', icon: icon(Bold), label: 'Bold', group: 'format' },
  { key: 'italic', type: 'toggle', icon: icon(Italic), label: 'Italic', group: 'format' },
  { key: 'underline', type: 'toggle', icon: icon(Underline), label: 'Underline', group: 'format' },
  { key: 'strikethrough', type: 'toggle', icon: icon(Strikethrough), label: 'Strikethrough', group: 'format' },
  { key: 'align', type: 'dropdown', icon: icon(AlignLeft), label: 'Alignment', group: 'align',
    options: [
      { value: 'left', label: 'Left', icon: icon(AlignLeft) },
      { value: 'center', label: 'Center', icon: icon(AlignCenter) },
      { value: 'right', label: 'Right', icon: icon(AlignRight) },
    ]},
  { key: 'textColor', type: 'color', icon: icon(Palette), label: 'Text color', group: 'color', colors: TEXT_COLORS },
];

// ── PPT Image Toolbar ──

export const PPT_IMAGE_ITEMS: ToolbarItem[] = [
  { key: 'replace', type: 'action', icon: icon(ImageIcon), label: 'Replace', group: 'action' },
  { key: 'copy', type: 'action', icon: icon(Copy), label: 'Copy', group: 'action' },
  { key: 'delete', type: 'action', icon: icon(Trash2), label: 'Delete', group: 'action' },
  { key: 'zOrder', type: 'dropdown', icon: icon(Layers), label: '层级', group: 'action',
    options: [
      { value: 'front', label: '置顶' },
      { value: 'back', label: '置底' },
    ]},
];

// ── PPT Shape Toolbar ──

const PPT_FILL_COLORS = [
  { name: 'White', value: '#ffffff' },
  { name: 'Blue', value: '#dbeafe' },
  { name: 'Green', value: '#dcfce7' },
  { name: 'Yellow', value: '#fef9c3' },
  { name: 'Red', value: '#fee2e2' },
  { name: 'Purple', value: '#f3e8ff' },
  { name: 'Orange', value: '#ffedd5' },
  { name: 'Gray', value: '#f3f4f6' },
  { name: 'Transparent', value: 'transparent' },
];

const PPT_BORDER_COLORS = [
  { name: 'Dark', value: '#374151' },
  { name: 'Blue', value: '#3b82f6' },
  { name: 'Green', value: '#22c55e' },
  { name: 'Red', value: '#ef4444' },
  { name: 'Purple', value: '#a855f7' },
  { name: 'Orange', value: '#f97316' },
  { name: 'Gray', value: '#94a3b8' },
  { name: 'Transparent', value: 'transparent' },
];

const BORDER_WIDTH_OPTIONS = [0, 1, 2, 3, 4, 6].map(
  w => ({ value: String(w), label: w === 0 ? 'None' : String(w) }),
);

const BORDER_STYLE_OPTIONS = [
  { value: 'solid', label: '实线' },
  { value: 'dashed', label: '虚线' },
  { value: 'dotted', label: '点线' },
];

const CORNER_RADIUS_OPTIONS = [0, 4, 8, 12, 16, 24].map(
  r => ({ value: String(r), label: r === 0 ? 'None' : `${r}px` }),
);

export const PPT_SHAPE_ITEMS: ToolbarItem[] = [
  { key: 'shapeSelect', type: 'custom', icon: icon(Square), label: '形状', group: 'shape' },
  { key: 'fillColor', type: 'color', icon: icon(Paintbrush), label: '填充色', group: 'color', colors: PPT_FILL_COLORS, colorClearable: true },
  { key: 'borderColor', type: 'color', icon: icon(Square), label: '边框色', group: 'border', colors: PPT_BORDER_COLORS, colorClearable: true },
  { key: 'borderWidth', type: 'dropdown', icon: icon(Minus), label: '边框宽度', group: 'border', options: BORDER_WIDTH_OPTIONS },
  { key: 'borderStyle', type: 'dropdown', icon: null, label: '边框样式', group: 'border', options: BORDER_STYLE_OPTIONS },
  { key: 'textColor', type: 'color', icon: icon(Palette), label: '文字颜色', group: 'color', colors: TEXT_COLORS },
  { key: 'cornerRadius', type: 'dropdown', icon: null, label: '圆角', group: 'style', options: CORNER_RADIUS_OPTIONS },
  { key: 'copy', type: 'action', icon: icon(Copy), label: '复制', group: 'action' },
  { key: 'delete', type: 'action', icon: icon(Trash2), label: '删除', group: 'action' },
  { key: 'zOrder', type: 'dropdown', icon: icon(Layers), label: '层级', group: 'action',
    options: [
      { value: 'front', label: '置顶' },
      { value: 'back', label: '置底' },
    ]},
];

// ── Diagram Toolbar ──

const DIAGRAM_FILL_COLORS = [
  { name: 'White', value: '#ffffff' },
  { name: 'Blue', value: '#dbeafe' },
  { name: 'Green', value: '#dcfce7' },
  { name: 'Yellow', value: '#fef9c3' },
  { name: 'Red', value: '#fee2e2' },
  { name: 'Purple', value: '#f3e8ff' },
  { name: 'Orange', value: '#ffedd5' },
  { name: 'Indigo', value: '#e0e7ff' },
  { name: 'Gray', value: '#f1f5f9' },
  { name: 'Pink', value: '#fce7f3' },
  { name: 'Transparent', value: 'transparent' },
];

const DIAGRAM_BORDER_COLORS = [
  { name: 'Dark', value: '#374151' },
  { name: 'Blue', value: '#3b82f6' },
  { name: 'Green', value: '#22c55e' },
  { name: 'Yellow', value: '#eab308' },
  { name: 'Red', value: '#ef4444' },
  { name: 'Purple', value: '#a855f7' },
  { name: 'Orange', value: '#f97316' },
  { name: 'Indigo', value: '#6366f1' },
  { name: 'Gray', value: '#94a3b8' },
  { name: 'Transparent', value: 'transparent' },
];

const DIAGRAM_FONT_SIZES = [12, 14, 16, 18, 20, 24, 28, 32].map(
  s => ({ value: String(s), label: String(s) }),
);

const EDGE_COLORS = [
  { name: 'Gray', value: '#94a3b8' },
  { name: 'Blue', value: '#3b82f6' },
  { name: 'Green', value: '#22c55e' },
  { name: 'Yellow', value: '#eab308' },
  { name: 'Red', value: '#ef4444' },
  { name: 'Purple', value: '#a855f7' },
  { name: 'Orange', value: '#f97316' },
  { name: 'Dark', value: '#374151' },
];

const EDGE_WIDTH_OPTIONS = [1, 1.5, 2, 3, 4, 6].map(
  w => ({ value: String(w), label: String(w) }),
);

const LINE_STYLE_OPTIONS = [
  { value: 'solid', label: '实线' },
  { value: 'dashed', label: '虚线' },
  { value: 'dotted', label: '点线' },
];

const CONNECTOR_TYPE_OPTIONS = [
  { value: 'straight', label: '直线' },
  { value: 'manhattan', label: '正交' },
  { value: 'rounded', label: '折线' },
  { value: 'smooth', label: '曲线' },
];

const ZORDER_OPTIONS = [
  { value: 'front', label: '置顶' },
  { value: 'back', label: '置底' },
];

/**
 * Diagram Node toolbar.
 * 'shapeSelect' item uses 'custom' type — the renderCustom is set by the diagram editor
 * at integration time since it depends on ShapePicker component.
 */
export const DIAGRAM_NODE_ITEMS: ToolbarItem[] = [
  { key: 'shapeSelect', type: 'custom', icon: icon(Square), label: '形状', group: 'shape' },
  { key: 'fillColor', type: 'color', icon: icon(Paintbrush), label: '填充色', group: 'color', colors: DIAGRAM_FILL_COLORS, colorClearable: true },
  { key: 'borderColor', type: 'color', icon: icon(Square), label: '边框色', group: 'color', colors: DIAGRAM_BORDER_COLORS, colorClearable: true },
  { key: 'fontSize', type: 'dropdown', icon: null, label: '字号', group: 'font', options: DIAGRAM_FONT_SIZES },
  { key: 'bold', type: 'toggle', icon: icon(Bold), label: 'Bold', group: 'format' },
  { key: 'italic', type: 'toggle', icon: icon(Italic), label: 'Italic', group: 'format' },
  { key: 'strikethrough', type: 'toggle', icon: icon(Strikethrough), label: 'Strikethrough', group: 'format' },
  { key: 'underline', type: 'toggle', icon: icon(Underline), label: 'Underline', group: 'format' },
  { key: 'align', type: 'dropdown', icon: icon(AlignLeft), label: '对齐', group: 'align',
    options: [
      { value: 'left', label: 'Left', icon: icon(AlignLeft) },
      { value: 'center', label: 'Center', icon: icon(AlignCenter) },
      { value: 'right', label: 'Right', icon: icon(AlignRight) },
    ]},
  { key: 'copy', type: 'action', icon: icon(Copy), label: '复制', group: 'action' },
  { key: 'delete', type: 'action', icon: icon(Trash2), label: '删除', group: 'action' },
  { key: 'zOrder', type: 'dropdown', icon: icon(Layers), label: '层级', group: 'action', options: ZORDER_OPTIONS },
];

export const DIAGRAM_EDGE_ITEMS: ToolbarItem[] = [
  { key: 'lineColor', type: 'color', icon: icon(Palette), label: '线条颜色', group: 'line', colors: EDGE_COLORS },
  { key: 'lineWidth', type: 'dropdown', icon: icon(Minus), label: '线宽', group: 'line', options: EDGE_WIDTH_OPTIONS },
  { key: 'lineStyle', type: 'dropdown', icon: null, label: '线型', group: 'line', options: LINE_STYLE_OPTIONS },
  { key: 'connectorType', type: 'dropdown', icon: null, label: '连接类型', group: 'connector', options: CONNECTOR_TYPE_OPTIONS },
  { key: 'arrowStyle', type: 'dropdown', icon: icon(ArrowRight), label: '箭头样式', group: 'connector',
    options: [
      { value: 'classic', label: '实心箭头' },
      { value: 'open', label: '空心箭头' },
      { value: 'none', label: '无箭头' },
    ]},
  { key: 'label', type: 'action', icon: icon(Type), label: '标签文本', group: 'label' },
  { key: 'copy', type: 'action', icon: icon(Copy), label: '复制', group: 'action' },
  { key: 'delete', type: 'action', icon: icon(Trash2), label: '删除', group: 'action' },
  { key: 'zOrder', type: 'dropdown', icon: icon(Layers), label: '层级', group: 'action', options: ZORDER_OPTIONS },
];

export const DIAGRAM_IMAGE_ITEMS: ToolbarItem[] = [
  { key: 'replace', type: 'action', icon: icon(ImageIcon), label: '替换', group: 'action' },
  { key: 'copy', type: 'action', icon: icon(Copy), label: '复制', group: 'action' },
  { key: 'delete', type: 'action', icon: icon(Trash2), label: '删除', group: 'action' },
  { key: 'zOrder', type: 'dropdown', icon: icon(Layers), label: '层级', group: 'action', options: ZORDER_OPTIONS },
];
