"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api, type Project } from "@/lib/api";
import { cliAccent } from "@/lib/accents";

export default function Home() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [repoPath, setRepoPath] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [serverUp, setServerUp] = useState(true);

  const refresh = () =>
    api
      .listProjects()
      .then((p) => {
        setProjects(p);
        setServerUp(true);
      })
      .catch(() => setServerUp(false));

  useEffect(() => {
    refresh();
  }, []);

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!repoPath.trim()) return;
    setBusy(true);
    setError("");
    try {
      await api.createProject(repoPath.trim());
      setRepoPath("");
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function onDelete(id: string, name: string) {
    if (!confirm(`'${name}' 프로젝트 연결을 해제할까요?\n(워크트리와 브랜치는 디스크에 남습니다)`)) return;
    await api.deleteProject(id);
    await refresh();
  }

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-14">
      <header className="mb-10">
        <h1 className="text-3xl font-bold tracking-tight">
          Agent<span className="text-emerald-400">Sync</span>
        </h1>
        <p className="mt-2 text-sm text-zinc-400">
          Claude Code × Codex — 두 에이전트가 워크트리를 나눠 쓰고, 핸드오프 버튼으로 작업을
          넘깁니다. 역할(설계/코딩/자유)은 프로젝트마다 자유롭게 정할 수 있어요.
        </p>
      </header>

      {!serverUp && (
        <div className="mb-6 rounded-lg border border-amber-700 bg-amber-950/50 px-4 py-3 text-sm text-amber-300">
          백엔드 서버(localhost:4310)에 연결할 수 없습니다. <code>server</code> 폴더에서{" "}
          <code>npm run dev</code>를 실행해 주세요.
        </div>
      )}

      <form onSubmit={onCreate} className="mb-10 flex gap-2">
        <input
          value={repoPath}
          onChange={(e) => setRepoPath(e.target.value)}
          placeholder="로컬 git 저장소 경로 (예: C:\dev\myapp)"
          className="flex-1 rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-2.5 text-sm outline-none placeholder:text-zinc-500 focus:border-emerald-500"
        />
        <button
          disabled={busy}
          className="rounded-lg bg-emerald-500 px-5 py-2.5 text-sm font-semibold text-zinc-950 transition hover:bg-emerald-400 disabled:opacity-50"
        >
          {busy ? "워크트리 생성 중…" : "프로젝트 연결"}
        </button>
      </form>
      {error && <p className="-mt-6 mb-6 text-sm text-red-400">{error}</p>}

      <ul className="space-y-3">
        {projects.map((p) => (
          <li
            key={p.id}
            className="group flex items-center justify-between rounded-xl border border-zinc-800 bg-zinc-900/60 px-5 py-4 transition hover:border-zinc-600"
          >
            <Link href={`/project/${p.id}`} className="min-w-0 flex-1">
              <div className="font-semibold">{p.name}</div>
              <div className="mt-0.5 truncate text-xs text-zinc-500">
                {p.repoPath} · base: {p.baseBranch}
              </div>
            </Link>
            <div className="flex items-center gap-3">
              {p.slots.map((s) => (
                <span key={s.id} className={`rounded-full border px-2 py-0.5 text-[11px] ${cliAccent(s.cli)}`}>
                  {s.label}
                </span>
              ))}
              <button
                onClick={() => onDelete(p.id, p.name)}
                className="text-xs text-zinc-600 opacity-0 transition group-hover:opacity-100 hover:text-red-400"
              >
                연결 해제
              </button>
            </div>
          </li>
        ))}
        {serverUp && projects.length === 0 && (
          <li className="rounded-xl border border-dashed border-zinc-800 px-5 py-10 text-center text-sm text-zinc-500">
            아직 연결된 프로젝트가 없습니다. 로컬 git 저장소 경로를 입력해 시작하세요.
          </li>
        )}
      </ul>
    </main>
  );
}
