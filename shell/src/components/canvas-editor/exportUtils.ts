import { toPng } from 'html-to-image';

export async function exportFramePng(frameEl: HTMLElement, frameName: string): Promise<void> {
  const dataUrl = await toPng(frameEl, { pixelRatio: 2, skipFonts: false });
  const a = document.createElement('a');
  a.download = `${frameName || 'frame'}.png`;
  a.href = dataUrl;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}
