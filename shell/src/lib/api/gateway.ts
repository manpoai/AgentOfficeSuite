/**
 * ASuite Gateway API client — calls through /api/gateway/* proxy
 */

const BASE = '/api/gateway';

async function gwFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, init);
  if (!res.ok) throw new Error(`Gateway API ${path}: ${res.status}`);
  return res.json();
}

// ── Types ──

export interface Agent {
  agent_id: string;
  name: string;
  display_name?: string;
  type?: string;
  online: boolean;
  capabilities?: string[];
  registered_at?: string;
  last_seen_at?: number | null;
}

export interface Task {
  task_id: string;
  title: string;
  description?: string;
  status: 'todo' | 'in_progress' | 'done' | 'cancelled' | null;
  priority?: string;
  assignee_name?: string;
  assignees?: string[];
  start_date?: string | null;
  target_date?: string | null;
  url?: string;
  created_at?: number;
  updated_at?: number;
}

// ── Agents ──

export async function listAgents(): Promise<Agent[]> {
  const data = await gwFetch<{ agents: Agent[] }>('/agents');
  return data.agents;
}

export async function getAgent(name: string): Promise<Agent> {
  return gwFetch(`/agents/${name}`);
}

// ── Tasks ──

export async function listTasks(): Promise<Task[]> {
  const data = await gwFetch<{ tasks: Task[] }>('/tasks');
  return data.tasks;
}

export async function createTask(title: string, opts?: {
  description?: string;
  assignee?: string;
  priority?: string;
  start_date?: string;
  target_date?: string;
}): Promise<Task> {
  return gwFetch('/tasks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title,
      description: opts?.description,
      assignee_name: opts?.assignee,
      priority: opts?.priority,
      start_date: opts?.start_date,
      target_date: opts?.target_date,
    }),
  });
}

export async function updateTask(taskId: string, fields: {
  title?: string;
  description?: string;
  priority?: string;
  assignee_name?: string;
  start_date?: string | null;
  target_date?: string | null;
}): Promise<Task> {
  return gwFetch(`/tasks/${taskId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(fields),
  });
}

export async function updateTaskStatus(taskId: string, status: string): Promise<void> {
  await gwFetch(`/tasks/${taskId}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status }),
  });
}

export async function commentOnTask(taskId: string, text: string): Promise<void> {
  await gwFetch(`/tasks/${taskId}/comments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
}

// ── Comments ──

export interface Comment {
  id: string;
  text: string;
  html?: string;
  actor: string;
  parent_id?: string | null;
  created_at: string;
  updated_at?: string;
}

export async function listTaskComments(taskId: string): Promise<Comment[]> {
  const data = await gwFetch<{ comments: Comment[] }>(`/tasks/${taskId}/comments`);
  return data.comments;
}

export async function listDocComments(docId: string): Promise<Comment[]> {
  const data = await gwFetch<{ comments: Comment[] }>(`/docs/${docId}/comments`);
  return data.comments;
}

export async function commentOnDoc(docId: string, text: string, parentId?: string): Promise<void> {
  await gwFetch('/comments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ doc_id: docId, text, parent_comment_id: parentId }),
  });
}
