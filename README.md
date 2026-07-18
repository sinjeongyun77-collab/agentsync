# AgentSync — AI 코딩 에이전트 협업 플랫폼 (로컬 MVP)

여러 AI 코딩 에이전트(Claude Code, Codex, Gemini, Qwen, …)를 한 브라우저에서 격리된 git worktree로 돌리고, 칸반과 핸드오프로 지휘하는 오케스트레이션 플랫폼입니다. AI 사용량은 각자 본인 계정(BYOK) — 이 도구는 지휘 레이어만 제공합니다.

- **에이전트 슬롯 (최대 4개)**: 슬롯마다 CLI를 자유 선택. 같은 CLI 두 개(Claude×Claude)도, 무료 CLI 조합도 가능
- **워크트리 격리**: 슬롯마다 `agentsync/<슬롯>` 브랜치 + git worktree 자동 생성 — 파일 충돌 없음
- **칸반 디스패치**: 작업 카드를 에이전트 컬럼에 드래그하면 해당 세션에 작업 지시가 자동 주입
- **웹 터미널 그리드**: 브라우저에서 세션들을 나란히 실행 (WebSocket + xterm.js), 새로고침에도 세션 유지
- **핸드오프**: 버튼 한 번으로 에이전트 A의 최근 세션 요약 + 설계 문서를 B의 워크트리(`HANDOFF.md`)로 전달하고 B 세션에 프롬프트 주입
- **역할 자유 설정**: 슬롯별 역할(설계/구현/리뷰/직접 입력)을 지정하면 디스패치·핸드오프 프롬프트에 반영
- **공용 규칙 파일**: `AGENTS.md`를 하드링크로 모든 워크트리에 공유
- **Diff / 병합**: 워크트리별 변경을 웹에서 확인하고 base 브랜치로 병합

## 지원 에이전트 CLI

| 프리셋 | 비용 | 비고 |
|---|---|---|
| Claude Code | Claude 구독/API | |
| Codex | ChatGPT 구독 (무료 계정도 소량 한도) | |
| Gemini CLI | 무료 한도 (Google 계정, 일 1,000회 수준) | |
| Qwen Code | 무료 한도 (Qwen 계정 OAuth, 일 2,000회 수준) | 오픈소스 모델 |
| 커스텀 명령 | CLI마다 다름 | opencode·aider 등 — DeepSeek API(초저가) 연결 가능 |

핸드오프 세션 요약 추출은 현재 Claude/Codex만 지원(다른 CLI는 문서 전달만).

## MCP 공유 컨텍스트

모든 에이전트가 `agentsync` MCP 서버로 공유 상태에 접근할 수 있습니다 — 팀 구성 확인(`agentsync_status`), 칸반 조회/완료 보고(`list_tasks`, `update_task_status`), 핸드오프 기록(`list_handoffs`), 팀 노트(`read_team_notes`, `write_team_note`).

- **Claude Code**: 워크트리마다 자동 생성되는 `.mcp.json`으로 즉시 사용 (첫 실행 때 승인 한 번)
- **Codex**: `codex mcp add agentsync -- node <repo>\server\node_modules\tsx\dist\cli.mjs <repo>\server\src\mcpServer.ts`
- **Gemini CLI**: `gemini mcp add agentsync node <위와 같은 인자>`

MCP 서버는 실행 위치(cwd)로 자신이 어느 프로젝트/슬롯인지 자동 인식하므로 등록은 전역 1회면 됩니다. (메인 서버 4310이 켜져 있어야 함)

## 클라우드판 (설계 단계)

`docs/CLOUD_DESIGN.md` 참고 — 1사용자=1컨테이너, 클라우드는 API 키 연결 기본(약관 리스크 회피), Toss 정기결제. 컨테이너 이미지는 `infra/Dockerfile.agent`.

## 실행

```powershell
# 1) 백엔드 (포트 4310)
cd server; npm run dev

# 2) 프런트엔드 (포트 3000)
cd web; npm run dev
```

브라우저에서 http://localhost:3000 접속 → 로컬 git 저장소 경로 입력 → 프로젝트 연결.

## 요구 사항

- Windows, Node 20+, git 2.40+
- `claude` / `codex` CLI가 설치·로그인되어 있어야 함 (BYOK — 본인 구독 사용)

## 테스트용 환경변수

실제 CLI 대신 다른 명령을 띄우려면:

```powershell
$env:AGENTSYNC_CMD_CLAUDE = "powershell"
$env:AGENTSYNC_CMD_CODEX = "powershell"
```

## 구조

```
server/  Fastify + node-pty + git worktree 서비스 (TypeScript)
web/     Next.js 15 + Tailwind + xterm.js
```

세션 대화 추출 경로: Claude Code `~/.claude/projects/<프로젝트>/`, Codex `~/.codex/sessions/`.
