export const API_BASE = "http://localhost:4310";
export const WS_BASE = "ws://localhost:4310";

export interface Slot {
  id: string;
  cli: string;
  command: string;
  label: string;
  role: string;
  worktree: { path: string; branch: string };
}

export interface Project {
  id: string;
  name: string;
  repoPath: string;
  baseBranch: string;
  slots: Slot[];
  createdAt: string;
}

export interface DiffResult {
  slotId: string;
  branch: string;
  diff: string;
  untracked: string[];
  aheadCount: number;
}

export interface HandoffRecord {
  id: string;
  from: string;
  to: string;
  fromLabel: string;
  toLabel: string;
  summary: string;
  copiedDocs: string[];
  createdAt: string;
}

export type TaskStatus = "todo" | "doing" | "done";

export interface TaskItem {
  id: string;
  projectId: string;
  title: string;
  description: string;
  assignee: string | null;
  status: TaskStatus;
  createdAt: string;
  dispatchedAt?: string;
  arena?: { slots: string[]; winner?: string };
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    // body 없는 요청(DELETE 등)에 JSON 헤더를 붙이면 Fastify가 빈 body를 400으로 거부한다
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
    ...init,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error || `요청 실패 (${res.status})`);
  return body as T;
}

export const api = {
  listProjects: () => req<Project[]>("/api/projects"),
  createProject: (repoPath: string) =>
    req<Project>("/api/projects", { method: "POST", body: JSON.stringify({ repoPath }) }),
  deleteProject: (id: string) => req<{ ok: boolean }>(`/api/projects/${id}`, { method: "DELETE" }),

  addSlot: (id: string, cli: string, command?: string) =>
    req<Slot>(`/api/projects/${id}/slots`, { method: "POST", body: JSON.stringify({ cli, command }) }),
  updateSlot: (id: string, slotId: string, patch: { role?: string; label?: string }) =>
    req<Slot>(`/api/projects/${id}/slots/${slotId}`, { method: "PATCH", body: JSON.stringify(patch) }),
  removeSlot: (id: string, slotId: string) =>
    req<{ ok: boolean }>(`/api/projects/${id}/slots/${slotId}`, { method: "DELETE" }),

  getDiff: (id: string, slotId: string) => req<DiffResult>(`/api/projects/${id}/diff/${slotId}`),
  merge: (id: string, slotId: string) =>
    req<{ ok: boolean; message: string }>(`/api/projects/${id}/merge`, {
      method: "POST",
      body: JSON.stringify({ slotId }),
    }),
  handoff: (id: string, from: string, to: string) =>
    req<{ record: HandoffRecord; injected: boolean }>(`/api/projects/${id}/handoff`, {
      method: "POST",
      body: JSON.stringify({ from, to }),
    }),
  listHandoffs: (id: string) => req<HandoffRecord[]>(`/api/projects/${id}/handoffs`),

  listTasks: (id: string) => req<TaskItem[]>(`/api/projects/${id}/tasks`),
  createTask: (id: string, title: string, description?: string) =>
    req<TaskItem>(`/api/projects/${id}/tasks`, {
      method: "POST",
      body: JSON.stringify({ title, description }),
    }),
  dispatchTask: (id: string, taskId: string, slotId: string) =>
    req<{ task: TaskItem; injected: boolean }>(`/api/projects/${id}/tasks/${taskId}/dispatch`, {
      method: "POST",
      body: JSON.stringify({ slotId }),
    }),
  arenaStart: (id: string, taskId: string, slotIds: string[]) =>
    req<{ task: TaskItem; injected: boolean[] }>(`/api/projects/${id}/tasks/${taskId}/arena`, {
      method: "POST",
      body: JSON.stringify({ slotIds }),
    }),
  arenaWinner: (id: string, taskId: string, slotId: string, resetLoser: boolean) =>
    req<{ ok: boolean; message: string }>(`/api/projects/${id}/tasks/${taskId}/arena/winner`, {
      method: "POST",
      body: JSON.stringify({ slotId, resetLoser }),
    }),
  updateTask: (id: string, taskId: string, patch: Partial<Pick<TaskItem, "status" | "title" | "description" | "assignee">>) =>
    req<TaskItem>(`/api/projects/${id}/tasks/${taskId}`, { method: "PATCH", body: JSON.stringify(patch) }),
  deleteTask: (id: string, taskId: string) =>
    req<{ ok: boolean }>(`/api/projects/${id}/tasks/${taskId}`, { method: "DELETE" }),
};
