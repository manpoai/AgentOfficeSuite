/**
 * ProseMirror plugin for image drag-drop and paste handling.
 * Uploads images to Outline via attachments.create API.
 */
import { Plugin } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import type { Schema } from 'prosemirror-model';
import * as docApi from '@/lib/api/documents';
import { showError } from '@/lib/utils/error';
import { getT } from '@/lib/i18n';

/** Find a valid block-level insertion position at or near `pos`. */
function findInsertPos(view: EditorView, pos: number): number {
  const $pos = view.state.doc.resolve(pos);
  // Walk up to find a position where we can insert a paragraph (block level)
  for (let d = $pos.depth; d >= 0; d--) {
    const parent = $pos.node(d);
    const indexInParent = $pos.index(d);
    // Check if we can insert a paragraph as a child of this node
    if (parent.type.spec.content && parent.canReplaceWith(indexInParent, indexInParent, view.state.schema.nodes.paragraph)) {
      return $pos.after(d + 1 > $pos.depth ? $pos.depth : d + 1);
    }
  }
  // Fallback: insert at end of doc
  return view.state.doc.content.size;
}

/** Sanitize file name for upload — remove special chars that may cause issues */
function sanitizeFileName(name: string): string {
  if (!name) return 'image.png';
  // Replace spaces and special characters with underscores
  return name.replace(/[^a-zA-Z0-9._-]/g, '_');
}

/** Guess content type from file name extension */
function guessContentType(file: File): string {
  if (file.type && file.type.startsWith('image/')) return file.type;
  const ext = file.name?.split('.').pop()?.toLowerCase();
  const map: Record<string, string> = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
    gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
    bmp: 'image/bmp', ico: 'image/x-icon', tif: 'image/tiff', tiff: 'image/tiff',
  };
  return (ext && map[ext]) || 'image/png';
}

/** Upload a File and insert the resulting image node into the editor */
export async function uploadAndInsert(view: EditorView, file: File, rawPos: number, docId?: string) {
  const schema = view.state.schema;
  const imageType = schema.nodes.image;
  if (!imageType) return;

  // Prepare a sanitized file for upload (fix name & content type)
  const contentType = guessContentType(file);
  const safeName = sanitizeFileName(file.name);
  const uploadFile = (safeName !== file.name || !file.type)
    ? new File([file], safeName, { type: contentType })
    : file;

  // Generate unique ID for this upload — used to locate the placeholder node
  const uploadId = crypto.randomUUID();

  // Create a placeholder with a data URL for local preview while uploading
  const reader = new FileReader();
  reader.onload = async () => {
    const dataUrl = reader.result as string;

    // Use current state (may have changed since drop event)
    const insertPos = findInsertPos(view, Math.min(rawPos, view.state.doc.content.size));

    // Insert placeholder image with uploading=uploadId (base64 is only for preview)
    const placeholderNode = imageType.create({ src: dataUrl, alt: '', uploading: uploadId });
    const para = schema.nodes.paragraph.create(null, placeholderNode);
    view.dispatch(view.state.tr.insert(insertPos, para));

    try {
      const result = await docApi.uploadFile(uploadFile, docId);

      // Locate placeholder by uploadId (pos may have shifted during await)
      let found = false;
      view.state.doc.descendants((node, nodePos) => {
        if (found) return false;
        if (node.type === imageType && node.attrs.uploading === uploadId) {
          view.dispatch(view.state.tr.setNodeMarkup(nodePos, undefined, {
            ...node.attrs,
            src: result.url,
            uploading: undefined,
          }));
          found = true;
          return false;
        }
        return true;
      });
    } catch (e: any) {
      showError(getT()('errors.imageUploadFailed'), e);
      // Remove placeholder on error
      let found = false;
      view.state.doc.descendants((node, nodePos) => {
        if (found) return false;
        if (node.type === imageType && node.attrs.uploading === uploadId) {
          view.dispatch(view.state.tr.delete(nodePos, nodePos + node.nodeSize));
          found = true;
          return false;
        }
        return true;
      });
    }
  };
  reader.readAsDataURL(file);
}

const IMAGE_EXTENSIONS = /\.(jpe?g|png|gif|webp|svg|bmp|ico|tiff?)$/i;

function isImageFile(file: File): boolean {
  if (file.type.startsWith('image/')) return true;
  // Fallback: check file extension (some OS/browsers don't set MIME type on drag)
  if (file.name && IMAGE_EXTENSIONS.test(file.name)) return true;
  return false;
}

function getImageFiles(data: DataTransfer): File[] {
  const files: File[] = [];
  for (let i = 0; i < data.files.length; i++) {
    const file = data.files[i];
    if (isImageFile(file)) files.push(file);
  }
  return files;
}

export function imageUploadPlugin(getDocId?: () => string | undefined): Plugin {
  return new Plugin({
    props: {
      handleDrop(view, event) {
        const dt = event.dataTransfer;
        if (!dt) return false;
        const files = getImageFiles(dt);
        if (files.length === 0) return false;

        event.preventDefault();
        const pos = view.posAtCoords({ left: event.clientX, top: event.clientY });
        if (!pos) return false;

        for (const file of files) {
          uploadAndInsert(view, file, pos.pos, getDocId?.());
        }
        return true;
      },

      handlePaste(view, event) {
        const dt = event.clipboardData;
        if (!dt) return false;
        const files = getImageFiles(dt);
        if (files.length === 0) return false;

        event.preventDefault();
        const { from } = view.state.selection;
        for (const file of files) {
          uploadAndInsert(view, file, from, getDocId?.());
        }
        return true;
      },
    },
  });
}
