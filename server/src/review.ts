import fs from 'node:fs';
import path from 'node:path';
import type { Project, ReviewComment, Slot } from './types.js';
import { injectPrompt } from './handoff.js';

/**
 * 리뷰 루프: 사람이 diff에 남긴 지적사항을 REVIEW.md로 워크트리에 넣고,
 * 해당 에이전트 세션에 수정 작업을 지시한다.
 */
export async function sendReview(
  project: Project,
  slot: Slot,
  comments: ReviewComment[],
): Promise<{ ok: boolean; injected: boolean; file: string; count: number }> {
  const grouped = new Map<string, ReviewComment[]>();
  for (const c of comments) {
    const list = grouped.get(c.file) ?? [];
    list.push(c);
    grouped.set(c.file, list);
  }

  const sections: string[] = [
    `# 코드 리뷰 — ${slot.label}`,
    '',
    `> ${new Date().toLocaleString('ko-KR')}에 사람이 남긴 리뷰입니다. 아래 지적사항을 반영해 수정해주세요.`,
    '',
  ];
  for (const [file, items] of grouped) {
    sections.push(`## ${file}`, '');
    for (const c of items) {
      sections.push(`### ${c.line ? `${file}:${c.line}` : file}`);
      if (c.code) sections.push('```', c.code.trim(), '```');
      sections.push(c.text.trim(), '');
    }
  }

  const reviewPath = path.join(slot.worktree.path, 'REVIEW.md');
  fs.writeFileSync(reviewPath, sections.join('\n'), 'utf8');

  const fileList = [...grouped.keys()].join(', ');
  const prompt =
    `[AgentSync 코드 리뷰] 방금 작성한 코드에 리뷰가 달렸어. REVIEW.md 파일을 읽고 지적사항 ${comments.length}건을 반영해서 수정해줘. ` +
    `대상 파일: ${fileList}. 수정이 끝나면 무엇을 어떻게 고쳤는지 요약해줘.`;
  const injected = await injectPrompt(project, slot, prompt);

  return { ok: true, injected, file: 'REVIEW.md', count: comments.length };
}
