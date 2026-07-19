"use client";

import type { VerifyResult } from "@/lib/api";

/** 병합 전 검증 결과 — 충돌 예측 + 프로젝트 검증 명령 결과 */
export default function VerifyPanel({ result, compact }: { result: VerifyResult; compact?: boolean }) {
  return (
    <div
      className={`rounded-lg border p-3 text-xs ${
        result.ok ? "border-emerald-800 bg-emerald-950/30" : "border-red-800 bg-red-950/30"
      }`}
    >
      <div className="flex items-center gap-2">
        <span className={result.ok ? "text-emerald-300" : "text-red-300"}>
          {result.ok ? "✅ 병합 가능" : "⚠️ 병합 위험"}
        </span>
        <span className="text-zinc-500">
          {result.slotLabel} · 변경 파일 {result.filesChanged}개
        </span>
      </div>

      {!result.mergeable && (
        <div className="mt-2">
          <p className="font-semibold text-red-300">충돌 예상 파일</p>
          <ul className="mt-1 space-y-0.5 font-mono text-[11px] text-red-400">
            {result.conflicts.map((f) => (
              <li key={f}>⚔ {f}</li>
            ))}
          </ul>
          <p className="mt-1 text-[11px] text-zinc-500">
            base 브랜치가 그사이 바뀌었습니다. 해당 에이전트에게 최신 base를 반영하도록 지시하세요.
          </p>
        </div>
      )}

      {!compact && result.checks.length > 0 && (
        <ul className="mt-2 space-y-1">
          {result.checks.map((c, i) => (
            <li key={i} className="rounded border border-zinc-800 bg-zinc-900/60 px-2 py-1">
              <div className="flex items-center gap-2">
                <span className={c.skipped ? "text-zinc-500" : c.ok ? "text-emerald-400" : "text-red-400"}>
                  {c.skipped ? "—" : c.ok ? "✓" : "✕"}
                </span>
                <span className="font-mono text-[11px] text-zinc-300">{c.name}</span>
              </div>
              {!c.ok && !c.skipped && (
                <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-all text-[10px] text-zinc-500">
                  {c.detail}
                </pre>
              )}
              {c.skipped && <p className="mt-0.5 text-[10px] text-zinc-600">{c.detail}</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
