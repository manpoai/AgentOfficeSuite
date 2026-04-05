/**
 * 统一文件选择工具函数
 * 替代各处 document.createElement('input') type='file' 模式
 */
export function pickFile(options?: {
  accept?: string;
  multiple?: boolean;
}): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    if (options?.accept) input.accept = options.accept;
    if (options?.multiple) input.multiple = true;
    input.onchange = () => {
      const files = Array.from(input.files || []);
      resolve(files);
    };
    // 用户取消选择
    input.addEventListener('cancel', () => resolve([]));
    input.click();
  });
}
