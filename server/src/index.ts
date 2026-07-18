import Fastify from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import crypto from 'node:crypto';
import { store } from './store.js';
import { addSlot, createProjectFromRepo, getDiff, mergeSlotBranch, GitError } from './gitService.js';
import { ensureSession, killProjectSessions, killSession, resizeSession, writeToSession } from './sessionManager.js';
import { injectPrompt, performHandoff } from './handoff.js';
import { MAX_SLOTS, type Project, type Slot, type TaskStatus } from './types.js';

const PORT = Number(process.env.PORT) || 4310;

const app = Fastify({ logger: { level: 'info' } });
await app.register(cors, { origin: true });
await app.register(websocket);

function findSlot(project: Project, slotId: string): Slot | undefined {
  return project.slots.find((s) => s.id === slotId);
}

function handleGitError(e: unknown, reply: { code: (n: number) => { send: (b: unknown) => unknown } }) {
  if (e instanceof GitError) return reply.code(400).send({ error: e.message });
  throw e;
}

app.get('/api/health', async () => ({ ok: true }));

// ---------- 프로젝트 ----------

app.get('/api/projects', async () => store.listProjects());

app.post<{ Body: { repoPath?: string } }>('/api/projects', async (req, reply) => {
  const repoPath = req.body?.repoPath?.trim();
  if (!repoPath) return reply.code(400).send({ error: 'repoPath가 필요합니다.' });
  const dup = store.listProjects().find((p) => p.repoPath.toLowerCase() === repoPath.toLowerCase());
  if (dup) return dup;
  try {
    const project = await createProjectFromRepo(repoPath);
    store.addProject(project);
    return project;
  } catch (e) {
    return handleGitError(e, reply);
  }
});

app.delete<{ Params: { id: string } }>('/api/projects/:id', async (req, reply) => {
  const project = store.getProject(req.params.id);
  if (!project) return reply.code(404).send({ error: '프로젝트를 찾을 수 없습니다.' });
  killProjectSessions(project);
  store.removeProject(project.id);
  // 워크트리는 의도적으로 디스크에 남긴다 — 에이전트 작업물 삭제는 사람이 직접
  return { ok: true };
});

// ---------- 슬롯 ----------

app.post<{ Params: { id: string }; Body: { cli?: string; command?: string; label?: string } }>(
  '/api/projects/:id/slots',
  async (req, reply) => {
    const project = store.getProject(req.params.id);
    if (!project) return reply.code(404).send({ error: '프로젝트를 찾을 수 없습니다.' });
    if (project.slots.length >= MAX_SLOTS)
      return reply.code(400).send({ error: `슬롯은 최대 ${MAX_SLOTS}개입니다.` });
    const cli = req.body?.cli?.trim();
    if (!cli) return reply.code(400).send({ error: 'cli가 필요합니다.' });
    try {
      const slot = await addSlot(project, cli, req.body?.command, req.body?.label);
      store.persistNow();
      return slot;
    } catch (e) {
      return handleGitError(e, reply);
    }
  },
);

app.patch<{ Params: { id: string; slotId: string }; Body: { role?: string; label?: string } }>(
  '/api/projects/:id/slots/:slotId',
  async (req, reply) => {
    const project = store.getProject(req.params.id);
    const slot = project && findSlot(project, req.params.slotId);
    if (!project || !slot) return reply.code(404).send({ error: '슬롯을 찾을 수 없습니다.' });
    const { role, label } = req.body ?? {};
    if (typeof role === 'string' && role.trim()) slot.role = role.trim().slice(0, 40);
    if (typeof label === 'string' && label.trim()) slot.label = label.trim().slice(0, 40);
    store.persistNow();
    return slot;
  },
);

app.delete<{ Params: { id: string; slotId: string } }>(
  '/api/projects/:id/slots/:slotId',
  async (req, reply) => {
    const project = store.getProject(req.params.id);
    const slot = project && findSlot(project, req.params.slotId);
    if (!project || !slot) return reply.code(404).send({ error: '슬롯을 찾을 수 없습니다.' });
    if (project.slots.length <= 1) return reply.code(400).send({ error: '슬롯은 최소 1개 필요합니다.' });
    killSession(project.id, slot.id);
    project.slots = project.slots.filter((s) => s.id !== slot.id);
    // 배정돼 있던 태스크는 대기로 되돌림
    for (const t of store.listTasks(project.id)) {
      if (t.assignee === slot.id && t.status !== 'done') {
        t.assignee = null;
        t.status = 'todo';
      }
    }
    store.persistNow();
    // 워크트리/브랜치는 디스크에 남김 (작업물 보존)
    return { ok: true };
  },
);

// ---------- Diff / 병합 ----------

app.get<{ Params: { id: string; slotId: string } }>('/api/projects/:id/diff/:slotId', async (req, reply) => {
  const project = store.getProject(req.params.id);
  const slot = project && findSlot(project, req.params.slotId);
  if (!project || !slot) return reply.code(404).send({ error: '슬롯을 찾을 수 없습니다.' });
  try {
    return await getDiff(project, slot);
  } catch (e) {
    return handleGitError(e, reply);
  }
});

app.post<{ Params: { id: string }; Body: { slotId?: string } }>('/api/projects/:id/merge', async (req, reply) => {
  const project = store.getProject(req.params.id);
  const slot = project && req.body?.slotId ? findSlot(project, req.body.slotId) : undefined;
  if (!project || !slot) return reply.code(404).send({ error: '슬롯을 찾을 수 없습니다.' });
  try {
    return await mergeSlotBranch(project, slot);
  } catch (e) {
    return handleGitError(e, reply);
  }
});

// ---------- 핸드오프 ----------

app.post<{ Params: { id: string }; Body: { from?: string; to?: string } }>(
  '/api/projects/:id/handoff',
  async (req, reply) => {
    const project = store.getProject(req.params.id);
    if (!project) return reply.code(404).send({ error: '프로젝트를 찾을 수 없습니다.' });
    const from = req.body?.from ? findSlot(project, req.body.from) : undefined;
    const to = req.body?.to ? findSlot(project, req.body.to) : undefined;
    if (!from || !to || from.id === to.id) {
      return reply.code(400).send({ error: 'from/to는 서로 다른 슬롯이어야 합니다.' });
    }
    return await performHandoff(project, from, to);
  },
);

app.get<{ Params: { id: string } }>('/api/projects/:id/handoffs', async (req) =>
  store.listHandoffs(req.params.id),
);

// ---------- 칸반 태스크 ----------

app.get<{ Params: { id: string } }>('/api/projects/:id/tasks', async (req) => store.listTasks(req.params.id));

app.post<{ Params: { id: string }; Body: { title?: string; description?: string } }>(
  '/api/projects/:id/tasks',
  async (req, reply) => {
    const project = store.getProject(req.params.id);
    if (!project) return reply.code(404).send({ error: '프로젝트를 찾을 수 없습니다.' });
    const title = req.body?.title?.trim();
    if (!title) return reply.code(400).send({ error: '제목이 필요합니다.' });
    const task = {
      id: crypto.randomUUID().slice(0, 8),
      projectId: project.id,
      title: title.slice(0, 200),
      description: (req.body?.description ?? '').trim().slice(0, 2000),
      assignee: null,
      status: 'todo' as TaskStatus,
      createdAt: new Date().toISOString(),
    };
    store.addTask(task);
    return task;
  },
);

/** 카드 드래그 → 슬롯 배정 + 세션에 프롬프트 주입 */
app.post<{ Params: { id: string; taskId: string }; Body: { slotId?: string } }>(
  '/api/projects/:id/tasks/:taskId/dispatch',
  async (req, reply) => {
    const project = store.getProject(req.params.id);
    const task = store.getTask(req.params.taskId);
    const slot = project && req.body?.slotId ? findSlot(project, req.body.slotId) : undefined;
    if (!project || !task || task.projectId !== project.id || !slot) {
      return reply.code(404).send({ error: '태스크 또는 슬롯을 찾을 수 없습니다.' });
    }
    task.assignee = slot.id;
    task.status = 'doing';
    task.dispatchedAt = new Date().toISOString();
    store.persistNow();

    const rolePart = slot.role && slot.role !== '자유' ? ` (너의 역할: ${slot.role})` : '';
    const desc = task.description ? ` 상세: ${task.description}` : '';
    const prompt = `[AgentSync 작업 카드] "${task.title}"${desc}${rolePart} — 이 작업을 진행해줘. 완료하면 결과를 요약해줘.`;
    const injected = await injectPrompt(project, slot, prompt);
    return { task, injected };
  },
);

app.patch<{ Params: { id: string; taskId: string }; Body: { status?: string; title?: string; description?: string; assignee?: string | null } }>(
  '/api/projects/:id/tasks/:taskId',
  async (req, reply) => {
    const task = store.getTask(req.params.taskId);
    if (!task || task.projectId !== req.params.id)
      return reply.code(404).send({ error: '태스크를 찾을 수 없습니다.' });
    const { status, title, description, assignee } = req.body ?? {};
    if (status === 'todo' || status === 'doing' || status === 'done') task.status = status;
    if (status === 'todo') task.assignee = null;
    if (assignee === null) task.assignee = null;
    if (typeof title === 'string' && title.trim()) task.title = title.trim().slice(0, 200);
    if (typeof description === 'string') task.description = description.trim().slice(0, 2000);
    store.persistNow();
    return task;
  },
);

app.delete<{ Params: { id: string; taskId: string } }>(
  '/api/projects/:id/tasks/:taskId',
  async (req, reply) => {
    const task = store.getTask(req.params.taskId);
    if (!task || task.projectId !== req.params.id)
      return reply.code(404).send({ error: '태스크를 찾을 수 없습니다.' });
    store.removeTask(task.id);
    return { ok: true };
  },
);

// ---------- 터미널 WebSocket ----------

app.get<{ Querystring: { projectId?: string; slot?: string; cols?: string; rows?: string } }>(
  '/ws/terminal',
  { websocket: true },
  (socket, req) => {
    const { projectId, slot: slotId } = req.query;
    const cols = Number(req.query.cols) || 120;
    const rows = Number(req.query.rows) || 32;
    const project = projectId ? store.getProject(projectId) : undefined;
    const slot = project && slotId ? findSlot(project, slotId) : undefined;
    if (!project || !slot) {
      socket.send('\x1b[31m[AgentSync] 잘못된 프로젝트/슬롯입니다.\x1b[0m\r\n');
      socket.close();
      return;
    }

    const session = ensureSession(project, slot, cols, rows);
    if (session.buffer) socket.send(session.buffer);

    const onData = (data: string) => {
      if (socket.readyState === socket.OPEN) socket.send(data);
    };
    session.listeners.add(onData);

    socket.on('message', (raw: Buffer) => {
      const msg = raw.toString();
      if (msg.startsWith('\x00resize:')) {
        const [c, r] = msg.slice(8).split('x').map(Number);
        resizeSession(project.id, slot.id, c, r);
      } else {
        writeToSession(project.id, slot.id, msg);
      }
    });
    socket.on('close', () => {
      // pty는 유지 — 세션은 페이지 새로고침에도 살아있는 게 의도
      session.listeners.delete(onData);
    });
  },
);

app.listen({ port: PORT, host: '127.0.0.1' }).then(() => {
  console.log(`AgentSync server: http://localhost:${PORT}`);
});
