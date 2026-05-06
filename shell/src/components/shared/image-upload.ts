export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

import { resolveGatewayUrl, API_BASE } from '@/lib/api/config';

/** Resolve a server upload URL (e.g. /api/uploads/files/x.png) to a shell-proxied URL the browser can fetch. */
export function resolveUploadUrl(p: string): string {
  return resolveGatewayUrl(p);
}

/** Read image natural width/height without consuming the whole file. */
export function probeImageSize(file: File): Promise<{ w: number; h: number; objectUrl: string }> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight, objectUrl });
    img.onerror = () => { URL.revokeObjectURL(objectUrl); reject(new Error('Failed to load image')); };
    img.src = objectUrl;
  });
}

export function createImageHtml(src: string, w = 300, h = 200): string {
  const resolved = resolveUploadUrl(src);
  return `<div style="width:100%;height:100%;overflow:visible;"><svg xmlns="http://www.w3.org/2000/svg" viewBox="-1 -1 ${w + 2} ${h + 2}" preserveAspectRatio="none" style="width:100%;height:100%;display:block;overflow:visible;"><defs><pattern id="img-fill" patternUnits="objectBoundingBox" width="1" height="1"><image href="${resolved}" width="100%" height="100%" preserveAspectRatio="xMidYMid slice"/></pattern></defs><path d="M0 0h${w}v${h}H0z" fill="url(#img-fill)" stroke="none" stroke-width="0" vector-effect="non-scaling-stroke"/></svg></div>`;
}

export function extractDroppedImageFiles(e: DragEvent): File[] {
  const files: File[] = [];
  if (e.dataTransfer?.files) {
    for (let i = 0; i < e.dataTransfer.files.length; i++) {
      const f = e.dataTransfer.files[i];
      if (f.type.startsWith('image/')) files.push(f);
    }
  }
  return files;
}

export function isSvgFile(file: File): boolean {
  return file.type === 'image/svg+xml' || file.name.endsWith('.svg');
}

export async function uploadImageFile(file: File): Promise<string> {
  const form = new FormData();
  form.append('file', file);
  const token = typeof window !== 'undefined' ? localStorage.getItem('aose_token') : null;
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${API_BASE}/uploads`, { method: 'POST', headers, body: form });
  if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
  const { url } = await res.json() as { url: string };
  return url;
}
