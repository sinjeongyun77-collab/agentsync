"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, WS_BASE, type CliInfo } from "@/lib/api";
import { cliAccent } from "@/lib/accents";

/**
 * 비개발자도 클릭 한 번으로 에이전트 CLI를 설치할 수 있게 하는 패널.
 * 설치 후에는 터미널에서 로그인만 하면 바로 사용 가능.
 */
export default function CliInstaller({ onClose, onInstalled }: { onClose: () => void; onInstalled: () => void }) {
  const [clis, setClis] = useState<CliInfo[] | null>(null);
  const [installing, setInstalling] = useState<string | null>(null);
  const [log, setLog] = useState("");
  const logRef = useRef<HTMLPreElement>(null);

  const refresh = useCallback(() => {
    api.listClis().then(setClis).catch(() => setClis([]));
  }, []);

  useEffect(refresh, [refresh]);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [log]);

  function install(cli: CliInfo) {
    setInstalling(cli.id);
    setLog(`${cli.label} 설치를 시작합니다…\n`);
    const ws = new WebSocket(`${WS_BASE}/ws/install?cli=${cli.id}`);
    ws.onmessage = (ev) => {
      const text = String(ev.data);
      if (text.includes("__AGENTSYNC_DONE__")) {
        const ok = text.includes("__AGENTSYNC_DONE__:ok");
        setLog((l) => l + (ok ? "\n✅ 설치가 완료됐습니다!\n" : "\n❌ 설치에 실패했습니다.\n"));
        setInstalling(null);
        refresh();
        if (ok) onInstalled();
        return;
      }
      setLog((l) => (l + text).slice(-8000));
    };
    ws.onerror = () => {
      setLog((l) => l + "\n서버 연결에 실패했습니다.\n");
      setInstalling(null);
    };
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6" onClick={onClose}>
      <div
        className="flex max-h-full w-full max-w-3xl flex-col rounded-xl border border-zinc-700 bg-zinc-900 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center border-b border-zinc-800 px-5 py-3">
          <h2 className="text-sm font-semibold">AI 에이전트 설치</h2>
          <span className="ml-3 text-xs text-zinc-500">
            설치 후 터미널에서 로그인 한 번이면 바로 사용할 수 있어요
          </span>
          <button onClick={onClose} className="ml-auto text-zinc-500 hover:text-zinc-200">
            ✕
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {clis === null ? (
            <p className="text-sm text-zinc-500">확인 중…</p>
          ) : (
            <ul className="space-y-2">
              {clis.map((c) => (
                <li
                  key={c.id}
                  className="flex items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-900/60 px-4 py-3"
                >
                  <span className={`shrink-0 rounded-full border px-2 py-0.5 text-xs ${cliAccent(c.id)}`}>
                    {c.label}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-zinc-400">{c.cost}</p>
                    <p className="mt-0.5 truncate text-[11px] text-zinc-600">
                      {c.installed ? `설치됨 ${c.version ?? ""} · ${c.auth}` : c.auth}
                    </p>
                  </div>
                  {c.installed ? (
                    <span className="shrink-0 rounded-md border border-emerald-800 bg-emerald-950/40 px-3 py-1 text-xs text-emerald-300">
                      ✓ 준비됨
                    </span>
                  ) : (
                    <button
                      onClick={() => install(c)}
                      disabled={installing !== null}
                      className="shrink-0 rounded-md bg-emerald-500 px-3 py-1 text-xs font-semibold text-zinc-950 transition hover:bg-emerald-400 disabled:opacity-40"
                    >
                      {installing === c.id ? "설치 중…" : "설치"}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}

          {log && (
            <pre
              ref={logRef}
              className="mt-4 max-h-56 overflow-y-auto rounded-lg border border-zinc-800 bg-[#101014] p-3 font-mono text-[11px] leading-relaxed text-zinc-400"
            >
              {log}
            </pre>
          )}

          <p className="mt-4 text-xs text-zinc-500">
            💡 무료로 시작하려면 <span className="text-amber-300">Gemini CLI</span> +{" "}
            <span className="text-rose-300">Qwen Code</span> 조합을 추천합니다. 설치 후 슬롯을 추가하고
            터미널 안내대로 계정 로그인만 하면 됩니다.
          </p>
        </div>
      </div>
    </div>
  );
}
