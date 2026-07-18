/** CLI별 포인트 컬러 (칩 테두리 + 텍스트) */
export function cliAccent(cli: string): string {
  switch (cli) {
    case "claude":
      return "border-violet-800 text-violet-300";
    case "codex":
      return "border-sky-800 text-sky-300";
    case "gemini":
      return "border-amber-800 text-amber-300";
    case "qwen":
      return "border-rose-800 text-rose-300";
    default:
      return "border-zinc-700 text-zinc-300";
  }
}
