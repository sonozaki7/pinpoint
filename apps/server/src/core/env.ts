import { fileURLToPath } from 'node:url';
import path from 'node:path';

export type SplitterProviderName = 'opencode' | 'anthropic' | 'openrouter' | 'fixture';

export interface Env {
  mode: 'demo' | 'live';
  port: number;
  t3Url: string;
  t3Token: string;
  /**
   * Privacy allowlist: T3 project ids or exact titles Pinpoint may read.
   * Live mode refuses to start when this is empty (see assertLivePrivacy).
   */
  t3Projects: string[];
  /**
   * Live-mode browser origins allowed to call the API (comma-separated).
   * Demo mode always allows every origin; live mode never uses "*".
   */
  allowedOrigins: string[];
  splitterProvider: SplitterProviderName;
  splitterModel: string;
  anthropicKey: string;
  anthropicModel: string;
  openrouterKey: string;
  openrouterModel: string;
  telegramToken: string;
  telegramChatId: string;
  whisperModel: string;
  /**
   * Demo recording helper: a JSON file of canned voice notes. When set, /api/voice
   * skips T3/whisper and returns the next note with a realistic delay.
   */
  scriptedTranscripts: string;
  /** apps/server */
  serverRoot: string;
  /** repo root (pinpoint/) */
  repoRoot: string;
  /** optional deck pin for a live recording (see loadDeckFixture) */
  deckFixture: string;
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

function list(source: NodeJS.ProcessEnv, key: string): string[] {
  return str(source, key)
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
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
    t3Projects: list(source, 'T3_PROJECTS'),
    allowedOrigins: list(source, 'PINPOINT_ALLOWED_ORIGINS'),
    splitterProvider: provider(source, mode),
    splitterModel: str(source, 'SPLITTER_MODEL', 'opencode-go/deepseek-v4.1-flash'),
    anthropicKey: str(source, 'ANTHROPIC_API_KEY'),
    anthropicModel: str(source, 'ANTHROPIC_MODEL', 'claude-sonnet-4-5'),
    openrouterKey: str(source, 'OPENROUTER_API_KEY'),
    openrouterModel: str(source, 'OPENROUTER_MODEL', 'anthropic/claude-sonnet-4.5'),
    telegramToken: str(source, 'TELEGRAM_BOT_TOKEN'),
    telegramChatId: str(source, 'TELEGRAM_CHAT_ID'),
    whisperModel: str(source, 'WHISPER_MODEL'),
    scriptedTranscripts: str(source, 'PINPOINT_SCRIPTED_TRANSCRIPTS'),
    serverRoot: SERVER_ROOT,
    repoRoot: REPO_ROOT,
    deckFixture: str(source, 'PINPOINT_DECK_FIXTURE'),
    dataDir,
    fixturesDir: path.join(REPO_ROOT, 'demo', 'fixtures'),
  };
}

/**
 * Privacy gate for live mode (SPEC §6 / live-run hardening).
 *
 * The owner's T3 Code holds private business threads. Pinpoint may only read
 * the projects named in T3_PROJECTS, so a live server started without that
 * allowlist must fail instead of listing everything.
 */
export function assertLivePrivacy(env: Env): void {
  if (env.mode !== 'live' || env.t3Projects.length > 0) return;
  throw new Error(
    'Refusing to start in live mode: T3_PROJECTS is empty. ' +
      'Set T3_PROJECTS to a comma-separated list of T3 project ids or exact project titles ' +
      '(for example T3_PROJECTS=pinpoint) so Pinpoint only reads the projects you allow.',
  );
}
