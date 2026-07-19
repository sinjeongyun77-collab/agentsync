import Link from "next/link";

export const metadata = {
  title: "AgentSync — AI가 짠 코드, 검증 없이는 병합되지 않습니다",
  description:
    "Claude Code, Codex, Gemini, Qwen, Kimi를 한 화면에서. 충돌 사전 감지 + 빌드 검증을 통과해야만 병합. 컨텍스트 오염 방지. AI 비용 추가 0원(BYOK).",
};

const PILLARS = [
  {
    title: "검증을 통과해야 병합됩니다",
    emoji: "🛡️",
    highlight: true,
    desc: "병합 직전에 두 가지를 자동으로 검사합니다. ① git merge-tree로 실제 병합 없이 충돌을 예측하고, ② 프로젝트의 타입체크·테스트·빌드를 해당 에이전트의 작업 공간에서 실행합니다. 하나라도 실패하면 병합이 차단됩니다.",
  },
  {
    title: "컨텍스트가 섞이지 않습니다",
    emoji: "🧠",
    highlight: true,
    desc: "한 세션에 작업을 계속 던지면 이전 작업의 맥락이 새 작업을 오염시킵니다. AgentSync는 세션별 작업 누적을 추적해 경고하고, 새 작업은 깨끗한 컨텍스트에서 시작할지 물어봅니다. 대결(아레나)은 양쪽 모두 새 세션에서 공정하게 시작합니다.",
  },
  {
    title: "충돌 없는 병렬 작업",
    emoji: "🌿",
    desc: "에이전트마다 독립된 git worktree와 브랜치가 자동으로 생깁니다. 여러 AI가 같은 파일을 덮어쓸 일이 없습니다.",
  },
  {
    title: "리뷰 → 수정 루프",
    emoji: "💬",
    desc: "diff의 코드 줄에 코멘트를 남기고 '수정 요청'을 누르면, 지적사항이 그 에이전트 세션으로 전달돼 바로 고칩니다.",
  },
  {
    title: "같은 작업, 두 AI 대결",
    emoji: "🥊",
    desc: "중요한 작업은 Claude와 Codex에게 동시에 시키고, 결과를 나란히 비교해 더 나은 쪽만 채택하세요.",
  },
  {
    title: "버튼 하나로 인수인계",
    emoji: "🤝",
    desc: "A가 하던 작업을 B에게 넘길 때, 세션을 AI가 요약해 문서로 전달하고 B가 바로 이어서 작업합니다.",
  },
];

const COMBOS = [
  { combo: "Gemini + Qwen", cost: "0원", desc: "무료 한도로 시작" },
  { combo: "Claude × Claude", cost: "Claude 구독", desc: "구독 하나로 2세션 병렬" },
  { combo: "Claude + Codex", cost: "각자 구독", desc: "설계×구현 풀 세팅" },
  { combo: "Kimi K3 · 커스텀", cost: "자유", desc: "opencode, aider 등 뭐든" },
];

export default function Landing() {
  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      {/* Hero */}
      <section className="mx-auto max-w-4xl px-6 pb-20 pt-24 text-center">
        <p className="mb-4 inline-block rounded-full border border-emerald-800 bg-emerald-950/50 px-3 py-1 text-xs text-emerald-300">
          로컬에서 무료로 시작 · AI 비용 추가 0원 (BYOK)
        </p>
        <h1 className="text-4xl font-bold leading-tight tracking-tight sm:text-5xl">
          AI가 짠 코드,
          <br />
          <span className="text-emerald-400">검증 없이는</span> 병합되지 않습니다
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg text-zinc-400">
          Claude Code, Codex, Gemini, Qwen, Kimi — 최대 6개의 에이전트를 한 화면에서 지휘하세요.
          작업 공간은 격리되고, 컨텍스트는 섞이지 않고, 병합은 검증을 통과해야 승인됩니다.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <a
            href="https://github.com/sinjeongyun77-collab/agentsync"
            className="rounded-lg bg-emerald-500 px-6 py-3 text-sm font-semibold text-zinc-950 transition hover:bg-emerald-400"
          >
            무료로 시작하기 (GitHub)
          </a>
          <Link
            href="/"
            className="rounded-lg border border-zinc-700 px-6 py-3 text-sm text-zinc-300 transition hover:border-zinc-500"
          >
            라이브 데모 열기
          </Link>
        </div>
      </section>

      {/* Pain */}
      <section className="border-y border-zinc-900 bg-zinc-900/30 py-16">
        <div className="mx-auto max-w-4xl px-6">
          <h2 className="text-center text-2xl font-bold">이런 경험, 있으시죠?</h2>
          <div className="mt-8 grid gap-4 sm:grid-cols-3">
            {[
              "AI가 짠 코드를 그냥 병합했다가 빌드가 깨짐",
              "이전 작업 얘기가 섞여서 엉뚱한 걸 고쳐놓음",
              "AI 두 개를 같은 폴더에서 돌렸다가 파일이 서로 덮어써짐",
            ].map((t) => (
              <div key={t} className="rounded-xl border border-zinc-800 bg-zinc-950 p-5 text-sm text-zinc-400">
                &ldquo;{t}&rdquo;
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="mx-auto max-w-4xl px-6 py-20">
        <h2 className="text-center text-2xl font-bold">AgentSync가 해결합니다</h2>
        <p className="mt-2 text-center text-sm text-zinc-500">
          앞의 두 가지가 다른 도구에는 없는 AgentSync의 핵심입니다
        </p>
        <div className="mt-10 grid gap-6 sm:grid-cols-2">
          {PILLARS.map((f) => (
            <div
              key={f.title}
              className={`rounded-2xl border p-6 ${
                f.highlight
                  ? "border-emerald-800 bg-emerald-950/20 sm:col-span-1"
                  : "border-zinc-800 bg-zinc-900/40"
              }`}
            >
              <div className="text-3xl">{f.emoji}</div>
              <h3 className={`mt-3 font-semibold ${f.highlight ? "text-emerald-300" : ""}`}>{f.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-zinc-400">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* BYOK */}
      <section className="border-y border-zinc-900 bg-zinc-900/30 py-16">
        <div className="mx-auto max-w-4xl px-6">
          <h2 className="text-center text-2xl font-bold">
            AI 비용은 <span className="text-emerald-400">추가 0원</span>
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-center text-sm text-zinc-400">
            AgentSync는 AI를 팔지 않습니다. 이미 갖고 있는 계정(BYOK)을 연결해 쓰세요. 조합은
            자유입니다.
          </p>
          <div className="mt-8 overflow-x-auto">
            <table className="mx-auto w-full max-w-2xl text-sm">
              <thead>
                <tr className="border-b border-zinc-800 text-left text-zinc-500">
                  <th className="px-4 py-2">조합</th>
                  <th className="px-4 py-2">월 AI 비용</th>
                  <th className="px-4 py-2">추천 상황</th>
                </tr>
              </thead>
              <tbody>
                {COMBOS.map((c) => (
                  <tr key={c.combo} className="border-b border-zinc-900">
                    <td className="px-4 py-3 font-medium">{c.combo}</td>
                    <td className="px-4 py-3 text-emerald-400">{c.cost}</td>
                    <td className="px-4 py-3 text-zinc-400">{c.desc}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section className="mx-auto max-w-4xl px-6 py-20">
        <h2 className="text-center text-2xl font-bold">가격</h2>
        <div className="mt-10 grid gap-6 sm:grid-cols-2">
          <div className="rounded-2xl border border-emerald-800 bg-emerald-950/20 p-6">
            <h3 className="font-semibold">로컬판</h3>
            <p className="mt-1 text-3xl font-bold">
              무료 <span className="text-sm font-normal text-zinc-400">/ 영원히</span>
            </p>
            <ul className="mt-4 space-y-2 text-sm text-zinc-300">
              <li>✓ 모든 기능 (에이전트 6개, 칸반, 검증 병합, 리뷰 루프)</li>
              <li>✓ 내 컴퓨터에서 실행 — 데이터가 밖으로 안 나감</li>
              <li>✓ 오픈 코어</li>
            </ul>
          </div>
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-6">
            <h3 className="font-semibold">
              클라우드 <span className="ml-1 rounded bg-zinc-800 px-2 py-0.5 text-xs text-zinc-400">준비 중</span>
            </h3>
            <p className="mt-1 text-3xl font-bold">
              ₩9,900~ <span className="text-sm font-normal text-zinc-400">/ 월</span>
            </p>
            <ul className="mt-4 space-y-2 text-sm text-zinc-300">
              <li>✓ 설치 없이 브라우저에서 바로</li>
              <li>✓ 노트북을 꺼도 에이전트는 계속 작업</li>
              <li>✓ 멀티 프로젝트 · 모바일 확인</li>
            </ul>
            <p className="mt-4 text-xs text-zinc-500">출시 알림을 받고 싶다면 GitHub를 Watch 해주세요.</p>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="border-t border-zinc-900 bg-zinc-900/30 py-16">
        <div className="mx-auto max-w-3xl px-6">
          <h2 className="text-center text-2xl font-bold">자주 묻는 질문</h2>
          <div className="mt-8 space-y-6 text-sm">
            {[
              {
                q: "Claude랑 ChatGPT 둘 다 구독해야 하나요?",
                a: "아니요. 슬롯 조합이 자유라서 Claude 하나로 2세션을 돌리거나, Gemini+Qwen 무료 조합으로 시작할 수 있습니다. 둘 다 구독은 선택입니다.",
              },
              {
                q: "제 코드가 AgentSync 서버로 전송되나요?",
                a: "로컬판은 전부 내 컴퓨터 안에서 돌아갑니다. 코드는 각 AI 제공사(내가 연결한 계정)로만 전송되며, AgentSync가 중간에서 수집하지 않습니다.",
              },
              {
                q: "무료 CLI(Gemini/Qwen)는 어떻게 쓰나요?",
                a: "CLI 설치 후 슬롯에서 선택하고, 첫 실행 때 해당 계정으로 로그인만 하면 됩니다. 무료 한도는 각 제공사 정책을 따릅니다.",
              },
              {
                q: "에이전트가 작업을 망치면요?",
                a: "각 에이전트는 격리된 브랜치에서만 작업합니다. 병합 전 충돌 예측과 빌드·테스트 검증을 통과해야 하고, diff를 보고 승인한 것만 메인에 들어갑니다. 문제가 보이면 코드 줄에 코멘트를 달아 바로 수정을 요청할 수 있습니다.",
              },
              {
                q: "설치가 어렵지 않나요?",
                a: "앱 안에서 '에이전트 설치' 버튼을 누르면 원하는 CLI가 자동으로 설치됩니다. 그다음 터미널에서 계정 로그인 한 번이면 끝입니다.",
              },
            ].map((f) => (
              <div key={f.q}>
                <h3 className="font-semibold text-zinc-200">{f.q}</h3>
                <p className="mt-1 leading-relaxed text-zinc-400">{f.a}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <footer className="border-t border-zinc-900 py-10 text-center text-xs text-zinc-600">
        AgentSync — 본인 구독 기반(BYOK) AI 에이전트 협업 도구. Anthropic·OpenAI·Google과 무관한
        독립 프로젝트입니다.
      </footer>
    </main>
  );
}
