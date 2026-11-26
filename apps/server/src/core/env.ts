import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export type SplitterProviderName = 'opencode' | 'anthropic' | 'openrouter' | 'fixture';

/** demo: local fixture showcase · live: this Mac's T3 Code · cloud: public sample workspace per device. */
export type PinpointMode = 'demo' | 'live' | 'cloud';

export interface Env {
  mode: PinpointMode;
  /** Cloud: bind address. Default 127.0.0.1 so nginx stays in front. */
  host: string;
  port: number;
  /**
   * Cloud: trust the first X-Forwarded-For hop (set behind nginx).
   * Never trusted unless PINPOINT_TRUST_PROXY=1.
   */
  trustProxy: boolean;
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
  /** whisper-cli threads (WHISPER_THREADS, default 4). */
  whisperThreads: number;
  /**
   * Demo recording helper: a JSON file of canned voice notes. When set, /api/voice
   * skips T3/whisper and returns the next note with a realistic delay.
   * Cloud honours it too, but only when it is explicitly set.
   */
  scriptedTranscripts: string;
  /** Cloud: delay before the sample agent's reply appears (PINPOINT_SAMPLE_REPLY_MS). */
  sampleReplyMs: number;
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
  /** apps/server package.json version, reported by cloud /api/health. */
  serverVersion: string;
}

const SERVER_ROOT = fileURLToPath(new URL('../../', import.meta.url)).replace(/\/+$/, '');
const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url)).replace(/\/+$/, '');

function readServerVersion(): string {
  try {
    const raw = JSON.parse(
      fs.readFileSync(path.join(SERVER_ROOT, 'package.json'), 'utf8'),
    ) as { version?: unknown };
    return typeof raw.version === 'string' && raw.version.length > 0 ? raw.version : '0.0.0';
  } catch {
    return '0.0.0';
  }
}

const SERVER_VERSION = readServerVersion();

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
  const rawMode = str(source, 'PINPOINT_MODE').toLowerCase();
  const mode: PinpointMode =
    rawMode === 'live' ? 'live' : rawMode === 'cloud' ? 'cloud' : 'demo';
  const cloud = mode === 'cloud';

  const port = Number.parseInt(str(source, 'PINPOINT_PORT', '8787'), 10);
  const dataDir = path.resolve(str(source, 'PINPOINT_DATA_DIR', path.join(SERVER_ROOT, '.data')));

  // Cloud deliberately never reads T3_*, TELEGRAM_* or splitter provider env:
  // the public server has no desk and never calls a model.
  const rawSampleReplyMs = Number.parseInt(str(source, 'PINPOINT_SAMPLE_REPLY_MS', '5000'), 10);
  const sampleReplyMs =
    Number.isFinite(rawSampleReplyMs) && rawSampleReplyMs >= 0 ? rawSampleReplyMs : 5_000;
  const rawThreads = Number.parseInt(str(source, 'WHISPER_THREADS', '4'), 10);
  const whisperThreads = Number.isFinite(rawThreads)
    ? Math.min(32, Math.max(1, rawThreads))
    : 4;

  return {
    mode,
    host: str(source, 'PINPOINT_HOST', '127.0.0.1'),
    port: Number.isFinite(port) && port > 0 && port < 65536 ? port : 8787,
    trustProxy: str(source, 'PINPOINT_TRUST_PROXY') === '1',
    t3Url: cloud ? '' : str(source, 'T3_URL', 'http://127.0.0.1:3773').replace(/\/+$/, ''),
    t3Token: cloud ? '' : str(source, 'T3_TOKEN'),
    t3Projects: cloud ? [] : list(source, 'T3_PROJECTS'),
    allowedOrigins: cloud ? [] : list(source, 'PINPOINT_ALLOWED_ORIGINS'),
    splitterProvider: cloud ? 'fixture' : provider(source, mode),
    splitterModel: cloud ? 'fixture' : str(source, 'SPLITTER_MODEL', 'opencode-go/deepseek-v4.1-flash'),
    anthropicKey: cloud ? '' : str(source, 'ANTHROPIC_API_KEY'),
    anthropicModel: cloud ? '' : str(source, 'ANTHROPIC_MODEL', 'claude-sonnet-4-5'),
    openrouterKey: cloud ? '' : str(source, 'OPENROUTER_API_KEY'),
    openrouterModel: cloud ? '' : str(source, 'OPENROUTER_MODEL', 'anthropic/claude-sonnet-4.5'),
    telegramToken: cloud ? '' : str(source, 'TELEGRAM_BOT_TOKEN'),
    telegramChatId: cloud ? '' : str(source, 'TELEGRAM_CHAT_ID'),
    whisperModel: str(source, 'WHISPER_MODEL'),
    whisperThreads,
    scriptedTranscripts: str(source, 'PINPOINT_SCRIPTED_TRANSCRIPTS'),
    sampleReplyMs,
    serverRoot: SERVER_ROOT,
    repoRoot: REPO_ROOT,
    deckFixture: cloud ? '' : str(source, 'PINPOINT_DECK_FIXTURE'),
    dataDir,
    fixturesDir: path.join(REPO_ROOT, 'demo', 'fixtures'),
    serverVersion: SERVER_VERSION,
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
