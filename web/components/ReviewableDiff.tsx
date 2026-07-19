"use client";

import { useMemo, useState } from "react";
import type { ReviewComment } from "@/lib/api";

interface ParsedLine {
  key: string;
  text: string;
  cls: string;
  /** 코멘트를 달 수 있는 코드 줄인지 (헤더·구분선 제외) */
  commentable: boolean;
  file: string;
  lineNo?: number;
}

/** unified diff를 파싱해 각 줄에 파일명·새 파일 기준 줄번호를 붙인다 */
function parseDiff(text: string): ParsedLine[] {
  const out: ParsedLine[] = [];
  let file = "";
  let newLine = 0;

  text.split("\n").forEach((raw, i) => {
    const key = `l${i}`;
    if (raw.startsWith("diff --git")) {
      const m = raw.match(/ b\/(.+)$/);
      file = m ? m[1] : raw.replace("diff --git ", "");
      out.push({ key, text: raw, cls: "font-semibold text-zinc-200", commentable: false, file });
      return;
    }
    if (raw.startsWith("+++") || raw.startsWith("---") || raw.startsWith("index ") || raw.startsWith("new file") || raw.startsWith("deleted file") || raw.startsWith("similarity ") || raw.startsWith("rename ")) {
      out.push({ key, text: raw, cls: "text-zinc-600", commentable: false, file });
      return;
    }
    if (raw.startsWith("@@")) {
      const m = raw.match(/@@ -\d+(?:,\d+)? \+(\d+)/);
      newLine = m ? Number(m[1]) : 0;
      out.push({ key, text: raw, cls: "text-sky-400", commentable: false, file });
      return;
    }
    if (raw.startsWith("+")) {
      out.push({ key, text: raw, cls: "text-emerald-400", commentable: true, file, lineNo: newLine });
      newLine += 1;
      return;
    }
    if (raw.startsWith("-")) {
      out.push({ key, text: raw, cls: "text-red-400", commentable: true, file, lineNo: undefined });
      return;
    }
    out.push({ key, text: raw, cls: "text-zinc-400", commentable: Boolean(raw), file, lineNo: newLine });
    if (raw) newLine += 1;
  });

  return out;
}

/**
 * 코멘트를 달 수 있는 diff 뷰어. 줄에 마우스를 올리면 💬 버튼이 나타나고,
 * 클릭하면 그 자리에 코멘트 입력창이 열린다.
 */
export default function ReviewableDiff({
  text,
  comments,
  onAdd,
  onRemove,
}: {
  text: string;
  comments: ReviewComment[];
  onAdd: (c: ReviewComment) => void;
  onRemove: (index: number) => void;
}) {
  const lines = useMemo(() => parseDiff(text), [text]);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  if (!text.trim())
    return (
      <p className="rounded-lg border border-dashed border-zinc-800 p-6 text-center text-sm text-zinc-500">
        base 브랜치 대비 변경 사항이 없습니다.
      </p>
    );

  function commentsFor(line: ParsedLine) {
    return comments
      .map((c, i) => ({ c, i }))
      .filter(({ c }) => c.file === line.file && c.code === line.text);
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-zinc-800 bg-[#101014] p-2 font-mono text-xs leading-relaxed">
      {lines.map((line) => {
        const mine = commentsFor(line);
        return (
          <div key={line.key}>
            <div className="group flex items-start gap-1">
              {line.commentable ? (
                <button
                  onClick={() => {
                    setOpenKey(openKey === line.key ? null : line.key);
                    setDraft("");
                  }}
                  className="mt-0.5 shrink-0 rounded px-1 text-[10px] text-zinc-700 opacity-0 transition hover:bg-zinc-800 hover:text-sky-300 group-hover:opacity-100"
                  title="이 줄에 리뷰 코멘트 남기기"
                >
                  💬
                </button>
              ) : (
                <span className="w-5 shrink-0" />
              )}
              <span className={`whitespace-pre ${line.cls}`}>{line.text || " "}</span>
            </div>

            {mine.map(({ c, i }) => (
              <div
                key={`c${i}`}
                className="my-1 ml-6 flex items-start gap-2 rounded border border-sky-900 bg-sky-950/40 px-2 py-1"
              >
                <span className="text-sky-400">💬</span>
                <span className="flex-1 whitespace-pre-wrap font-sans text-[11px] text-sky-200">{c.text}</span>
                <button onClick={() => onRemove(i)} className="text-[10px] text-zinc-600 hover:text-red-400">
                  삭제
                </button>
              </div>
            ))}

            {openKey === line.key && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (draft.trim()) {
                    onAdd({
                      file: line.file,
                      line: line.lineNo,
                      code: line.text,
                      text: draft.trim(),
                    });
                    setDraft("");
                    setOpenKey(null);
                  }
                }}
                className="my-1 ml-6 flex gap-2"
              >
                <input
                  autoFocus
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder="이 줄의 문제점이나 수정 요청을 적으세요"
                  className="flex-1 rounded border border-zinc-700 bg-zinc-950 px-2 py-1 font-sans text-[11px] outline-none placeholder:text-zinc-600 focus:border-sky-500"
                />
                <button className="rounded bg-sky-600 px-2 py-1 font-sans text-[11px] text-white hover:bg-sky-500">
                  추가
                </button>
                <button
                  type="button"
                  onClick={() => setOpenKey(null)}
                  className="px-1 font-sans text-[11px] text-zinc-500 hover:text-zinc-300"
                >
                  취소
                </button>
              </form>
            )}
          </div>
        );
      })}
    </div>
  );
}
