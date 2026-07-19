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
  verifyCommands?: string[];
  createdAt: string;
}

export interface CliInfo {
  id: string;
  label: string;
  command: string;
  auth: string;
  cost: string;
  installed: boolean;
  version?: string;
}

export interface SessionContext {
  slotId: string;
  running: boolean;
  startedAt: string | null;
  taskCount: number;
  taskTitles: string[];
  contextStale: boolean;
}

export interface ReviewComment {
  file: string;
  line?: number;
  code?: string;
  text: string;
}

export interface CheckResult {
  name: string;
  command?: string;
  ok: boolean;
  detail: string;
  skipped?: boolean;
}

export interface VerifyResult {
  slotId: string;
  slotLabel: string;
  mergeable: boolean;
  conflicts: string[];
  checks: CheckResult[];
  filesChanged: number;
  ok: boolean;
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

  listClis: () => req<CliInfo[]>("/api/clis"),

  listContexts: (id: string) => req<SessionContext[]>(`/api/projects/${id}/contexts`),
  restartSlot: (id: string, slotId: string) =>
    req<{ ok: boolean; message: string }>(`/api/projects/${id}/slots/${slotId}/restart`, { method: "POST" }),

  getVerifyConfig: (id: string) =>
    req<{ commands: string[]; suggestions: string[] }>(`/api/projects/${id}/verify-config`),
  setVerifyConfig: (id: string, commands: string[]) =>
    req<{ ok: boolean; commands: string[] }>(`/api/projects/${id}/verify-config`, {
      method: "PUT",
      body: JSON.stringify({ commands }),
    }),
  verify: (id: string, slotId: string, runChecks = true) =>
    req<VerifyResult>(`/api/projects/${id}/verify/${slotId}`, {
      method: "POST",
      body: JSON.stringify({ runChecks }),
    }),

  sendReview: (id: string, slotId: string, comments: ReviewComment[]) =>
    req<{ ok: boolean; injected: boolean; count: number }>(`/api/projects/${id}/review/${slotId}`, {
      method: "POST",
      body: JSON.stringify({ comments }),
    }),

  getDiff: (id: string, slotId: string) => req<DiffResult>(`/api/projects/${id}/diff/${slotId}`),
  merge: (id: string, slotId: string, skipVerify = false) =>
    req<{ ok: boolean; message: string; verify?: VerifyResult }>(`/api/projects/${id}/merge`, {
      method: "POST",
      body: JSON.stringify({ slotId, skipVerify }),
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
  dispatchTask: (id: string, taskId: string, slotId: string, freshContext = false) =>
    req<{ task: TaskItem; injected: boolean }>(`/api/projects/${id}/tasks/${taskId}/dispatch`, {
      method: "POST",
      body: JSON.stringify({ slotId, freshContext }),
    }),
  arenaStart: (id: string, taskId: string, slotIds: string[]) =>
    req<{ task: TaskItem; injected: boolean[] }>(`/api/projects/${id}/tasks/${taskId}/arena`, {
      method: "POST",
      body: JSON.stringify({ slotIds }),
    }),
  arenaWinner: (id: string, taskId: string, slotId: string, resetLoser: boolean, skipVerify = false) =>
    req<{ ok: boolean; message: string; verify?: VerifyResult }>(
      `/api/projects/${id}/tasks/${taskId}/arena/winner`,
      { method: "POST", body: JSON.stringify({ slotId, resetLoser, skipVerify }) },
    ),
  updateTask: (id: string, taskId: string, patch: Partial<Pick<TaskItem, "status" | "title" | "description" | "assignee">>) =>
    req<TaskItem>(`/api/projects/${id}/tasks/${taskId}`, { method: "PATCH", body: JSON.stringify(patch) }),
  deleteTask: (id: string, taskId: string) =>
    req<{ ok: boolean }>(`/api/projects/${id}/tasks/${taskId}`, { method: "DELETE" }),
};
