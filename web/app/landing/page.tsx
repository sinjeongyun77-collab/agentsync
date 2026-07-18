import Link from "next/link";

export const metadata = {
  title: "AgentSync — AI 코딩 에이전트 팀을 지휘하세요",
  description:
    "Claude Code, Codex, Gemini, Qwen을 한 화면에서. 워크트리 격리 + 칸반 디스패치 + 자동 핸드오프. AI 비용 0원 추가(BYOK).",
};

const FEATURES = [
  {
    title: "충돌 없는 병렬 작업",
    emoji: "🌿",
    desc: "에이전트마다 독립된 git worktree와 브랜치가 자동으로 생깁니다. 두 AI가 같은 파일을 덮어쓸 일이 없습니다.",
  },
  {
    title: "칸반으로 작업 지시",
    emoji: "📋",
    desc: "작업 카드를 만들어 에이전트 컬럼에 드래그하면 그 세션에 지시가 자동 주입됩니다. 누가 뭘 하는지 한눈에.",
  },
  {
    title: "버튼 하나로 인수인계",
    emoji: "🤝",
    desc: "A가 하던 작업을 B에게 넘길 때, 세션을 AI가 요약해 HANDOFF.md로 전달하고 B가 바로 이어서 작업합니다.",
  },
  {
    title: "검수 후 병합",
    emoji: "✅",
    desc: "에이전트별 변경사항을 diff로 확인하고, 마음에 들 때만 메인 브랜치에 병합합니다. 원본은 항상 안전합니다.",
  },
];

const COMBOS = [
  { combo: "Gemini + Qwen", cost: "0원", desc: "무료 한도로 시작" },
  { combo: "Claude × Claude", cost: "Claude 구독", desc: "구독 하나로 2세션 병렬" },
  { combo: "Claude + Codex", cost: "각자 구독", desc: "설계×구현 풀 세팅" },
  { combo: "커스텀 CLI", cost: "자유", desc: "opencode, aider 등 뭐든" },
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
          AI 코딩 에이전트 <span className="text-emerald-400">팀</span>을
          <br />한 화면에서 지휘하세요
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg text-zinc-400">
          Claude Code, Codex, Gemini, Qwen — 최대 4개의 에이전트에게 각자의 작업 공간을 주고,
          칸반으로 일을 시키고, 버튼 하나로 인수인계하세요.
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
              "AI 두 개를 같은 폴더에서 돌렸다가 파일이 서로 덮어써짐",
              "Claude가 짠 설계를 Codex에 복붙하느라 왔다갔다",
              "터미널 창 여러 개를 오가며 누가 뭘 하는지 놓침",
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
        <div className="mt-10 grid gap-6 sm:grid-cols-2">
          {FEATURES.map((f) => (
            <div key={f.title} className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-6">
              <div className="text-3xl">{f.emoji}</div>
              <h3 className="mt-3 font-semibold">{f.title}</h3>
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
              <li>✓ 모든 기능 (슬롯 4개, 칸반, 핸드오프, 병합)</li>
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
                a: "각 에이전트는 격리된 브랜치에서만 작업합니다. diff를 확인하고 승인한 것만 메인에 병합되므로 원본 코드는 항상 안전합니다.",
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
