import pty from '@lydell/node-pty';
import type { Project, Slot } from './types.js';

export interface AgentSession {
  key: string;
  proc: pty.IPty;
  buffer: string;
  listeners: Set<(data: string) => void>;
  exited: boolean;
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
    env: { ...process.env } as Record<string, string>,
  });

  const session: AgentSession = { key, proc, buffer: '', listeners: new Set(), exited: false };

  proc.onData((data) => {
    session.buffer = (session.buffer + data).slice(-MAX_BUFFER);
    for (const l of session.listeners) l(data);
  });
  proc.onExit(({ exitCode }) => {
    session.exited = true;
    const msg = `\r\n\x1b[33m[AgentSync] 세션이 종료되었습니다 (exit ${exitCode}). 새로고침하면 다시 시작합니다.\x1b[0m\r\n`;
    session.buffer += msg;
    for (const l of session.listeners) l(msg);
  });

  sessions.set(key, session);
  return session;
}

export function writeToSession(projectId: string, slotId: string, data: string): boolean {
  const s = getSession(projectId, slotId);
  if (!s) return false;
  s.proc.write(data);
  return true;
}

export function resizeSession(projectId: string, slotId: string, cols: number, rows: number) {
  const s = getSession(projectId, slotId);
  if (s && cols > 0 && rows > 0) s.proc.resize(cols, rows);
}

export function killSession(projectId: string, slotId: string) {
  const key = sessionKey(projectId, slotId);
  const s = sessions.get(key);
  if (s && !s.exited) s.proc.kill();
  sessions.delete(key);
}

export function killProjectSessions(project: Project) {
  for (const slot of project.slots) killSession(project.id, slot.id);
}
