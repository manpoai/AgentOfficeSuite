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
import { getT } from '@/lib/i18n';
import { PALETTES } from '@/actions/color-palettes';

const icon = (Icon: any) => createElement(Icon, { className: 'h-4 w-4' });

export function getDocsTextItems(): ToolbarItem[] {
  const t = getT();
  return [
    { key: 'bold', type: 'toggle', icon: icon(Bold), label: t('toolbar.bold'), group: 'inline' },
    { key: 'italic', type: 'toggle', icon: icon(Italic), label: t('toolbar.italic'), group: 'inline' },
    { key: 'strikethrough', type: 'toggle', icon: icon(Strikethrough), label: t('toolbar.strikethrough'), group: 'inline' },
    { key: 'underline', type: 'toggle', icon: icon(Underline), label: t('toolbar.underline'), group: 'inline' },
    { key: 'highlight', type: 'color', icon: icon(Highlighter), label: t('toolbar.docs.highlight'), group: 'style', colors: PALETTES.highlight, colorClearable: true },
    { key: 'code', type: 'toggle', icon: icon(Code2), label: t('toolbar.docs.inlineCode'), group: 'style' },
    { key: 'blockquote', type: 'toggle', icon: icon(Quote), label: t('toolbar.docs.quote'), group: 'style' },
    { key: 'heading1', type: 'toggle', icon: icon(Heading1), label: t('toolbar.docs.heading1'), group: 'heading' },
    { key: 'heading2', type: 'toggle', icon: icon(Heading2), label: t('toolbar.docs.heading2'), group: 'heading' },
    { key: 'heading3', type: 'toggle', icon: icon(Heading3), label: t('toolbar.docs.heading3'), group: 'heading' },
    { key: 'checkboxList', type: 'toggle', icon: icon(ListTodo), label: t('toolbar.docs.checkboxList'), group: 'list' },
    { key: 'orderedList', type: 'toggle', icon: icon(ListOrdered), label: t('toolbar.docs.orderedList'), group: 'list' },
    { key: 'bulletList', type: 'toggle', icon: icon(List), label: t('toolbar.docs.bulletList'), group: 'list' },
    { key: 'link', type: 'action', icon: icon(Link), label: t('toolbar.docs.link'), group: 'insert' },
    { key: 'comment', type: 'action', icon: icon(MessageSquare), label: t('toolbar.docs.comment'), group: 'insert' },
  ];
}


// ── Docs Table Toolbar ──

export function getDocsTableItems(): ToolbarItem[] {
  const t = getT();
  return [
    { key: 'toggleHeaderRow', type: 'action', icon: icon(TableProperties), label: t('toolbar.docs.toggleHeaderRow'), group: 'table' },
    { key: 'toggleHeaderCol', type: 'action', icon: icon(Columns), label: t('toolbar.docs.toggleHeaderCol'), group: 'table' },
    { key: 'mergeCells', type: 'action', icon: icon(Merge), label: t('toolbar.docs.mergeCells'), group: 'table' },
    { key: 'splitCell', type: 'action', icon: icon(Split), label: t('toolbar.docs.splitCell'), group: 'table' },
    { key: 'cellBgColor', type: 'color', icon: icon(Paintbrush), label: t('toolbar.docs.cellBackground'), group: 'cellStyle', colors: PALETTES.cellBackground, colorClearable: true },
    { key: 'bold', type: 'toggle', icon: icon(Bold), label: t('toolbar.bold'), group: 'format' },
    { key: 'italic', type: 'toggle', icon: icon(Italic), label: t('toolbar.italic'), group: 'format' },
    { key: 'strikethrough', type: 'toggle', icon: icon(Strikethrough), label: t('toolbar.strikethrough'), group: 'format' },
    { key: 'underline', type: 'toggle', icon: icon(Underline), label: t('toolbar.underline'), group: 'format' },
    { key: 'highlight', type: 'color', icon: icon(Highlighter), label: t('toolbar.docs.highlight'), group: 'style', colors: PALETTES.highlight, colorClearable: true },
    { key: 'code', type: 'toggle', icon: icon(Code2), label: t('toolbar.docs.inlineCode'), group: 'style' },
    { key: 'blockquote', type: 'toggle', icon: icon(Quote), label: t('toolbar.docs.quote'), group: 'style' },
    { key: 'heading', type: 'dropdown', icon: icon(Heading1), label: t('toolbar.docs.heading'), group: 'block',
      options: [
        { value: '1', label: t('toolbar.docs.heading1Short'), icon: icon(Heading1) },
        { value: '2', label: t('toolbar.docs.heading2Short'), icon: icon(Heading2) },
        { value: '3', label: t('toolbar.docs.heading3Short'), icon: icon(Heading3) },
        { value: 'paragraph', label: t('toolbar.docs.paragraph'), icon: icon(Type) },
      ]},
    { key: 'list', type: 'dropdown', icon: icon(List), label: t('toolbar.docs.list'), group: 'block',
      options: [
        { value: 'checkbox', label: t('toolbar.docs.checkboxList'), icon: icon(ListTodo) },
        { value: 'ordered', label: t('toolbar.docs.orderedList'), icon: icon(ListOrdered) },
        { value: 'bullet', label: t('toolbar.docs.bulletList'), icon: icon(List) },
      ]},
    { key: 'comment', type: 'action', icon: icon(MessageSquare), label: t('toolbar.docs.comment'), group: 'insert' },
    { key: 'deleteRow', type: 'action', icon: icon(Trash2), label: t('toolbar.docs.deleteRow'), group: 'delete' },
    { key: 'deleteCol', type: 'action', icon: icon(Trash2), label: t('toolbar.docs.deleteCol'), group: 'delete' },
  ];
}


// ── Simple Table Toolbar (PPT / Diagram — schema only has paragraph + inline marks) ──

export function getSimpleTableItems(): ToolbarItem[] {
  const t = getT();
  return [
    { key: 'toggleHeaderRow', type: 'action', icon: icon(TableProperties), label: t('toolbar.docs.toggleHeaderRow'), group: 'table' },
    { key: 'toggleHeaderCol', type: 'action', icon: icon(Columns), label: t('toolbar.docs.toggleHeaderCol'), group: 'table' },
    { key: 'mergeCells', type: 'action', icon: icon(Merge), label: t('toolbar.docs.mergeCells'), group: 'table' },
    { key: 'splitCell', type: 'action', icon: icon(Split), label: t('toolbar.docs.splitCell'), group: 'table' },
    { key: 'cellBgColor', type: 'color', icon: icon(Paintbrush), label: t('toolbar.docs.cellBackground'), group: 'cellStyle', colors: PALETTES.cellBackground, colorClearable: true },
    { key: 'bold', type: 'toggle', icon: icon(Bold), label: t('toolbar.bold'), group: 'format' },
    { key: 'italic', type: 'toggle', icon: icon(Italic), label: t('toolbar.italic'), group: 'format' },
    { key: 'strikethrough', type: 'toggle', icon: icon(Strikethrough), label: t('toolbar.strikethrough'), group: 'format' },
    { key: 'underline', type: 'toggle', icon: icon(Underline), label: t('toolbar.underline'), group: 'format' },
    { key: 'highlight', type: 'color', icon: icon(Highlighter), label: t('toolbar.docs.highlight'), group: 'style', colors: PALETTES.highlight, colorClearable: true },
    { key: 'deleteRow', type: 'action', icon: icon(Trash2), label: t('toolbar.docs.deleteRow'), group: 'delete' },
    { key: 'deleteCol', type: 'action', icon: icon(Trash2), label: t('toolbar.docs.deleteCol'), group: 'delete' },
  ];
}


// ── Docs Image Toolbar ──

export function getDocsImageItems(): ToolbarItem[] {
  const t = getT();
  return [
    { key: 'alignLeft', type: 'action', icon: icon(AlignLeft), label: t('toolbar.alignLeft'), group: 'align' },
    { key: 'alignCenter', type: 'action', icon: icon(AlignCenter), label: t('toolbar.alignCenter'), group: 'align' },
    { key: 'alignRight', type: 'action', icon: icon(AlignRight), label: t('toolbar.alignRight'), group: 'align' },
    { key: 'alignFull', type: 'action', icon: icon(Maximize), label: t('toolbar.docs.fullWidth'), group: 'align' },
    { key: 'alignFit', type: 'action', icon: icon(Minimize), label: t('toolbar.docs.fitWidth'), group: 'align' },
    { key: 'replace', type: 'action', icon: icon(ImageIcon), label: t('toolbar.common.replace'), group: 'action' },
    { key: 'download', type: 'action', icon: icon(Download), label: t('toolbar.docs.download'), group: 'action' },
    { key: 'delete', type: 'action', icon: icon(Trash2), label: t('toolbar.common.delete'), group: 'action' },
    { key: 'altText', type: 'action', icon: icon(Pencil), label: t('toolbar.docs.altText'), group: 'action' },
    { key: 'comment', type: 'action', icon: icon(MessageSquare), label: t('toolbar.docs.comment'), group: 'action' },
  ];
}


// ── PPT Text Toolbar ──

function getFontFamilies(t: ReturnType<typeof getT>) {
  return [
    { value: 'Inter, system-ui, sans-serif', label: t('toolbar.fonts.inter') },
    { value: 'Arial, Helvetica, sans-serif', label: t('toolbar.fonts.arial') },
    { value: 'Georgia, serif', label: t('toolbar.fonts.georgia') },
    { value: '"Times New Roman", Times, serif', label: t('toolbar.fonts.timesNewRoman') },
    { value: '"Courier New", Courier, monospace', label: t('toolbar.fonts.courierNew') },
    { value: 'Verdana, Geneva, sans-serif', label: t('toolbar.fonts.verdana') },
    { value: '"Trebuchet MS", sans-serif', label: t('toolbar.fonts.trebuchetMs') },
    { value: '"Comic Sans MS", cursive', label: t('toolbar.fonts.comicSansMs') },
    { value: '"Noto Sans SC", "Source Han Sans SC", sans-serif', label: t('toolbar.fonts.notoSansSC') },
    { value: '"Noto Serif SC", "Source Han Serif SC", serif', label: t('toolbar.fonts.notoSerifSC') },
    { value: '"Microsoft YaHei", sans-serif', label: t('toolbar.fonts.microsoftYaHei') },
    { value: '"PingFang SC", sans-serif', label: t('toolbar.fonts.pingFangSC') },
  ];
}

const FONT_SIZES = [10, 12, 14, 16, 18, 20, 24, 28, 32, 36, 42, 48, 56, 64, 72, 96].map(
  s => ({ value: String(s), label: String(s) }),
);

export function getPptTextItems(): ToolbarItem[] {
  const t = getT();
  return [
    { key: 'fontFamily', type: 'dropdown', icon: null, label: t('toolbar.ppt.font'), group: 'font', options: getFontFamilies(t) },
    { key: 'fontSize', type: 'dropdown', icon: null, label: t('toolbar.ppt.fontSize'), group: 'font', options: FONT_SIZES },
    { key: 'bold', type: 'toggle', icon: icon(Bold), label: t('toolbar.bold'), group: 'format' },
    { key: 'italic', type: 'toggle', icon: icon(Italic), label: t('toolbar.italic'), group: 'format' },
    { key: 'underline', type: 'toggle', icon: icon(Underline), label: t('toolbar.underline'), group: 'format' },
    { key: 'strikethrough', type: 'toggle', icon: icon(Strikethrough), label: t('toolbar.strikethrough'), group: 'format' },
    { key: 'align', type: 'dropdown', icon: icon(AlignLeft), label: t('toolbar.ppt.alignment'), group: 'align',
      options: [
        { value: 'left', label: t('toolbar.alignLeft'), icon: icon(AlignLeft) },
        { value: 'center', label: t('toolbar.alignCenter'), icon: icon(AlignCenter) },
        { value: 'right', label: t('toolbar.alignRight'), icon: icon(AlignRight) },
      ]},
    { key: 'textColor', type: 'color', icon: icon(Palette), label: t('toolbar.ppt.textColor'), group: 'color', colors: PALETTES.text },
  ];
}


// ── PPT Image Toolbar ──

export function getPptImageItems(): ToolbarItem[] {
  const t = getT();
  return [
    { key: 'replace', type: 'action', icon: icon(ImageIcon), label: t('toolbar.common.replace'), group: 'action' },
    { key: 'copy', type: 'action', icon: icon(Copy), label: t('toolbar.common.copy'), group: 'action' },
    { key: 'delete', type: 'action', icon: icon(Trash2), label: t('toolbar.common.delete'), group: 'action' },
    { key: 'zOrder', type: 'dropdown', icon: icon(Layers), label: t('toolbar.common.zOrder'), group: 'action',
      options: [
        { value: 'front', label: t('toolbar.common.bringToFront') },
        { value: 'back', label: t('toolbar.common.sendToBack') },
      ]},
  ];
}


// ── PPT Shape Toolbar ──


function getBorderWidthOptions(t: ReturnType<typeof getT>) {
  return [0, 1, 2, 3, 4, 6].map(
    w => ({ value: String(w), label: w === 0 ? t('toolbar.common.none') : String(w) }),
  );
}

function getBorderStyleOptions(t: ReturnType<typeof getT>) {
  return [
    { value: 'solid', label: t('toolbar.common.solidLine') },
    { value: 'dashed', label: t('toolbar.common.dashedLine') },
    { value: 'dotted', label: t('toolbar.common.dottedLine') },
  ];
}

function getCornerRadiusOptions(t: ReturnType<typeof getT>) {
  return [0, 4, 8, 12, 16, 24].map(
    r => ({ value: String(r), label: r === 0 ? t('toolbar.common.none') : `${r}px` }),
  );
}

export function getPptShapeItems(): ToolbarItem[] {
  const t = getT();
  return [
    { key: 'shapeSelect', type: 'custom', icon: icon(Square), label: t('toolbar.ppt.shape'), group: 'shape' },
    { key: 'fillColor', type: 'color', icon: icon(Paintbrush), label: t('toolbar.ppt.fillColor'), group: 'color', colors: PALETTES.fill, colorClearable: true },
    { key: 'borderColor', type: 'color', icon: icon(Square), label: t('toolbar.ppt.borderColor'), group: 'border', colors: PALETTES.border, colorClearable: true },
    { key: 'borderWidth', type: 'dropdown', icon: icon(Minus), label: t('toolbar.ppt.borderWidth'), group: 'border', options: getBorderWidthOptions(t) },
    { key: 'borderStyle', type: 'dropdown', icon: null, label: t('toolbar.ppt.borderStyle'), group: 'border', options: getBorderStyleOptions(t) },
    { key: 'textColor', type: 'color', icon: icon(Palette), label: t('toolbar.ppt.textColor'), group: 'color', colors: PALETTES.text },
    { key: 'cornerRadius', type: 'dropdown', icon: null, label: t('toolbar.ppt.cornerRadius'), group: 'style', options: getCornerRadiusOptions(t) },
    { key: 'copy', type: 'action', icon: icon(Copy), label: t('toolbar.common.copy'), group: 'action' },
    { key: 'delete', type: 'action', icon: icon(Trash2), label: t('toolbar.common.delete'), group: 'action' },
    { key: 'zOrder', type: 'dropdown', icon: icon(Layers), label: t('toolbar.common.zOrder'), group: 'action',
      options: [
        { value: 'front', label: t('toolbar.common.bringToFront') },
        { value: 'back', label: t('toolbar.common.sendToBack') },
      ]},
  ];
}


// ── Diagram Toolbar ──


const DIAGRAM_FONT_SIZES = [12, 14, 16, 18, 20, 24, 28, 32].map(
  s => ({ value: String(s), label: String(s) }),
);


const EDGE_WIDTH_OPTIONS = [1, 1.5, 2, 3, 4, 6].map(
  w => ({ value: String(w), label: String(w) }),
);

function getLineStyleOptions(t: ReturnType<typeof getT>) {
  return [
    { value: 'solid', label: t('toolbar.common.solidLine') },
    { value: 'dashed', label: t('toolbar.common.dashedLine') },
    { value: 'dotted', label: t('toolbar.common.dottedLine') },
  ];
}

function getConnectorTypeOptions(t: ReturnType<typeof getT>) {
  return [
    { value: 'straight', label: t('toolbar.diagram.connStraight') },
    { value: 'manhattan', label: t('toolbar.diagram.connOrthogonal') },
    { value: 'rounded', label: t('toolbar.diagram.connPolyline') },
    { value: 'smooth', label: t('toolbar.diagram.connCurve') },
  ];
}

function getZOrderOptions(t: ReturnType<typeof getT>) {
  return [
    { value: 'front', label: t('toolbar.common.bringToFront') },
    { value: 'back', label: t('toolbar.common.sendToBack') },
  ];
}

/**
 * Diagram Node toolbar.
 * 'shapeSelect' item uses 'custom' type — the renderCustom is set by the diagram editor
 * at integration time since it depends on ShapePicker component.
 */
export function getDiagramNodeItems(): ToolbarItem[] {
  const t = getT();
  return [
    { key: 'shapeSelect', type: 'custom', icon: icon(Square), label: t('toolbar.diagram.shape'), group: 'shape' },
    { key: 'fillColor', type: 'color', icon: icon(Paintbrush), label: t('toolbar.diagram.fillColor'), group: 'color', colors: PALETTES.fill, colorClearable: true },
    { key: 'borderColor', type: 'color', icon: icon(Square), label: t('toolbar.diagram.borderColor'), group: 'color', colors: PALETTES.border, colorClearable: true },
    { key: 'fontSize', type: 'dropdown', icon: null, label: t('toolbar.diagram.fontSize'), group: 'font', options: DIAGRAM_FONT_SIZES },
    { key: 'bold', type: 'toggle', icon: icon(Bold), label: t('toolbar.bold'), group: 'format' },
    { key: 'italic', type: 'toggle', icon: icon(Italic), label: t('toolbar.italic'), group: 'format' },
    { key: 'strikethrough', type: 'toggle', icon: icon(Strikethrough), label: t('toolbar.strikethrough'), group: 'format' },
    { key: 'underline', type: 'toggle', icon: icon(Underline), label: t('toolbar.underline'), group: 'format' },
    { key: 'align', type: 'dropdown', icon: icon(AlignLeft), label: t('toolbar.diagram.alignment'), group: 'align',
      options: [
        { value: 'left', label: t('toolbar.alignLeft'), icon: icon(AlignLeft) },
        { value: 'center', label: t('toolbar.alignCenter'), icon: icon(AlignCenter) },
        { value: 'right', label: t('toolbar.alignRight'), icon: icon(AlignRight) },
      ]},
    { key: 'copy', type: 'action', icon: icon(Copy), label: t('toolbar.common.copy'), group: 'action' },
    { key: 'delete', type: 'action', icon: icon(Trash2), label: t('toolbar.common.delete'), group: 'action' },
    { key: 'zOrder', type: 'dropdown', icon: icon(Layers), label: t('toolbar.common.zOrder'), group: 'action', options: getZOrderOptions(t) },
  ];
}


export function getDiagramEdgeItems(): ToolbarItem[] {
  const t = getT();
  return [
    { key: 'lineColor', type: 'color', icon: icon(Palette), label: t('toolbar.diagram.lineColor'), group: 'line', colors: PALETTES.border },
    { key: 'lineWidth', type: 'dropdown', icon: icon(Minus), label: t('toolbar.diagram.lineWidth'), group: 'line', options: EDGE_WIDTH_OPTIONS },
    { key: 'lineStyle', type: 'dropdown', icon: null, label: t('toolbar.diagram.lineStyle'), group: 'line', options: getLineStyleOptions(t) },
    { key: 'connectorType', type: 'dropdown', icon: null, label: t('toolbar.diagram.connectorType'), group: 'connector', options: getConnectorTypeOptions(t) },
    { key: 'arrowStyle', type: 'dropdown', icon: icon(ArrowRight), label: t('toolbar.diagram.arrowStyle'), group: 'connector',
      options: [
        { value: 'classic', label: t('toolbar.diagram.arrowClassic') },
        { value: 'open', label: t('toolbar.diagram.arrowOpen') },
        { value: 'none', label: t('toolbar.diagram.arrowNone') },
      ]},
    { key: 'label', type: 'action', icon: icon(Type), label: t('toolbar.diagram.labelText'), group: 'label' },
    { key: 'copy', type: 'action', icon: icon(Copy), label: t('toolbar.common.copy'), group: 'action' },
    { key: 'delete', type: 'action', icon: icon(Trash2), label: t('toolbar.common.delete'), group: 'action' },
    { key: 'zOrder', type: 'dropdown', icon: icon(Layers), label: t('toolbar.common.zOrder'), group: 'action', options: getZOrderOptions(t) },
  ];
}


export function getDiagramImageItems(): ToolbarItem[] {
  const t = getT();
  return [
    { key: 'replace', type: 'action', icon: icon(ImageIcon), label: t('toolbar.common.replace'), group: 'action' },
    { key: 'copy', type: 'action', icon: icon(Copy), label: t('toolbar.common.copy'), group: 'action' },
    { key: 'delete', type: 'action', icon: icon(Trash2), label: t('toolbar.common.delete'), group: 'action' },
    { key: 'zOrder', type: 'dropdown', icon: icon(Layers), label: t('toolbar.common.zOrder'), group: 'action', options: getZOrderOptions(t) },
  ];
}

