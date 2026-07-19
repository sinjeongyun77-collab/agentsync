"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import dynamic from "next/dynamic";
import {
  api,
  type DiffResult,
  type HandoffRecord,
  type Project,
  type ReviewComment,
  type SessionContext,
  type Slot,
  type VerifyResult,
} from "@/lib/api";
import { cliAccent } from "@/lib/accents";
import Kanban from "@/components/Kanban";
import CliInstaller from "@/components/CliInstaller";
import VerifyPanel from "@/components/VerifyPanel";
import ReviewableDiff from "@/components/ReviewableDiff";

const Terminal = dynamic(() => import("@/components/Terminal"), { ssr: false });

const ROLE_PRESETS = ["자유", "설계·기획", "구현·코딩", "리뷰·테스트"];
const CUSTOM_ROLE = "__custom__";
const CLI_OPTIONS = [
  { value: "claude", label: "Claude Code" },
  { value: "codex", label: "Codex" },
  { value: "gemini", label: "Gemini CLI (무료 한도)" },
  { value: "qwen", label: "Qwen Code (무료 한도)" },
  { value: "kimi", label: "Kimi Code (K3)" },
  { value: "custom", label: "커스텀 명령… (opencode, aider 등)" },
];

function RoleSelect({
  value,
  onChange,
  onCustomRequest,
}: {
  value: string;
  onChange: (role: string) => void;
  onCustomRequest: () => void;
}) {
  return (
    <select
      value={ROLE_PRESETS.includes(value) ? value : CUSTOM_ROLE}
      onChange={(e) => {
        // prompt()는 임베디드 브라우저에서 차단되므로 자체 모달 사용
        if (e.target.value === CUSTOM_ROLE) onCustomRequest();
        else onChange(e.target.value);
      }}
      className="rounded-md border border-zinc-700 bg-zinc-900 px-1.5 py-0.5 text-xs text-zinc-300 outline-none hover:border-zinc-500"
      title="역할은 자유롭게 바꿀 수 있습니다"
    >
      {ROLE_PRESETS.map((r) => (
        <option key={r} value={r}>
          {r}
        </option>
      ))}
      <option value={CUSTOM_ROLE}>
        {ROLE_PRESETS.includes(value) ? "직접 입력…" : `${value} (직접 입력)`}
      </option>
    </select>
  );
}

export default function ProjectPage() {
  const { id } = useParams<{ id: string }>();
  const [project, setProject] = useState<Project | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [tab, setTab] = useState<"terminals" | "kanban" | "diff">("terminals");
  const [toast, setToast] = useState("");
  const [busy, setBusy] = useState(false);
  const [textModal, setTextModal] = useState<{
    title: string;
    placeholder: string;
    initial: string;
    onSubmit: (value: string) => void;
  } | null>(null);
  const [showInstaller, setShowInstaller] = useState(false);
  const [contexts, setContexts] = useState<SessionContext[]>([]);

  const refresh = useCallback(() => {
    return api
      .listProjects()
      .then((ps) => {
        const p = ps.find((x) => x.id === id);
        if (p) setProject(p);
        else setNotFound(true);
      })
      .catch(() => setNotFound(true));
  }, [id]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // 컨텍스트 누적 상태를 주기적으로 확인 (오염 경고용)
  useEffect(() => {
    const load = () => api.listContexts(id).then(setContexts).catch(() => {});
    load();
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, [id]);

  async function onRestartSlot(slot: Slot) {
    if (!confirm(`${slot.label} 세션을 새 컨텍스트로 재시작할까요?\n(진행 중인 대화 맥락이 비워집니다. 작업 파일은 그대로예요)`))
      return;
    try {
      const res = await api.restartSlot(id, slot.id);
      showToast(res.message);
      setTimeout(() => api.listContexts(id).then(setContexts).catch(() => {}), 1000);
    } catch (e) {
      showToast(`재시작 실패: ${(e as Error).message}`);
    }
  }

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(""), 5000);
  }, []);

  async function onRoleChange(slot: Slot, role: string) {
    try {
      await api.updateSlot(id, slot.id, { role });
      await refresh();
    } catch (e) {
      showToast(`역할 변경 실패: ${(e as Error).message}`);
    }
  }

  async function onHandoff(from: Slot, toId: string) {
    if (!toId) return;
    const to = project?.slots.find((s) => s.id === toId);
    if (!to) return;
    setBusy(true);
    showToast(`${from.label} → ${to.label} 핸드오프 진행 중…`);
    try {
      const res = await api.handoff(id, from.id, to.id);
      showToast(
        res.injected
          ? `핸드오프 완료 — ${to.label} 세션에 HANDOFF.md 안내를 주입했습니다.`
          : `HANDOFF.md 생성 완료 — ${to.label} 세션에서 직접 확인해 주세요.`,
      );
    } catch (e) {
      showToast(`핸드오프 실패: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function doAddSlot(cli: string, command?: string) {
    setBusy(true);
    try {
      await api.addSlot(id, cli, command);
      await refresh();
      showToast("슬롯이 추가됐습니다. 워크트리와 브랜치가 자동 생성됐어요.");
    } catch (e) {
      showToast(`슬롯 추가 실패: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  function onAddSlot(cli: string) {
    if (!cli) return;
    if (cli === "custom") {
      setTextModal({
        title: "실행할 명령을 입력하세요",
        placeholder: "예: opencode, aider, powershell",
        initial: "",
        onSubmit: (v) => doAddSlot("custom", v),
      });
      return;
    }
    void doAddSlot(cli);
  }

  async function onRemoveSlot(slot: Slot) {
    if (!confirm(`'${slot.label}' 슬롯을 제거할까요?\n(워크트리와 브랜치는 디스크에 남고, 세션만 종료됩니다)`)) return;
    try {
      await api.removeSlot(id, slot.id);
      await refresh();
    } catch (e) {
      showToast(`슬롯 제거 실패: ${(e as Error).message}`);
    }
  }

  if (notFound)
    return (
      <main className="flex flex-1 flex-col items-center justify-center gap-3 text-zinc-400">
        <p>프로젝트를 찾을 수 없습니다.</p>
        <Link href="/" className="text-emerald-400 underline">
          홈으로
        </Link>
      </main>
    );
  if (!project)
    return <main className="flex flex-1 items-center justify-center text-zinc-500">불러오는 중…</main>;

  const slotCount = project.slots.length;
  const rows = Math.ceil(slotCount / 2);

  return (
    <main className="flex h-screen flex-col">
      <header className="flex items-center gap-4 border-b border-zinc-800 px-5 py-3">
        <Link href="/" className="text-sm text-zinc-500 hover:text-zinc-300">
          ← AgentSync
        </Link>
        <h1 className="font-semibold">{project.name}</h1>
        <span className="text-xs text-zinc-500">base: {project.baseBranch}</span>
        <button
          onClick={() => setShowInstaller(true)}
          className="ml-auto rounded-md border border-zinc-700 px-3 py-1 text-xs text-zinc-300 transition hover:border-zinc-500"
          title="에이전트 CLI를 클릭 한 번으로 설치"
        >
          ⬇ 에이전트 설치
        </button>
        <nav className="flex gap-1 rounded-lg bg-zinc-900 p-1 text-sm">
          {(["terminals", "kanban", "diff"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`rounded-md px-3 py-1 transition ${
                tab === t ? "bg-zinc-700 text-white" : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              {t === "terminals" ? "터미널" : t === "kanban" ? "칸반" : "Diff / 병합"}
            </button>
          ))}
        </nav>
      </header>

      {toast && (
        <div className="border-b border-emerald-900 bg-emerald-950/60 px-5 py-2 text-sm text-emerald-300">
          {toast}
        </div>
      )}

      <div
        className={tab === "terminals" ? "grid min-h-0 flex-1 grid-cols-2 gap-px bg-zinc-800" : "hidden"}
        style={{ gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))` }}
      >
        {project.slots.map((slot) => {
          const others = project.slots.filter((s) => s.id !== slot.id);
          const ctx = contexts.find((c) => c.slotId === slot.id);
          return (
            <section key={slot.id} className="flex min-h-0 min-w-0 flex-col bg-zinc-950">
              <div className="flex items-center gap-2 border-b border-zinc-800 bg-zinc-900/60 px-3 py-1.5">
                <span
                  className={`rounded-full border px-2 py-0.5 text-xs ${cliAccent(slot.cli)}`}
                  title={`브랜치: ${slot.worktree.branch}`}
                >
                  {slot.label}
                </span>
                <RoleSelect
                  value={slot.role}
                  onChange={(role) => onRoleChange(slot, role)}
                  onCustomRequest={() =>
                    setTextModal({
                      title: `${slot.label}의 역할을 입력하세요`,
                      placeholder: "예: 프론트 코딩, DB 설계",
                      initial: ROLE_PRESETS.includes(slot.role) ? "" : slot.role,
                      onSubmit: (v) => onRoleChange(slot, v),
                    })
                  }
                />
                {ctx && ctx.taskCount > 0 && (
                  <button
                    onClick={() => onRestartSlot(slot)}
                    className={`rounded px-1.5 py-0.5 text-[10px] transition ${
                      ctx.contextStale
                        ? "border border-amber-800 bg-amber-950/40 text-amber-300 hover:bg-amber-900/50"
                        : "text-zinc-600 hover:text-zinc-300"
                    }`}
                    title={`이 세션에서 처리한 작업: ${ctx.taskTitles.join(", ")}\n클릭하면 컨텍스트를 비우고 새 세션으로 재시작합니다.`}
                  >
                    {ctx.contextStale ? `⚠ 작업 ${ctx.taskCount}건 누적 · 초기화` : `작업 ${ctx.taskCount}건`}
                  </button>
                )}
                <div className="ml-auto flex items-center gap-1.5">
                  {others.length === 1 ? (
                    <button
                      onClick={() => onHandoff(slot, others[0].id)}
                      disabled={busy}
                      className="rounded-md border border-emerald-700 bg-emerald-950/50 px-2.5 py-0.5 text-xs font-medium text-emerald-300 transition hover:bg-emerald-900/60 disabled:opacity-40"
                    >
                      {others[0].label}에게 넘기기 ⇥
                    </button>
                  ) : (
                    <select
                      value=""
                      disabled={busy}
                      onChange={(e) => onHandoff(slot, e.target.value)}
                      className="rounded-md border border-emerald-700 bg-emerald-950/50 px-2 py-0.5 text-xs font-medium text-emerald-300 outline-none disabled:opacity-40"
                    >
                      <option value="">넘기기 ⇥</option>
                      {others.map((o) => (
                        <option key={o.id} value={o.id}>
                          → {o.label}
                        </option>
                      ))}
                    </select>
                  )}
                  {slotCount > 1 && (
                    <button
                      onClick={() => onRemoveSlot(slot)}
                      className="px-1 text-zinc-600 transition hover:text-red-400"
                      title="슬롯 제거"
                    >
                      ✕
                    </button>
                  )}
                </div>
              </div>
              <div className="min-h-0 flex-1 bg-[#101014] p-2">
                <Terminal projectId={project.id} slotId={slot.id} />
              </div>
            </section>
          );
        })}
        {slotCount < 6 && (
          <section className="flex min-h-0 items-center justify-center bg-zinc-950">
            <select
              value=""
              disabled={busy}
              onChange={(e) => onAddSlot(e.target.value)}
              className="rounded-lg border border-dashed border-zinc-700 bg-zinc-900 px-4 py-2.5 text-sm text-zinc-400 outline-none transition hover:border-zinc-500 hover:text-zinc-200"
            >
              <option value="">+ 에이전트 슬롯 추가 (최대 6개)</option>
              {CLI_OPTIONS.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </section>
        )}
      </div>

      {tab === "kanban" && <Kanban project={project} showToast={showToast} />}
      {tab === "diff" && <DiffTab project={project} showToast={showToast} />}

      {showInstaller && (
        <CliInstaller
          onClose={() => setShowInstaller(false)}
          onInstalled={() => showToast("설치 완료! 슬롯을 추가한 뒤 터미널에서 로그인하세요.")}
        />
      )}

      {textModal && (
        <TextInputModal
          title={textModal.title}
          placeholder={textModal.placeholder}
          initial={textModal.initial}
          onCancel={() => setTextModal(null)}
          onSubmit={(v) => {
            setTextModal(null);
            if (v.trim()) textModal.onSubmit(v.trim());
          }}
        />
      )}
    </main>
  );
}

/** 병합 전 실행할 검증 명령 설정 (package.json 스크립트 자동 추천) */
function VerifySettingsModal({
  project,
  onClose,
  showToast,
}: {
  project: Project;
  onClose: () => void;
  showToast: (m: string) => void;
}) {
  const [commands, setCommands] = useState<string[]>([]);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [input, setInput] = useState("");

  useEffect(() => {
    api
      .getVerifyConfig(project.id)
      .then((c) => {
        setCommands(c.commands);
        setSuggestions(c.suggestions);
      })
      .catch(() => {});
  }, [project.id]);

  async function save(next: string[]) {
    setCommands(next);
    try {
      await api.setVerifyConfig(project.id, next);
    } catch (e) {
      showToast(`저장 실패: ${(e as Error).message}`);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="w-[30rem] max-w-[90vw] rounded-xl border border-zinc-700 bg-zinc-900 p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-sm font-semibold text-zinc-200">병합 전 검증 명령</h2>
        <p className="mt-1 text-xs text-zinc-500">
          병합 직전에 에이전트의 워크트리에서 실행됩니다. 하나라도 실패하면 병합이 차단돼요.
        </p>

        <ul className="mt-3 space-y-1">
          {commands.map((c) => (
            <li key={c} className="flex items-center gap-2 rounded-md border border-zinc-800 bg-zinc-950 px-3 py-1.5">
              <code className="flex-1 text-xs text-zinc-300">{c}</code>
              <button
                onClick={() => save(commands.filter((x) => x !== c))}
                className="text-xs text-zinc-600 hover:text-red-400"
              >
                제거
              </button>
            </li>
          ))}
          {commands.length === 0 && (
            <li className="rounded-md border border-dashed border-zinc-800 px-3 py-3 text-center text-xs text-zinc-600">
              설정된 명령이 없습니다 (충돌 검사만 수행)
            </li>
          )}
        </ul>

        {suggestions.filter((s) => !commands.includes(s)).length > 0 && (
          <div className="mt-3">
            <p className="text-[11px] text-zinc-500">이 프로젝트에서 발견한 명령</p>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {suggestions
                .filter((s) => !commands.includes(s))
                .map((s) => (
                  <button
                    key={s}
                    onClick={() => save([...commands, s])}
                    className="rounded-md border border-sky-800 bg-sky-950/40 px-2 py-1 text-[11px] text-sky-300 hover:bg-sky-900/50"
                  >
                    + {s}
                  </button>
                ))}
            </div>
          </div>
        )}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (input.trim()) {
              save([...commands, input.trim()]);
              setInput("");
            }
          }}
          className="mt-3 flex gap-2"
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="직접 입력 (예: npm test)"
            className="flex-1 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-xs outline-none placeholder:text-zinc-600 focus:border-emerald-500"
          />
          <button className="rounded-lg bg-zinc-700 px-3 py-1.5 text-xs text-zinc-100 hover:bg-zinc-600">추가</button>
        </form>

        <div className="mt-4 flex justify-end">
          <button onClick={onClose} className="rounded-lg bg-emerald-500 px-4 py-1.5 text-sm font-semibold text-zinc-950 hover:bg-emerald-400">
            완료
          </button>
        </div>
      </div>
    </div>
  );
}

/** prompt() 대체 — 임베디드 브라우저에서도 동작하는 자체 입력 모달 */
function TextInputModal({
  title,
  placeholder,
  initial,
  onSubmit,
  onCancel,
}: {
  title: string;
  placeholder: string;
  initial: string;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onCancel}>
      <div
        className="w-96 max-w-[90vw] rounded-xl border border-zinc-700 bg-zinc-900 p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-3 text-sm font-semibold text-zinc-200">{title}</h2>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit(value);
          }}
        >
          <input
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={placeholder}
            className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm outline-none placeholder:text-zinc-600 focus:border-emerald-500"
          />
          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              onClick={onCancel}
              className="rounded-lg px-3 py-1.5 text-sm text-zinc-400 transition hover:text-zinc-200"
            >
              취소
            </button>
            <button
              type="submit"
              className="rounded-lg bg-emerald-500 px-4 py-1.5 text-sm font-semibold text-zinc-950 transition hover:bg-emerald-400"
            >
              확인
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function DiffTab({ project, showToast }: { project: Project; showToast: (m: string) => void }) {
  const [slotId, setSlotId] = useState(project.slots[0]?.id ?? "");
  const [diff, setDiff] = useState<DiffResult | null>(null);
  const [handoffs, setHandoffs] = useState<HandoffRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [merging, setMerging] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState<VerifyResult | null>(null);
  const [showVerifySettings, setShowVerifySettings] = useState(false);
  const [comments, setComments] = useState<ReviewComment[]>([]);
  const [sendingReview, setSendingReview] = useState(false);

  const load = useCallback(() => {
    if (!slotId) return;
    setLoading(true);
    api
      .getDiff(project.id, slotId)
      .then(setDiff)
      .catch((e) => showToast(`diff 로드 실패: ${e.message}`))
      .finally(() => setLoading(false));
    api.listHandoffs(project.id).then(setHandoffs).catch(() => {});
  }, [project.id, slotId, showToast]);

  useEffect(load, [load]);

  const slot = project.slots.find((s) => s.id === slotId);

  async function onSendReview() {
    if (!slot || comments.length === 0) return;
    setSendingReview(true);
    try {
      const res = await api.sendReview(project.id, slotId, comments);
      showToast(
        res.injected
          ? `💬 리뷰 ${res.count}건을 ${slot.label}에게 전달했습니다 — 터미널에서 수정 작업을 확인하세요.`
          : `REVIEW.md는 생성됐지만 세션 전달에 실패했습니다. 터미널에서 직접 확인해 주세요.`,
      );
      setComments([]);
    } catch (e) {
      showToast(`리뷰 전송 실패: ${(e as Error).message}`);
    } finally {
      setSendingReview(false);
    }
  }

  async function onVerify() {
    if (!slot) return;
    setVerifying(true);
    setVerifyResult(null);
    showToast(`${slot.label} 검증 중… (충돌 예측 + 프로젝트 검증 명령 실행)`);
    try {
      const res = await api.verify(project.id, slotId);
      setVerifyResult(res);
      showToast(res.ok ? "✅ 검증 통과 — 병합해도 안전합니다." : "⚠️ 검증 실패 — 결과를 확인하세요.");
    } catch (e) {
      showToast(`검증 실패: ${(e as Error).message}`);
    } finally {
      setVerifying(false);
    }
  }

  async function onMerge() {
    if (!slot) return;
    if (!confirm(`${slot.label}의 브랜치를 ${project.baseBranch}에 병합할까요?\n(병합 전 검증이 자동 실행됩니다)`)) return;
    setMerging(true);
    try {
      const res = await api.merge(project.id, slotId);
      showToast(res.message);
      if (res.verify) setVerifyResult(res.verify);
      if (res.ok) setVerifyResult(null);
      load();
    } catch (e) {
      showToast(`병합 실패: ${(e as Error).message}`);
    } finally {
      setMerging(false);
    }
  }

  async function onForceMerge() {
    if (!slot) return;
    if (!confirm(`검증을 건너뛰고 강제로 병합할까요?\n충돌이나 깨진 코드가 ${project.baseBranch}에 들어갈 수 있습니다.`)) return;
    setMerging(true);
    try {
      const res = await api.merge(project.id, slotId, true);
      showToast(res.message);
      load();
    } catch (e) {
      showToast(`병합 실패: ${(e as Error).message}`);
    } finally {
      setMerging(false);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-5">
      <div className="flex items-center gap-2">
        {project.slots.map((s) => (
          <button
            key={s.id}
            onClick={() => {
              setSlotId(s.id);
              setComments([]);
              setVerifyResult(null);
            }}
            className={`rounded-md border px-3 py-1.5 text-sm transition ${
              slotId === s.id
                ? `bg-zinc-800 ${cliAccent(s.cli)}`
                : "border-zinc-800 text-zinc-500 hover:text-zinc-300"
            }`}
          >
            {s.label}
          </button>
        ))}
        <button onClick={load} className="text-xs text-zinc-500 hover:text-zinc-300">
          새로고침
        </button>
        <button
          onClick={() => setShowVerifySettings(true)}
          className="text-xs text-zinc-500 hover:text-zinc-300"
          title="병합 전 실행할 검증 명령 설정"
        >
          검증 설정
        </button>
        <button
          onClick={onVerify}
          disabled={verifying || !slot}
          className="ml-auto rounded-md border border-sky-700 bg-sky-950/40 px-3 py-1.5 text-sm text-sky-300 transition hover:bg-sky-900/50 disabled:opacity-50"
        >
          {verifying ? "검증 중…" : "🔎 병합 전 검증"}
        </button>
        <button
          onClick={onMerge}
          disabled={merging || !slot}
          className="rounded-md bg-emerald-500 px-4 py-1.5 text-sm font-semibold text-zinc-950 transition hover:bg-emerald-400 disabled:opacity-50"
        >
          {merging ? "병합 중…" : `${project.baseBranch}에 병합`}
        </button>
      </div>

      {verifyResult && (
        <div>
          <VerifyPanel result={verifyResult} />
          {!verifyResult.ok && (
            <button
              onClick={onForceMerge}
              className="mt-2 text-[11px] text-zinc-600 underline hover:text-red-400"
            >
              위험을 감수하고 강제 병합
            </button>
          )}
        </div>
      )}

      {showVerifySettings && (
        <VerifySettingsModal
          project={project}
          onClose={() => setShowVerifySettings(false)}
          showToast={showToast}
        />
      )}

      {loading ? (
        <p className="text-sm text-zinc-500">diff 불러오는 중…</p>
      ) : diff ? (
        <>
          <p className="text-xs text-zinc-500">
            {diff.branch} · base 대비 커밋 {diff.aheadCount}개
            {diff.untracked.length > 0 && ` · 추적되지 않은 파일 ${diff.untracked.length}개`}
          </p>
          {diff.untracked.length > 0 && (
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3 text-xs text-zinc-400">
              <p className="mb-1 font-semibold text-zinc-300">추적되지 않은 새 파일</p>
              {diff.untracked.map((f) => (
                <div key={f} className="font-mono text-emerald-400">
                  + {f}
                </div>
              ))}
            </div>
          )}
          <div className="flex items-center gap-2">
            <p className="text-xs text-zinc-500">
              💬 코드 줄에 마우스를 올리면 리뷰 코멘트를 남길 수 있습니다
            </p>
            {comments.length > 0 && (
              <>
                <span className="rounded-full border border-sky-800 bg-sky-950/50 px-2 py-0.5 text-[11px] text-sky-300">
                  코멘트 {comments.length}건
                </span>
                <button
                  onClick={() => setComments([])}
                  className="text-[11px] text-zinc-600 hover:text-zinc-300"
                >
                  전체 삭제
                </button>
                <button
                  onClick={onSendReview}
                  disabled={sendingReview}
                  className="ml-auto rounded-md bg-sky-600 px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-sky-500 disabled:opacity-50"
                >
                  {sendingReview ? "전달 중…" : `💬 ${slot?.label}에게 수정 요청`}
                </button>
              </>
            )}
          </div>
          <ReviewableDiff
            text={diff.diff}
            comments={comments}
            onAdd={(c) => setComments((prev) => [...prev, c])}
            onRemove={(i) => setComments((prev) => prev.filter((_, idx) => idx !== i))}
          />
        </>
      ) : null}

      {handoffs.length > 0 && (
        <div className="mt-4">
          <h3 className="mb-2 text-sm font-semibold text-zinc-300">핸드오프 기록</h3>
          <ul className="space-y-2">
            {[...handoffs].reverse().map((h) => (
              <li key={h.id} className="rounded-lg border border-zinc-800 bg-zinc-900/40 px-4 py-2.5 text-xs">
                <span className="text-zinc-300">
                  {h.fromLabel} → {h.toLabel}
                </span>
                <span className="ml-2 text-zinc-600">{new Date(h.createdAt).toLocaleString("ko-KR")}</span>
                {h.copiedDocs.length > 0 && (
                  <span className="ml-2 text-zinc-500">문서 {h.copiedDocs.length}개 전달</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

