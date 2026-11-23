import { fileURLToPath } from 'node:url';
import path from 'node:path';

export type SplitterProviderName = 'opencode' | 'anthropic' | 'openrouter' | 'fixture';

export interface Env {
  mode: 'demo' | 'live';
  port: number;
  t3Url: string;
  t3Token: string;
  splitterProvider: SplitterProviderName;
  splitterModel: string;
  anthropicKey: string;
  anthropicModel: string;
  openrouterKey: string;
  openrouterModel: string;
  telegramToken: string;
  telegramChatId: string;
  whisperModel: string;
  /** apps/server */
  serverRoot: string;
  /** repo root (pinpoint/) */
  repoRoot: string;
  /** apps/server/.data (or PINPOINT_DATA_DIR) */
  dataDir: string;
  /** demo/fixtures */
  fixturesDir: string;
}

const SERVER_ROOT = fileURLToPath(new URL('../../', import.meta.url)).replace(/\/+$/, '');
const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url)).replace(/\/+$/, '');

function str(source: NodeJS.ProcessEnv, key: string, fallback = ''): string {
  const raw = source[key];
  if (raw === undefined) return fallback;
  // Accept the inline comments used in .env.example, e.g. "demo # demo | live".
  const value = raw.replace(/\s+#.*$/, '').trim();
  return value === '' ? fallback : value;
}

function provider(source: NodeJS.ProcessEnv, mode: 'demo' | 'live'): SplitterProviderName {
  const raw = str(source, 'SPLITTER_PROVIDER').toLowerCase();
  if (raw === 'opencode' || raw === 'anthropic' || raw === 'openrouter' || raw === 'fixture') {
    return raw;
  }
  // Demo must run offline without opencode installed, so fixtures are the safe default there.
  return mode === 'demo' ? 'fixture' : 'opencode';
}

export function readEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const mode = str(source, 'PINPOINT_MODE').toLowerCase() === 'live' ? 'live' : 'demo';
  const port = Number.parseInt(str(source, 'PINPOINT_PORT', '8787'), 10);
  const dataDir = path.resolve(str(source, 'PINPOINT_DATA_DIR', path.join(SERVER_ROOT, '.data')));
  return {
    mode,
    port: Number.isFinite(port) && port > 0 && port < 65536 ? port : 8787,
    t3Url: str(source, 'T3_URL', 'http://127.0.0.1:3773').replace(/\/+$/, ''),
    t3Token: str(source, 'T3_TOKEN'),
    splitterProvider: provider(source, mode),
    splitterModel: str(source, 'SPLITTER_MODEL', 'opencode-go/deepseek-v4.1-flash'),
    anthropicKey: str(source, 'ANTHROPIC_API_KEY'),
    anthropicModel: str(source, 'ANTHROPIC_MODEL', 'claude-sonnet-4-5'),
    openrouterKey: str(source, 'OPENROUTER_API_KEY'),
    openrouterModel: str(source, 'OPENROUTER_MODEL', 'anthropic/claude-sonnet-4.5'),
    telegramToken: str(source, 'TELEGRAM_BOT_TOKEN'),
    telegramChatId: str(source, 'TELEGRAM_CHAT_ID'),
    whisperModel: str(source, 'WHISPER_MODEL'),
    serverRoot: SERVER_ROOT,
    repoRoot: REPO_ROOT,
    dataDir,
    fixturesDir: path.join(REPO_ROOT, 'demo', 'fixtures'),
  };
}
