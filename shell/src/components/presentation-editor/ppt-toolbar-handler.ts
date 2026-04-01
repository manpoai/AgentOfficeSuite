import type { ToolbarHandler, ToolbarState } from '@/components/shared/FloatingToolbar/types';

interface PPTTarget {
  obj: any;       // Fabric.js object
  canvas: any;    // Fabric.js Canvas
}

// Backward-compatible alias
type PPTTextTarget = PPTTarget;

export function createPPTTextHandler(target: PPTTextTarget): ToolbarHandler {
  const { obj, canvas } = target;

  function refresh() {
    canvas.renderAll();
    canvas.fire('object:modified', { target: obj });
  }

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
        case 'fontFamily': obj.set('fontFamily', value); refresh(); break;
        case 'fontSize': obj.set('fontSize', Math.max(1, Number(value))); refresh(); break;
        case 'bold': obj.set('fontWeight', obj.fontWeight === 'bold' ? 'normal' : 'bold'); refresh(); break;
        case 'italic': obj.set('fontStyle', obj.fontStyle === 'italic' ? 'normal' : 'italic'); refresh(); break;
        case 'underline': obj.set('underline', !obj.underline); refresh(); break;
        case 'strikethrough': obj.set('linethrough', !obj.linethrough); refresh(); break;
        case 'align': obj.set('textAlign', value); refresh(); break;
        case 'textColor': obj.set('fill', value); refresh(); break;
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
          const input = document.createElement('input');
          input.type = 'file';
          input.accept = 'image/*';
          input.onchange = () => {
            const file = input.files?.[0];
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
          };
          input.click();
          break;
        }
        case 'copy': {
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
          canvas.remove(obj);
          canvas.renderAll();
          canvas.fire('object:modified', { target: obj });
          break;
        case 'zOrder':
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

  function refresh() {
    canvas.renderAll();
    canvas.fire('object:modified', { target: obj });
  }

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
        case 'fillColor': obj.set('fill', value || 'transparent'); refresh(); break;
        case 'borderColor': obj.set('stroke', value || 'transparent'); refresh(); break;
        case 'borderWidth': obj.set('strokeWidth', Number(value)); refresh(); break;
        case 'borderStyle': {
          if (value === 'dashed') obj.set('strokeDashArray', [8, 4]);
          else if (value === 'dotted') obj.set('strokeDashArray', [2, 4]);
          else obj.set('strokeDashArray', null);
          refresh();
          break;
        }
        case 'textColor': obj.set('fill', value); refresh(); break;
        case 'cornerRadius': {
          obj.set('rx', Number(value));
          obj.set('ry', Number(value));
          refresh();
          break;
        }
        case 'copy': {
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
          canvas.remove(obj);
          canvas.renderAll();
          canvas.fire('object:modified', { target: obj });
          break;
        case 'zOrder':
          if (value === 'front') obj.bringToFront();
          else obj.sendToBack();
          refresh();
          break;
      }
    },
  };
}
