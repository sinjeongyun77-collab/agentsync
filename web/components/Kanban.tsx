"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, type Project, type TaskItem } from "@/lib/api";
import { cliAccent } from "@/lib/accents";

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
        showToast(`"${task.title}" → ${slot?.label ?? column} 디스패치 중…`);
        const res = await api.dispatchTask(project.id, task.id, column);
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
      tasks: tasks.filter((t) => t.status === "doing" && t.assignee === s.id),
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
                      {task.title}
                    </span>
                    <button
                      onClick={() => onDelete(task)}
                      className="text-zinc-600 opacity-0 transition group-hover:opacity-100 hover:text-red-400"
                      title="삭제"
                    >
                      ✕
                    </button>
                  </div>
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
    </div>
  );
}
