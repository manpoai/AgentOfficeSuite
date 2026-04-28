// Client-side video export — Phase 6 iteration 1.
//
// Renders the video into a hidden DOM tree, walks the timeline frame by frame,
// rasterizes each frame to a canvas via html-to-image, captures the canvas as
// a MediaStream, and records it with MediaRecorder. Outputs webm; mp4
// transcoding is iteration 2.
//
// No server dependencies. See AgentOffice doc_55241d430df73876 §9 for design.

import { toCanvas } from 'html-to-image';
import type { VideoData, VideoElement } from './types';
import { getElementSnapshotAt, computeTotalDuration, TIME_EPSILON } from './types';

export interface ExportOptions {
  /** Frames per second of the output. Defaults to settings.fps. */
  fps?: number;
  /** Override total duration (s). Defaults to computeTotalDuration(elements). */
  totalDuration?: number;
  /** Progress callback fired after each frame. */
  onProgress?: (current: number, total: number) => void;
  /** AbortSignal to stop early. */
  signal?: AbortSignal;
}

export interface ExportResult {
  blob: Blob;
  /** webm or mp4. Iteration 1: always webm. */
  mimeType: string;
  /** File extension corresponding to mimeType. */
  extension: 'webm' | 'mp4';
  /** Total frames captured. */
  framesCaptured: number;
}

/** Build a hidden DOM tree that the export pipeline rasterizes each frame.
 *  Lives in document.body during export and is removed afterwards. */
function mountHiddenScene(data: VideoData): { container: HTMLDivElement; render: (globalT: number) => void } {
  const container = document.createElement('div');
  container.style.cssText = `
    position: fixed;
    left: -99999px;
    top: 0;
    width: ${data.settings.width}px;
    height: ${data.settings.height}px;
    background: ${data.settings.background_color ?? '#000'};
    overflow: hidden;
    pointer-events: none;
  `;
  document.body.appendChild(container);

  // Pre-create a positioned wrapper per element so we can update style without
  // re-creating DOM nodes (which would also restart any inline CSS animations).
  const wrappers = new Map<string, HTMLDivElement>();
  for (const el of data.elements) {
    const wrap = document.createElement('div');
    wrap.style.position = 'absolute';
    wrap.style.transformOrigin = 'center center';
    // Inject element html (StableHtml-equivalent: set once, never re-set).
    wrap.innerHTML = el.html;
    container.appendChild(wrap);
    wrappers.set(el.id, wrap);
  }

  function render(globalT: number) {
    for (const el of data.elements) {
      const wrap = wrappers.get(el.id);
      if (!wrap) continue;
      // Visibility window
      const localT = globalT - el.start;
      const visible = el.visible !== false && localT >= -TIME_EPSILON && localT <= el.duration + TIME_EPSILON;
      wrap.style.display = visible ? 'block' : 'none';
      if (!visible) continue;
      const snap = getElementSnapshotAt(el, Math.max(0, Math.min(el.duration, localT)));
      wrap.style.left = `${snap.x}px`;
      wrap.style.top = `${snap.y}px`;
      wrap.style.width = `${snap.w}px`;
      wrap.style.height = `${snap.h}px`;
      wrap.style.opacity = String(snap.opacity);
      wrap.style.transform = `scale(${snap.scale}) rotate(${snap.rotation}deg)`;
      wrap.style.zIndex = String(el.z_index ?? 0);
    }
  }

  return { container, render };
}

/** Pause every Web Animations API animation under root and return their handles
 *  so we can manually seek per-frame. Inline CSS @keyframes shortcuts (e.g.
 *  `animation: twinkle 1.5s infinite`) are converted to WAAPI implicitly by the
 *  browser; we get them via getAnimations(). */
function captureWaapi(root: HTMLElement): Animation[] {
  const all: Animation[] = [];
  const walk = (node: Element) => {
    // getAnimations({subtree:true}) on the root element if available
    if ('getAnimations' in node && typeof (node as any).getAnimations === 'function') {
      try {
        const found = (node as any).getAnimations({ subtree: true }) as Animation[];
        for (const a of found) {
          a.pause();
          all.push(a);
        }
      } catch { /* ignore */ }
    }
  };
  walk(root);
  return all;
}

/** Set every captured animation's currentTime to the given global time (ms). */
function seekWaapi(handles: Animation[], globalT: number): void {
  const ms = globalT * 1000;
  for (const a of handles) {
    try {
      const dur = a.effect ? (a.effect.getTiming().duration as number) || 0 : 0;
      // For looped animations, modulo into the iteration; for finite, clamp.
      const it = a.effect?.getTiming().iterations;
      if (it === Infinity && dur > 0) {
        a.currentTime = ms % dur;
      } else {
        a.currentTime = ms;
      }
    } catch { /* ignore */ }
  }
}

/** Run the full export pipeline. */
export async function exportVideoToBlob(data: VideoData, opts: ExportOptions = {}): Promise<ExportResult> {
  if (!data.elements.length) {
    throw new Error('Cannot export an empty video.');
  }
  const fps = opts.fps ?? data.settings.fps ?? 30;
  const totalDuration = opts.totalDuration ?? computeTotalDuration(data.elements);
  const totalFrames = Math.max(1, Math.ceil(totalDuration * fps));

  const { container, render } = mountHiddenScene(data);
  let waapiHandles: Animation[] = [];

  // Prepare an output canvas at native resolution.
  const out = document.createElement('canvas');
  out.width = data.settings.width;
  out.height = data.settings.height;
  const ctx = out.getContext('2d');
  if (!ctx) throw new Error('2D context unavailable.');

  // canvas.captureStream(0) creates a stream with no automatic frames; we push
  // one per loop iteration so output frame rate matches the requested fps.
  const stream = (out as any).captureStream(0) as MediaStream;
  const track = stream.getVideoTracks()[0] as any;

  // MediaRecorder mimeType selection: try VP9 → VP8 → fall back.
  const mimeCandidates = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
  const mimeType = mimeCandidates.find(m => MediaRecorder.isTypeSupported(m)) ?? 'video/webm';
  const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 8_000_000 });
  const chunks: Blob[] = [];
  recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };

  const finished = new Promise<Blob>(resolve => {
    recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType }));
  });

  recorder.start();

  try {
    // First pass: render at t=0 to let the browser materialize any inline CSS
    // @keyframes animations as Animation objects, so we can pause + seek them.
    render(0);
    // Allow browser to commit animations to their initial state.
    await new Promise<void>(r => requestAnimationFrame(() => r()));
    waapiHandles = captureWaapi(container);

    let captured = 0;
    for (let n = 0; n < totalFrames; n++) {
      if (opts.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      const globalT = n / fps;
      render(globalT);
      seekWaapi(waapiHandles, globalT);

      // Let the browser settle layout before snapshotting.
      await new Promise<void>(r => requestAnimationFrame(() => r()));

      const frameCanvas = await toCanvas(container, {
        width: data.settings.width,
        height: data.settings.height,
        pixelRatio: 1,
        cacheBust: false,
        skipFonts: true,
      });
      ctx.clearRect(0, 0, out.width, out.height);
      ctx.drawImage(frameCanvas, 0, 0, out.width, out.height);

      // Push exactly one frame to the encoder.
      if (typeof track.requestFrame === 'function') {
        track.requestFrame();
      }
      captured++;
      opts.onProgress?.(n + 1, totalFrames);
    }

    // Allow the recorder to flush the last frame before stopping.
    await new Promise(r => setTimeout(r, 100));
    recorder.stop();
    const blob = await finished;

    return { blob, mimeType, extension: 'webm', framesCaptured: captured };
  } finally {
    container.remove();
    try { recorder.state !== 'inactive' && recorder.stop(); } catch { /* ignore */ }
    track.stop?.();
  }
}

/** Trigger a browser download for an export result. */
export function downloadExport(result: ExportResult, filename: string): void {
  const url = URL.createObjectURL(result.blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith(`.${result.extension}`) ? filename : `${filename}.${result.extension}`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
