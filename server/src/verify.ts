import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import { augmentedPath } from './cliManager.js';
import type { Project, Slot } from './types.js';

const run = promisify(execFile);

async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await run('git', ['-C', cwd, ...args], {
    maxBuffer: 32 * 1024 * 1024,
    windowsHide: true,
  });
  return stdout;
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

/**
 * 실제 병합 없이 충돌 여부를 판정한다.
 * git merge-tree --write-tree는 인덱스/워킹트리를 건드리지 않아 안전하다.
 */
async function detectConflicts(project: Project, slot: Slot): Promise<{ mergeable: boolean; conflicts: string[] }> {
  try {
    const out = await git(
      project.repoPath,
      'merge-tree',
      '--write-tree',
      '--name-only',
      project.baseBranch,
      slot.worktree.branch,
    );
    // 성공(exit 0) = 충돌 없음
    void out;
    return { mergeable: true, conflicts: [] };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; code?: number };
    const stdout = err.stdout ?? '';
    // exit 1 = 충돌: 첫 줄은 트리 OID, 이후 충돌 파일 목록
    const lines = stdout.split('\n').map((l) => l.trim()).filter(Boolean);
    const conflicts = lines.slice(1).filter((l) => !l.startsWith('CONFLICT') && !l.includes('Auto-merging'));
    if (conflicts.length || err.code === 1) {
      return { mergeable: false, conflicts: conflicts.length ? conflicts : ['(충돌 파일 목록을 읽지 못했습니다)'] };
    }
    return { mergeable: true, conflicts: [] };
  }
}

/** package.json 스크립트에서 검증 명령 자동 추천 */
export function suggestVerifyCommands(repoPath: string): string[] {
  const pkgPath = path.join(repoPath, 'package.json');
  if (!fs.existsSync(pkgPath)) return [];
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as { scripts?: Record<string, string> };
    const scripts = pkg.scripts ?? {};
    const wanted = ['typecheck', 'lint', 'test', 'build'];
    return wanted.filter((s) => scripts[s]).map((s) => `npm run ${s}`);
  } catch {
    return [];
  }
}

function runCommand(cwd: string, command: string, timeoutMs: number): Promise<CheckResult> {
  return new Promise((resolve) => {
    const env = { ...process.env } as NodeJS.ProcessEnv;
    env[env.Path !== undefined ? 'Path' : 'PATH'] = augmentedPath();
    // windowsVerbatimArguments 없이는 Node가 인용부호를 재escape해 cmd가 명령을
    // 잘못 해석하고 실패해도 종료 코드 0을 반환한다 (검증이 거짓 통과함)
    const proc = spawn('cmd.exe', ['/c', command], {
      cwd,
      env,
      windowsHide: true,
      windowsVerbatimArguments: true,
    });
    let out = '';
    const timer = setTimeout(() => {
      proc.kill();
      resolve({ name: command, command, ok: false, detail: `시간 초과 (${timeoutMs / 1000}초)` });
    }, timeoutMs);
    proc.stdout.on('data', (d: Buffer) => (out += d.toString()));
    proc.stderr.on('data', (d: Buffer) => (out += d.toString()));
    proc.on('error', (e) => {
      clearTimeout(timer);
      resolve({ name: command, command, ok: false, detail: e.message });
    });
    proc.on('close', (code) => {
      clearTimeout(timer);
      const tail = out.trim().split('\n').slice(-12).join('\n').slice(-1500);
      resolve({
        name: command,
        command,
        ok: code === 0,
        detail: tail || (code === 0 ? '통과' : `종료 코드 ${code}`),
      });
    });
  });
}

/**
 * 병합 전 검증: ① 충돌 사전 감지(실제 병합 없이) ② 에이전트 워크트리에서
 * 프로젝트 검증 명령 실행. 검증은 승자 워크트리에서 돌려야 "병합 후 상태"에
 * 가장 가깝다.
 */
export async function verifySlot(
  project: Project,
  slot: Slot,
  options: { runChecks: boolean } = { runChecks: true },
): Promise<VerifyResult> {
  const { mergeable, conflicts } = await detectConflicts(project, slot);

  let filesChanged = 0;
  try {
    const names = await git(slot.worktree.path, 'diff', '--name-only', project.baseBranch);
    filesChanged = names.split('\n').filter(Boolean).length;
  } catch {
    /* 무시 */
  }

  const checks: CheckResult[] = [];
  const commands = project.verifyCommands ?? [];
  if (!options.runChecks || commands.length === 0) {
    checks.push({
      name: '프로젝트 검증',
      ok: true,
      skipped: true,
      detail: commands.length === 0 ? '설정된 검증 명령이 없습니다 (설정에서 추가 가능)' : '건너뜀',
    });
  } else {
    for (const cmd of commands) {
      checks.push(await runCommand(slot.worktree.path, cmd, 180_000));
    }
  }

  const checksOk = checks.every((c) => c.ok || c.skipped);
  return {
    slotId: slot.id,
    slotLabel: slot.label,
    mergeable,
    conflicts,
    checks,
    filesChanged,
    ok: mergeable && checksOk,
  };
}
