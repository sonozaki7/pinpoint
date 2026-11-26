import { Hono, type Context } from 'hono';
import { cors } from 'hono/cors';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { getConnInfo } from '@hono/node-server/conninfo';
import { DEVICE_HEADER } from '../../../../shared/contract.js';
import { normalizeDeviceId, deviceHash } from '../cloud/device.js';
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
import { draftInputSchema } from '../core/schemas.js';
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
  [/^\/api\/inbox$/, '/api/inbox'],
  [/^\/api\/voice$/, '/api/voice'],
  [/^\/api\/sample\/reset$/, '/api/sample/reset'],
  [/^\/api\/deck\/[^/]+$/, '/api/deck/:threadId'],
  [/^\/api\/review\/[^/]+\/preview$/, '/api/review/:threadId/preview'],
  [/^\/api\/review\/[^/]+\/send$/, '/api/review/:threadId/send'],
  [/^\/api\/review\/[^/]+$/, '/api/review/:threadId'],
  [/^\/api\/phone\/[^/]+\/[^/]+$/, '/api/phone/:threadId/:pointId'],
];

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

function workspaceFor(c: Context<CloudVariables>, cloud: CloudService): DeviceWorkspace {
  return cloud.workspaceFor(c.get('deviceId'));
}

/**
 * The public cloud API. It shares route shapes with demo/live but keeps its
 * own middleware stack: wildcard CORS for phone WebViews, the device header,
 * per-IP/per-device rate limits, capped bodies and whisper-only voice.
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
      allowHeaders: ['Content-Type', 'X-Pinpoint-Device', 'X-Pinpoint-Token'],
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

    return next();
  });

  app.get('/', (c) => c.json({ name: 'pinpoint-cloud', ok: true, docs: '/api/health' }));

  app.get('/api/health', (c) => c.json(cloud.health()));

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
