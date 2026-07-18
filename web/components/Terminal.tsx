"use client";

import { useEffect, useRef } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { WS_BASE } from "@/lib/api";

export default function Terminal({
  projectId,
  slotId,
}: {
  projectId: string;
  slotId: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const term = new XTerm({
      fontFamily: "var(--font-geist-mono), Consolas, monospace",
      fontSize: 13,
      cursorBlink: true,
      theme: {
        background: "#101014",
        foreground: "#e4e4e7",
        cursor: "#a1a1aa",
      },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(el);
    fit.fit();

    const ws = new WebSocket(
      `${WS_BASE}/ws/terminal?projectId=${projectId}&slot=${slotId}&cols=${term.cols}&rows=${term.rows}`,
    );
    ws.binaryType = "arraybuffer";

    ws.onmessage = (ev) => {
      term.write(typeof ev.data === "string" ? ev.data : new Uint8Array(ev.data));
    };
    ws.onclose = () => {
      term.write("\r\n\x1b[33m[AgentSync] 서버 연결이 끊겼습니다. 새로고침해 주세요.\x1b[0m\r\n");
    };

    const sendResize = () => {
      fit.fit();
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(`\x00resize:${term.cols}x${term.rows}`);
      }
    };
    ws.onopen = sendResize;

    const onInput = term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(data);
    });

    const observer = new ResizeObserver(() => sendResize());
    observer.observe(el);

    return () => {
      observer.disconnect();
      onInput.dispose();
      ws.close();
      term.dispose();
    };
  }, [projectId, slotId]);

  return <div ref={containerRef} className="h-full w-full" />;
}
