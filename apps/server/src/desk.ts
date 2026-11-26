import { CLOUD_URL } from '../../../shared/contract.js';
import { startLocal } from './index.js';
import { readEnv } from './core/env.js';
import { DeskClient } from './relay/deskClient.js';
import { loadOrCreateDesk } from './relay/deskCredentials.js';
import {
  markDeskRunning,
  runningDeskPid,
  sendDeskCommand,
  startCommandWatcher,
} from './relay/control.js';

interface Options {
  pair: boolean;
  unpairAll: boolean;
}

function parseArgs(argv: string[]): Options {
  return {
    pair: argv.includes('--pair'),
    unpairAll: argv.includes('--unpair-all'),
  };
}

function printPairCode(code: string, expiresAt: string): void {
  let until = '';
  try {
    until = new Date(expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    until = '10 minutes';
  }
  console.info('');
  console.info('  Pair your phone');
  console.info(`  Type this code in Pinpoint:  ${code}`);
  console.info(`  It works once${until ? `, until ${until}` : ' within 10 minutes'}.`);
  console.info('');
}

function cloudUrlFromEnv(): string {
  return (process.env.PINPOINT_CLOUD_URL ?? '').trim() || CLOUD_URL;
}

/**
 * `--pair` and `--unpair-all` talk to the already-running desk through a local
 * request file, so they never open a second cloud socket (which would replace
 * the live one).
 */
async function runCommand(options: Options): Promise<void> {
  const env = readEnv({
    ...process.env,
    PINPOINT_MODE: process.env.PINPOINT_MODE ?? 'live',
  });
  if (env.mode === 'cloud') {
    throw new Error('PINPOINT_MODE=cloud is for the server; run the desk with demo or live.');
  }
  const loaded = loadOrCreateDesk({ dataDir: env.dataDir, name: process.env.PINPOINT_DESK_NAME });

  if (runningDeskPid(env.dataDir) !== null) {
    const command = options.unpairAll ? 'unpair-all' : 'pair';
    const result = await sendDeskCommand(env.dataDir, command);
    if (!result.ok) throw new Error(result.error ?? 'The desk could not run that command.');
    if (command === 'pair') {
      if (!result.code) throw new Error('The desk did not return a pairing code.');
      printPairCode(result.code, result.expiresAt ?? '');
    } else {
      console.info(
        `Unpaired ${result.removed ?? 0} device${result.removed === 1 ? '' : 's'} from ${loaded.credentials.name}.`,
      );
    }
    return;
  }

  if (!options.unpairAll) {
    throw new Error(
      'Your desk is not running. Start it with `npm run desk` in another terminal, then run --pair again.',
    );
  }

  // No local desk process: open one short-lived socket to revoke pairings.
  const client = new DeskClient({
    cloudUrl: cloudUrlFromEnv(),
    secret: loaded.credentials.secret,
    name: loaded.credentials.name,
    answer: async () => new Response('{}', { status: 200 }),
    reconnect: false,
    minBackoffMs: 300,
    maxBackoffMs: 3_000,
  });
  client.start();
  try {
    const removed = await client.requestUnpairAll(20_000);
    console.info(
      `Unpaired ${removed} device${removed === 1 ? '' : 's'} from ${loaded.credentials.name}.`,
    );
  } finally {
    client.stop();
  }
}

async function runDesk(): Promise<void> {
  const env = readEnv({
    ...process.env,
    PINPOINT_MODE: process.env.PINPOINT_MODE ?? 'live',
  });
  if (env.mode === 'cloud') {
    throw new Error('PINPOINT_MODE=cloud is for the server; run the desk with demo or live.');
  }
  const loaded = loadOrCreateDesk({ dataDir: env.dataDir, name: process.env.PINPOINT_DESK_NAME });
  const cleanupPid = markDeskRunning(env.dataDir);
  const runtime = await startLocal(env);
  const client = new DeskClient({
    cloudUrl: cloudUrlFromEnv(),
    secret: loaded.credentials.secret,
    name: loaded.credentials.name,
    answer: async (request) => runtime.app.fetch(request),
    pairOnStart: true,
    onPairCode: printPairCode,
  });

  console.info(
    `[desk] "${loaded.credentials.name}" ${loaded.created ? 'created' : 'loaded'} ${loaded.file} (mode 600)`,
  );
  console.info(
    `[desk] cloud=${cloudUrlFromEnv()} local=http://${env.host}:${env.port} — keep this terminal open`,
  );
  client.start();

  const stopWatcher = startCommandWatcher(env.dataDir, async (command) => {
    if (command === 'pair') {
      const { code, expiresAt } = await client.requestPairCode();
      return { ok: true, code, expiresAt };
    }
    const removed = await client.requestUnpairAll();
    return { ok: true, removed };
  });

  let closing = false;
  let runtimeClosed = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (closing) return;
    closing = true;
    console.info(`[desk] shutting down (${signal})`);
    const force = setTimeout(() => process.exit(0), 4_000);
    force.unref();
    stopWatcher();
    client.stop();
    if (!runtimeClosed) {
      runtimeClosed = true;
      await runtime.close().catch(() => undefined);
    }
    cleanupPid();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options.pair || options.unpairAll) {
    await runCommand(options);
    return;
  }
  await runDesk();
}

main().catch((error: unknown) => {
  console.error(`[desk] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
