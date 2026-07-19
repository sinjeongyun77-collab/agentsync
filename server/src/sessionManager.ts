import pty from '@lydell/node-pty';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Project, Slot } from './types.js';

/** 서버 기동 후 설치된 CLI(예: Kimi)도 찾을 수 있게 알려진 설치 경로를 PATH에 보강 */
function sessionEnv(): Record<string, string> {
  const env = { ...process.env } as Record<string, string>;
  const extraBins = [path.join(os.homedir(), '.kimi-code', 'bin')];
  const additions = extraBins.filter((p) => fs.existsSync(p) && !(env.Path ?? env.PATH ?? '').includes(p));
  if (additions.length) {
    const key = env.Path !== undefined ? 'Path' : 'PATH';
    env[key] = `${env[key] ?? ''};${additions.join(';')}`;
  }
  return env;
}

export interface AgentSession {
  key: string;
  proc: pty.IPty;
  buffer: string;
  listeners: Set<(data: string) => void>;
  exited: boolean;
  /** 컨텍스트 추적: 이 세션이 시작된 이후 처리한 작업들 */
  startedAt: number;
  taskTitles: string[];
}

export interface SessionContext {
  slotId: string;
  running: boolean;
  startedAt: string | null;
  taskCount: number;
  taskTitles: string[];
  /** 여러 작업이 한 세션에 누적되면 컨텍스트 오염 위험 */
  contextStale: boolean;
}

const MAX_BUFFER = 200 * 1024;
const sessions = new Map<string, AgentSession>();

function sessionKey(projectId: string, slotId: string) {
  return `${projectId}:${slotId}`;
}

/** 테스트용 오버라이드 (예: AGENTSYNC_CMD_CLAUDE=powershell) 우선, 아니면 슬롯 명령 */
function slotCommand(slot: Slot): string {
  const override = process.env[`AGENTSYNC_CMD_${slot.cli.toUpperCase()}`];
  return override || slot.command;
}

export function getSession(projectId: string, slotId: string): AgentSession | undefined {
  const s = sessions.get(sessionKey(projectId, slotId));
  return s && !s.exited ? s : undefined;
}

export function ensureSession(project: Project, slot: Slot, cols = 120, rows = 32): AgentSession {
  const key = sessionKey(project.id, slot.id);
  const existing = sessions.get(key);
  if (existing && !existing.exited) return existing;

  // cmd.exe /c는 npm 설치 CLI의 .cmd 심을 ConPTY에서 해석해준다
  const proc = pty.spawn('cmd.exe', ['/c', slotCommand(slot)], {
    name: 'xterm-256color',
    cols,
    rows,
    cwd: slot.worktree.path,
    env: sessionEnv(),
  });

  const session: AgentSession = {
    key,
    proc,
    buffer: '',
    listeners: new Set(),
    exited: false,
    startedAt: Date.now(),
    taskTitles: [],
  };

  proc.onData((data) => {
    session.buffer = (session.buffer + data).slice(-MAX_BUFFER);
    for (const l of session.listeners) l(data);
  });
  const startedAt = Date.now();
  proc.onExit(({ exitCode }) => {
    session.exited = true;
    // 몇 초 안에 죽었다면 십중팔구 CLI 미설치/명령 오류
    const quickExit = Date.now() - startedAt < 7000 && exitCode !== 0;
    const hint = quickExit
      ? `\r\n\x1b[31m[AgentSync] '${slotCommand(slot)}' 실행에 실패했습니다. CLI가 설치돼 있는지 확인하세요.\x1b[0m` +
        `\r\n\x1b[33m  Gemini: npm install -g @google/gemini-cli · Qwen: npm install -g @qwen-code/qwen-code\x1b[0m`
      : '';
    const msg = `${hint}\r\n\x1b[33m[AgentSync] 세션이 종료되었습니다 (exit ${exitCode}). 새로고침하면 다시 시작합니다.\x1b[0m\r\n`;
    session.buffer += msg;
    for (const l of session.listeners) l(msg);
  });

  sessions.set(key, session);
  return session;
}

export function writeToSession(projectId: string, slotId: string, data: string): boolean {
  const s = getSession(projectId, slotId);
  if (!s) return false;
  try {
    s.proc.write(data);
    return true;
  } catch {
    return false; // pty가 방금 종료된 레이스 — 서버는 계속 살아야 한다
  }
}

export function resizeSession(projectId: string, slotId: string, cols: number, rows: number) {
  const s = getSession(projectId, slotId);
  if (s && cols > 0 && rows > 0) {
    try {
      s.proc.resize(cols, rows);
    } catch {
      /* pty가 방금 종료된 레이스 — 무시 */
    }
  }
}

export function killSession(projectId: string, slotId: string) {
  const key = sessionKey(projectId, slotId);
  const s = sessions.get(key);
  if (s && !s.exited) {
    try {
      s.proc.kill();
    } catch {
      /* 이미 종료된 pty — 무시 */
    }
  }
  sessions.delete(key);
}

export function killProjectSessions(project: Project) {
  for (const slot of project.slots) killSession(project.id, slot.id);
}

/** 작업 디스패치 기록 — 컨텍스트 누적 추적용 */
export function recordTask(projectId: string, slotId: string, title: string) {
  const s = getSession(projectId, slotId);
  if (s) s.taskTitles.push(title);
}

export function getContexts(project: Project): SessionContext[] {
  return project.slots.map((slot) => {
    const s = getSession(project.id, slot.id);
    return {
      slotId: slot.id,
      running: Boolean(s),
      startedAt: s ? new Date(s.startedAt).toISOString() : null,
      taskCount: s?.taskTitles.length ?? 0,
      taskTitles: s?.taskTitles.slice(-5) ?? [],
      // 서로 다른 작업이 2건 이상 쌓이면 이전 작업의 맥락이 새 작업에 섞일 수 있다
      contextStale: (s?.taskTitles.length ?? 0) >= 2,
    };
  });
}

/** 컨텍스트를 비우고 CLI를 새로 띄운다 (이전 대화가 새 작업에 섞이지 않게) */
export function restartSession(project: Project, slot: Slot, cols = 120, rows = 32): AgentSession {
  killSession(project.id, slot.id);
  return ensureSession(project, slot, cols, rows);
}
