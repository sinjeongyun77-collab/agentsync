import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const run = promisify(execFile);

export interface CliInfo {
  id: string;
  label: string;
  command: string;
  /** 설치 방식 — npm 전역 설치 또는 공식 설치 스크립트 */
  install: { kind: 'npm'; pkg: string } | { kind: 'script'; powershell: string };
  /** 로그인 방법 안내 (비개발자용) */
  auth: string;
  cost: string;
  installed: boolean;
  version?: string;
}

const CATALOG: Omit<CliInfo, 'installed' | 'version'>[] = [
  {
    id: 'claude',
    label: 'Claude Code',
    command: 'claude',
    install: { kind: 'npm', pkg: '@anthropic-ai/claude-code' },
    auth: '터미널에서 안내에 따라 Claude 계정으로 로그인',
    cost: 'Claude 구독 또는 API 키',
  },
  {
    id: 'codex',
    label: 'Codex',
    command: 'codex',
    install: { kind: 'npm', pkg: '@openai/codex' },
    auth: '터미널에서 ChatGPT 계정으로 로그인',
    cost: 'ChatGPT 구독 (무료 계정도 소량 한도)',
  },
  {
    id: 'gemini',
    label: 'Gemini CLI',
    command: 'gemini',
    install: { kind: 'npm', pkg: '@google/gemini-cli' },
    auth: '터미널에서 구글 계정으로 로그인',
    cost: '무료 한도 (구글 계정)',
  },
  {
    id: 'qwen',
    label: 'Qwen Code',
    command: 'qwen',
    install: { kind: 'npm', pkg: '@qwen-code/qwen-code' },
    auth: '터미널에서 Qwen 계정으로 로그인',
    cost: '무료 한도 (Qwen 계정)',
  },
  {
    id: 'kimi',
    label: 'Kimi Code (K3)',
    command: 'kimi',
    install: {
      kind: 'script',
      powershell: 'irm https://code.kimi.com/kimi-code/install.ps1 | iex',
    },
    auth: '터미널에서 /login 입력 후 Kimi 계정 로그인',
    cost: 'Kimi 멤버십 또는 API 키',
  },
];

/** CLI가 서버 기동 후 설치됐을 수 있으므로 알려진 설치 경로를 보강한 PATH */
export function augmentedPath(): string {
  const base = process.env.Path ?? process.env.PATH ?? '';
  const extra = [path.join(os.homedir(), '.kimi-code', 'bin'), path.join(os.homedir(), 'AppData', 'Roaming', 'npm')];
  const missing = extra.filter((p) => fs.existsSync(p) && !base.includes(p));
  return missing.length ? `${base};${missing.join(';')}` : base;
}

function envWithPath(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  const key = env.Path !== undefined ? 'Path' : 'PATH';
  env[key] = augmentedPath();
  return env;
}

async function detect(command: string): Promise<{ installed: boolean; version?: string }> {
  try {
    const { stdout } = await run('cmd.exe', ['/c', `${command} --version`], {
      env: envWithPath(),
      windowsHide: true,
      timeout: 20_000,
    });
    const version = stdout.trim().split('\n')[0]?.trim().slice(0, 40);
    return { installed: true, version };
  } catch {
    return { installed: false };
  }
}

export async function listClis(): Promise<CliInfo[]> {
  return Promise.all(
    CATALOG.map(async (c) => ({ ...c, ...(await detect(c.command)) })),
  );
}

export function getCliDef(id: string) {
  return CATALOG.find((c) => c.id === id);
}

export interface InstallEvents {
  onOutput: (chunk: string) => void;
  onDone: (ok: boolean) => void;
}

/** CLI 설치를 실행하고 출력을 스트리밍 (설치는 사용자가 UI에서 명시적으로 누를 때만) */
export function installCli(id: string, events: InstallEvents): { cancel: () => void } | null {
  const def = getCliDef(id);
  if (!def) return null;

  const args =
    def.install.kind === 'npm'
      ? ['/c', 'npm', 'install', '-g', '--no-fund', '--no-audit', def.install.pkg]
      : ['/c', 'powershell', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', def.install.powershell];

  events.onOutput(
    def.install.kind === 'npm'
      ? `> npm install -g ${def.install.pkg}\r\n`
      : `> ${def.install.powershell}\r\n`,
  );

  const proc = spawn('cmd.exe', args, { env: envWithPath(), windowsHide: true });
  proc.stdout.on('data', (d: Buffer) => events.onOutput(d.toString()));
  proc.stderr.on('data', (d: Buffer) => events.onOutput(d.toString()));
  proc.on('error', (e) => {
    events.onOutput(`\r\n설치 실행 실패: ${e.message}\r\n`);
    events.onDone(false);
  });
  proc.on('close', (code) => {
    events.onOutput(`\r\n${code === 0 ? '설치 완료' : `설치 실패 (코드 ${code})`}\r\n`);
    events.onDone(code === 0);
  });

  return { cancel: () => proc.kill() };
}
