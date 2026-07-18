import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CLI_PRESETS, type HandoffRecord, type NoteItem, type Project, type Slot, type TaskItem } from './types.js';

const dataDir =
  process.env.AGENTSYNC_DATA_DIR || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');
const dataFile = path.join(dataDir, 'store.json');

interface StoreShape {
  projects: Project[];
  handoffs: HandoffRecord[];
  tasks: TaskItem[];
  notes: NoteItem[];
}

/** v1 스키마(고정 claude/codex worktrees + roles) → 슬롯 배열로 마이그레이션 */
function migrateProject(raw: Record<string, unknown>): Project {
  const p = raw as unknown as Project & {
    worktrees?: Record<string, { path: string; branch: string }>;
    roles?: Record<string, string>;
  };
  if (!p.slots && p.worktrees) {
    p.slots = Object.entries(p.worktrees).map(([cli, wt]): Slot => ({
      id: cli,
      cli,
      command: CLI_PRESETS[cli]?.command ?? cli,
      label: CLI_PRESETS[cli]?.label ?? cli,
      role: p.roles?.[cli] ?? '자유',
      worktree: wt,
    }));
    delete p.worktrees;
    delete p.roles;
  }
  return p;
}

function load(): StoreShape {
  try {
    const raw = JSON.parse(fs.readFileSync(dataFile, 'utf8')) as StoreShape;
    raw.projects = (raw.projects ?? []).map((p) => migrateProject(p as unknown as Record<string, unknown>));
    raw.handoffs = raw.handoffs ?? [];
    raw.tasks = raw.tasks ?? [];
    raw.notes = raw.notes ?? [];
    return raw;
  } catch {
    return { projects: [], handoffs: [], tasks: [], notes: [] };
  }
}

const state: StoreShape = load();

function persist() {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(dataFile, JSON.stringify(state, null, 2), 'utf8');
}

export const store = {
  listProjects(): Project[] {
    return state.projects;
  },
  getProject(id: string): Project | undefined {
    return state.projects.find((p) => p.id === id);
  },
  addProject(p: Project) {
    state.projects.push(p);
    persist();
  },
  removeProject(id: string) {
    state.projects = state.projects.filter((p) => p.id !== id);
    state.handoffs = state.handoffs.filter((h) => h.projectId !== id);
    state.tasks = state.tasks.filter((t) => t.projectId !== id);
    persist();
  },
  listHandoffs(projectId: string): HandoffRecord[] {
    return state.handoffs.filter((h) => h.projectId === projectId);
  },
  addHandoff(h: HandoffRecord) {
    state.handoffs.push(h);
    persist();
  },
  listTasks(projectId: string): TaskItem[] {
    return state.tasks.filter((t) => t.projectId === projectId);
  },
  getTask(id: string): TaskItem | undefined {
    return state.tasks.find((t) => t.id === id);
  },
  addTask(t: TaskItem) {
    state.tasks.push(t);
    persist();
  },
  removeTask(id: string) {
    state.tasks = state.tasks.filter((t) => t.id !== id);
    persist();
  },
  listNotes(projectId: string): NoteItem[] {
    return state.notes.filter((n) => n.projectId === projectId);
  },
  addNote(n: NoteItem) {
    state.notes.push(n);
    // 프로젝트당 최근 200개만 유지
    const mine = state.notes.filter((x) => x.projectId === n.projectId);
    if (mine.length > 200) {
      const cutoff = mine[mine.length - 200].createdAt;
      state.notes = state.notes.filter((x) => x.projectId !== n.projectId || x.createdAt >= cutoff);
    }
    persist();
  },
  /** 저장된 객체를 직접 수정한 뒤 호출 (슬롯/태스크 편집 등) */
  persistNow() {
    persist();
  },
};
