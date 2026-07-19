export interface WorktreeInfo {
  path: string;
  branch: string;
}

/** 에이전트 슬롯 — CLI 종류와 역할을 자유롭게 조합 (같은 CLI 여러 개 가능) */
export interface Slot {
  id: string; // worktree 디렉터리 이름과 동일 (예: claude-1)
  cli: string; // 'claude' | 'codex' | 'gemini' | 'custom'
  command: string; // 실제 스폰 명령
  label: string; // 표시 이름 (예: "Claude Code #2")
  role: string; // 자유 편집 역할
  worktree: WorktreeInfo;
}

export interface Project {
  id: string;
  name: string;
  repoPath: string;
  baseBranch: string;
  slots: Slot[];
  /** 병합 전 실행할 검증 명령 (예: npm run typecheck) */
  verifyCommands?: string[];
  createdAt: string;
}

export interface HandoffRecord {
  id: string;
  projectId: string;
  from: string; // slot id
  to: string; // slot id
  fromLabel: string;
  toLabel: string;
  summary: string;
  copiedDocs: string[];
  createdAt: string;
}

export type TaskStatus = 'todo' | 'doing' | 'done';

export interface TaskItem {
  id: string;
  projectId: string;
  title: string;
  description: string;
  assignee: string | null; // slot id
  status: TaskStatus;
  createdAt: string;
  dispatchedAt?: string;
  /** 아레나 모드: 같은 작업을 여러 슬롯에 동시에 시키고 승자를 채택 */
  arena?: { slots: string[]; winner?: string };
}

/** 에이전트들이 MCP로 공유하는 팀 노트 */
export interface NoteItem {
  id: string;
  projectId: string;
  author: string; // slot label 또는 'user'
  text: string;
  createdAt: string;
}

export const MAX_SLOTS = 6;

export const CLI_PRESETS: Record<string, { label: string; command: string }> = {
  claude: { label: 'Claude Code', command: 'claude' },
  codex: { label: 'Codex', command: 'codex' },
  gemini: { label: 'Gemini CLI', command: 'gemini' },
  qwen: { label: 'Qwen Code', command: 'qwen' },
  kimi: { label: 'Kimi Code', command: 'kimi' },
};
