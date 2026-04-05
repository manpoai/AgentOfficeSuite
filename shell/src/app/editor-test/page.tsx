'use client';

import { useState, useEffect } from 'react';
import { Editor } from '@/components/editor';
import '@/components/editor/editor-styles.css';

// Sample markdown content for editor testing
const testContent = `# 渲染测试文档

## 基础元素

**粗体** *斜体* ~~删除线~~ \`行内代码\` ==高亮文本==

[链接示例](https://example.com)

> 这是一段引用文字 可以有多行


---

## 列表

* 无序列表项 1
* 无序列表项 2


1. 有序列表项 1
2. 有序列表项 2

- [ ] 未完成任务
- [x] 已完成任务
- [ ] 另一个未完成

## 表格

| 名称 | 状态 | 备注 |
|----|----|----|
| 项目A | 进行中 | 需要review |
| 项目B | 已完成 | 无 |
| 项目C | 待开始 | 下周启动 |

## 代码块

\`\`\`javascript
function hello() {
  console.log("Hello, World!");
  return 42;
}
\`\`\`

## 通知块


:::info
这是一条信息通知

:::


:::warning
这是一条警告通知

:::


:::tip
这是一条提示

:::

## 数学公式

$$
E = mc^2$$

完毕。`;

export default function EditorTestPage() {
  // Simulate async load like the content page does
  const [doc, setDoc] = useState<{ id: string; text: string } | null>(null);

  useEffect(() => {
    // Simulate API fetch delay
    setTimeout(() => {
      setDoc({ id: 'test-doc-1', text: testContent });
    }, 500);
  }, []);

  if (!doc) {
    return <div style={{ height: '100vh', background: '#18181b', color: '#888', padding: 20 }}>Loading...</div>;
  }

  return (
    <div style={{ height: '100vh', background: '#18181b' }}>
      <div style={{ padding: '12px 16px', borderBottom: '1px solid #333', color: '#fff', fontSize: 14 }}>
        渲染测试 — Editor Test Page (no auth)
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
        <Editor key={doc.id} defaultValue={doc.text} />
      </div>
    </div>
  );
}
