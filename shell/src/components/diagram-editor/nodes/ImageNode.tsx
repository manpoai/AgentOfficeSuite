'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import type { Node } from '@antv/x6';
import { useT } from '@/lib/i18n';

interface ImageNodeData {
  imageUrl: string; // base64 or URL
  label?: string;
}

export function ImageNode({ node }: { node: Node }) {
  const { t } = useT();
  const raw = node.getData() || {};
  const [imageUrl, setImageUrl] = useState<string>(raw.imageUrl || '');
  const [label, setLabel] = useState<string>(raw.label || '');
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onChange = () => {
      const d = node.getData() || {};
      setImageUrl(d.imageUrl || '');
      setLabel(d.label || '');
    };
    node.on('change:data', onChange);
    return () => { node.off('change:data', onChange); };
  }, [node]);

  // Listen for replace-image trigger from toolbar
  useEffect(() => {
    const onReplace = () => {
      fileInputRef.current?.click();
    };
    node.on('image:replace', onReplace);
    return () => { node.off('image:replace', onReplace); };
  }, [node]);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      node.setData({ ...node.getData(), imageUrl: dataUrl }, { silent: false });
    };
    reader.readAsDataURL(file);
    // Reset so same file can be re-selected
    e.target.value = '';
  }, [node]);

  const size = node.getSize();

  if (!imageUrl) {
    return (
      <div
        style={{
          width: size.width,
          height: size.height,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#f8fafc',
          border: '2px dashed #cbd5e1',
          borderRadius: 8,
          cursor: 'pointer',
          color: '#94a3b8',
          fontSize: 13,
        }}
        onDoubleClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={handleFileChange}
        />
        <span>{t('diagram.tools.dblclickImage')}</span>
      </div>
    );
  }

  return (
    <div style={{ width: size.width, height: size.height, position: 'relative' }}>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />
      <img
        src={imageUrl}
        alt={label || ''}
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'contain',
          borderRadius: 4,
          pointerEvents: 'none',
        }}
        draggable={false}
      />
    </div>
  );
}
