/**
 * AgentSync MCP 서버 (stdio)
 *
 * 에이전트 CLI(Claude Code, Codex, Gemini 등)가 이 서버를 통해 프로젝트의
 * 공유 컨텍스트(칸반 태스크, 핸드오프 기록, 팀 노트)에 접근한다.
 * 메인 API(4310)의 얇은 클라이언트라서 데이터 충돌이 없고,
 * 실행 위치(cwd)로 자신이 어느 프로젝트/슬롯인지 자동 인식한다.
 */
import path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import type { HandoffRecord, NoteItem, Project, Slot, TaskItem } from './types.js';

const API = process.env.AGENTSYNC_API || 'http://127.0.0.1:4310';

async function api<T>(pathname: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${pathname}`, {
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
    ...init,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((body as { error?: string }).error || `AgentSync API 오류 (${res.status})`);
  }
  return body as T;
}

interface Context {
  project: Project;
  slot: Slot | null; // null이면 메인 저장소 등 슬롯 밖에서 실행된 경우
}

let cached: Context | null = null;

/** cwd가 어느 프로젝트/슬롯의 워크트리인지 판별 */
async function resolveContext(): Promise<Context> {
  if (cached) return cached;
  const cwd = path.resolve(process.cwd()).toLowerCase();
  const projects = await api<Project[]>('/api/projects');
  for (const project of projects) {
    for (const slot of project.slots) {
      const wt = path.resolve(slot.worktree.path).toLowerCase();
      if (cwd === wt || cwd.startsWith(wt + path.sep)) {
        cached = { project, slot };
        return cached;
      }
    }
  }
  for (const project of projects) {
    const repo = path.resolve(project.repoPath).toLowerCase();
    if (cwd === repo || cwd.startsWith(repo + path.sep)) {
      cached = { project, slot: null };
      return cached;
    }
  }
  throw new Error(
    `현재 위치(${process.cwd()})가 AgentSync 프로젝트의 워크트리가 아닙니다. AgentSync 서버(4310)가 켜져 있는지도 확인하세요.`,
  );
}

function text(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}

const server = new McpServer({ name: 'agentsync', version: '0.2.0' });

server.tool(
  'agentsync_status',
  '내가 어느 프로젝트의 어떤 슬롯(에이전트)인지, 팀 구성(슬롯·역할)이 어떤지 확인한다.',
  {},
  async () => {
    const { project, slot } = await resolveContext();
    return text({
      project: { id: project.id, name: project.name, baseBranch: project.baseBranch },
      me: slot ? { id: slot.id, label: slot.label, role: slot.role } : '메인 저장소 (슬롯 아님)',
      team: project.slots.map((s) => ({ id: s.id, label: s.label, cli: s.cli, role: s.role })),
    });
  },
);

server.tool(
  'list_tasks',
  '프로젝트의 칸반 태스크 목록을 본다. 내 담당 작업과 대기 중인 작업을 파악할 때 사용.',
  { status: z.enum(['todo', 'doing', 'done']).optional().describe('필터 (생략 시 전체)') },
  async ({ status }) => {
    const { project, slot } = await resolveContext();
    let tasks = await api<TaskItem[]>(`/api/projects/${project.id}/tasks`);
    if (status) tasks = tasks.filter((t) => t.status === status);
    return text(
      tasks.map((t) => ({
        id: t.id,
        title: t.title,
        description: t.description,
        status: t.status,
        assignee: t.assignee,
        mine: slot ? t.assignee === slot.id : false,
      })),
    );
  },
);

server.tool(
  'update_task_status',
  '태스크 상태를 바꾼다. 맡은 작업을 끝냈으면 done으로 보고할 것.',
  {
    taskId: z.string().describe('태스크 id (list_tasks에서 확인)'),
    status: z.enum(['todo', 'doing', 'done']),
  },
  async ({ taskId, status }) => {
    const { project } = await resolveContext();
    const updated = await api<TaskItem>(`/api/projects/${project.id}/tasks/${taskId}`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
    return text({ ok: true, task: { id: updated.id, title: updated.title, status: updated.status } });
  },
);

server.tool(
  'list_handoffs',
  '이 프로젝트의 핸드오프(인수인계) 기록을 본다.',
  {},
  async () => {
    const { project } = await resolveContext();
    const handoffs = await api<HandoffRecord[]>(`/api/projects/${project.id}/handoffs`);
    return text(
      handoffs.slice(-10).map((h) => ({
        from: h.fromLabel,
        to: h.toLabel,
        summary: h.summary,
        docs: h.copiedDocs,
        at: h.createdAt,
      })),
    );
  },
);

server.tool(
  'read_team_notes',
  '팀 노트(에이전트들이 서로 남긴 공유 메모)를 읽는다. 작업 시작 전에 확인하면 좋다.',
  {},
  async () => {
    const { project } = await resolveContext();
    const notes = await api<NoteItem[]>(`/api/projects/${project.id}/notes`);
    return text(notes.map((n) => ({ author: n.author, text: n.text, at: n.createdAt })));
  },
);

server.tool(
  'write_team_note',
  '팀 노트에 메모를 남긴다. 다른 에이전트가 알아야 할 결정사항·주의점을 기록할 것.',
  { text: z.string().min(1).max(2000).describe('남길 메모') },
  async ({ text: noteText }) => {
    const { project, slot } = await resolveContext();
    const note = await api<NoteItem>(`/api/projects/${project.id}/notes`, {
      method: 'POST',
      body: JSON.stringify({ author: slot?.label ?? 'unknown', text: noteText }),
    });
    return text({ ok: true, id: note.id });
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
