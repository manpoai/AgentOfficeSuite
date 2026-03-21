'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as gw from '@/lib/api/gateway';
import { CheckSquare, Circle, Clock, Loader2, CheckCircle2, XCircle, X, ArrowUp, ArrowDown, Plus, Calendar, User, GripVertical, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useState, useCallback, useMemo } from 'react';
import { DndContext, DragOverlay, closestCenter, PointerSensor, useSensor, useSensors, type DragEndEvent, type DragStartEvent } from '@dnd-kit/core';
import { useDroppable, useDraggable } from '@dnd-kit/core';
import { Comments } from '@/components/comments/Comments';
import { Filter, ChevronDown } from 'lucide-react';

const STATUS_CONFIG = {
  todo: { label: '待做', icon: Circle, color: 'text-muted-foreground', bg: 'bg-muted', group: 'unstarted' },
  in_progress: { label: '进行中', icon: Loader2, color: 'text-blue-500', bg: 'bg-blue-500/10', group: 'started' },
  done: { label: '完成', icon: CheckCircle2, color: 'text-green-500', bg: 'bg-green-500/10', group: 'completed' },
  cancelled: { label: '取消', icon: XCircle, color: 'text-muted-foreground', bg: 'bg-muted', group: 'cancelled' },
} as const;

// Map Plane state groups back to our status keys
const GROUP_TO_STATUS: Record<string, keyof typeof STATUS_CONFIG> = {
  unstarted: 'todo', started: 'in_progress', completed: 'done', cancelled: 'cancelled',
};

const PRIORITY_CONFIG: Record<string, { label: string; color: string }> = {
  urgent: { label: '紧急', color: 'text-red-500' },
  high: { label: '高', color: 'text-orange-500' },
  medium: { label: '中', color: 'text-yellow-500' },
  low: { label: '低', color: 'text-blue-400' },
  none: { label: '无', color: 'text-muted-foreground' },
};

type ViewMode = 'kanban' | 'list';

function getTaskStatus(task: gw.Task): keyof typeof STATUS_CONFIG {
  const s = task.status;
  if (s && s in STATUS_CONFIG) return s as keyof typeof STATUS_CONFIG;
  if (s && s in GROUP_TO_STATUS) return GROUP_TO_STATUS[s];
  return 'todo';
}

type TaskFilters = {
  status: Set<string>;
  priority: Set<string>;
  assignee: string;
};

export default function TasksPage() {
  const [viewMode, setViewMode] = useState<ViewMode>('kanban');
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [filters, setFilters] = useState<TaskFilters>({ status: new Set(), priority: new Set(), assignee: '' });
  const queryClient = useQueryClient();

  const { data: tasks, isLoading, error } = useQuery({
    queryKey: ['tasks'],
    queryFn: gw.listTasks,
    refetchInterval: 10_000,
  });

  // Fetch agent list for assignee dropdown
  const { data: agents } = useQuery({
    queryKey: ['agents'],
    queryFn: gw.listAgents,
  });

  const selectedTask = tasks?.find(t => t.task_id === selectedTaskId);

  const refreshTasks = () => queryClient.invalidateQueries({ queryKey: ['tasks'] });

  // Apply filters + search
  const filteredTasks = useMemo(() => {
    if (!tasks) return [];
    return tasks.filter(t => {
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        const matchTitle = t.title.toLowerCase().includes(q);
        const matchDesc = (t.description || '').toLowerCase().includes(q);
        if (!matchTitle && !matchDesc) return false;
      }
      if (filters.status.size > 0 && !filters.status.has(getTaskStatus(t))) return false;
      if (filters.priority.size > 0 && !filters.priority.has(t.priority || 'none')) return false;
      if (filters.assignee && !(t.assignees || []).some(a => a.includes(filters.assignee))) return false;
      return true;
    });
  }, [tasks, filters, searchQuery]);

  const hasActiveFilters = filters.status.size > 0 || filters.priority.size > 0 || filters.assignee || searchQuery;
  const clearFilters = () => { setFilters({ status: new Set(), priority: new Set(), assignee: '' }); setSearchQuery(''); };

  return (
    <div className="flex h-full flex-col md:flex-row">
      {/* Main area */}
      <div className={cn(
        'flex-1 flex flex-col min-w-0',
        (selectedTask || showCreate) ? 'hidden md:flex' : 'flex'
      )}>
        {/* Header */}
        <div className="p-4 border-b border-border shrink-0">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-lg font-semibold text-foreground">任务</h1>
              <p className="text-sm text-muted-foreground mt-0.5">
                {tasks ? (hasActiveFilters ? `${filteredTasks.length} / ${tasks.length} 个任务` : `${tasks.length} 个任务`) : '加载中...'}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <input
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder="搜索任务..."
                  className="bg-muted rounded-lg pl-7 pr-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground outline-none w-36 focus:w-48 transition-all"
                />
                {searchQuery && (
                  <button onClick={() => setSearchQuery('')} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>
              <button
                onClick={() => setShowFilters(!showFilters)}
                className={cn(
                  'flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg transition-colors',
                  hasActiveFilters ? 'bg-sidebar-primary/20 text-sidebar-primary' : 'text-muted-foreground hover:bg-accent'
                )}
              >
                <Filter className="h-3.5 w-3.5" />
                筛选
                {hasActiveFilters && <span className="w-1.5 h-1.5 rounded-full bg-sidebar-primary" />}
              </button>
              <button
                onClick={() => { setShowCreate(true); setSelectedTaskId(null); }}
                className="flex items-center gap-1 px-3 py-1.5 text-xs bg-sidebar-primary text-sidebar-primary-foreground rounded-lg hover:opacity-90 transition-opacity"
              >
                <Plus className="h-3.5 w-3.5" />
                新建
              </button>
              <div className="flex items-center gap-1 bg-muted rounded-lg p-0.5">
                <button
                  onClick={() => setViewMode('kanban')}
                  className={cn(
                    'px-3 py-1 text-xs rounded-md transition-colors',
                    viewMode === 'kanban' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground'
                  )}
                >
                  看板
                </button>
                <button
                  onClick={() => setViewMode('list')}
                  className={cn(
                    'px-3 py-1 text-xs rounded-md transition-colors',
                    viewMode === 'list' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground'
                  )}
                >
                  列表
                </button>
              </div>
            </div>
          </div>

          {/* Filter bar */}
          {showFilters && (
            <div className="mt-3 flex items-center gap-3 flex-wrap">
              {/* Status filter */}
              <div className="flex items-center gap-1">
                <span className="text-[10px] text-muted-foreground mr-1">状态:</span>
                {(Object.entries(STATUS_CONFIG) as [string, typeof STATUS_CONFIG[keyof typeof STATUS_CONFIG]][]).map(([key, sc]) => {
                  const active = filters.status.has(key);
                  return (
                    <button key={key} onClick={() => {
                      const next = new Set(filters.status);
                      active ? next.delete(key) : next.add(key);
                      setFilters({ ...filters, status: next });
                    }} className={cn(
                      'text-[10px] px-2 py-0.5 rounded-full transition-colors',
                      active ? cn(sc.bg, sc.color, 'font-medium') : 'text-muted-foreground bg-muted hover:bg-accent/50'
                    )}>
                      {sc.label}
                    </button>
                  );
                })}
              </div>

              {/* Priority filter */}
              <div className="flex items-center gap-1">
                <span className="text-[10px] text-muted-foreground mr-1">优先级:</span>
                {(['urgent', 'high', 'medium', 'low'] as const).map(p => {
                  const pc = PRIORITY_CONFIG[p];
                  const active = filters.priority.has(p);
                  return (
                    <button key={p} onClick={() => {
                      const next = new Set(filters.priority);
                      active ? next.delete(p) : next.add(p);
                      setFilters({ ...filters, priority: next });
                    }} className={cn(
                      'text-[10px] px-2 py-0.5 rounded-full transition-colors',
                      active ? cn(pc.color, 'bg-accent font-medium') : 'text-muted-foreground bg-muted hover:bg-accent/50'
                    )}>
                      {pc.label}
                    </button>
                  );
                })}
              </div>

              {/* Assignee filter */}
              {agents && agents.length > 0 && (
                <div className="flex items-center gap-1">
                  <span className="text-[10px] text-muted-foreground mr-1">指派:</span>
                  <select
                    value={filters.assignee}
                    onChange={e => setFilters({ ...filters, assignee: e.target.value })}
                    className="text-[10px] bg-muted rounded px-2 py-0.5 text-foreground outline-none"
                  >
                    <option value="">全部</option>
                    {agents.map(a => (
                      <option key={a.agent_id} value={a.name}>{a.display_name || a.name}</option>
                    ))}
                  </select>
                </div>
              )}

              {hasActiveFilters && (
                <button onClick={clearFilters} className="text-[10px] text-muted-foreground hover:text-foreground px-2">
                  清除筛选
                </button>
              )}
            </div>
          )}
        </div>

        {isLoading && (
          <div className="flex-1 flex items-center justify-center text-muted-foreground">
            <p className="text-sm">加载中...</p>
          </div>
        )}

        {error && (
          <div className="flex-1 flex items-center justify-center text-destructive">
            <p className="text-sm">加载失败: {(error as Error).message}</p>
          </div>
        )}

        {tasks && viewMode === 'kanban' && <KanbanView tasks={filteredTasks} onSelect={setSelectedTaskId} onStatusChange={refreshTasks} />}
        {tasks && viewMode === 'list' && <ListView tasks={filteredTasks} onSelect={setSelectedTaskId} selectedId={selectedTaskId} />}
      </div>

      {/* Create task panel */}
      {showCreate && (
        <CreateTaskPanel
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); refreshTasks(); }}
        />
      )}

      {/* Task detail panel */}
      {selectedTask && !showCreate && (
        <TaskDetailPanel
          task={selectedTask}
          onClose={() => setSelectedTaskId(null)}
          onUpdated={refreshTasks}
        />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════
// Kanban View with DnD
// ═══════════════════════════════════════════════════

function KanbanView({ tasks, onSelect, onStatusChange }: {
  tasks: gw.Task[];
  onSelect: (id: string) => void;
  onStatusChange: () => void;
}) {
  const columns: (keyof typeof STATUS_CONFIG)[] = ['todo', 'in_progress', 'done', 'cancelled'];
  const [activeTask, setActiveTask] = useState<gw.Task | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

  const handleDragStart = (event: DragStartEvent) => {
    const task = tasks.find(t => t.task_id === event.active.id);
    setActiveTask(task || null);
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    setActiveTask(null);
    const { active, over } = event;
    if (!over) return;

    const taskId = active.id as string;
    const newStatus = over.id as string;
    const task = tasks.find(t => t.task_id === taskId);
    if (!task) return;

    const currentStatus = getTaskStatus(task);
    if (currentStatus === newStatus) return;

    try {
      await gw.updateTaskStatus(taskId, newStatus);
      onStatusChange();
    } catch (e) {
      console.error('Drag status update failed:', e);
    }
  };

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div className="flex-1 overflow-x-auto p-4">
        <div className="flex gap-4 h-full min-w-[640px]">
          {columns.map(status => {
            const config = STATUS_CONFIG[status];
            const statusTasks = tasks.filter(t => getTaskStatus(t) === status);
            const Icon = config.icon;

            const isEmpty = statusTasks.length === 0;
            return (
              <KanbanColumn key={status} id={status} collapsed={isEmpty}>
                <div className="flex items-center gap-2 mb-3 px-1">
                  <Icon className={cn('h-4 w-4', config.color)} />
                  <span className="text-sm font-medium text-foreground">{config.label}</span>
                  <span className={cn('text-xs', isEmpty ? 'text-muted-foreground/50' : 'text-muted-foreground')}>({statusTasks.length})</span>
                </div>
                <ScrollArea className="flex-1">
                  <div className="space-y-2">
                    {statusTasks.map(task => (
                      <DraggableTaskCard key={task.task_id} task={task} onClick={() => onSelect(task.task_id)} />
                    ))}
                    {isEmpty && (
                      <div className="rounded-lg border border-dashed border-border/50 p-3 text-center">
                        <p className="text-[10px] text-muted-foreground/50">拖拽任务到这里</p>
                      </div>
                    )}
                  </div>
                </ScrollArea>
              </KanbanColumn>
            );
          })}
        </div>
      </div>

      <DragOverlay>
        {activeTask && <TaskCard task={activeTask} onClick={() => {}} isDragging />}
      </DragOverlay>
    </DndContext>
  );
}

function KanbanColumn({ id, children, collapsed }: { id: string; children: React.ReactNode; collapsed?: boolean }) {
  const { isOver, setNodeRef } = useDroppable({ id });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        'flex flex-col rounded-lg transition-all p-1',
        collapsed ? 'min-w-[140px] flex-[0.5]' : 'min-w-[200px] flex-1',
        isOver && 'bg-accent/30'
      )}
    >
      {children}
    </div>
  );
}

function DraggableTaskCard({ task, onClick }: { task: gw.Task; onClick: () => void }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: task.task_id });
  const style = transform ? { transform: `translate(${transform.x}px, ${transform.y}px)` } : undefined;

  return (
    <div ref={setNodeRef} style={style} className={cn(isDragging && 'opacity-30')}>
      <TaskCard task={task} onClick={onClick} dragHandleProps={{ ...attributes, ...listeners }} />
    </div>
  );
}

function TaskCard({ task, onClick, isDragging, dragHandleProps }: {
  task: gw.Task;
  onClick: () => void;
  isDragging?: boolean;
  dragHandleProps?: Record<string, any>;
}) {
  const priorityConfig = PRIORITY_CONFIG[task.priority || 'none'] || PRIORITY_CONFIG.none;
  return (
    <div className={cn(
      'w-full text-left rounded-lg border border-border bg-card p-3 hover:bg-accent/30 transition-colors flex gap-2',
      isDragging && 'shadow-xl ring-2 ring-sidebar-primary'
    )}>
      {dragHandleProps && (
        <div {...dragHandleProps} className="cursor-grab active:cursor-grabbing shrink-0 pt-0.5 text-muted-foreground/50 hover:text-muted-foreground">
          <GripVertical className="h-4 w-4" />
        </div>
      )}
      <button onClick={onClick} className="flex-1 text-left min-w-0">
        <p className="text-sm text-foreground line-clamp-2">{task.title}</p>
        <div className="flex items-center gap-2 mt-2 flex-wrap">
          {task.priority && task.priority !== 'none' && (
            <span className={cn('text-[10px] flex items-center gap-0.5', priorityConfig.color)}>
              <ArrowUp className="h-3 w-3" />
              {priorityConfig.label}
            </span>
          )}
          {task.assignees && task.assignees.length > 0 && (
            <span className="text-[10px] bg-muted text-muted-foreground px-1.5 py-0.5 rounded">
              {task.assignees[0]}
            </span>
          )}
          {task.target_date && (
            <span className="text-[10px] flex items-center gap-0.5 text-muted-foreground">
              <Calendar className="h-2.5 w-2.5" />
              {task.target_date}
            </span>
          )}
        </div>
      </button>
    </div>
  );
}

// ═══════════════════════════════════════════════════
// List View
// ═══════════════════════════════════════════════════

function ListView({ tasks, onSelect, selectedId }: { tasks: gw.Task[]; onSelect: (id: string) => void; selectedId: string | null }) {
  const [sortKey, setSortKey] = useState<'title' | 'status' | 'priority' | 'assignee' | 'target_date' | null>(null);
  const [sortAsc, setSortAsc] = useState(true);

  const handleSort = (key: typeof sortKey) => {
    if (sortKey === key) {
      if (sortAsc) setSortAsc(false);
      else { setSortKey(null); setSortAsc(true); }
    } else {
      setSortKey(key);
      setSortAsc(true);
    }
  };

  const PRIORITY_ORDER: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3, none: 4 };

  const sorted = useMemo(() => {
    if (!sortKey) return tasks;
    return [...tasks].sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case 'title': cmp = a.title.localeCompare(b.title); break;
        case 'status': cmp = getTaskStatus(a).localeCompare(getTaskStatus(b)); break;
        case 'priority': cmp = (PRIORITY_ORDER[a.priority || 'none'] ?? 4) - (PRIORITY_ORDER[b.priority || 'none'] ?? 4); break;
        case 'assignee': cmp = (a.assignees?.[0] || '').localeCompare(b.assignees?.[0] || ''); break;
        case 'target_date': cmp = (a.target_date || '9999').localeCompare(b.target_date || '9999'); break;
      }
      return sortAsc ? cmp : -cmp;
    });
  }, [tasks, sortKey, sortAsc]);

  const SortHeader = ({ label, field }: { label: string; field: typeof sortKey }) => (
    <th
      className="px-3 py-2 text-left text-[10px] font-medium text-muted-foreground uppercase tracking-wider cursor-pointer select-none hover:text-foreground transition-colors"
      onClick={() => handleSort(field)}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        {sortKey === field && (sortAsc ? <ArrowUp className="h-2.5 w-2.5" /> : <ArrowDown className="h-2.5 w-2.5" />)}
      </span>
    </th>
  );

  return (
    <div className="flex-1 overflow-auto">
      {tasks.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
          <CheckSquare className="h-12 w-12 mb-4 opacity-30" />
          <p className="text-sm">暂无任务</p>
        </div>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/50 sticky top-0">
              <SortHeader label="任务" field="title" />
              <SortHeader label="状态" field="status" />
              <SortHeader label="优先级" field="priority" />
              <SortHeader label="指派" field="assignee" />
              <SortHeader label="截止" field="target_date" />
            </tr>
          </thead>
          <tbody>
            {sorted.map(task => {
              const status = getTaskStatus(task);
              const config = STATUS_CONFIG[status];
              const Icon = config.icon;
              const pc = PRIORITY_CONFIG[task.priority || 'none'] || PRIORITY_CONFIG.none;
              return (
                <tr
                  key={task.task_id}
                  onClick={() => onSelect(task.task_id)}
                  className={cn(
                    'border-b border-border cursor-pointer transition-colors',
                    selectedId === task.task_id ? 'bg-accent' : 'hover:bg-accent/30'
                  )}
                >
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      <Icon className={cn('h-3.5 w-3.5 shrink-0', config.color)} />
                      <span className="text-sm text-foreground truncate max-w-[300px]">{task.title}</span>
                    </div>
                  </td>
                  <td className="px-3 py-2.5">
                    <span className={cn('text-[10px] px-2 py-0.5 rounded-full', config.bg, config.color)}>{config.label}</span>
                  </td>
                  <td className="px-3 py-2.5">
                    <span className={cn('text-xs', pc.color)}>{pc.label}</span>
                  </td>
                  <td className="px-3 py-2.5">
                    <span className="text-xs text-muted-foreground">{task.assignees?.[0] || '—'}</span>
                  </td>
                  <td className="px-3 py-2.5">
                    {task.target_date ? (
                      <span className="text-xs text-muted-foreground flex items-center gap-1">
                        <Calendar className="h-3 w-3" />
                        {task.target_date}
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════
// Task Detail Panel (editable fields)
// ═══════════════════════════════════════════════════

function TaskDetailPanel({ task, onClose, onUpdated }: { task: gw.Task; onClose: () => void; onUpdated: () => void }) {
  const [updating, setUpdating] = useState(false);
  const status = getTaskStatus(task);
  const priorityConfig = PRIORITY_CONFIG[task.priority || 'none'] || PRIORITY_CONFIG.none;

  const { data: agents } = useQuery({
    queryKey: ['agents'],
    queryFn: gw.listAgents,
  });

  const patchField = useCallback(async (fields: Parameters<typeof gw.updateTask>[1]) => {
    setUpdating(true);
    try {
      await gw.updateTask(task.task_id, fields);
      onUpdated();
    } catch (e) {
      console.error('Update failed:', e);
    } finally {
      setUpdating(false);
    }
  }, [task.task_id, onUpdated]);

  const handleStatusChange = async (newStatus: string) => {
    setUpdating(true);
    try {
      await gw.updateTaskStatus(task.task_id, newStatus);
      onUpdated();
    } catch (e) {
      console.error('Status update failed:', e);
    } finally {
      setUpdating(false);
    }
  };

  return (
    <div className="w-full md:w-96 border-l border-border bg-card flex flex-col shrink-0">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <h3 className="text-sm font-semibold text-foreground">任务详情</h3>
        <button onClick={onClose} className="p-1 text-muted-foreground hover:text-foreground">
          <X className="h-4 w-4" />
        </button>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-4 space-y-4">
          {/* Title — editable */}
          <EditableText
            value={task.title}
            onSave={val => patchField({ title: val })}
            className="text-base font-semibold"
            placeholder="任务标题"
          />

          {/* Description — editable */}
          <EditableText
            value={task.description || ''}
            onSave={val => patchField({ description: val })}
            multiline
            className="text-sm text-foreground/80"
            placeholder="添加描述..."
          />

          <div className="space-y-3 pt-2 border-t border-border">
            {/* Status */}
            <DetailRow label="状态">
              <div className="flex gap-1 flex-wrap">
                {(Object.keys(STATUS_CONFIG) as (keyof typeof STATUS_CONFIG)[]).map(s => {
                  const sc = STATUS_CONFIG[s];
                  const Icon = sc.icon;
                  const isActive = status === s;
                  return (
                    <button
                      key={s}
                      onClick={() => !isActive && handleStatusChange(s)}
                      disabled={updating || isActive}
                      className={cn(
                        'text-[10px] flex items-center gap-1 px-2 py-1 rounded-full transition-colors',
                        isActive ? cn(sc.bg, sc.color, 'font-medium') : 'text-muted-foreground hover:bg-accent'
                      )}
                    >
                      <Icon className="h-3 w-3" />
                      {sc.label}
                    </button>
                  );
                })}
              </div>
            </DetailRow>

            {/* Priority — editable */}
            <DetailRow label="优先级">
              <div className="flex gap-1">
                {(Object.entries(PRIORITY_CONFIG) as [string, { label: string; color: string }][]).map(([p, pc]) => {
                  const isActive = (task.priority || 'none') === p;
                  return (
                    <button
                      key={p}
                      onClick={() => !isActive && patchField({ priority: p })}
                      disabled={updating || isActive}
                      className={cn(
                        'text-[10px] px-2 py-0.5 rounded-full transition-colors',
                        isActive ? cn(pc.color, 'font-medium bg-accent') : 'text-muted-foreground hover:bg-accent/50'
                      )}
                    >
                      {pc.label}
                    </button>
                  );
                })}
              </div>
            </DetailRow>

            {/* Assignees */}
            <DetailRow label="指派人">
              <select
                value={task.assignees?.[0] || ''}
                onChange={e => patchField({ assignee_name: e.target.value || undefined })}
                disabled={updating}
                className="text-xs bg-transparent text-foreground outline-none cursor-pointer text-right"
              >
                <option value="">未指派</option>
                {agents?.map(a => (
                  <option key={a.agent_id} value={a.name}>
                    {a.display_name || a.name}{a.online ? ' 🟢' : ''}
                  </option>
                ))}
              </select>
            </DetailRow>

            {/* Start Date */}
            <DetailRow label="开始日期">
              <input
                type="date"
                value={task.start_date || ''}
                onChange={e => patchField({ start_date: e.target.value || null })}
                className="text-xs bg-transparent text-foreground outline-none cursor-pointer"
              />
            </DetailRow>

            {/* Target Date */}
            <DetailRow label="截止日期">
              <input
                type="date"
                value={task.target_date || ''}
                onChange={e => patchField({ target_date: e.target.value || null })}
                className="text-xs bg-transparent text-foreground outline-none cursor-pointer"
              />
            </DetailRow>

            {/* Created */}
            <DetailRow label="创建时间">
              <span className="text-xs text-foreground flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {formatTimestamp(task.created_at)}
              </span>
            </DetailRow>

            {/* Updated */}
            {task.updated_at && (
              <DetailRow label="更新时间">
                <span className="text-xs text-foreground">{formatTimestamp(task.updated_at)}</span>
              </DetailRow>
            )}
          </div>
        </div>
      </ScrollArea>

      <Comments
        queryKey={['task-comments', task.task_id]}
        fetchComments={() => gw.listTaskComments(task.task_id)}
        postComment={(text) => gw.commentOnTask(task.task_id, text)}
      />
    </div>
  );
}

// ═══════════════════════════════════════════════════
// Create Task Panel
// ═══════════════════════════════════════════════════

function CreateTaskPanel({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState('none');
  const [assignee, setAssignee] = useState('');
  const [startDate, setStartDate] = useState('');
  const [targetDate, setTargetDate] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  const { data: agents } = useQuery({
    queryKey: ['agents'],
    queryFn: gw.listAgents,
  });

  const handleCreate = async () => {
    if (!title.trim()) return;
    setCreating(true);
    setError('');
    try {
      await gw.createTask(title.trim(), {
        description: description.trim() || undefined,
        assignee: assignee.trim() || undefined,
        priority: priority !== 'none' ? priority : undefined,
        start_date: startDate || undefined,
        target_date: targetDate || undefined,
      });
      onCreated();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="w-full md:w-96 border-l border-border bg-card flex flex-col shrink-0">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <h3 className="text-sm font-semibold text-foreground">新建任务</h3>
        <button onClick={onClose} className="p-1 text-muted-foreground hover:text-foreground">
          <X className="h-4 w-4" />
        </button>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-4 space-y-4">
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">标题 *</label>
            <input
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="任务标题"
              className="w-full bg-muted rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-sidebar-primary"
              autoFocus
            />
          </div>

          <div>
            <label className="text-xs text-muted-foreground mb-1 block">描述</label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="任务描述（可选）"
              rows={3}
              className="w-full bg-muted rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground outline-none resize-none focus:ring-1 focus:ring-sidebar-primary"
            />
          </div>

          <div>
            <label className="text-xs text-muted-foreground mb-1 block">优先级</label>
            <div className="flex gap-1">
              {(Object.entries(PRIORITY_CONFIG) as [string, { label: string; color: string }][]).map(([p, pc]) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPriority(p)}
                  className={cn(
                    'text-xs px-3 py-1.5 rounded-lg transition-colors',
                    priority === p ? cn(pc.color, 'bg-accent font-medium') : 'text-muted-foreground bg-muted hover:bg-accent/50'
                  )}
                >
                  {pc.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-xs text-muted-foreground mb-1 block">指派给</label>
            <select
              value={assignee}
              onChange={e => setAssignee(e.target.value)}
              className="w-full bg-muted rounded-lg px-3 py-2 text-sm text-foreground outline-none focus:ring-1 focus:ring-sidebar-primary"
            >
              <option value="">未指派</option>
              {agents?.map(a => (
                <option key={a.agent_id} value={a.name}>
                  {a.display_name || a.name}{a.online ? ' 🟢' : ''}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">开始日期</label>
              <input
                type="date"
                value={startDate}
                onChange={e => setStartDate(e.target.value)}
                className="w-full bg-muted rounded-lg px-3 py-2 text-sm text-foreground outline-none focus:ring-1 focus:ring-sidebar-primary"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">截止日期</label>
              <input
                type="date"
                value={targetDate}
                onChange={e => setTargetDate(e.target.value)}
                className="w-full bg-muted rounded-lg px-3 py-2 text-sm text-foreground outline-none focus:ring-1 focus:ring-sidebar-primary"
              />
            </div>
          </div>

          {error && <p className="text-xs text-destructive">{error}</p>}

          <button
            onClick={handleCreate}
            disabled={!title.trim() || creating}
            className="w-full py-2 bg-sidebar-primary text-sidebar-primary-foreground text-sm rounded-lg hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            {creating ? '创建中...' : '创建任务'}
          </button>
        </div>
      </ScrollArea>
    </div>
  );
}

// ═══════════════════════════════════════════════════
// Shared Components
// ═══════════════════════════════════════════════════

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="text-xs text-muted-foreground shrink-0 pt-0.5">{label}</span>
      <div className="flex-1 flex justify-end">{children}</div>
    </div>
  );
}

function EditableText({ value, onSave, className, placeholder, multiline, inline }: {
  value: string;
  onSave: (val: string) => void;
  className?: string;
  placeholder?: string;
  multiline?: boolean;
  inline?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  const startEdit = () => {
    setDraft(value);
    setEditing(true);
  };

  const save = () => {
    setEditing(false);
    if (draft.trim() !== value) {
      onSave(draft.trim());
    }
  };

  const cancel = () => {
    setEditing(false);
    setDraft(value);
  };

  if (editing) {
    if (multiline) {
      return (
        <textarea
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={save}
          onKeyDown={e => { if (e.key === 'Escape') cancel(); }}
          className={cn('w-full bg-muted rounded px-2 py-1 outline-none resize-none text-foreground', className)}
          rows={4}
          autoFocus
        />
      );
    }
    return (
      <input
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={save}
        onKeyDown={e => {
          if (e.key === 'Enter') save();
          if (e.key === 'Escape') cancel();
        }}
        className={cn(
          'bg-muted rounded px-2 py-0.5 outline-none text-foreground',
          inline ? 'text-right w-full' : 'w-full',
          className
        )}
        autoFocus
      />
    );
  }

  return (
    <div
      onClick={startEdit}
      className={cn(
        'cursor-pointer rounded px-1 -mx-1 hover:bg-accent/50 transition-colors min-h-[1.5em] text-foreground',
        !value && 'text-muted-foreground italic',
        inline && 'text-right',
        className
      )}
    >
      {value || placeholder || '点击编辑'}
    </div>
  );
}

function formatTimestamp(ts?: number): string {
  if (!ts) return '-';
  const d = new Date(ts);
  return d.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' }) +
    ' ' + d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}
