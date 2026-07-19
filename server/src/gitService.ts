import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { CLI_PRESETS, type Project, type Slot } from './types.js';

const run = promisify(execFile);

export class GitError extends Error {}

async function git(cwd: string, ...args: string[]): Promise<string> {
  try {
    const { stdout } = await run('git', ['-C', cwd, ...args], {
      maxBuffer: 32 * 1024 * 1024,
      windowsHide: true,
    });
    return stdout;
  } catch (e: unknown) {
    const err = e as { stderr?: string; stdout?: string; message?: string };
    throw new GitError((err.stderr || err.stdout || err.message || 'git failed').trim());
  }
}

const PLATFORM_FILES = ['agents.md', 'claude.md', 'handoff.md', 'review.md', '.mcp.json'];

/**
 * 워크트리에 .mcp.json 생성 — Claude Code가 이 프로젝트에서 agentsync MCP 서버
 * (공유 태스크/노트)를 쓸 수 있게 한다. cwd 기반으로 슬롯을 자동 인식하므로
 * 모든 워크트리가 같은 설정을 공유한다.
 */
export function writeMcpConfig(wtPath: string) {
  const serverRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
  const tsxCli = path.join(serverRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs');
  const script = path.join(serverRoot, 'src', 'mcpServer.ts');
  const file = path.join(wtPath, '.mcp.json');
  let config: { mcpServers?: Record<string, unknown> } = {};
  try {
    config = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    /* 새로 생성 */
  }
  config.mcpServers = {
    ...config.mcpServers,
    agentsync: { command: 'node', args: [tsxCli, script] },
  };
  fs.writeFileSync(file, JSON.stringify(config, null, 2), 'utf8');
}

const AGENTS_MD_TEMPLATE = `# AGENTS.md

이 파일은 AgentSync가 관리하는 공용 규칙 파일입니다. 모든 에이전트 세션이 이 파일을 읽습니다.

## 프로젝트 규칙
- (여기에 코딩 컨벤션, 빌드/테스트 명령 등을 적으세요)

## 역할 분담
- 역할은 고정이 아닙니다. AgentSync 웹 UI에서 슬롯별로 자유롭게 바꿀 수 있습니다.
- 예: Claude=설계·Codex=구현, 그 반대, Claude 둘이 병렬 코딩 등.
`;

function worktreeBase(project: Pick<Project, 'repoPath' | 'name'>): string {
  return path.join(path.dirname(project.repoPath), `${project.name}.agentsync`);
}

/** 슬롯 추가: 고유 id 산출 → 브랜치+워크트리 생성 → 공용 파일 링크 */
export async function addSlot(project: Project, cli: string, command?: string, label?: string): Promise<Slot> {
  const preset = CLI_PRESETS[cli];
  const cmd = (command ?? preset?.command ?? cli).trim();
  if (!cmd) throw new GitError('실행 명령이 비어 있습니다.');

  let n = 1;
  while (project.slots.some((s) => s.id === `${cli}-${n}`)) n++;
  const id = `${cli}-${n}`;
  const sameCliCount = project.slots.filter((s) => s.cli === cli).length;
  const baseLabel = label ?? preset?.label ?? cli;
  const finalLabel = sameCliCount > 0 ? `${baseLabel} #${sameCliCount + 1}` : baseLabel;

  const branch = `agentsync/${id}`;
  const wtPath = path.join(worktreeBase(project), id);
  if (!fs.existsSync(wtPath)) {
    const branchExists = await git(project.repoPath, 'rev-parse', '--verify', `refs/heads/${branch}`)
      .then(() => true)
      .catch(() => false);
    if (branchExists) {
      await git(project.repoPath, 'worktree', 'add', wtPath, branch);
    } else {
      await git(project.repoPath, 'worktree', 'add', '-b', branch, wtPath, project.baseBranch);
    }
  }
  linkSharedFile(project.repoPath, wtPath, 'AGENTS.md');
  linkSharedFile(project.repoPath, wtPath, 'CLAUDE.md');
  writeMcpConfig(wtPath);

  const slot: Slot = { id, cli, command: cmd, label: finalLabel, role: '자유', worktree: { path: wtPath, branch } };
  project.slots.push(slot);
  return slot;
}

export async function createProjectFromRepo(repoPath: string): Promise<Project> {
  const abs = path.resolve(repoPath);
  if (!fs.existsSync(abs)) throw new GitError(`경로가 존재하지 않습니다: ${abs}`);

  const root = (await git(abs, 'rev-parse', '--show-toplevel')).trim();
  const rootWin = path.resolve(root);
  const name = path.basename(rootWin);

  const baseBranch = (await git(rootWin, 'rev-parse', '--abbrev-ref', 'HEAD')).trim();
  if (baseBranch === 'HEAD') throw new GitError('detached HEAD 상태의 저장소는 연결할 수 없습니다.');
  await git(rootWin, 'rev-parse', 'HEAD').catch(() => {
    throw new GitError('커밋이 하나도 없는 저장소입니다. 먼저 최초 커밋을 만들어 주세요.');
  });

  const agentsMd = path.join(rootWin, 'AGENTS.md');
  if (!fs.existsSync(agentsMd)) fs.writeFileSync(agentsMd, AGENTS_MD_TEMPLATE, 'utf8');
  const claudeMd = path.join(rootWin, 'CLAUDE.md');
  if (!fs.existsSync(claudeMd)) fs.writeFileSync(claudeMd, '@AGENTS.md\n', 'utf8');

  const project: Project = {
    id: crypto.randomUUID().slice(0, 8),
    name,
    repoPath: rootWin,
    baseBranch,
    slots: [],
    createdAt: new Date().toISOString(),
  };
  fs.mkdirSync(worktreeBase(project), { recursive: true });

  // 기본 구성: Claude + Codex (이후 UI에서 자유롭게 추가/삭제)
  await addSlot(project, 'claude');
  await addSlot(project, 'codex');
  return project;
}

/**
 * 공용 파일 공유 — Windows에서 관리자 권한 없이 되는 하드링크 우선, 실패 시 복사.
 */
function linkSharedFile(repoRoot: string, wtPath: string, file: string) {
  const src = path.join(repoRoot, file);
  const dst = path.join(wtPath, file);
  if (!fs.existsSync(src)) return;
  try {
    if (fs.existsSync(dst)) fs.rmSync(dst);
    fs.linkSync(src, dst);
  } catch {
    fs.copyFileSync(src, dst);
  }
}

export interface DiffResult {
  slotId: string;
  branch: string;
  diff: string;
  untracked: string[];
  aheadCount: number;
}

export async function getDiff(project: Project, slot: Slot): Promise<DiffResult> {
  const wt = slot.worktree;
  const diff = await git(wt.path, 'diff', project.baseBranch, '--', '.', ':!AGENTS.md', ':!CLAUDE.md', ':!HANDOFF.md', ':!REVIEW.md', ':!.mcp.json');
  const untracked = (await git(wt.path, 'ls-files', '--others', '--exclude-standard'))
    .split('\n')
    .filter((f) => f && !PLATFORM_FILES.includes(path.basename(f).toLowerCase()));
  const ahead = (await git(wt.path, 'rev-list', '--count', `${project.baseBranch}..HEAD`)).trim();
  return { slotId: slot.id, branch: wt.branch, diff, untracked, aheadCount: Number(ahead) || 0 };
}

export interface MergeResult {
  ok: boolean;
  message: string;
}

export async function mergeSlotBranch(project: Project, slot: Slot): Promise<MergeResult> {
  const wt = slot.worktree;

  const status = (await git(wt.path, 'status', '--porcelain')).trim();
  if (status) {
    // 플랫폼 관리 파일은 에이전트 커밋에서 제외 (하드링크로 공유되므로)
    await git(wt.path, 'add', '-A', '--', '.', ':!HANDOFF.md', ':!AGENTS.md', ':!CLAUDE.md', ':!REVIEW.md', ':!.mcp.json');
    const staged = (await git(wt.path, 'diff', '--cached', '--name-only')).trim();
    if (staged) await git(wt.path, 'commit', '-m', `agentsync: ${slot.label} 작업 자동 커밋`);
  }

  const ahead = Number((await git(wt.path, 'rev-list', '--count', `${project.baseBranch}..HEAD`)).trim());
  if (!ahead) return { ok: true, message: '병합할 커밋이 없습니다.' };

  // 미추적 파일은 병합을 막지 않음 (연결 시 만든 AGENTS.md 등)
  const mainStatus = (await git(project.repoPath, 'status', '--porcelain'))
    .split('\n')
    .filter((l) => l.trim() && !l.startsWith('??'))
    .join('\n');
  if (mainStatus) {
    return { ok: false, message: '메인 저장소에 커밋되지 않은 변경이 있어 병합을 중단했습니다. 먼저 정리해 주세요.' };
  }
  const current = (await git(project.repoPath, 'rev-parse', '--abbrev-ref', 'HEAD')).trim();
  if (current !== project.baseBranch) {
    await git(project.repoPath, 'checkout', project.baseBranch);
  }
  try {
    await git(project.repoPath, 'merge', '--no-ff', wt.branch, '-m', `agentsync: merge ${wt.branch}`);
    return { ok: true, message: `${wt.branch} → ${project.baseBranch} 병합 완료 (${ahead}개 커밋)` };
  } catch (e) {
    await git(project.repoPath, 'merge', '--abort').catch(() => {});
    return { ok: false, message: `병합 충돌이 발생해 취소했습니다: ${(e as Error).message}` };
  }
}

/**
 * 아레나 패자 정리용: 워크트리를 base 브랜치 상태로 완전 초기화.
 * (커밋·미커밋 변경 모두 폐기 — 호출 전 사용자 확인 필수)
 */
export async function resetSlotWorktree(project: Project, slot: Slot): Promise<void> {
  const wt = slot.worktree;
  await git(wt.path, 'reset', '--hard', project.baseBranch);
  await git(wt.path, 'clean', '-fd');
  // clean이 지웠을 수 있는 플랫폼 공유 파일 복구
  linkSharedFile(project.repoPath, wt.path, 'AGENTS.md');
  linkSharedFile(project.repoPath, wt.path, 'CLAUDE.md');
  writeMcpConfig(wt.path);
}

/** base 대비 변경·추가된 md 파일 — 핸드오프로 전달할 문서 후보 */
export async function changedDocs(project: Project, slot: Slot): Promise<string[]> {
  const wt = slot.worktree;
  const changed = (await git(wt.path, 'diff', '--name-only', project.baseBranch)).split('\n');
  const untracked = (await git(wt.path, 'ls-files', '--others', '--exclude-standard')).split('\n');
  return [...changed, ...untracked].filter(
    (f) => f && f.toLowerCase().endsWith('.md') && !PLATFORM_FILES.includes(path.basename(f).toLowerCase()),
  );
}
