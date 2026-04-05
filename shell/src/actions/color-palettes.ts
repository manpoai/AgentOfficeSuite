export interface ColorDef {
  name: string;
  value: string;
}

export const PALETTES: Record<string, ColorDef[]> = {
  /** Text color — PPT text, diagram node text */
  text: [
    { name: 'Black', value: '#1f2937' },
    { name: 'Red', value: '#ef4444' },
    { name: 'Orange', value: '#f97316' },
    { name: 'Yellow', value: '#eab308' },
    { name: 'Green', value: '#22c55e' },
    { name: 'Blue', value: '#3b82f6' },
    { name: 'Purple', value: '#a855f7' },
    { name: 'Pink', value: '#ec4899' },
  ],
  /** Fill/background color — merges PPT objects and diagram node fill colors */
  fill: [
    { name: 'White', value: '#ffffff' },
    { name: 'Light Blue', value: '#dbeafe' },
    { name: 'Light Green', value: '#dcfce7' },
    { name: 'Light Yellow', value: '#fef9c3' },
    { name: 'Light Red', value: '#fee2e2' },
    { name: 'Light Purple', value: '#f3e8ff' },
    { name: 'Light Orange', value: '#ffedd5' },
    { name: 'Light Gray', value: '#f3f4f6' },
    { name: 'Light Indigo', value: '#e0e7ff' },
    { name: 'Light Pink', value: '#fce7f3' },
    { name: 'Transparent', value: 'transparent' },
  ],
  /** Border/stroke color — merges PPT and diagram border colors */
  border: [
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
  ],
  /** Slide/page background */
  background: [
    { name: 'White', value: '#ffffff' },
    { name: 'Off White', value: '#f8fafc' },
    { name: 'Light Blue', value: '#eff6ff' },
    { name: 'Light Green', value: '#f0fdf4' },
    { name: 'Light Yellow', value: '#fefce8' },
    { name: 'Dark', value: '#1e293b' },
    { name: 'Black', value: '#000000' },
  ],
  /** Highlight colors — for docs text highlighting */
  highlight: [
    { name: 'Yellow', value: 'hsl(50 90% 60% / 0.3)' },
    { name: 'Orange', value: 'hsl(25 90% 60% / 0.3)' },
    { name: 'Red', value: 'hsl(0 80% 60% / 0.3)' },
    { name: 'Pink', value: 'hsl(330 80% 65% / 0.3)' },
    { name: 'Purple', value: 'hsl(270 60% 60% / 0.3)' },
    { name: 'Blue', value: 'hsl(210 70% 55% / 0.3)' },
    { name: 'Green', value: 'hsl(142 50% 50% / 0.3)' },
  ],
  /** Table/cell background colors */
  cellBackground: [
    { name: 'None', value: '' },
    { name: 'Yellow', value: '#fef3c7' },
    { name: 'Blue', value: '#dbeafe' },
    { name: 'Green', value: '#d1fae5' },
    { name: 'Pink', value: '#fce7f3' },
    { name: 'Purple', value: '#ede9fe' },
    { name: 'Orange', value: '#ffedd5' },
    { name: 'Gray', value: '#f3f4f6' },
  ],
};

export type PaletteKey = keyof typeof PALETTES;
