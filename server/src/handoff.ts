import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import type { HandoffRecord, Project, Slot } from './types.js';
import { changedDocs } from './gitService.js';
import { ensureSession, writeToSession } from './sessionManager.js';
import { store } from './store.js';

const MAX_SUMMARY_CHARS = 6000;

/** Claude Code 세션 기록: ~/.claude/projects/<경로 비영숫자→'-'>/*.jsonl */
function claudeProjectDir(cwd: string): string {
  const munged = cwd.replace(/[^A-Za-z0-9]/g, '-');
  return path.join(os.homedir(), '.claude', 'projects', munged);
}

function newestFiles(dir: string, ext: string, limit: number): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(ext))
    .map((f) => path.join(dir, f))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)
    .slice(0, limit);
}

function extractClaudeSummary(worktreePath: string): string {
  for (const file of newestFiles(claudeProjectDir(worktreePath), '.jsonl', 3)) {
    const texts: string[] = [];
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try {
        const obj = JSON.parse(line);
        if (obj.type === 'assistant' && Array.isArray(obj.message?.content)) {
          for (const c of obj.message.content) {
            if (c.type === 'text' && c.text?.trim()) texts.push(c.text.trim());
          }
        }
      } catch {
        /* skip malformed lines */
      }
    }
    if (texts.length) return texts.slice(-3).join('\n\n---\n\n').slice(-MAX_SUMMARY_CHARS);
  }
  return '';
}

/** Codex 세션 기록: ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl */
function extractCodexSummary(worktreePath: string): string {
  const base = path.join(os.homedir(), '.codex', 'sessions');
  if (!fs.existsSync(base)) return '';
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (entry.name.endsWith('.jsonl')) files.push(p);
    }
  };
  walk(base);
  files.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);

  const normalizedWt = path.resolve(worktreePath).toLowerCase();
  for (const file of files.slice(0, 20)) {
    const content = fs.readFileSync(file, 'utf8');
    if (!content.toLowerCase().includes(normalizedWt.replace(/\\/g, '\\\\')) &&
        !content.toLowerCase().includes(normalizedWt)) {
      continue;
    }
    const texts: string[] = [];
    for (const line of content.split('\n')) {
      if (!line.trim()) continue;
      try {
        const obj = JSON.parse(line);
        const payload = obj.payload ?? obj;
        if (payload?.role === 'assistant' && Array.isArray(payload.content)) {
          for (const c of payload.content) {
            const text = c.text ?? c.output_text;
            if (typeof text === 'string' && text.trim()) texts.push(text.trim());
          }
        }
      } catch {
        /* skip malformed lines */
      }
    }
    if (texts.length) return texts.slice(-3).join('\n\n---\n\n').slice(-MAX_SUMMARY_CHARS);
  }
  return '';
}

/** CLI별 세션 요약 어댑터 — 지원 안 되는 CLI는 문서 전달만 */
function extractSummary(slot: Slot): string {
  if (slot.cli === 'claude') return extractClaudeSummary(slot.worktree.path);
  if (slot.cli === 'codex') return extractCodexSummary(slot.worktree.path);
  return '';
}

const SUMMARIZE_PROMPT =
  '다른 AI 코딩 에이전트에게 이 세션의 작업을 인수인계해야 해. 지금까지 한 작업, 만들거나 수정한 파일, 남은 할 일, 주의사항을 마크다운으로 간결하게 요약해줘. 인사말 없이 요약 본문만 출력해.';

/**
 * Claude 슬롯 전용 고품질 요약: 최신 세션을 `claude -p --resume`으로 재개해
 * 인수인계 요약을 생성. 프롬프트는 stdin으로 넘겨 cmd.exe 인용 문제를 회피.
 */
function summarizeClaudeSession(worktreePath: string): Promise<string> {
  const files = newestFiles(claudeProjectDir(worktreePath), '.jsonl', 1);
  if (!files.length) return Promise.resolve('');
  const sessionId = path.basename(files[0], '.jsonl');

  return new Promise((resolve) => {
    const proc = spawn('cmd.exe', ['/c', 'claude', '-p', '--resume', sessionId], {
      cwd: worktreePath,
      windowsHide: true,
    });
    let out = '';
    const timer = setTimeout(() => {
      proc.kill();
      resolve('');
    }, 90_000);
    proc.stdout.on('data', (d: Buffer) => (out += d.toString('utf8')));
    proc.on('error', () => {
      clearTimeout(timer);
      resolve('');
    });
    proc.on('close', (code) => {
      clearTimeout(timer);
      resolve(code === 0 ? out.trim().slice(0, MAX_SUMMARY_CHARS) : '');
    });
    proc.stdin.write(SUMMARIZE_PROMPT, 'utf8');
    proc.stdin.end();
  });
}

export interface HandoffResult {
  record: HandoffRecord;
  injected: boolean;
}

export async function performHandoff(project: Project, from: Slot, to: Slot): Promise<HandoffResult> {
  // Claude 슬롯은 세션 재개로 진짜 요약 생성, 실패하면 원문 발췌로 폴백
  let summary = '';
  let aiSummary = false;
  if (from.cli === 'claude' && process.env.AGENTSYNC_SUMMARIZE !== 'off') {
    summary = await summarizeClaudeSession(from.worktree.path);
    aiSummary = Boolean(summary);
  }
  if (!summary) summary = extractSummary(from);

  const docs = await changedDocs(project, from);
  const copied: string[] = [];
  for (const rel of docs) {
    const src = path.join(from.worktree.path, rel);
    const dst = path.join(to.worktree.path, rel);
    if (fs.existsSync(src)) {
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.copyFileSync(src, dst);
      copied.push(rel);
    }
  }

  const handoffMd = [
    `# HANDOFF — ${from.label} → ${to.label}`,
    '',
    `> AgentSync가 ${new Date().toLocaleString('ko-KR')}에 자동 생성한 인수인계 문서입니다.`,
    '',
    copied.length ? `## 전달된 문서\n${copied.map((d) => `- ${d}`).join('\n')}` : '',
    '',
    aiSummary
      ? `## ${from.label} 세션의 인수인계 요약 (AI 생성)`
      : `## ${from.label} 세션의 최근 작업 내용 (원문 발췌)`,
    '',
    summary || '(세션 기록을 찾지 못했습니다 — 전달된 문서를 참고하세요)',
    '',
  ].join('\n');
  fs.writeFileSync(path.join(to.worktree.path, 'HANDOFF.md'), handoffMd, 'utf8');

  ensureSession(project, to);
  const rolePart = to.role && to.role !== '자유' ? ` 이 프로젝트에서 너의 역할은 "${to.role}"이야.` : '';
  const prompt = `HANDOFF.md 파일을 읽어줘. ${from.label}가 넘긴 인수인계 문서야.${rolePart} 내용을 파악한 뒤 이어서 작업을 진행해줘.`;
  const injected = await injectPrompt(project, to, prompt);

  const record: HandoffRecord = {
    id: crypto.randomUUID().slice(0, 8),
    projectId: project.id,
    from: from.id,
    to: to.id,
    fromLabel: from.label,
    toLabel: to.label,
    summary: summary.slice(0, 500),
    copiedDocs: copied,
    createdAt: new Date().toISOString(),
  };
  store.addHandoff(record);
  return { record, injected };
}

/** 세션이 방금 떴을 수 있으니 부팅 여유를 두고 프롬프트 주입 */
export function injectPrompt(project: Project, slot: Slot, prompt: string): Promise<boolean> {
  ensureSession(project, slot);
  const oneLine = prompt.replace(/\s*\n\s*/g, ' ').trim();
  return new Promise<boolean>((resolve) => {
    setTimeout(() => {
      resolve(writeToSession(project.id, slot.id, oneLine + '\r'));
    }, 2500);
  });
}
