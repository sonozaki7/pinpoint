import { createHash } from 'node:crypto';
import { Hono, type Context } from 'hono';
import { cors } from 'hono/cors';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { getConnInfo } from '@hono/node-server/conninfo';
import { DEVICE_HEADER, SAMPLE_HEADER, TOKEN_HEADER, type PairResult } from '../../../../shared/contract.js';
import { normalizeDeviceId, deviceHash } from '../cloud/device.js';
import {
  DeskOfflineError,
  DeskTimeoutError,
  RelayProtocolError,
  RelayTooLargeError,
  type DeskHub,
} from '../cloud/deskHub.js';
import {
  CLOUD_DEVICE_REQUESTS_PER_MINUTE,
  CLOUD_IP_REQUESTS_PER_MINUTE,
  CLOUD_MAX_AUDIO_BYTES,
  CLOUD_VOICE_REQUESTS_PER_MINUTE,
} from '../cloud/limits.js';
import { FixedWindowRateLimiter, type RateLimitDecision } from '../cloud/rateLimit.js';
import type { CloudService } from '../cloud/service.js';
import type { DeviceWorkspace } from '../cloud/workspace.js';
import { HttpError, errorMessage } from '../core/errors.js';
import { askInputSchema, draftInputSchema, editInputSchema, taskInputSchema } from '../core/schemas.js';
import { parsePersona } from '../cloud/sample.js';
import {
  RELAY_MAX_BYTES,
  isDeviceToken,
  newRequestId,
  type RelayRequest,
} from '../relay/protocol.js';
import { MAX_CLOUD_JSON_BYTES, readBodyCapped, readJsonBody } from './body.js';

export interface CloudAppDeps {
  cloud: CloudService;
  /** Test hook: one line per request. Defaults to console.info. */
  log?: (line: string) => void;
}

type CloudVariables = { Variables: { deviceId: string } };

/** Values are only ever used for logs, never included in responses. */
const ROUTE_TEMPLATES: [RegExp, string][] = [
  [/^\/api\/health$/, '/api/health'],
  [/^\/api\/pair$/, '/api/pair'],
  [/^\/api\/desk\/connect$/, '/api/desk/connect'],
  [/^\/api\/inbox$/, '/api/inbox'],
  [/^\/api\/voice$/, '/api/voice'],
  [/^\/api\/sample\/reset$/, '/api/sample/reset'],
  [/^\/api\/deck\/[^/]+$/, '/api/deck/:threadId'],
  [/^\/api\/review\/[^/]+\/preview$/, '/api/review/:threadId/preview'],
  [/^\/api\/review\/[^/]+\/send$/, '/api/review/:threadId/send'],
  [/^\/api\/review\/[^/]+$/, '/api/review/:threadId'],
  [/^\/api\/edit\/[^/]+$/, '/api/edit/:threadId'],
  [/^\/api\/ask\/[^/]+$/, '/api/ask/:threadId'],
  [/^\/api\/task$/, '/api/task'],
  [/^\/api\/phone\/[^/]+\/[^/]+$/, '/api/phone/:threadId/:pointId'],
];

/** These routes are answered by the cloud itself, never relayed to a desk. */
const CLOUD_LOCAL_PATHS = new Set(['/api/health', '/api/pair']);

function routeTemplate(path: string): string {
  for (const [pattern, template] of ROUTE_TEMPLATES) {
    if (pattern.test(path)) return template;
  }
  if (path === '/') return '/';
  if (path.startsWith('/api/')) return '/api/unknown';
  return '/unknown';
}

function clientIp(c: Context, trustProxy: boolean): string {
  if (trustProxy) {
    const forwarded = c.req.header('x-forwarded-for');
    const first = forwarded?.split(',')[0]?.trim();
    if (first) return first;
  }
  try {
    return getConnInfo(c).remote.address ?? 'local';
  } catch {
    return 'local';
  }
}

function tooMany(decision: RateLimitDecision): HttpError {
  return new HttpError(
    429,
    'Too many requests',
    'rate_limited',
    { 'Retry-After': String(Math.max(1, decision.retryAfterSeconds ?? 1)) },
  );
}

function tokenHeader(c: Context): string | null {
  const value = c.req.header(TOKEN_HEADER)?.trim() ?? '';
  return isDeviceToken(value) ? value : null;
}

function workspaceFor(c: Context<CloudVariables>, cloud: CloudService): DeviceWorkspace {
  return cloud.workspaceFor(c.get('deviceId'), parsePersona(c.req.header(SAMPLE_HEADER)));
}

function relayError(error: unknown): HttpError {
  if (error instanceof DeskOfflineError) {
    return new HttpError(503, error.message, 'desk_offline');
  }
  if (error instanceof DeskTimeoutError) {
    return new HttpError(504, error.message, 'desk_timeout');
  }
  if (error instanceof RelayTooLargeError) {
    return new HttpError(502, error.message, 'desk_too_large');
  }
  if (error instanceof RelayProtocolError) {
    return new HttpError(502, error.message, 'desk_bad_response');
  }
  return new HttpError(502, 'Your desk could not answer. Try again.', 'desk_error');
}

/**
 * Forward one device request to its desk and return the desk's response
 * untouched. The cloud never parses the body: it only moves base64 bytes.
 */
async function relayToDesk(
  c: Context<CloudVariables>,
  desk: DeskHub,
  deskId: string,
): Promise<Response> {
  const method = c.req.method;
  let body: Buffer = Buffer.alloc(0);
  if (method !== 'GET' && method !== 'HEAD') {
    body = await readBodyCapped(c.req.raw, RELAY_MAX_BYTES, 'Request body exceeds 2 MB');
  }
  const url = new URL(c.req.url);
  const request: RelayRequest = {
    id: newRequestId(),
    method,
    path: c.req.path,
    query: url.search.startsWith('?') ? url.search.slice(1) : url.search,
    ...(c.req.header('content-type') ? { contentType: c.req.header('content-type')! } : {}),
    device: createHash('sha256').update(c.get('deviceId')).digest('hex').slice(0, 16),
    bodyBase64: body.toString('base64'),
  };

  let response;
  try {
    response = await desk.relay(deskId, request);
  } catch (error) {
    throw relayError(error);
  }
  const bytes = Buffer.from(response.bodyBase64, 'base64');
  const headers: Record<string, string> = {};
  if (response.contentType) headers['content-type'] = response.contentType;
  if (method === 'HEAD' || response.status === 204 || response.status === 304) {
    return c.body(null, response.status as ContentfulStatusCode, headers);
  }
  // Buffer is a Uint8Array at runtime; Hono's Data type only narrows its buffer.
  return c.body(
    bytes as unknown as Uint8Array<ArrayBuffer>,
    response.status as ContentfulStatusCode,
    headers,
  );
}

/**
 * The public cloud API. It shares route shapes with demo/live but keeps its
 * own middleware stack: wildcard CORS for phone WebViews, the device header,
 * per-IP/per-device rate limits, capped bodies and whisper-only voice.
 *
 * A valid X-Pinpoint-Token makes every normal API request a relay to the paired
 * desk. The desk sees its own API shape; the cloud is only a transport.
 */
export function createCloudApp(deps: CloudAppDeps): Hono<CloudVariables> {
  const { cloud } = deps;
  const log = deps.log ?? ((line: string) => console.info(line));
  const app = new Hono<CloudVariables>();
  const ipLimiter = new FixedWindowRateLimiter(CLOUD_IP_REQUESTS_PER_MINUTE);
  const deviceLimiter = new FixedWindowRateLimiter(CLOUD_DEVICE_REQUESTS_PER_MINUTE);
  const voiceLimiter = new FixedWindowRateLimiter(CLOUD_VOICE_REQUESTS_PER_MINUTE);

  // One line per request. No bodies, transcripts, query strings or full IPs.
  app.use('*', async (c, next) => {
    const started = Date.now();
    const validDevice = normalizeDeviceId(c.req.header('x-pinpoint-device'));
    const template = routeTemplate(c.req.path);
    let thrown: unknown;
    try {
      await next();
    } catch (error) {
      thrown = error;
      throw error;
    } finally {
      const status = thrown
        ? thrown instanceof HttpError
          ? thrown.status
          : 500
        : c.res.status;
      const id = validDevice ? deviceHash(validDevice) : '-';
      log(`[cloud] ${c.req.method} ${template} ${status} ${Date.now() - started}ms device=${id}`);
    }
  });

  // Cloud runs behind nginx and inside phone WebViews. Origins are opaque or
  // unknown there, so every origin is allowed; credentials are never used.
  app.use(
    '*',
    cors({
      origin: '*',
      allowMethods: ['GET', 'PUT', 'POST', 'DELETE', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'X-Pinpoint-Device', 'X-Pinpoint-Token', 'X-Pinpoint-Sample'],
      maxAge: 600,
    }),
  );

  app.use('/api/*', async (c, next) => {
    const ipDecision = ipLimiter.hit(clientIp(c, cloud.env.trustProxy));
    if (!ipDecision.allowed) throw tooMany(ipDecision);

    // GET /api/health is the unauthenticated liveness probe; CORS middleware
    // already answers preflights before this middleware runs.
    if (c.req.method === 'OPTIONS' || (c.req.method === 'GET' && c.req.path === '/api/health')) {
      return next();
    }

    const device = normalizeDeviceId(c.req.header('x-pinpoint-device'));
    if (!device) {
      throw new HttpError(
        400,
        `A valid ${DEVICE_HEADER} header (UUID) is required`,
        'bad_request',
      );
    }
    c.set('deviceId', device);

    const deviceDecision = deviceLimiter.hit(device);
    if (!deviceDecision.allowed) throw tooMany(deviceDecision);

    // Pairing routes and health are cloud-local. Every other route is relayed
    // when the device presents a valid token; an invalid token simply falls
    // back to the sample workspace, which is what an unpaired device sees.
    if (c.req.path.startsWith('/api/desk/') || CLOUD_LOCAL_PATHS.has(c.req.path)) {
      return next();
    }
    const token = tokenHeader(c);
    const presence = token ? cloud.desk.check(device, token) : null;
    if (presence) {
      return relayToDesk(c, cloud.desk, presence.deskId);
    }
    return next();
  });

  app.get('/', (c) => c.json({ name: 'pinpoint-cloud', ok: true, docs: '/api/health' }));

  app.get('/api/health', (c) => {
    const device = normalizeDeviceId(c.req.header(DEVICE_HEADER));
    const token = device ? tokenHeader(c) : null;
    const presence = device && token ? cloud.desk.check(device, token) : null;
    return c.json(
      cloud.health(
        presence ? { name: presence.name, online: presence.online } : undefined,
      ),
    );
  });

  /**
   * Pair with the desk that owns this code. Five attempts per device and per
   * IP per ten minutes; the token is shown once and stored hashed.
   */
  app.post('/api/pair', async (c) => {
    const raw = await readJsonBody(c.req.raw, 4 * 1024, 'Pairing body is too large');
    const code =
      raw && typeof raw === 'object' && 'code' in raw
        ? (raw as { code?: unknown }).code
        : undefined;
    const result = cloud.desk.pair({
      code: typeof code === 'string' ? code : null,
      deviceId: c.get('deviceId'),
      ip: clientIp(c, cloud.env.trustProxy),
    });
    if (result.retryAfterSeconds !== undefined) {
      c.header('Retry-After', String(result.retryAfterSeconds));
    }
    const body: PairResult = { ok: result.ok };
    if (result.token) body.token = result.token;
    if (result.desk) body.desk = result.desk;
    if (result.error) body.error = result.error;
    return c.json(body, result.status as ContentfulStatusCode);
  });

  app.delete('/api/pair', (c) => {
    const token = tokenHeader(c);
    cloud.desk.unpair(c.get('deviceId'), token);
    return c.json({ ok: true });
  });

  app.get('/api/inbox', async (c) =>
    c.json(await workspaceFor(c, cloud).listInbox()),
  );

  app.get('/api/deck/:threadId', (c) =>
    c.json(workspaceFor(c, cloud).getDeck(c.req.param('threadId'))),
  );

  app.get('/api/review/:threadId', (c) =>
    c.json(workspaceFor(c, cloud).getDraft(c.req.param('threadId'))),
  );

  app.put('/api/review/:threadId', async (c) => {
    const raw = await readJsonBody(
      c.req.raw,
      MAX_CLOUD_JSON_BYTES,
      'JSON body exceeds 64 KB',
    );
    const parsed = draftInputSchema.safeParse(raw);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new HttpError(
        400,
        `Invalid review body${issue ? `: ${issue.path.join('.')} ${issue.message}` : ''}`,
        'bad_request',
      );
    }
    return c.json(workspaceFor(c, cloud).putDraft(c.req.param('threadId'), parsed.data));
  });

  app.post('/api/review/:threadId/preview', (c) =>
    c.json(workspaceFor(c, cloud).preview(c.req.param('threadId'))),
  );

  app.post('/api/edit/:threadId', async (c) => {
    const raw = await readJsonBody(
      c.req.raw,
      MAX_CLOUD_JSON_BYTES,
      'JSON body exceeds 64 KB',
    );
    const parsed = editInputSchema.safeParse(raw);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new HttpError(
        400,
        `Invalid edit body${issue ? `: ${issue.path.join('.')} ${issue.message}` : ''}`,
        'bad_request',
      );
    }
    return c.json(
      await workspaceFor(c, cloud).edit(
        c.req.param('threadId'),
        parsed.data.pointId,
        parsed.data.text,
      ),
    );
  });

  app.post('/api/ask/:threadId', async (c) => {
    const raw = await readJsonBody(
      c.req.raw,
      MAX_CLOUD_JSON_BYTES,
      'JSON body exceeds 64 KB',
    );
    const parsed = askInputSchema.safeParse(raw);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new HttpError(
        400,
        `Invalid question${issue ? `: ${issue.path.join('.')} ${issue.message}` : ''}`,
        'bad_request',
      );
    }
    const llm = cloud.askUsesModel(c.get('deviceId'));
    return c.json(
      await workspaceFor(c, cloud).ask(c.req.param('threadId'), parsed.data.question, { llm }),
    );
  });

  app.post('/api/task', async (c) => {
    const raw = await readJsonBody(
      c.req.raw,
      MAX_CLOUD_JSON_BYTES,
      'JSON body exceeds 64 KB',
    );
    const parsed = taskInputSchema.safeParse(raw);
    if (!parsed.success) {
      throw new HttpError(400, 'Invalid task: text is required', 'bad_request');
    }
    const result = await workspaceFor(c, cloud).task(parsed.data.text);
    return c.json(result, result.ok ? 200 : 429);
  });

  app.post('/api/review/:threadId/send', async (c) =>
    c.json(await workspaceFor(c, cloud).send(c.req.param('threadId'))),
  );

  app.post('/api/phone/:threadId/:pointId', (c) =>
    c.json(
      workspaceFor(c, cloud).phone(
        c.req.param('threadId'),
        c.req.param('pointId'),
      ),
    ),
  );

  app.post('/api/sample/reset', (c) => {
    workspaceFor(c, cloud).reset();
    return c.body(null, 204);
  });

  app.post('/api/voice', async (c) => {
    const device = c.get('deviceId');
    const voiceDecision = voiceLimiter.hit(device);
    if (!voiceDecision.allowed) throw tooMany(voiceDecision);

    let bytes: Buffer;
    try {
      bytes = await readBodyCapped(
        c.req.raw,
        CLOUD_MAX_AUDIO_BYTES,
        'Audio exceeds 30 seconds',
      );
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw new HttpError(400, 'Could not read audio body', 'bad_request');
    }
    if (bytes.length === 0) throw new HttpError(400, 'Empty audio body', 'bad_request');

    return c.json(
      await cloud.transcribe(device, bytes, {
        threadId: c.req.header('x-thread-id') || undefined,
        pointId: c.req.header('x-point-id') || undefined,
      }),
    );
  });

  app.notFound((c) => {
    c.header('Access-Control-Allow-Origin', '*');
    return c.json({ error: 'Not found', code: 'not_found' }, 404);
  });

  app.onError((error, c) => {
    c.header('Access-Control-Allow-Origin', '*');
    if (error instanceof HttpError) {
      for (const [name, value] of Object.entries(error.headers ?? {})) {
        c.header(name, value);
      }
      return c.json(
        { error: error.message, code: error.code },
        error.status as ContentfulStatusCode,
      );
    }
    console.error(`[cloud] unhandled error: ${errorMessage(error)}`);
    return c.json({ error: 'Internal server error', code: 'internal' }, 500);
  });

  return app;
}
