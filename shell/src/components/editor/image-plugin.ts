/**
 * ProseMirror plugin for image drag-drop and paste handling.
 * Uploads images to Outline via attachments.create API.
 */
import { Plugin } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import type { Schema } from 'prosemirror-model';
import * as ol from '@/lib/api/outline';

/** Upload a File and insert the resulting image node into the editor */
async function uploadAndInsert(view: EditorView, file: File, pos: number, docId?: string) {
  // Insert a placeholder (loading indicator)
  const schema = view.state.schema;
  const imageType = schema.nodes.image;
  if (!imageType) return;

  // Create a placeholder with a data URL while uploading
  const reader = new FileReader();
  reader.onload = async () => {
    const dataUrl = reader.result as string;
    // Insert placeholder image (wrapped in a paragraph since image is inline)
    const placeholderNode = imageType.create({ src: dataUrl, alt: file.name, title: file.name });
    const para = schema.nodes.paragraph.create(null, placeholderNode);
    let tr = view.state.tr.insert(pos, para);
    view.dispatch(tr);

    try {
      const result = await ol.uploadAttachment(file, docId);
      const url = result.data.url;

      // Find and replace the placeholder image
      view.state.doc.descendants((node, nodePos) => {
        if (node.type === imageType && node.attrs.src === dataUrl) {
          const tr = view.state.tr.setNodeMarkup(nodePos, undefined, {
            ...node.attrs,
            src: url,
          });
          view.dispatch(tr);
          return false;
        }
        return true;
      });
    } catch (e) {
      console.error('Image upload failed:', e);
      // Remove placeholder on error
      view.state.doc.descendants((node, nodePos) => {
        if (node.type === imageType && node.attrs.src === dataUrl) {
          const tr = view.state.tr.delete(nodePos, nodePos + node.nodeSize);
          view.dispatch(tr);
          return false;
        }
        return true;
      });
    }
  };
  reader.readAsDataURL(file);
}

function getImageFiles(data: DataTransfer): File[] {
  const files: File[] = [];
  for (let i = 0; i < data.files.length; i++) {
    const file = data.files[i];
    if (file.type.startsWith('image/')) files.push(file);
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
