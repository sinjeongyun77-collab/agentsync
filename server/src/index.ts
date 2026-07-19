import Fastify from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import crypto from 'node:crypto';
import { store } from './store.js';
import { addSlot, createProjectFromRepo, getDiff, mergeSlotBranch, resetSlotWorktree, writeMcpConfig, GitError } from './gitService.js';
import {
  ensureSession,
  getContexts,
  killProjectSessions,
  killSession,
  recordTask,
  resizeSession,
  restartSession,
  writeToSession,
} from './sessionManager.js';
import { installCli, listClis } from './cliManager.js';
import { suggestVerifyCommands, verifySlot } from './verify.js';
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

// ---------- CLI 설치 관리 (비개발자용) ----------

app.get('/api/clis', async () => listClis());

/** 설치 진행 상황을 실시간으로 보여주기 위한 WebSocket */
app.get<{ Querystring: { cli?: string } }>('/ws/install', { websocket: true }, (socket, req) => {
  const cli = req.query.cli;
  if (!cli) {
    socket.send('설치할 CLI가 지정되지 않았습니다.');
    socket.close();
    return;
  }
  const handle = installCli(cli, {
    onOutput: (chunk) => {
      if (socket.readyState === socket.OPEN) socket.send(chunk);
    },
    onDone: (ok) => {
      if (socket.readyState === socket.OPEN) {
        socket.send(`\r\n__AGENTSYNC_DONE__:${ok ? 'ok' : 'fail'}`);
        socket.close();
      }
    },
  });
  if (!handle) {
    socket.send(`알 수 없는 CLI: ${cli}`);
    socket.close();
    return;
  }
  socket.on('close', () => handle.cancel());
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

// ---------- 컨텍스트 격리 ----------

app.get<{ Params: { id: string } }>('/api/projects/:id/contexts', async (req, reply) => {
  const project = store.getProject(req.params.id);
  if (!project) return reply.code(404).send({ error: '프로젝트를 찾을 수 없습니다.' });
  return getContexts(project);
});

/** 세션을 새로 띄워 이전 대화 맥락을 비운다 */
app.post<{ Params: { id: string; slotId: string } }>(
  '/api/projects/:id/slots/:slotId/restart',
  async (req, reply) => {
    const project = store.getProject(req.params.id);
    const slot = project && findSlot(project, req.params.slotId);
    if (!project || !slot) return reply.code(404).send({ error: '슬롯을 찾을 수 없습니다.' });
    restartSession(project, slot);
    return { ok: true, message: `${slot.label} 세션을 새 컨텍스트로 재시작했습니다.` };
  },
);

// ---------- 병합 검증 ----------

app.get<{ Params: { id: string } }>('/api/projects/:id/verify-config', async (req, reply) => {
  const project = store.getProject(req.params.id);
  if (!project) return reply.code(404).send({ error: '프로젝트를 찾을 수 없습니다.' });
  return {
    commands: project.verifyCommands ?? [],
    suggestions: suggestVerifyCommands(project.repoPath),
  };
});

app.put<{ Params: { id: string }; Body: { commands?: string[] } }>(
  '/api/projects/:id/verify-config',
  async (req, reply) => {
    const project = store.getProject(req.params.id);
    if (!project) return reply.code(404).send({ error: '프로젝트를 찾을 수 없습니다.' });
    const commands = (req.body?.commands ?? []).map((c) => String(c).trim()).filter(Boolean).slice(0, 6);
    project.verifyCommands = commands;
    store.persistNow();
    return { ok: true, commands };
  },
);

app.post<{ Params: { id: string; slotId: string }; Body: { runChecks?: boolean } }>(
  '/api/projects/:id/verify/:slotId',
  async (req, reply) => {
    const project = store.getProject(req.params.id);
    const slot = project && findSlot(project, req.params.slotId);
    if (!project || !slot) return reply.code(404).send({ error: '슬롯을 찾을 수 없습니다.' });
    try {
      return await verifySlot(project, slot, { runChecks: req.body?.runChecks !== false });
    } catch (e) {
      return handleGitError(e, reply);
    }
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

app.post<{ Params: { id: string }; Body: { slotId?: string; skipVerify?: boolean } }>(
  '/api/projects/:id/merge',
  async (req, reply) => {
    const project = store.getProject(req.params.id);
    const slot = project && req.body?.slotId ? findSlot(project, req.body.slotId) : undefined;
    if (!project || !slot) return reply.code(404).send({ error: '슬롯을 찾을 수 없습니다.' });
    try {
      // 검증 없이 병합하면 충돌·깨진 빌드가 base로 들어간다 — 기본은 검증 필수
      if (!req.body?.skipVerify) {
        const verdict = await verifySlot(project, slot);
        if (!verdict.ok) {
          return {
            ok: false,
            message: verdict.mergeable
              ? '검증 실패로 병합을 중단했습니다. 검증 결과를 확인하세요.'
              : `병합 충돌이 예상돼 중단했습니다 (${verdict.conflicts.length}개 파일).`,
            verify: verdict,
          };
        }
      }
      return await mergeSlotBranch(project, slot);
    } catch (e) {
      return handleGitError(e, reply);
    }
  },
);

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
app.post<{ Params: { id: string; taskId: string }; Body: { slotId?: string; freshContext?: boolean } }>(
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

    // 이전 작업 맥락이 새 작업에 섞이지 않도록 요청 시 세션을 새로 띄운다
    if (req.body?.freshContext) restartSession(project, slot);

    const rolePart = slot.role && slot.role !== '자유' ? ` (너의 역할: ${slot.role})` : '';
    const desc = task.description ? ` 상세: ${task.description}` : '';
    const prompt = `[AgentSync 작업 카드] "${task.title}"${desc}${rolePart} — 이 작업을 진행해줘. 완료하면 결과를 요약해줘.`;
    const injected = await injectPrompt(project, slot, prompt);
    recordTask(project.id, slot.id, task.title);
    return { task, injected };
  },
);

/** 아레나 시작: 같은 작업을 두 슬롯에 동시에 디스패치 */
app.post<{ Params: { id: string; taskId: string }; Body: { slotIds?: string[]; freshContext?: boolean } }>(
  '/api/projects/:id/tasks/:taskId/arena',
  async (req, reply) => {
    const project = store.getProject(req.params.id);
    const task = store.getTask(req.params.taskId);
    if (!project || !task || task.projectId !== project.id) {
      return reply.code(404).send({ error: '태스크를 찾을 수 없습니다.' });
    }
    const slotIds = [...new Set(req.body?.slotIds ?? [])];
    const slots = slotIds.map((sid) => findSlot(project, sid)).filter((s): s is Slot => Boolean(s));
    if (slots.length !== 2) return reply.code(400).send({ error: '서로 다른 슬롯 2개가 필요합니다.' });

    task.arena = { slots: slots.map((s) => s.id) };
    task.assignee = null;
    task.status = 'doing';
    task.dispatchedAt = new Date().toISOString();
    store.persistNow();

    const desc = task.description ? ` 상세: ${task.description}` : '';
    const results: boolean[] = [];
    for (const slot of slots) {
      // 공정한 대결을 위해 양쪽 모두 깨끗한 컨텍스트에서 시작 (기본값)
      if (req.body?.freshContext !== false) restartSession(project, slot);
      const prompt = `[AgentSync 아레나] "${task.title}"${desc} — 다른 에이전트도 같은 작업을 독립적으로 수행 중이야. 상의 없이 너만의 최선의 구현을 해줘. 완료하면 결과를 요약해줘.`;
      results.push(await injectPrompt(project, slot, prompt));
      recordTask(project.id, slot.id, task.title);
    }
    return { task, injected: results };
  },
);

/** 아레나 승자 채택: 승자 브랜치 병합, 패자 워크트리는 선택적으로 초기화 */
app.post<{ Params: { id: string; taskId: string }; Body: { slotId?: string; resetLoser?: boolean; skipVerify?: boolean } }>(
  '/api/projects/:id/tasks/:taskId/arena/winner',
  async (req, reply) => {
    const project = store.getProject(req.params.id);
    const task = store.getTask(req.params.taskId);
    if (!project || !task || task.projectId !== project.id || !task.arena) {
      return reply.code(404).send({ error: '아레나 태스크를 찾을 수 없습니다.' });
    }
    const winner = req.body?.slotId ? findSlot(project, req.body.slotId) : undefined;
    if (!winner || !task.arena.slots.includes(winner.id)) {
      return reply.code(400).send({ error: '승자는 아레나 참가 슬롯이어야 합니다.' });
    }
    try {
      if (!req.body?.skipVerify) {
        const verdict = await verifySlot(project, winner);
        if (!verdict.ok) {
          return {
            ok: false,
            message: verdict.mergeable
              ? '승자 코드가 검증을 통과하지 못해 채택을 중단했습니다.'
              : `승자 코드에 병합 충돌이 예상돼 중단했습니다 (${verdict.conflicts.length}개 파일).`,
            verify: verdict,
          };
        }
      }
      const merge = await mergeSlotBranch(project, winner);
      if (!merge.ok) return { ok: false, message: merge.message };

      let loserReset = false;
      if (req.body?.resetLoser) {
        const loserId = task.arena.slots.find((sid) => sid !== winner.id);
        const loser = loserId ? findSlot(project, loserId) : undefined;
        if (loser) {
          await resetSlotWorktree(project, loser);
          loserReset = true;
        }
      }
      task.arena.winner = winner.id;
      task.assignee = winner.id;
      task.status = 'done';
      store.persistNow();
      return { ok: true, message: `${winner.label} 채택 — ${merge.message}${loserReset ? ' · 패자 워크트리 초기화됨' : ''}` };
    } catch (e) {
      return handleGitError(e, reply);
    }
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

// ---------- 팀 노트 (MCP 공유 컨텍스트) ----------

app.get<{ Params: { id: string } }>('/api/projects/:id/notes', async (req) =>
  store.listNotes(req.params.id).slice(-50),
);

app.post<{ Params: { id: string }; Body: { author?: string; text?: string } }>(
  '/api/projects/:id/notes',
  async (req, reply) => {
    const project = store.getProject(req.params.id);
    if (!project) return reply.code(404).send({ error: '프로젝트를 찾을 수 없습니다.' });
    const text = req.body?.text?.trim();
    if (!text) return reply.code(400).send({ error: 'text가 필요합니다.' });
    const note = {
      id: crypto.randomUUID().slice(0, 8),
      projectId: project.id,
      author: (req.body?.author ?? 'user').slice(0, 40),
      text: text.slice(0, 2000),
      createdAt: new Date().toISOString(),
    };
    store.addNote(note);
    return note;
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

// 기존 워크트리에도 MCP 설정을 보장 (부팅 시 1회, 실패해도 무시)
for (const p of store.listProjects()) {
  for (const s of p.slots) {
    try {
      writeMcpConfig(s.worktree.path);
    } catch {
      /* 워크트리가 지워졌을 수 있음 */
    }
  }
}

// pty 등 네이티브 콜백의 예외로 서버 전체가 죽는 것을 방지
process.on('uncaughtException', (e) => app.log.error({ err: e }, 'uncaughtException'));
process.on('unhandledRejection', (e) => app.log.error({ err: e }, 'unhandledRejection'));

app.listen({ port: PORT, host: process.env.HOST || '127.0.0.1' }).then(() => {
  console.log(`AgentSync server: http://localhost:${PORT}`);
});
