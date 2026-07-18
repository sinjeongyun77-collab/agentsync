"use client";

export default function DiffView({ text }: { text: string }) {
  if (!text.trim())
    return (
      <p className="rounded-lg border border-dashed border-zinc-800 p-6 text-center text-sm text-zinc-500">
        base 브랜치 대비 변경 사항이 없습니다.
      </p>
    );
  return (
    <pre className="overflow-x-auto rounded-lg border border-zinc-800 bg-[#101014] p-4 font-mono text-xs leading-relaxed">
      {text.split("\n").map((line, i) => {
        let cls = "text-zinc-400";
        if (line.startsWith("+") && !line.startsWith("+++")) cls = "text-emerald-400";
        else if (line.startsWith("-") && !line.startsWith("---")) cls = "text-red-400";
        else if (line.startsWith("@@")) cls = "text-sky-400";
        else if (line.startsWith("diff --git")) cls = "font-semibold text-zinc-200";
        return (
          <div key={i} className={cls}>
            {line || " "}
          </div>
        );
      })}
    </pre>
  );
}
