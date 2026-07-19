"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, type DiffResult, type Project, type SessionContext, type TaskItem, type VerifyResult } from "@/lib/api";
import { cliAccent } from "@/lib/accents";
import DiffView from "@/components/DiffView";
import VerifyPanel from "@/components/VerifyPanel";

export default function Kanban({
  project,
  showToast,
}: {
  project: Project;
  showToast: (m: string) => void;
}) {
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [dragId, setDragId] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<string | null>(null);
  const [arenaSetup, setArenaSetup] = useState<TaskItem | null>(null);
  const [arenaCompare, setArenaCompare] = useState<TaskItem | null>(null);
  const [contexts, setContexts] = useState<SessionContext[]>([]);

  // 드래그 중 보드 가장자리에 가까워지면 자동 가로 스크롤 (먼 컬럼으로 한 번에 이동)
  const boardRef = useRef<HTMLDivElement | null>(null);
  const scrollVel = useRef(0);
  const rafId = useRef<number | null>(null);

  const stopAutoScroll = useCallback(() => {
    if (rafId.current !== null) cancelAnimationFrame(rafId.current);
    rafId.current = null;
    scrollVel.current = 0;
  }, []);

  const startAutoScroll = useCallback(() => {
    if (rafId.current !== null) return;
    const step = () => {
      const el = boardRef.current;
      if (el && scrollVel.current !== 0) el.scrollLeft += scrollVel.current;
      rafId.current = requestAnimationFrame(step);
    };
    rafId.current = requestAnimationFrame(step);
  }, []);

  useEffect(() => stopAutoScroll, [stopAutoScroll]);

  function onBoardDragOver(e: React.DragEvent) {
    e.preventDefault();
    const el = boardRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const EDGE = 120; // 가장자리 감지 폭(px)
    const MAX = 22; // 프레임당 최대 스크롤(px)
    if (e.clientX < rect.left + EDGE) {
      scrollVel.current = -Math.ceil(((rect.left + EDGE - e.clientX) / EDGE) * MAX);
    } else if (e.clientX > rect.right - EDGE) {
      scrollVel.current = Math.ceil(((e.clientX - (rect.right - EDGE)) / EDGE) * MAX);
    } else {
      scrollVel.current = 0;
    }
  }

  const load = useCallback(() => {
    api.listTasks(project.id).then(setTasks).catch(() => {});
  }, [project.id]);

  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    const loadCtx = () => api.listContexts(project.id).then(setContexts).catch(() => {});
    loadCtx();
    const t = setInterval(loadCtx, 8000);
    return () => clearInterval(t);
  }, [project.id]);

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    try {
      await api.createTask(project.id, title.trim(), desc.trim() || undefined);
      setTitle("");
      setDesc("");
      load();
    } catch (err) {
      showToast(`카드 생성 실패: ${(err as Error).message}`);
    }
  }

  async function onDrop(column: string) {
    setOverCol(null);
    stopAutoScroll();
    if (!dragId) return;
    const task = tasks.find((t) => t.id === dragId);
    setDragId(null);
    if (!task) return;
    try {
      if (column === "todo") {
        await api.updateTask(project.id, task.id, { status: "todo" });
      } else if (column === "done") {
        await api.updateTask(project.id, task.id, { status: "done" });
      } else {
        // 슬롯 컬럼 → 디스패치 (세션에 프롬프트 주입)
        const slot = project.slots.find((s) => s.id === column);
        const ctx = contexts.find((c) => c.slotId === column);
        // 다른 작업이 이미 쌓인 세션이면 컨텍스트를 비우고 시작할지 확인
        let fresh = false;
        if (ctx?.contextStale) {
          fresh = confirm(
            `${slot?.label}에는 이미 작업 ${ctx.taskCount}건의 대화가 쌓여 있습니다.\n` +
              `(${ctx.taskTitles.join(", ")})\n\n` +
              `새 컨텍스트로 시작할까요?\n` +
              `[확인] 깨끗한 세션에서 시작 (권장 — 이전 작업 맥락이 섞이지 않음)\n` +
              `[취소] 기존 대화를 이어서 진행`,
          );
        }
        showToast(`"${task.title}" → ${slot?.label ?? column} 디스패치 중…${fresh ? " (새 컨텍스트)" : ""}`);
        const res = await api.dispatchTask(project.id, task.id, column, fresh);
        showToast(
          res.injected
            ? `"${task.title}" 카드를 ${slot?.label}에게 보냈습니다. 터미널 탭에서 확인하세요.`
            : `배정은 됐지만 프롬프트 주입에 실패했습니다. 터미널에서 직접 지시해 주세요.`,
        );
      }
      load();
    } catch (err) {
      showToast(`이동 실패: ${(err as Error).message}`);
    }
  }

  async function onDelete(task: TaskItem) {
    if (!confirm(`'${task.title}' 카드를 삭제할까요?`)) return;
    await api.deleteTask(project.id, task.id).catch(() => {});
    load();
  }

  const columns: { key: string; title: string; accent: string; tasks: TaskItem[] }[] = [
    {
      key: "todo",
      title: "대기",
      accent: "border-zinc-700 text-zinc-300",
      tasks: tasks.filter((t) => t.status === "todo"),
    },
    ...project.slots.map((s) => ({
      key: s.id,
      title: s.label,
      accent: cliAccent(s.cli),
      tasks: tasks.filter(
        (t) =>
          t.status === "doing" &&
          (t.assignee === s.id || (t.arena && !t.arena.winner && t.arena.slots.includes(s.id))),
      ),
    })),
    {
      key: "done",
      title: "완료",
      accent: "border-emerald-700 text-emerald-300",
      tasks: tasks.filter((t) => t.status === "done"),
    },
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-5">
      <form onSubmit={onCreate} className="flex flex-wrap gap-2">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="작업 제목 (예: 로그인 API 구현)"
          className="w-64 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm outline-none placeholder:text-zinc-500 focus:border-emerald-500"
        />
        <input
          value={desc}
          onChange={(e) => setDesc(e.target.value)}
          placeholder="상세 설명 (선택)"
          className="min-w-48 flex-1 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm outline-none placeholder:text-zinc-500 focus:border-emerald-500"
        />
        <button className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-zinc-950 transition hover:bg-emerald-400">
          카드 추가
        </button>
      </form>
      <p className="text-xs text-zinc-500">
        카드를 에이전트 컬럼으로 드래그하면 해당 세션에 작업 지시가 자동 주입됩니다.
      </p>

      <div
        ref={boardRef}
        onDragOver={onBoardDragOver}
        className="flex min-h-0 flex-1 gap-3 overflow-x-auto pb-2"
      >
        {columns.map((col) => (
          <div
            key={col.key}
            onDragOver={(e) => {
              e.preventDefault();
              setOverCol(col.key);
            }}
            onDragLeave={() => setOverCol((c) => (c === col.key ? null : c))}
            onDrop={() => onDrop(col.key)}
            className={`flex w-64 shrink-0 flex-col rounded-xl border bg-zinc-900/40 transition ${
              overCol === col.key ? "border-emerald-500 bg-emerald-950/20" : "border-zinc-800"
            }`}
          >
            <div className={`border-b border-zinc-800 px-3 py-2 text-sm font-semibold ${col.accent.split(" ").pop()}`}>
              {col.title}
              <span className="ml-2 text-xs font-normal text-zinc-500">{col.tasks.length}</span>
            </div>
            <div className="flex min-h-24 flex-1 flex-col gap-2 p-2">
              {col.tasks.map((task) => (
                <div
                  key={task.id}
                  draggable
                  onDragStart={() => {
                    setDragId(task.id);
                    startAutoScroll();
                  }}
                  onDragEnd={() => {
                    setDragId(null);
                    stopAutoScroll();
                  }}
                  className="group cursor-grab rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm shadow-sm transition hover:border-zinc-500 active:cursor-grabbing"
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className={task.status === "done" ? "text-zinc-500 line-through" : ""}>
                      {task.arena && "🥊 "}
                      {task.title}
                    </span>
                    <span className="flex shrink-0 gap-1">
                      {task.status === "todo" && !task.arena && (
                        <button
                          onClick={() => setArenaSetup(task)}
                          className="text-zinc-600 opacity-0 transition group-hover:opacity-100 hover:text-amber-300"
                          title="아레나: 두 에이전트에게 동시에 시키고 승자 채택"
                        >
                          🥊
                        </button>
                      )}
                      <button
                        onClick={() => onDelete(task)}
                        className="text-zinc-600 opacity-0 transition group-hover:opacity-100 hover:text-red-400"
                        title="삭제"
                      >
                        ✕
                      </button>
                    </span>
                  </div>
                  {task.arena && !task.arena.winner && task.status === "doing" && (
                    <button
                      onClick={() => setArenaCompare(task)}
                      className="mt-2 w-full rounded-md border border-amber-800 bg-amber-950/40 px-2 py-1 text-xs text-amber-300 transition hover:bg-amber-900/50"
                    >
                      ⚖️ 결과 비교 · 승자 채택
                    </button>
                  )}
                  {task.arena?.winner && (
                    <p className="mt-1 text-[10px] text-amber-400">
                      🏆 {project.slots.find((s) => s.id === task.arena?.winner)?.label ?? task.arena.winner} 승
                    </p>
                  )}
                  {task.description && (
                    <p className="mt-1 line-clamp-2 text-xs text-zinc-500">{task.description}</p>
                  )}
                  {task.dispatchedAt && task.status === "doing" && (
                    <p className="mt-1 text-[10px] text-zinc-600">
                      {new Date(task.dispatchedAt).toLocaleTimeString("ko-KR")} 디스패치됨
                    </p>
                  )}
                </div>
              ))}
              {col.tasks.length === 0 && (
                <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed border-zinc-800 py-6 text-xs text-zinc-600">
                  {col.key === "todo" ? "카드를 추가하세요" : "여기로 드래그"}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {arenaSetup && (
        <ArenaSetupModal
          project={project}
          task={arenaSetup}
          onClose={() => setArenaSetup(null)}
          onStart={async (slotIds) => {
            setArenaSetup(null);
            const labels = slotIds
              .map((sid) => project.slots.find((s) => s.id === sid)?.label ?? sid)
              .join(" vs ");
            showToast(`🥊 아레나 시작: ${labels} — 두 세션에 동시에 디스패치 중…`);
            try {
              await api.arenaStart(project.id, arenaSetup.id, slotIds);
              showToast(`🥊 ${labels} 아레나 진행 중 — 터미널 탭에서 관전하세요.`);
              load();
            } catch (e) {
              showToast(`아레나 시작 실패: ${(e as Error).message}`);
            }
          }}
        />
      )}

      {arenaCompare && (
        <ArenaCompareModal
          project={project}
          task={arenaCompare}
          onClose={() => setArenaCompare(null)}
          showToast={showToast}
          onDecided={() => {
            setArenaCompare(null);
            load();
          }}
        />
      )}
    </div>
  );
}

function ArenaSetupModal({
  project,
  task,
  onClose,
  onStart,
}: {
  project: Project;
  task: TaskItem;
  onClose: () => void;
  onStart: (slotIds: string[]) => void;
}) {
  const [picked, setPicked] = useState<string[]>([]);
  function toggle(id: string) {
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id].slice(-2)));
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="w-[26rem] max-w-[90vw] rounded-xl border border-zinc-700 bg-zinc-900 p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-sm font-semibold text-zinc-200">🥊 아레나 — 대결시킬 에이전트 2명 선택</h2>
        <p className="mt-1 text-xs text-zinc-500">
          &ldquo;{task.title}&rdquo; 작업을 두 에이전트가 각자 독립적으로 수행합니다. 끝나면 결과를
          비교해 승자만 병합하세요. (해당 작업만큼 양쪽 사용량이 듭니다)
        </p>
        <div className="mt-4 grid grid-cols-2 gap-2">
          {project.slots.map((s) => (
            <button
              key={s.id}
              onClick={() => toggle(s.id)}
              className={`rounded-lg border px-3 py-2 text-sm transition ${
                picked.includes(s.id)
                  ? `bg-zinc-800 ${cliAccent(s.cli)}`
                  : "border-zinc-800 text-zinc-400 hover:border-zinc-600"
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg px-3 py-1.5 text-sm text-zinc-400 hover:text-zinc-200">
            취소
          </button>
          <button
            disabled={picked.length !== 2}
            onClick={() => onStart(picked)}
            className="rounded-lg bg-amber-500 px-4 py-1.5 text-sm font-semibold text-zinc-950 transition hover:bg-amber-400 disabled:opacity-40"
          >
            대결 시작
          </button>
        </div>
      </div>
    </div>
  );
}

function ArenaCompareModal({
  project,
  task,
  onClose,
  onDecided,
  showToast,
}: {
  project: Project;
  task: TaskItem;
  onClose: () => void;
  onDecided: () => void;
  showToast: (m: string) => void;
}) {
  const slots = (task.arena?.slots ?? [])
    .map((sid) => project.slots.find((s) => s.id === sid))
    .filter((s): s is NonNullable<typeof s> => Boolean(s));
  const [diffs, setDiffs] = useState<Record<string, DiffResult | null>>({});
  const [verifies, setVerifies] = useState<Record<string, VerifyResult | "loading">>({});
  const [resetLoser, setResetLoser] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    for (const s of slots) {
      api
        .getDiff(project.id, s.id)
        .then((d) => setDiffs((prev) => ({ ...prev, [s.id]: d })))
        .catch(() => setDiffs((prev) => ({ ...prev, [s.id]: null })));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id, task.id]);

  async function verifyOne(slotId: string) {
    setVerifies((p) => ({ ...p, [slotId]: "loading" }));
    try {
      const res = await api.verify(project.id, slotId);
      setVerifies((p) => ({ ...p, [slotId]: res }));
    } catch (e) {
      showToast(`검증 실패: ${(e as Error).message}`);
      setVerifies((p) => {
        const next = { ...p };
        delete next[slotId];
        return next;
      });
    }
  }

  async function adopt(slotId: string) {
    const label = project.slots.find((s) => s.id === slotId)?.label ?? slotId;
    if (!confirm(`${label}의 결과를 채택해 ${project.baseBranch}에 병합할까요?\n(병합 전 검증이 자동 실행됩니다)${resetLoser ? "\n패자의 작업물은 초기화됩니다." : ""}`))
      return;
    setBusy(true);
    try {
      const res = await api.arenaWinner(project.id, task.id, slotId, resetLoser);
      showToast(res.message);
      if (res.verify) setVerifies((p) => ({ ...p, [slotId]: res.verify! }));
      if (res.ok) onDecided();
    } catch (e) {
      showToast(`채택 실패: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6" onClick={onClose}>
      <div
        className="flex max-h-full w-full max-w-6xl flex-col rounded-xl border border-zinc-700 bg-zinc-900 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-zinc-800 px-5 py-3">
          <h2 className="text-sm font-semibold">🥊 아레나 결과 비교 — {task.title}</h2>
          <label className="ml-auto flex items-center gap-1.5 text-xs text-zinc-400">
            <input type="checkbox" checked={resetLoser} onChange={(e) => setResetLoser(e.target.checked)} />
            패자 워크트리 초기화
          </label>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-200">
            ✕
          </button>
        </div>
        <div className="grid min-h-0 flex-1 grid-cols-2 gap-px overflow-hidden bg-zinc-800">
          {slots.map((s) => {
            const d = diffs[s.id];
            return (
              <div key={s.id} className="flex min-h-0 flex-col bg-zinc-900">
                <div className="flex items-center gap-2 border-b border-zinc-800 px-4 py-2">
                  <span className={`rounded-full border px-2 py-0.5 text-xs ${cliAccent(s.cli)}`}>{s.label}</span>
                  {d && (
                    <span className="text-[11px] text-zinc-500">
                      커밋 {d.aheadCount} · 새 파일 {d.untracked.length}
                    </span>
                  )}
                  <button
                    onClick={() => verifyOne(s.id)}
                    disabled={busy || verifies[s.id] === "loading"}
                    className="ml-auto rounded-md border border-sky-700 bg-sky-950/40 px-2 py-1 text-xs text-sky-300 transition hover:bg-sky-900/50 disabled:opacity-40"
                  >
                    {verifies[s.id] === "loading" ? "검증 중…" : "🔎 검증"}
                  </button>
                  <button
                    onClick={() => adopt(s.id)}
                    disabled={busy}
                    className="rounded-md bg-emerald-500 px-3 py-1 text-xs font-semibold text-zinc-950 transition hover:bg-emerald-400 disabled:opacity-40"
                  >
                    🏆 이쪽 채택
                  </button>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto p-3">
                  {verifies[s.id] && verifies[s.id] !== "loading" && (
                    <div className="mb-3">
                      <VerifyPanel result={verifies[s.id] as VerifyResult} />
                    </div>
                  )}
                  {d === undefined ? (
                    <p className="text-xs text-zinc-500">diff 불러오는 중…</p>
                  ) : d === null ? (
                    <p className="text-xs text-red-400">diff 로드 실패</p>
                  ) : (
                    <>
                      {d.untracked.length > 0 && (
                        <p className="mb-2 font-mono text-xs text-emerald-400">
                          {d.untracked.map((f) => `+ ${f}`).join("  ")}
                        </p>
                      )}
                      <DiffView text={d.diff} />
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
