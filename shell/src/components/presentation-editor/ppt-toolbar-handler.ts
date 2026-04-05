import type { ToolbarHandler, ToolbarState } from '@/components/shared/FloatingToolbar/types';
import { pickFile } from '@/lib/utils/pick-file';

interface PPTTarget {
  obj: any;       // Fabric.js object
  canvas: any;    // Fabric.js Canvas
}

// Backward-compatible alias
type PPTTextTarget = PPTTarget;

export function createPPTTextHandler(target: PPTTextTarget): ToolbarHandler {
  const { obj, canvas } = target;

  // Snapshot BEFORE change, commit AFTER
  function snapshot() { canvas.fire('before:modified', { target: obj }); }
  function commit() { canvas.renderAll(); canvas.fire('object:modified', { target: obj }); }

  return {
    getState(): ToolbarState {
      return {
        fontFamily: obj.fontFamily || 'Inter, system-ui, sans-serif',
        fontSize: String(obj.fontSize || 24),
        bold: obj.fontWeight === 'bold',
        italic: obj.fontStyle === 'italic',
        underline: !!obj.underline,
        strikethrough: !!obj.linethrough,
        align: obj.textAlign || 'left',
        textColor: typeof obj.fill === 'string' ? obj.fill : '#1f2937',
      };
    },

    execute(key: string, value?: unknown) {
      switch (key) {
        case 'fontFamily': snapshot(); obj.set('fontFamily', value); commit(); break;
        case 'fontSize': snapshot(); obj.set('fontSize', Math.max(1, Number(value))); commit(); break;
        case 'bold': snapshot(); obj.set('fontWeight', obj.fontWeight === 'bold' ? 'normal' : 'bold'); commit(); break;
        case 'italic': snapshot(); obj.set('fontStyle', obj.fontStyle === 'italic' ? 'normal' : 'italic'); commit(); break;
        case 'underline': snapshot(); obj.set('underline', !obj.underline); commit(); break;
        case 'strikethrough': snapshot(); obj.set('linethrough', !obj.linethrough); commit(); break;
        case 'align': snapshot(); obj.set('textAlign', value); commit(); break;
        case 'textColor': snapshot(); obj.set('fill', value); commit(); break;
      }
    },
  };
}

export function createPPTImageHandler(target: PPTTarget): ToolbarHandler {
  const { obj, canvas } = target;

  return {
    getState(): ToolbarState {
      return {};
    },

    execute(key: string, value?: unknown) {
      switch (key) {
        case 'replace': {
          canvas.fire('before:modified', { target: obj });
          pickFile({ accept: 'image/*' }).then((files) => {
            const file = files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = () => {
              const src = reader.result as string;
              const imgEl = new Image();
              imgEl.onload = () => {
                obj.setSrc(src, () => {
                  canvas.renderAll();
                  canvas.fire('object:modified', { target: obj });
                });
              };
              imgEl.src = src;
            };
            reader.readAsDataURL(file);
          });
          break;
        }
        case 'copy': {
          canvas.fire('before:modified', { target: obj });
          obj.clone((cloned: any) => {
            cloned.set({ left: (obj.left || 0) + 20, top: (obj.top || 0) + 20 });
            canvas.add(cloned);
            canvas.setActiveObject(cloned);
            canvas.renderAll();
            canvas.fire('object:modified', { target: cloned });
          });
          break;
        }
        case 'delete':
          canvas.fire('before:modified', { target: obj });
          canvas.remove(obj);
          canvas.renderAll();
          canvas.fire('object:modified', { target: obj });
          break;
        case 'zOrder':
          canvas.fire('before:modified', { target: obj });
          if (value === 'front') obj.bringToFront();
          else obj.sendToBack();
          canvas.renderAll();
          canvas.fire('object:modified', { target: obj });
          break;
      }
    },
  };
}

export function createPPTShapeHandler(target: PPTTarget): ToolbarHandler {
  const { obj, canvas } = target;

  // Snapshot BEFORE change, commit AFTER
  function snapshot() { canvas.fire('before:modified', { target: obj }); }
  function commit() { canvas.renderAll(); canvas.fire('object:modified', { target: obj }); }

  return {
    getState(): ToolbarState {
      return {
        fillColor: typeof obj.fill === 'string' ? obj.fill : '#ffffff',
        borderColor: obj.stroke || '#374151',
        borderWidth: String(obj.strokeWidth || 0),
        borderStyle: obj.strokeDashArray ? (obj.strokeDashArray[0] === 2 ? 'dotted' : 'dashed') : 'solid',
        textColor: typeof obj.fill === 'string' ? obj.fill : '#1f2937',
        cornerRadius: String(obj.rx || 0),
      };
    },

    execute(key: string, value?: unknown) {
      switch (key) {
        case 'fillColor': snapshot(); obj.set('fill', value || 'transparent'); commit(); break;
        case 'borderColor': snapshot(); obj.set('stroke', value || 'transparent'); commit(); break;
        case 'borderWidth': snapshot(); obj.set('strokeWidth', Number(value)); commit(); break;
        case 'borderStyle': {
          snapshot();
          if (value === 'dashed') obj.set('strokeDashArray', [8, 4]);
          else if (value === 'dotted') obj.set('strokeDashArray', [2, 4]);
          else obj.set('strokeDashArray', null);
          commit();
          break;
        }
        case 'textColor': snapshot(); obj.set('fill', value); commit(); break;
        case 'cornerRadius': {
          snapshot();
          obj.set('rx', Number(value));
          obj.set('ry', Number(value));
          commit();
          break;
        }
        case 'copy': {
          snapshot();
          obj.clone((cloned: any) => {
            cloned.set({ left: (obj.left || 0) + 20, top: (obj.top || 0) + 20 });
            canvas.add(cloned);
            canvas.setActiveObject(cloned);
            canvas.renderAll();
            canvas.fire('object:modified', { target: cloned });
          });
          break;
        }
        case 'delete':
          snapshot();
          canvas.remove(obj);
          canvas.renderAll();
          canvas.fire('object:modified', { target: obj });
          break;
        case 'zOrder':
          snapshot();
          if (value === 'front') obj.bringToFront();
          else obj.sendToBack();
          commit();
          break;
      }
    },
  };
}
