// Client-side video export — Phase 6.
//
// Renders the video into a hidden DOM tree, walks the timeline frame by frame,
// rasterizes each frame to a canvas via html-to-image, captures the canvas as
// a MediaStream, records it with MediaRecorder (webm), and optionally transcodes
// the result to mp4 via ffmpeg.wasm.
//
// No server dependencies. See AgentOffice doc_55241d430df73876 §9 for design.

import { toCanvas } from 'html-to-image';
import type { VideoData, VideoElement } from './types';
import { getElementSnapshotAt, computeTotalDuration, TIME_EPSILON, packedRgbToHex } from './types';

export type ExportFormat = 'webm' | 'mp4';

export interface ExportOptions {
  /** Output format. Defaults to 'mp4'. webm avoids the transcode step. */
  format?: ExportFormat;
  /** Frames per second of the output. Defaults to settings.fps. */
  fps?: number;
  /** Override total duration (s). Defaults to computeTotalDuration(elements). */
  totalDuration?: number;
  /** Unified progress callback. pct is 0–100, label describes current step. */
  onProgress?: (pct: number, label: string) => void;
  /** AbortSignal to stop early. */
  signal?: AbortSignal;
}

export interface ExportResult {
  blob: Blob;
  /** Final mime type (video/webm or video/mp4). */
  mimeType: string;
  /** File extension corresponding to mimeType. */
  extension: ExportFormat;
  /** Total frames captured during the capture phase. */
  framesCaptured: number;
}

/** Build a hidden DOM tree that the export pipeline rasterizes each frame.
 *  Lives in document.body during export and is removed afterwards. */
function mountHiddenScene(data: VideoData): { container: HTMLDivElement; render: (globalT: number) => void } {
  const container = document.createElement('div');
  container.style.cssText = `
    position: fixed;
    left: 0;
    top: 0;
    width: ${data.settings.width}px;
    height: ${data.settings.height}px;
    background: ${data.settings.background_color ?? '#000'};
    overflow: hidden;
    pointer-events: none;
    z-index: -1;
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
      const scaledW = snap.w * snap.scale;
      const scaledH = snap.h * snap.scale;
      wrap.style.left = `${snap.x - (scaledW - snap.w) / 2}px`;
      wrap.style.top = `${snap.y - (scaledH - snap.h) / 2}px`;
      wrap.style.width = `${scaledW}px`;
      wrap.style.height = `${scaledH}px`;
      wrap.style.opacity = String(snap.opacity);
      wrap.style.transform = `rotate(${snap.rotation}deg)`;
      wrap.style.zIndex = String(el.z_index ?? 0);
      // Apply animated color/fontSize overrides to the inner content
      const inner = wrap.firstElementChild as HTMLElement | null;
      if (inner) {
        const isSvg = el.html.includes('<svg');
        if (isSvg) {
          const hasImageFill = el.html.includes('url(#img-fill)');
          if (!hasImageFill) {
            const paths = inner.querySelectorAll('[fill]');
            paths.forEach(p => p.setAttribute('fill', packedRgbToHex(snap.fillColor)));
          }
          const strokes = inner.querySelectorAll('[stroke]');
          strokes.forEach(p => p.setAttribute('stroke', packedRgbToHex(snap.strokeColor)));
        } else {
          const hasBackgroundImage = /background-image:\s*url\(/.test(el.html);
          if (!hasBackgroundImage) {
            inner.style.background = packedRgbToHex(snap.fillColor);
          }
          if (el.type === 'text') {
            const hasTextClip = el.html.includes('background-clip:') || el.html.includes('background-clip :');
            if (!hasTextClip) {
              inner.style.color = packedRgbToHex(snap.textColor);
            }
            inner.style.fontSize = `${Math.round(snap.fontSize)}px`;
          }
        }
      }
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
  const format: ExportFormat = opts.format ?? 'mp4';
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

  // Emit a chunk every second so the main process doesn't hold the entire
  // recording in memory before stop(). Helps with longer exports.
  recorder.start(1000);

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
      const capturePct = format === 'webm'
        ? Math.round(((n + 1) / totalFrames) * 100)
        : Math.round(((n + 1) / totalFrames) * 50);
      opts.onProgress?.(capturePct, `Capturing frame ${n + 1} / ${totalFrames}`);
    }

    // Allow the recorder to flush the last frame before stopping.
    await new Promise(r => setTimeout(r, 100));
    recorder.stop();
    const webmBlob = await finished;

    if (format === 'webm') {
      return { blob: webmBlob, mimeType, extension: 'webm', framesCaptured: captured };
    }

    // Transcode webm → mp4 via ffmpeg.wasm.
    opts.onProgress?.(50, 'Loading ffmpeg…');
    const mp4Blob = await transcodeWebmToMp4(webmBlob, fps, opts.signal, (pct) => {
      const unified = 50 + Math.round(pct * 0.5);
      const label = pct < 15 ? 'Loading ffmpeg…' : pct < 25 ? 'Preparing transcode…' : `Encoding MP4 — ${Math.round(pct)}%`;
      opts.onProgress?.(unified, label);
    });
    return { blob: mp4Blob, mimeType: 'video/mp4', extension: 'mp4', framesCaptured: captured };
  } finally {
    container.remove();
    try { recorder.state !== 'inactive' && recorder.stop(); } catch { /* ignore */ }
    track.stop?.();
  }
}

// ─────────────────────────────────────────────────────────────────────────
// ffmpeg.wasm transcode (Phase 6 iter 2)
// ─────────────────────────────────────────────────────────────────────────

/** Cached ffmpeg instance — reused across exports so the 30 MB wasm only loads
 *  once per page session. */
let _ffmpegPromise: Promise<import('@ffmpeg/ffmpeg').FFmpeg> | null = null;

async function getFFmpeg(): Promise<import('@ffmpeg/ffmpeg').FFmpeg> {
  if (_ffmpegPromise) return _ffmpegPromise;
  _ffmpegPromise = (async () => {
    const { FFmpeg } = await import('@ffmpeg/ffmpeg');
    const ffmpeg = new FFmpeg();
    ffmpeg.on('log', ({ message }) => console.log('[ffmpeg]', message));
    console.log('[VideoExport] Loading ffmpeg.wasm...');
    await ffmpeg.load({
      coreURL: '/ffmpeg/ffmpeg-core.js',
      wasmURL: '/ffmpeg/ffmpeg-core.wasm',
    });
    console.log('[VideoExport] ffmpeg.wasm loaded successfully');
    return ffmpeg;
  })();
  try {
    return await _ffmpegPromise;
  } catch (e) {
    console.error('[VideoExport] ffmpeg.wasm failed to load:', e);
    _ffmpegPromise = null;
    throw e;
  }
}

async function transcodeWebmToMp4(
  webm: Blob,
  fps: number,
  signal: AbortSignal | undefined,
  onPct: (pct: number) => void,
): Promise<Blob> {
  onPct(5);
  console.log('[VideoExport] Loading ffmpeg.wasm...');
  const ffmpeg = await getFFmpeg();
  const { fetchFile } = await import('@ffmpeg/util');
  onPct(15);

  let gotRealProgress = false;
  const onProgress = ({ progress }: { progress: number }) => {
    gotRealProgress = true;
    onPct(Math.max(20, Math.min(95, progress * 100)));
  };
  ffmpeg.on('progress', onProgress);

  const inName = 'in.webm';
  const outName = 'out.mp4';

  try {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    console.log('[VideoExport] Writing webm to ffmpeg FS, size:', webm.size);
    await ffmpeg.writeFile(inName, await fetchFile(webm));
    onPct(20);

    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    console.log('[VideoExport] Starting transcode webm→mp4...');
    if (!gotRealProgress) onPct(25);
    const exitCode = await ffmpeg.exec([
      '-i', inName,
      '-r', String(fps),
      '-c:v', 'libx264',
      '-preset', 'fast',
      '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart',
      outName,
    ]);
    console.log('[VideoExport] ffmpeg exec exit code:', exitCode);
    onPct(95);

    const data = await ffmpeg.readFile(outName);
    const arr = data instanceof Uint8Array ? data : new Uint8Array(0);
    console.log('[VideoExport] MP4 output size:', arr.byteLength);
    try { await ffmpeg.deleteFile(inName); } catch { /* noop */ }
    try { await ffmpeg.deleteFile(outName); } catch { /* noop */ }
    onPct(100);
    return new Blob([arr], { type: 'video/mp4' });
  } finally {
    ffmpeg.off('progress', onProgress);
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
