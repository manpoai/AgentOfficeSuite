# 表格编辑器 17 个问题深度分析 V2

基于完整代码审查，逐个定位根因并给出代码级修复方案。

---

## Doc1: 基本功能缺漏

### Issue 1.1: 筛选条件不分字段类型

**需求理解：** 当前所有字段类型共用同一组筛选操作符（eq/neq/like/nlike/gt/gte/lt/lte/is/isnot），但不同类型应有不同操作符。例如：文本支持 contains/not contains，数字支持 >/>=/</<= 但不需要 like，日期支持 before/after，Checkbox 只需要 is checked / is not checked，Select 只需要 is/is not/is any of。

**代码分析：**

- **行 184-195 (`FILTER_OPS`)**: 定义了一个固定的全局操作符数组，所有字段共用：
  ```ts
  const FILTER_OPS = [
    { value: 'eq', key: 'eq' }, { value: 'neq', key: 'neq' },
    { value: 'like', key: 'like' }, { value: 'nlike', key: 'nlike' },
    { value: 'gt', key: 'gt' }, { value: 'gte', key: 'gte' },
    { value: 'lt', key: 'lt' }, { value: 'lte', key: 'lte' },
    { value: 'is', key: 'is' }, { value: 'isnot', key: 'isnot' },
  ];
  ```
- **行 2373-2374**: 新建筛选行的操作符下拉框直接遍历 `FILTER_OPS`，无条件分支。
- **行 2369**: 字段选择器已排除 READONLY_TYPES，但不影响此问题。

**根因：** `FILTER_OPS` 是静态常量，未按字段类型分组。

**解决方案：**

1. 替换 `FILTER_OPS` 为按字段类型分组的映射：
```ts
const FILTER_OPS_BY_TYPE: Record<string, { value: string; key: string }[]> = {
  text: [ // SingleLineText, LongText, Email, URL, PhoneNumber
    { value: 'eq', key: 'eq' }, { value: 'neq', key: 'neq' },
    { value: 'like', key: 'like' }, { value: 'nlike', key: 'nlike' },
    { value: 'is', key: 'empty' }, { value: 'isnot', key: 'notEmpty' },
  ],
  number: [ // Number, Decimal, Currency, Percent, Rating
    { value: 'eq', key: 'eq' }, { value: 'neq', key: 'neq' },
    { value: 'gt', key: 'gt' }, { value: 'gte', key: 'gte' },
    { value: 'lt', key: 'lt' }, { value: 'lte', key: 'lte' },
    { value: 'is', key: 'empty' }, { value: 'isnot', key: 'notEmpty' },
  ],
  date: [ // Date, DateTime, CreatedTime, LastModifiedTime
    { value: 'eq', key: 'eq' }, { value: 'neq', key: 'neq' },
    { value: 'gt', key: 'after' }, { value: 'lt', key: 'before' },
    { value: 'gte', key: 'onOrAfter' }, { value: 'lte', key: 'onOrBefore' },
    { value: 'is', key: 'empty' }, { value: 'isnot', key: 'notEmpty' },
  ],
  select: [ // SingleSelect, MultiSelect
    { value: 'eq', key: 'is' }, { value: 'neq', key: 'isNot' },
    { value: 'like', key: 'contains' }, { value: 'nlike', key: 'notContains' },
    { value: 'is', key: 'empty' }, { value: 'isnot', key: 'notEmpty' },
  ],
  checkbox: [ // Checkbox
    { value: 'eq', key: 'isChecked' }, { value: 'neq', key: 'isNotChecked' },
  ],
  default: [ // fallback
    { value: 'eq', key: 'eq' }, { value: 'neq', key: 'neq' },
    { value: 'is', key: 'empty' }, { value: 'isnot', key: 'notEmpty' },
  ],
};

function getFilterOpsForType(uidt: string): { value: string; key: string }[] {
  const group = COLUMN_TYPES.find(ct => ct.value === uidt)?.group;
  if (uidt === 'Checkbox') return FILTER_OPS_BY_TYPE.checkbox;
  if (group === 'text') return FILTER_OPS_BY_TYPE.text;
  if (group === 'number') return FILTER_OPS_BY_TYPE.number;
  if (group === 'datetime') return FILTER_OPS_BY_TYPE.date;
  if (group === 'select') return FILTER_OPS_BY_TYPE.select;
  return FILTER_OPS_BY_TYPE.default;
}
```

2. 在行 2373 处，将 `FILTER_OPS.map(...)` 改为：
```ts
const selectedCol = displayCols.find(c => c.column_id === newFilterCol);
const availableOps = selectedCol ? getFilterOpsForType(selectedCol.type) : FILTER_OPS_BY_TYPE.default;
// 然后 <select> 内使用 availableOps.map(...)
```

3. 当 `newFilterCol` 改变时，重置 `newFilterOp` 到新类型的第一个可用操作符。

4. 对 Checkbox 类型，筛选值输入改为下拉框（true/false），不需要文本输入。对 Select 类型，值输入改为下拉从 options 中选择。

---

### Issue 1.2: 排序没有生效

**需求理解：** 用户在排序面板中添加排序规则后，表格数据没有按排序规则显示。

**代码分析：**

- **行 452-455**: `sortParam` 定义：
  ```ts
  const sortParam = sortCol ? (sortDir === 'desc' ? `-${sortCol}` : sortCol) : 'Id';
  ```
  这里 `sortCol` 是本地的列标题，来自头部点击排序 (行 796-805 `handleSort`)。

- **行 777-784**: `handleAddSort` 通过 NocoDB API 创建 view sort：
  ```ts
  await nc.createSort(activeViewId, { fk_column_id: newSortCol, direction: newSortDir });
  ```
  这是 **view-level sort**，保存在 NocoDB view 上。

- **行 487-491**: 数据查询：
  ```ts
  nc.queryRowsByView(tableId, activeViewId, { limit: pageSize, offset: (page - 1) * pageSize, sort: sortParam })
  ```
  问题：`sort: sortParam` **总是传入**。即使 view 自身有 sort 规则，这里的 `sortParam` 默认是 `'Id'`，会 **覆盖 view 的排序**。

- **行 1255-1259** (gateway): 收到 `sort` 查询参数后直接传给 NocoDB：
  ```ts
  if (sort) params.set('sort', sort);
  ```
  NocoDB 行为：当 query string 中有 `sort` 参数时，它**覆盖**view自带的sort配置。

**根因：** `sortParam` 默认值为 `'Id'`（行 455），每次查询都通过 query string 传给 NocoDB，导致 view 自带的排序规则被覆盖。View sorts 面板创建的排序被 URL sort 参数压制。

**解决方案：**

修改行 455 和行 487-491：当存在 view sorts 时，不传 sort 参数，让 NocoDB view 自带的排序生效。

```ts
// 行 455: 仅在用户手动点击列头排序时设置 sortParam
const sortParam = sortCol ? (sortDir === 'desc' ? `-${sortCol}` : sortCol) : undefined;

// 行 487-491: 只在 sortParam 有值时传 sort
queryFn: () => activeViewId
  ? nc.queryRowsByView(tableId, activeViewId, {
      limit: pageSize,
      offset: (page - 1) * pageSize,
      ...(sortParam ? { sort: sortParam } : {}),
    })
  : nc.queryRows(tableId, {
      limit: pageSize,
      offset: (page - 1) * pageSize,
      sort: sortParam || 'Id',
    }),
```

同时需要将 `queryKey` 中的 `sortParam` 改为处理 undefined：
```ts
queryKey: ['nc-rows', tableId, activeViewId, page, sortParam || '__view_default__'],
```

并且当 `viewSorts` 有值时，列头的本地 `sortCol` 排序应提示用户可能与 view sort 冲突，或自动清除本地 sortCol。

---

### Issue 1.3: 看板/画板视图问题

**1.3a: 看板卡片拖拽到另一个分组**

**代码分析：**

- **行 4805-4866**: `KanbanView` 组件内有完整的 DnD 实现：
  - `handleKanbanDragStart` (行 4812): 设置 `draggedRowId`
  - `handleKanbanDragOver` (行 4816): 设置 `dragOverGroup`
  - `handleKanbanDragEnd` (行 4834): 更新行的分组字段值

- 问题在行 4869 的 `<DndContext>` 配置。`SortableContext` 用于卡片（行 4892 的 `KanbanCard` 用了 `useSortable`），但每个组内并没有 `<SortableContext>`。dnd-kit 需要 SortableContext 包裹才能正确检测 drag over。

- 关键问题：`KanbanCard` 使用 `useSortable`（行 4689），但组件中没有任何 `<SortableContext>` 包裹这些 card。没有 SortableContext，`useSortable` 无法正确工作。

- 另一个问题：`allGroupKeys` 包含字符串，但 `KanbanCard` 的 id 是数字 (rowId)。当从一个组拖到另一个组时，dnd-kit 需要一个跨组的 collision detection 策略来识别目标 droppable。

**根因：** 缺少 `<SortableContext>` 包裹每个组内的卡片。`KanbanColumn` 使用了 `useDroppable`（行 4680），但卡片用了 `useSortable` 而没有 SortableContext，两者不兼容。同时 collision detection 使用默认的 `closestCenter`，跨组移动时可能不准确。

**解决方案：**

1. 在每个 `KanbanColumn` 内部为卡片添加 `SortableContext`：
```tsx
<KanbanColumn key={groupKey} id={groupKey} isOver={dragOverGroup === groupKey}>
  <SortableContext items={groupRows.map(r => r.Id as number)} strategy={verticalListSortingStrategy}>
    {/* ... cards ... */}
  </SortableContext>
</KanbanColumn>
```

2. 使用 `rectIntersection` 替代 `closestCenter` 作为 collision detection 策略，更适合跨容器拖拽。

3. 或者更简单的方案：把 `KanbanCard` 从 `useSortable` 改为 `useDraggable`（因为卡片只需要跨组移动，不需要组内排序）：
```tsx
function KanbanCard({ id, children, isDragging }) {
  const { attributes, listeners, setNodeRef, transform } = useDraggable({ id });
  // ...
}
```

**1.3b: Customize Card 不生效**

**代码分析：**

- **行 2177**: Cover field 的 select 元素没有 `value` 绑定和 `onChange` 处理：
  ```tsx
  <select className="...">
    <option value="">None</option>
    {displayCols.filter(c => c.type === 'Attachment').map(c => (
      <option key={c.column_id} value={c.column_id}>{c.title}</option>
    ))}
  </select>
  ```
  既没有 `value={activeView?.fk_cover_image_col_id}` 也没有 `onChange`。

- **行 2186-2198**: 字段显示/隐藏切换调用 `toggleColVisibility`。这个函数（行 1483）修改的是 `hiddenCols` state 和 view column visibility。但在 `KanbanView` 中（行 4896），卡片显示的字段受 `hiddenCols` 控制：
  ```ts
  columns.filter(c => ... && !hiddenCols.has(c.column_id)).slice(0, 3)
  ```
  这部分应该是工作的。

**根因：** Cover field 选择器是纯展示 UI，没有 `value` 和 `onChange` 绑定，选择后不会调用 `nc.updateKanbanConfig` 来持久化设置。同时 KanbanView 组件本身没有读取 `fk_cover_image_col_id` 来渲染封面图。

**解决方案：**

1. 给 cover field select 添加状态绑定：
```tsx
<select
  value={activeView?.fk_cover_image_col_id || ''}
  onChange={async (e) => {
    const colId = e.target.value;
    await nc.updateKanbanConfig(activeView!.view_id, { fk_cover_image_col_id: colId || null });
    refreshMeta();
  }}
  className="..."
>
```

2. 在 `KanbanView` 中（行 4892附近），读取 `activeView.fk_cover_image_col_id`，找到对应的 Attachment 列，如果卡片的该列有图片附件，在卡片顶部渲染封面：
```tsx
const coverColId = activeView.fk_cover_image_col_id;
const coverCol = coverColId ? columns.find(c => c.column_id === coverColId) : null;
// 在 KanbanCard 内:
{coverCol && (() => {
  const attachments = row[coverCol.title];
  const images = parseAttachments(attachments).filter(a => a.mimetype?.startsWith('image/'));
  if (images.length === 0) return null;
  return <img src={ncAttachmentUrl(images[0])} className="w-full h-24 object-cover rounded-t-lg -m-3 mb-1.5" />;
})()}
```

**1.3c: 默认选择第一个附件列作为 cover field**

**代码分析：** 创建看板视图后（行 1964-1967），只设置了 `fk_grp_col_id`，没有设置 `fk_cover_image_col_id`。

**解决方案：** 在创建看板视图时，自动查找第一个 Attachment 列并设置为 cover：
```ts
if (vt.type === 'kanban') {
  const selectCol = displayCols.find(c => c.type === 'SingleSelect');
  if (selectCol) {
    await nc.updateKanbanConfig(newView.view_id, { fk_grp_col_id: selectCol.column_id });
  }
  // 自动设置 cover
  const attachCol = displayCols.find(c => c.type === 'Attachment');
  if (attachCol) {
    await nc.updateKanbanConfig(newView.view_id, { fk_cover_image_col_id: attachCol.column_id });
  }
}
```

---

### Issue 1.4: 单元格选中和多选

**需求理解：** 当前单击单元格直接进入编辑模式，需要改为：单击=选中（蓝色边框高亮），双击=编辑。支持拖拽多选，支持 Ctrl+C 复制选中内容。

**代码分析：**

- **行 2998**: 单元格 `onClick` 直接调用 `startEdit()`（行 3030）或打开 select dropdown 等。
- **行 808-824**: `startEdit` 函数：直接设置 `editingCell` 和 `editValue`，进入编辑模式。
- 完全没有 "选中但不编辑" 的中间状态。没有 `selectedCell` / `selectionRange` state。
- 也没有 `onDoubleClick` 处理。
- **行 3291**: 有一个 `pasteHint` 文本提示，但只出现在附件列空状态中。

**根因：** 缺少选中层（selectedCell state）和多选机制。当前直接从"未选中"跳到"编辑中"。

**解决方案：**

1. 新增 state：
```ts
const [selectedCell, setSelectedCell] = useState<{ rowId: number; col: string } | null>(null);
const [selectionRange, setSelectionRange] = useState<{
  startRow: number; startCol: number;
  endRow: number; endCol: number;
} | null>(null);
const [isDraggingSelection, setIsDraggingSelection] = useState(false);
```

2. 修改 `td` 的事件：
```tsx
<td
  onClick={() => {
    // 特殊类型保持现有行为（Links, Attachment, User, Select, Checkbox, Date）
    if (isSpecialType(col.type)) { /* 现有逻辑 */ return; }
    // 其他类型：单击=选中
    setSelectedCell({ rowId, col: col.title });
    setEditingCell(null);
  }}
  onDoubleClick={() => {
    if (isReadonly) return;
    startEdit(rowId, col.title, val, col.type);
  }}
  onMouseDown={(e) => {
    if (e.button !== 0) return;
    const rowIdx = rows.findIndex(r => (r.Id as number) === rowId);
    const colIdx = visibleCols.findIndex(c => c.column_id === col.column_id);
    setSelectionRange({ startRow: rowIdx, startCol: colIdx, endRow: rowIdx, endCol: colIdx });
    setIsDraggingSelection(true);
  }}
  onMouseEnter={() => {
    if (!isDraggingSelection || !selectionRange) return;
    const rowIdx = rows.findIndex(r => (r.Id as number) === rowId);
    const colIdx = visibleCols.findIndex(c => c.column_id === col.column_id);
    setSelectionRange(prev => prev ? { ...prev, endRow: rowIdx, endCol: colIdx } : null);
  }}
  className={cn(
    /* existing classes */,
    isInSelection(rowIdx, colIdx) && 'bg-sidebar-primary/10 ring-1 ring-sidebar-primary/30',
    isSelectedCell(rowId, col.title) && !isEditing && 'ring-2 ring-sidebar-primary',
  )}
>
```

3. 添加 `mouseup` 全局监听停止拖拽选择。

4. 添加全局键盘监听 `Ctrl+C`：
```ts
useEffect(() => {
  const handler = (e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'c' && selectionRange) {
      const { startRow, startCol, endRow, endCol } = normalizeRange(selectionRange);
      const lines: string[] = [];
      for (let r = startRow; r <= endRow; r++) {
        const cells: string[] = [];
        for (let c = startCol; c <= endCol; c++) {
          cells.push(String(rows[r]?.[visibleCols[c]?.title] ?? ''));
        }
        lines.push(cells.join('\t'));
      }
      navigator.clipboard.writeText(lines.join('\n'));
    }
  };
  document.addEventListener('keydown', handler);
  return () => document.removeEventListener('keydown', handler);
}, [selectionRange, rows, visibleCols]);
```

---

### Issue 1.5: 选中单元格后支持粘贴

**需求理解：** 选中单元格后，Ctrl+V 粘贴，支持多行多列（TSV 格式，Excel/Google Sheets 默认格式），超出现有列数时自动新增列。

**代码分析：** 目前无任何粘贴处理逻辑。

**根因：** 功能缺失。

**解决方案：**

在上面 Issue 1.4 的键盘监听中增加粘贴处理：
```ts
if ((e.metaKey || e.ctrlKey) && e.key === 'v' && selectedCell) {
  e.preventDefault();
  navigator.clipboard.readText().then(async (text) => {
    const lines = text.split('\n').filter(l => l.length > 0);
    const grid = lines.map(l => l.split('\t'));
    const startRowIdx = rows.findIndex(r => (r.Id as number) === selectedCell.rowId);
    const startColIdx = visibleCols.findIndex(c => c.title === selectedCell.col);
    if (startRowIdx < 0 || startColIdx < 0) return;

    // 检查是否需要新增列
    const maxPasteCols = Math.max(...grid.map(r => r.length));
    const neededCols = startColIdx + maxPasteCols - visibleCols.length;
    if (neededCols > 0) {
      for (let i = 0; i < neededCols; i++) {
        await nc.addColumn(tableId, `Column ${visibleCols.length + i + 1}`, 'SingleLineText');
      }
      await refreshMeta();
      // 重新获取 visibleCols
    }

    // 逐单元格更新
    for (let r = 0; r < grid.length; r++) {
      const targetRowIdx = startRowIdx + r;
      if (targetRowIdx >= rows.length) continue; // 可以选择自动新增行
      const targetRow = rows[targetRowIdx];
      const rowId = targetRow.Id as number;
      const updates: Record<string, unknown> = {};
      for (let c = 0; c < grid[r].length; c++) {
        const targetColIdx = startColIdx + c;
        if (targetColIdx >= visibleCols.length) continue;
        const col = visibleCols[targetColIdx];
        if (READONLY_TYPES.has(col.type) || col.primary_key) continue;
        updates[col.title] = grid[r][c];
      }
      if (Object.keys(updates).length > 0) {
        await nc.updateRow(tableId, rowId, updates);
      }
    }
    refresh();
  });
}
```

---

## Doc2: 关键问题

### Issue 2.1: 历史版本太多

**需求理解：** 几乎每个操作都创建一个历史版本，导致版本数量膨胀、内存占用大。

**代码分析：**

- **行 2802-2813** (gateway `maybeAutoSnapshot`): 检查最近一个 snapshot 是否超过 5 分钟，如果超过就创建新的。
- **行 1335-1336**: `insertRow` 后调用 `maybeAutoSnapshot`
- **行 1401-1402**: `updateRow` 后调用 `maybeAutoSnapshot`
- **行 1411-1412**: `deleteRow` 后调用 `maybeAutoSnapshot`
- 这意味着：如果用户间隔 5 分钟以上做一次操作，每次操作都会触发一个 snapshot。
- **行 2780-2790** (cleanup): 只保留 50 个最新的 snapshot，且删除 30 天以上的。但 snapshot 的 `data_json` 和 `schema_json` 可以很大（包含所有行数据的 JSON），50 个 snapshot * 大表 = 大量磁盘/内存占用。

**根因：**
1. 5 分钟间隔太短 — 频繁编辑场景下会产生大量快照。
2. 每个 snapshot 存储完整表数据（`data_json` 包含所有行），占用过大。
3. 保留 50 个上限太高。
4. 更根本的问题：market products (Notion, Airtable) 不在每次编辑时创建 snapshot，而是采用操作日志 (operation log) + 定时快照的方式。

**解决方案：**

**短期修复：**
1. 将 `maybeAutoSnapshot` 的间隔从 5 分钟改为 30 分钟：
```js
if (Date.now() - lastTime < 30 * 60 * 1000) return; // 30 minutes
```

2. 将保留上限从 50 降到 20：
```js
if (countAll.cnt > 20) {
  const nth = db.prepare('SELECT id FROM table_snapshots WHERE table_id = ? ORDER BY version DESC LIMIT 1 OFFSET 19').get(tableId);
```

3. 在 cleanup 中，对于超过 7 天的 snapshot 只保留最近 5 个：
```js
// 保留策略：最近 7 天保留所有，7-30 天保留每天最新 1 个，30 天以上删除
```

**中期方案：**
4. 改为基于时间窗口合并：连续编辑（如 1 小时内的多次编辑）合并为一个 snapshot。具体：`maybeAutoSnapshot` 不在每次写操作后调用，而是用一个 debounced scheduler：第一次写操作后 30 分钟才创建 snapshot，这期间的后续写操作重置 timer。

5. Snapshot 中不再存储完整 `data_json`，改为存储增量变更 (changeset)，需要回溯时通过 changeset 重建。或者只存储 schema 和统计信息，恢复时重新从 NocoDB 拉取。

**Gateway server.js 具体改动：**
```js
// 替换 maybeAutoSnapshot 为 debounced 版本
const snapshotTimers = new Map(); // tableId → timer

function scheduleAutoSnapshot(tableId, agent) {
  if (snapshotTimers.has(tableId)) {
    clearTimeout(snapshotTimers.get(tableId));
  }
  snapshotTimers.set(tableId, setTimeout(async () => {
    snapshotTimers.delete(tableId);
    try {
      await createTableSnapshot(tableId, 'auto', agent);
    } catch (e) {
      console.error(`[gateway] Auto-snapshot failed: ${e.message}`);
    }
  }, 30 * 60 * 1000)); // 30 分钟后创建
}
```

---

## Doc3: 类型优化

### Issue 3.1: 乐观更新问题

**3.1a: 单选选择选项后闪一下**

**代码分析：**

- **行 882-892** (`setSelectValue`): 没有做乐观更新！
  ```ts
  const setSelectValue = async (rowId, col, value) => {
    if (value) await ensureSelectOption(col, value);
    await nc.updateRow(tableId, rowId, { [col]: value });
    refresh();        // ← 等 API 返回后才 refresh
    refreshMeta();
    setSelectDropdown(null);
  };
  ```
  整个过程是：1) 调用 API 更新 option 定义 → 2) 调用 API 更新行值 → 3) 关闭 dropdown → 4) refresh 重新查询。

  在步骤 2 完成前，UI 显示旧值。步骤 4 的 refresh 又会触发重新查询，造成"闪一下"（旧值 → 空 → 新值）。

**根因：** `setSelectValue` 缺少乐观更新，且关闭 dropdown 在 API 返回后。

**解决方案：**
```ts
const setSelectValue = async (rowId: number, col: string, value: string) => {
  // 1. 乐观更新 UI
  queryClient.setQueriesData({ queryKey: ['nc-rows', tableId] }, (old: unknown) => {
    const data = old as { list: Record<string, unknown>[]; pageInfo?: unknown } | undefined;
    if (!data) return old;
    return { ...data, list: data.list.map(r => (r.Id as number) === rowId ? { ...r, [col]: value } : r) };
  });
  // 2. 立即关闭 dropdown
  setSelectDropdown(null);
  try {
    if (value) await ensureSelectOption(col, value);
    await nc.updateRow(tableId, rowId, { [col]: value });
    refresh();
    refreshMeta();
  } catch (e) {
    console.error('Set select failed:', e);
    refresh(); // revert
  }
};
```

**3.1b: Checkbox 点击**

**代码分析：**

- **行 850-865** (`toggleCheckbox`): 已经有乐观更新！
  ```ts
  queryClient.setQueriesData({ queryKey: ['nc-rows', tableId] }, (old) => {
    return { ...data, list: data.list.map(r => ... { ...r, [col]: newVal } ...) };
  });
  await nc.updateRow(tableId, rowId, { [col]: newVal });
  refresh();
  ```
  但行 860 的注释说"NocoDB/PostgreSQL requires boolean values"。实际问题可能是 `refresh()` 调用导致了闪烁 — 乐观更新后立即 refresh，refresh 的结果可能还没包含最新值（NocoDB 写入延迟），导致短暂回退到旧值。

**根因：** 乐观更新后的 `refresh()` 可能导致短暂闪烁。NocoDB 写入可能有 eventual consistency 延迟。

**解决方案：** 在 `refresh()` 前增加短延迟，或用 `queryClient.invalidateQueries` 替代并依赖 staleTime：
```ts
// 不立即 refresh，让乐观更新保持，下次用户交互或定时刷新时自然同步
// 或者延迟刷新：
setTimeout(() => refresh(), 500);
```

**3.1c: User 类型点击等一会儿**

**代码分析：** User field 更新在 RowDetailPanel 或直接 cell click 中处理。User picker（行 3195 附近）选择 agent 后调用 `nc.updateRow`，无乐观更新。

**解决方案：** 与 3.1a 相同模式，在 User picker 选择 agent 后立即乐观更新 UI。

---

### Issue 3.2: 类型切换应支持清除数据的情况

**代码分析：**

- **行 3515-3528** (`getCompat`): 定义了三种兼容性级别：
  - `ok`: 安全转换
  - `lossy`: 会丢失数据（弹 confirm 确认）
  - `blocked`: 完全不允许

- 行 3542-3547: `blocked` 类型显示为灰色不可点击。

**需求：** 用户要求即使会清除数据也允许切换（例如从 Number 切到 SingleSelect），只需提醒用户数据会被清除。当前 `blocked` 列表中有些类型可以改为 `lossy`。

**根因：** `IMMUTABLE_TYPES` 包含了 `CreatedTime`, `LastModifiedTime`, `AutoNumber` 等类型，但需求要求这些之外的类型之间应该都是可切换的（with warning）。

**解决方案：**

修改 `getCompat` 函数：
```ts
const getCompat = (from: string, to: string): 'ok' | 'lossy' | 'clear' | 'blocked' => {
  if (from === to) return 'ok';
  // 只有真正不可变的类型之间才 blocked
  const TRULY_IMMUTABLE = new Set(['Links', 'LinkToAnotherRecord', 'Lookup', 'Rollup', 'Formula']);
  if (TRULY_IMMUTABLE.has(from) || TRULY_IMMUTABLE.has(to)) return 'blocked';
  // 系统列不能改为用户列
  const SYSTEM_TYPES = new Set(['CreatedTime', 'LastModifiedTime', 'AutoNumber', 'ID', 'CreatedBy', 'LastModifiedBy']);
  if (SYSTEM_TYPES.has(to) && !SYSTEM_TYPES.has(from)) return 'blocked';
  // 同组安全转换
  if (TEXT_TYPES.has(from) && TEXT_TYPES.has(to)) return 'ok';
  if (NUM_TYPES.has(from) && NUM_TYPES.has(to)) return 'ok';
  // 不同组：会清除数据
  return 'clear';
};
```

新增 `clear` 级别的 UI 提示（与 `lossy` 类似但措辞不同）：
```ts
if (compat === 'clear') {
  if (!window.confirm(t('dataTable.typeChangeClearConfirm', {
    from: t(`dataTable.colTypes.${origType}`),
    to: t(`dataTable.colTypes.${ct.value}`)
  }))) return;
}
```

---

### Issue 3.3: 关联列选择关联项目需用完整表格展示

**代码分析：**

- **LinkRecordPicker.tsx** (完整文件): 当前是一个简单的列表视图，每行只显示 display column 的值（行 168-169）：
  ```tsx
  <span className="text-xs text-foreground truncate flex-1">
    {String(row[displayColTitle] || row.Title || row.Id)}
  </span>
  ```
- 只显示一列，不显示被关联表的其他字段。
- 搜索只基于 display column（行 44）。
- 要求的效果（参考 NocoDB 截图）：多列表格、checkbox 勾选、搜索。

**根因：** `LinkRecordPicker` 设计为简单列表，只渲染 display column。

**解决方案：**

重写 `LinkRecordPicker` 为多列表格：

1. 获取 `relatedMeta.columns` 并在表头渲染所有可见列（排除系统列）。

2. 用 checkbox 替代 +/- 按钮来 link/unlink：
```tsx
// 在可用记录列表中
{relatedMeta?.columns
  ?.filter(c => c.type !== 'ID' && c.title !== 'created_by')
  .slice(0, 6) // 限制列数
  .map(c => (
    <th key={c.column_id} className="...">{c.title}</th>
  ))
}

// 每行：
<tr>
  <td>
    <input
      type="checkbox"
      checked={linkedIds.has(rid)}
      onChange={() => linkedIds.has(rid) ? handleUnlink(rid) : handleLink(rid)}
    />
  </td>
  {shownColumns.map(c => (
    <td key={c.column_id}>{String(row[c.title] ?? '')}</td>
  ))}
</tr>
```

3. 搜索改为全局搜索（不限于 display column）。

4. 弹窗尺寸从 `max-w-md` 改为 `max-w-2xl` 或 `max-w-4xl`。

---

### Issue 3.4: 单选创建新取值不生效

**代码分析：**

- **行 3113-3121**: Enter 键处理：
  ```ts
  if (e.key === 'Enter' && selectInput.trim()) {
    if (selectDropdown.multi) {
      toggleMultiSelect(rowId, col.title, val, selectInput.trim());
    } else {
      setSelectValue(rowId, col.title, selectInput.trim());
    }
    setSelectInput('');
    refreshMeta();
  }
  ```
  这里调用 `setSelectValue`，内部会先 `ensureSelectOption` 再 `updateRow`。逻辑看起来是对的。

- **行 3170-3185**: "Create" 按钮的 onClick：
  ```ts
  onClick={(e) => {
    e.stopPropagation();
    if (selectDropdown.multi) {
      toggleMultiSelect(rowId, col.title, val, selectInput.trim());
    } else {
      setSelectValue(rowId, col.title, selectInput.trim());
    }
    setSelectInput('');
    refreshMeta();
  }}
  ```

- 检查 `ensureSelectOption`（行 868-880）：
  ```ts
  const ensureSelectOption = async (colTitle, optionTitle) => {
    const colDef = meta?.columns?.find(c => c.title === colTitle);
    if (!colDef) return;
    const exists = colDef.options?.some(o => o.title === optionTitle);
    if (!exists) {
      const updatedOptions = [...(colDef.options || []), { title: optionTitle, color: ... }];
      await nc.updateColumn(tableId, colDef.column_id, { options: updatedOptions });
    }
  };
  ```

  注意 `nc.updateColumn` (行 178-183):
  ```ts
  async function updateColumn(tableId, columnId, updates: { title?, uidt?, options?, meta? }) {
    await ncFetch(`/tables/${tableId}/columns/${columnId}`, {
      method: 'PATCH',
      body: JSON.stringify(updates),
    });
  }
  ```

- 检查 gateway 的 column update 路由... 让我搜索。

**Gateway column update:**
```
PATCH /api/data/tables/:table_id/columns/:column_id
```

让我查看 gateway 是否正确处理这个路由。

<让我查看>

实际上问题可能在于 `ensureSelectOption` 中的 `nc.updateColumn` 传的 `options` 格式。NocoDB API 期望 `colOptions.options` 字段而不是直接的 `options`。

但更关键的可能是：`ensureSelectOption` 是 async 但 `setSelectValue` 中 `ensureSelectOption` 和 `updateRow` 是顺序执行的，如果 `ensureSelectOption` 失败（但被 catch 吞了），`updateRow` 还是会执行，可能导致 NocoDB 拒绝（因为 option 不存在）。

**根因推测：** `nc.updateColumn` 对 options 的传参格式可能与 NocoDB API 不匹配。NocoDB v2 API 中 SingleSelect 的 options 需要通过 `colOptions.options` 传递，但代码直接传 `{ options: [...] }`。如果这个调用失败但被吞了，后续 `updateRow` 设置一个不在 options 列表中的值，NocoDB 可能静默忽略。

**解决方案：**

1. 在 `ensureSelectOption` 中添加错误日志，确认 API 调用是否成功。
2. 检查 gateway 对 column update 的代理是否正确转发 options 格式。
3. 确保 `refreshMeta()` 在 option 创建后执行，这样 `meta.columns` 缓存才有最新 options。
4. 添加 await 确保 `ensureSelectOption` 完成后才执行 `updateRow`：当前代码已经是 await 的（`setSelectValue` 中 `await ensureSelectOption(...)`），所以顺序是对的。

Gateway column update 路由（server.js 行 1051-1076）：
```js
app.patch('/api/data/tables/:table_id/columns/:column_id', async (req, res) => {
  const body = {};
  if (req.body.title) { body.title = req.body.title; body.column_name = req.body.title; }
  if (req.body.uidt) body.uidt = req.body.uidt;
  if (req.body.options) {
    body.colOptions = { options: req.body.options.map((o, i) => ({
      title: o.title || o, color: o.color, order: i + 1
    })) };
  }
  const result = await nc('PATCH', `/api/v1/db/meta/columns/${req.params.column_id}`, body);
});
```

Gateway 正确地将 `options` 转换为 `colOptions.options` 格式。但注意 `ensureSelectOption` 中 `nc.updateColumn`（行 178）直接传 `{ options: updatedOptions }`，Gateway 行 1057 正确转换为 `colOptions.options`。所以 options 创建应该是工作的。

**真正的根因可能是：**
1. `ensureSelectOption` 使用 `meta?.columns` 来检查 option 是否已存在。但 `meta` 是 React Query 缓存的数据，可能已过期。如果用户快速创建多个新 option，第二个 `ensureSelectOption` 调用时 `meta` 还是旧的（没有包含第一个刚创建的 option），导致重复创建 → NocoDB 返回冲突错误 → 被 catch 吞掉。
2. `refreshMeta()` 在创建 option 后调用，但是异步的。下次 `ensureSelectOption` 时 meta 可能还没刷新。

**解决方案：**
1. 在 `ensureSelectOption` 成功后，立即更新 React Query cache 中的 column options，而不是等 `refreshMeta` 异步刷新：
```ts
const ensureSelectOption = async (colTitle: string, optionTitle: string) => {
  const colDef = meta?.columns?.find(c => c.title === colTitle);
  if (!colDef) return;
  const exists = colDef.options?.some(o => o.title === optionTitle);
  if (!exists) {
    const newOpt = { title: optionTitle, color: SELECT_COLORS[(colDef.options?.length || 0) % SELECT_COLORS.length] };
    const updatedOptions = [...(colDef.options || []), newOpt];
    await nc.updateColumn(tableId, colDef.column_id, { options: updatedOptions });
    // 立即更新 cache
    queryClient.setQueryData(['nc-table-meta', tableId], (old: nc.NCTableMeta | undefined) => {
      if (!old) return old;
      return {
        ...old,
        columns: old.columns.map(c =>
          c.column_id === colDef.column_id ? { ...c, options: updatedOptions } : c
        ),
      };
    });
  }
};
```

2. 在 `setSelectValue` 和 `toggleMultiSelect` 中，确保 `ensureSelectOption` 错误被正确处理（目前它的错误会传播到 `setSelectValue` 的 catch 中，但 `setSelectValue` 只是 console.error 不做重试）。

---

### Issue 3.5: 多选直接在单元格创建新取值不生效

**代码分析：** 与 3.4 相同的代码路径。`toggleMultiSelect`（行 894-916）内部也调用 `ensureSelectOption`（行 908）。

**根因：** 与 3.4 相同——`ensureSelectOption` 的 meta 缓存过期问题。

**解决方案：** 与 3.4 统一修复。

---

### Issue 3.6: CreatedTime 内容填入的是当前时间而不是创建时间

**代码分析：**

- **Gateway 行 1313-1317** (insert row):
  ```js
  const now = new Date().toISOString();
  if ((col.uidt === 'CreateTime' || col.uidt === 'CreatedTime') && !rowData[col.title]) {
    rowData = { ...rowData, [col.title]: now };
  }
  ```
  这里用 `new Date().toISOString()` 作为创建时间。这本身是正确的——创建行时的当前时间就是创建时间。

- 但问题可能在别处：当用户后来编辑这行的其他字段时，`updateRow` 路由（行 1340-1357）会不会错误更新 CreatedTime？

  检查行 1348-1355：
  ```js
  for (const col of meta.data.columns) {
    if (col.uidt === 'LastModifiedTime') {
      updateData = { ...updateData, [col.title]: now };
    }
    if (col.uidt === 'LastModifiedBy') { ... }
  }
  ```
  这里**只更新 LastModifiedTime**，不碰 CreatedTime。所以后续编辑不会覆盖 CreatedTime。

- 那问题可能出在**前端显示**上。行 4465:
  ```ts
  if (colType === 'Date' || colType === 'DateTime' || colType === 'CreatedTime' || colType === 'LastModifiedTime')
  ```
  渲染逻辑似乎是正确的。

- 再看：NocoDB 可能对 CreatedTime 类型有自己的处理。NocoDB v2 在数据库层面自动管理 CreatedTime 列（类似 PostgreSQL 的 default value）。Gateway 手动填 `now` 时，NocoDB 可能不认 — 它可能会返回自己的值。但如果 NocoDB 的 CreatedTime 列是由 NocoDB 自动管理的 system column，那么 gateway 设置的值可能被忽略，NocoDB 返回的是其自身记录的创建时间（应该正确）。

- 问题更可能是：NocoDB 对通过 Gateway 创建的 CreatedTime 列**不是** system column，而是普通列，类型设为 `CreatedTime`。在这种情况下 NocoDB 不会自动管理它，gateway 的 `now` 就是正确的。

**重新审视需求：** "内容填入的是当前时间而不是创建时间"。这暗示用户看到的时间不对。可能的原因：

1. **时区问题**: `new Date().toISOString()` 返回 UTC 时间。如果前端显示时不做时区转换，用户看到的是 UTC 时间而非本地时间。
2. **行创建时的延迟**: 如果用户在 T1 点击创建行，但 `handleAddRow` 先插入空行（行 995 `nc.insertRow(tableId, {})`），gateway 在 T2 时填入时间。T2 - T1 的延迟可能不大。
3. **更可能**: 用户创建 CreatedTime **列**时，已有行的 CreatedTime 值是被 Gateway auto-fill 为"添加列的那个时间点"（当前时间），而不是行实际创建的时间。

**根因：** 当用户在已有数据的表上添加一个 `CreatedTime` 类型的列时，Gateway 的 `addColumn` 不会回填已有行的创建时间。如果 NocoDB 不自动管理（因为是自定义列非 system column），已有行的 CreatedTime 值要么为空，要么 NocoDB 可能会用当前时间填充——这才是"当前时间"问题的根源。

**解决方案：**

1. NocoDB 的 `CreatedTime` 类型列如果是 system column，NocoDB 会自动管理。确保创建列时使用正确的 NocoDB API 参数让它成为 system column。
2. 如果无法成为 system column，则在创建列后，Gateway 应查询 NocoDB 每行的 `created_at` 元数据字段，回填到新的 CreatedTime 列。

---

### Issue 3.7: LastModifiedTime 问题

**需求：** (a) 值不是最新更新时间 (b) 值不随编辑操作更新。

**代码分析：**

- **Gateway 行 1348-1351** (updateRow): 自动更新 LastModifiedTime:
  ```js
  if (col.uidt === 'LastModifiedTime') {
    updateData = { ...updateData, [col.title]: now };
  }
  ```
  这看起来是正确的——每次 updateRow 都会把 LastModifiedTime 设为 now。

- 但注意行 1344-1345：
  ```js
  const meta = await nc('GET', `/api/v1/db/meta/tables/${req.params.table_id}`);
  if (meta.status < 400 && meta.data?.columns) {
  ```
  如果 meta 获取失败（网络问题、NocoDB 慢响应），就跳过 auto-fill。

- 另一个问题：这个 auto-fill 只在 Gateway 的 `PATCH /api/data/:table_id/rows/:row_id` 路由中。如果前端通过其他路径更新数据（直接调 NocoDB？），LastModifiedTime 不会更新。但从代码看，前端只通过 `nc.updateRow` → Gateway proxy → NocoDB 这条路径。

- 更可能的问题：与 3.6 相同，NocoDB 可能对 `LastModifiedTime` 列有自己的处理逻辑。如果 NocoDB 认为这是 system column，它可能忽略 Gateway 传入的值；如果不是 system column，Gateway 的值应该生效。

- 再检查：Gateway 的 updateRow 在行 1358:
  ```js
  const result = await nc('PATCH', `/api/v1/db/data/noco/${NC_BASE_ID}/${req.params.table_id}/${req.params.row_id}`, updateData);
  ```
  `updateData` 包含了 `[col.title]: now`。但 NocoDB 可能**拒绝**直接写入 system column 的值。

**根因：** NocoDB 对 `CreatedTime` 和 `LastModifiedTime` 类型的列，如果是 system column，会由 NocoDB 引擎自动管理，忽略用户传入的值。Gateway 的 auto-fill 对这类列无效。问题是这些列可能在 NocoDB 中被创建为普通列（Gateway 的 `addColumn` 只传 `uidt: 'LastModifiedTime'`），NocoDB 可能将其视为普通列但不自动管理。

**解决方案：**

1. 确认 NocoDB API 中 `CreatedTime` / `LastModifiedTime` 列的行为：
   - 如果 NocoDB 自动管理这些列（system column），则 Gateway 不需要手动 fill，但前端应确保显示 NocoDB 返回的值。
   - 如果 NocoDB 不自动管理（自定义列），Gateway 的 auto-fill 逻辑需要确保生效。

2. 在 gateway 的 updateRow 中，添加日志验证 `updateData` 是否包含 LastModifiedTime 值，以及 NocoDB 返回的结果是否反映了更新。

3. 更可靠的方案：在 gateway 的 row update 响应后，如果 NocoDB 返回的数据中 LastModifiedTime 仍是旧值，则强制 re-patch。或者使用 NocoDB 的 webhook/hook 机制自动更新。

---

## Doc4: 稳定性问题

### Issue 4.1: 表格不稳定

**4.1a: LoadError 或 Rendering Error**

**代码分析：**

- **行 291-317** (Error Boundary): `TableEditorErrorBoundary` 捕获 React render errors，显示 "Table rendering error" + Retry/Back 按钮。这只是错误展示，不是错误根因。

- **行 1666-1677** (metaError): 当 `describeTable` API 失败时显示 "Failed to load table"。这对应 502 错误。

- **行 457-461**: meta 查询有 `retry: 2`。

- 502 错误的可能原因：
  1. Gateway → NocoDB 连接不稳定
  2. NocoDB 服务重启/OOM
  3. Gateway 的 `nc()` helper 中 NocoDB auth token 过期

- Rendering error 的可能原因：
  1. 数据格式异常导致 JS 运行时错误（例如 `JSON.parse` 失败、undefined 属性访问）
  2. 非常大的表导致内存溢出

- 检查 Gateway 的 NocoDB 认证：
  需要查看 `nc()` helper function 是否正确处理 token 刷新。

**根因推测：** 多个可能的触发源：
1. NocoDB auth token 过期但 Gateway 未刷新（最可能导致 502）
2. 前端代码中某些数据类型的渲染路径缺少 null check（导致 rendering error）
3. 大量 snapshot 占用内存导致 NocoDB/Gateway OOM

**解决方案：**

1. **Gateway NocoDB token 刷新**: 确保 `nc()` function 在 token 过期（401）时自动重新登录并重试请求。检查 gateway 中的 NocoDB auth 实现。

2. **前端防护**: 在 `CellDisplay`（约行 4300 开始）的每个分支中添加 try-catch，防止单个单元格渲染错误导致整个表崩溃：
```tsx
// 在 renderRow 中每个 <td> 的内容包裹 try-catch
try {
  return <CellDisplay value={val} col={col} ... />;
} catch (e) {
  return <span className="text-destructive text-xs">Error</span>;
}
```

3. **增加 meta 查询重试和 staleTime**：
```ts
const { data: meta, ... } = useQuery({
  queryKey: ['nc-table-meta', tableId],
  queryFn: () => nc.describeTable(tableId),
  retry: 3,
  retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 10000),
  staleTime: 30000, // 30s 不重复请求
});
```

**4.1b: 默认视图未显示或显示了却未被选中**

**代码分析：**

- **行 463-476** (设置 activeViewId):
  ```ts
  // Reset activeViewId when tableId changes
  useEffect(() => {
    setActiveViewId(null);
  }, [tableId]);

  // Set active view to default when meta loads
  useEffect(() => {
    if (meta?.views?.length && !activeViewId) {
      const savedViewId = localStorage.getItem(...);
      const savedView = savedViewId ? meta.views.find(v => v.view_id === savedViewId) : null;
      const defaultView = savedView || meta.views.find(v => v.is_default) || meta.views[0];
      setActiveViewId(defaultView.view_id);
    }
  }, [meta?.views, tableId]);
  ```

- 问题：两个 `useEffect` 存在竞态条件。当 `tableId` 变化时：
  1. 第一个 effect 将 `activeViewId` 设为 `null`
  2. 第二个 effect 依赖 `[meta?.views, tableId]`。如果 `meta` 还是旧表的 meta（因为新 meta 还在加载），`meta?.views?.length` 为 true，`!activeViewId` 也为 true（刚被设为 null），所以会**用旧表的 views 设置 activeViewId**。
  3. 新 meta 加载后，`!activeViewId` 为 false（已被设为旧 view），第二个 effect 不再触发。

- 另一个问题：第二个 effect 的依赖列表是 `[meta?.views, tableId]`，但 eslint 注释 `// eslint-disable-line react-hooks/exhaustive-deps` 暗示缺少了 `activeViewId` 依赖。这是有意的（避免无限循环），但导致了逻辑不严谨。

**根因：** `tableId` 变更和 `meta` 加载之间的竞态条件。旧 meta 的 views 可能在 `activeViewId` 被 reset 后被错误使用。同时 `meta?.views` 作为 useEffect 依赖是引用比较，每次 meta 返回都是新数组对象，可能导致不必要的重触发。

**解决方案：**

合并两个 effect 为一个，并增加 tableId 匹配检查：
```ts
useEffect(() => {
  // 确保 meta 对应当前 tableId
  if (!meta || meta.table_id !== tableId) {
    setActiveViewId(null);
    return;
  }
  if (meta.views?.length) {
    const savedViewId = localStorage.getItem(`asuite-table-last-view-${tableId}`);
    const savedView = savedViewId ? meta.views.find(v => v.view_id === savedViewId) : null;
    const defaultView = savedView || meta.views.find(v => v.is_default) || meta.views[0];
    setActiveViewId(defaultView.view_id);
  }
}, [meta?.table_id, tableId]); // meta.table_id 变化才重新设置
```

这样确保只有当 meta 和 tableId 匹配时才设置 activeViewId。

---

### Issue 4.2: 文档列表加载速度慢

**需求理解：** 文档列表（侧边栏）加载一直很慢，但数据量应该很小。

**代码分析：**

- **content/page.tsx 行 234-240**:
  ```ts
  const { data: docs } = useQuery({
    queryKey: ['outline-docs'],
    queryFn: () => ol.listDocuments(),
    staleTime: 5 * 60 * 1000,
  });
  ```

- **outline.ts 行 58-71** (`listDocuments`): 使用分页循环获取所有文档：
  ```ts
  while (true) {
    const data = await olFetch(..., { limit: 100, offset });
    allDocs.push(...data.data);
    if (data.data.length < limit) break;
    offset += limit;
  }
  ```
  如果文档数 > 100，这会发出多次串行 HTTP 请求。

- **Outline proxy** (`/api/outline/[...path]/route.ts`):
  - 行 7-8: 有 30s TTL 的 in-memory cache for `documents.list`
  - 行 68-82: cache 命中逻辑 — 如果 cache 存在且 < 30s，直接返回；如果 > 30s 但存在，返回旧值并后台刷新。
  - **问题**: cache 只存储第一页（offset=0, limit=100）的结果！

  行 17-18: `refreshDocListCache` 只请求 `{ limit: 100, offset: 0 }`。

  但前端 `listDocuments()` 会发出多次请求（offset=0, 100, 200...）。每次请求的 cache key 不同（因为 body 不同），只有第一页命中 cache。

- 同时 `listDocuments` 是串行分页，每页都要经过 Next.js proxy → Outline server 往返。

**根因：**

1. **串行分页**: `listDocuments` 一次只请求 100 个文档，如果有 300 个文档需要 3 次串行请求。每次都经过 Next.js API route proxy + Outline server，延迟累加。

2. **Cache 不完整**: Outline proxy 的 cache 只缓存 `documents.list` 的第一页。第 2/3 页不被缓存。

3. **无增量加载**: 每次加载都获取全部文档。

**解决方案：**

**方案一（快速修复）：增大单次请求量 + 改进缓存**

1. 在 `listDocuments` 中增大 limit：Outline 可能支持更大的 limit。
```ts
const limit = 500; // 尝试增大，如果 Outline 支持
```

2. 在 Outline proxy 中缓存完整文档列表（所有页合并后的结果），而不是单页：
```ts
// 在 proxy 层面，拦截 offset > 0 的请求，如果 cache 中已有完整列表，直接 slice 返回
```

**方案二（推荐）：一次请求全部 + 前端缓存**

修改 `listDocuments` 和 proxy 配合：

1. 前端只发一次请求，让 proxy 处理分页合并：
```ts
export async function listDocuments(): Promise<OLDocument[]> {
  // 使用特殊参数让 proxy 返回全部
  const data = await olFetch<{ data: OLDocument[] }>('documents.list', { limit: 1000, offset: 0 });
  return data.data;
}
```

2. Outline proxy 中 `refreshDocListCache` 改为分页获取所有文档并合并缓存。

3. 增加 `staleTime` 到 10 分钟 + 利用 `keepPreviousData` 避免加载状态闪烁：
```ts
const { data: docs } = useQuery({
  queryKey: ['outline-docs'],
  queryFn: () => ol.listDocuments(),
  staleTime: 10 * 60 * 1000,
  placeholderData: keepPreviousData,
});
```

---

## 依赖图

```
Issue 1.4 (单元格选中) ──depends-on──> Issue 1.5 (粘贴)
Issue 3.4 (单选创建) ──same-root──> Issue 3.5 (多选创建)
Issue 3.6 (CreatedTime) ──same-root──> Issue 3.7 (LastModifiedTime)
Issue 3.1a (单选乐观) ──same-pattern──> Issue 3.1b (checkbox乐观) ──same-pattern──> Issue 3.1c (user乐观)
Issue 1.3a (看板拖拽) ──depends-on──> Issue 1.3b (Customize Card) — 都需要修改 KanbanView
Issue 4.1b (视图选中) ──contributes-to──> Issue 4.1a (rendering error) — 错误的 view state 导致崩溃
Issue 2.1 (历史版本) ──contributes-to──> Issue 4.1a (稳定性) — 内存占用影响 NocoDB 稳定性
```

## 优先级矩阵

| 优先级 | Issue | 影响 | 难度 | 理由 |
|--------|-------|------|------|------|
| P0 | 4.1 (稳定性) | 致命 | 中 | 需求原文："直接决定生死"。修复竞态条件 + 增加防护 |
| P0 | 1.2 (排序不生效) | 严重 | 低 | 核心功能缺陷，改 1 行代码 (`sortParam` 默认值) |
| P1 | 2.1 (版本太多) | 严重 | 低 | 改 snapshot 间隔 + 清理策略，代码量小 |
| P1 | 3.1 (乐观更新) | 体验差 | 低 | 单选/checkbox/user 三处加乐观更新，模式相同 |
| P1 | 3.6+3.7 (时间列) | 功能错误 | 中 | 需要理清 NocoDB system column 机制 |
| P1 | 4.2 (文档加载慢) | 体验差 | 低 | 优化分页 + 缓存策略 |
| P2 | 1.1 (筛选类型) | 粗糙 | 中 | 需要重构 FILTER_OPS + 针对不同类型的值输入 UI |
| P2 | 1.3 (看板/画板) | 功能缺陷 | 中 | 三个子问题：DnD 修复 + cover + customize card |
| P2 | 3.3 (关联列表格) | 体验差 | 中 | 重写 LinkRecordPicker 为多列表格 |
| P2 | 3.2 (类型切换) | 受限 | 低 | 调整 getCompat 兼容性规则 |
| P2 | 3.4+3.5 (创建选项) | 功能缺陷 | 低 | 需排查 NocoDB column update API 格式 |
| P3 | 1.4 (单元格选中) | 功能缺失 | 高 | 需要新增选中层 + 多选 + 拖拽选择 |
| P3 | 1.5 (粘贴) | 功能缺失 | 中 | 依赖 1.4 的选中机制 |

## 关键文件路径

- `/Users/mac/Documents/asuite/shell/src/components/table-editor/TableEditor.tsx` — 主组件 (5175 行)
- `/Users/mac/Documents/asuite/shell/src/components/table-editor/LinkRecordPicker.tsx` — 关联选择器
- `/Users/mac/Documents/asuite/shell/src/lib/api/nocodb.ts` — NocoDB API 客户端
- `/Users/mac/Documents/asuite/gateway/server.js` — Gateway 代理 + auto-snapshot
- `/Users/mac/Documents/asuite/shell/src/app/api/outline/[...path]/route.ts` — Outline proxy + cache
- `/Users/mac/Documents/asuite/shell/src/lib/api/outline.ts` — Outline API 客户端
- `/Users/mac/Documents/asuite/shell/src/app/(workspace)/content/page.tsx` — 内容页面 + 文档列表
