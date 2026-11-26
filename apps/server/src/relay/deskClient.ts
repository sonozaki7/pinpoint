import WebSocket from 'ws';
import {
  RELAY_MAX_BYTES,
  newRequestId,
  type CloudToDesk,
  type RelayRequest,
  type RelayResponse,
} from './protocol.js';

export interface DeskClientOptions {
  /** https://pinpoint-api.qolso.com or a local http://127.0.0.1:8799. */
  cloudUrl: string;
  secret: string;
  name: string;
  /** The desk's own HTTP app: (request) => app.fetch(request). */
  answer: (request: Request) => Promise<Response>;
  log?: (line: string) => void;
  /** Called for every code, including reconnects and manual requests. */
  onPairCode?: (code: string, expiresAt: string) => void;
  /** Ask for a pairing code right after the first successful hello. */
  pairOnStart?: boolean;
  reconnect?: boolean;
  minBackoffMs?: number;
  maxBackoffMs?: number;
  maxBytes?: number;
  /** Injected only by tests; production uses the global WebSocket from ws. */
  WebSocketImpl?: typeof WebSocket;
}

interface Waiter {
  resolve: (value: { code: string; expiresAt: string } | { removed: number }) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
  kind: 'pair' | 'unpair';
}

/** https://host → wss://host/api/desk/connect (never log the secret). */
export function deskSocketUrl(cloudUrl: string): string {
  const url = new URL(cloudUrl);
  url.protocol =
    url.protocol === 'http:' || url.protocol === 'ws:' ? 'ws:' : 'wss:';
  url.pathname = '/api/desk/connect';
  url.search = '';
  url.hash = '';
  return url.toString();
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}

function relayUrl(request: RelayRequest): string {
  const query = request.query ? `?${request.query}` : '';
  return `http://desk.invalid${request.path}${query}`;
}

function validRelayRequest(value: unknown): value is RelayRequest {
  if (!value || typeof value !== 'object') return false;
  const request = value as Partial<RelayRequest>;
  if (typeof request.id !== 'string' || request.id.length === 0 || request.id.length > 100) {
    return false;
  }
  if (typeof request.method !== 'string' || !/^[A-Z]{3,7}$/.test(request.method)) return false;
  if (typeof request.path !== 'string' || !request.path.startsWith('/api/')) return false;
  if (request.path.length > 1_000) return false;
  if (typeof request.query !== 'string' || request.query.length > 8_000) return false;
  if (request.contentType !== undefined && typeof request.contentType !== 'string') return false;
  if (request.contentType && request.contentType.length > 200) return false;
  if (typeof request.bodyBase64 !== 'string') return false;
  if (request.bodyBase64.length > Math.ceil((RELAY_MAX_BYTES * 4) / 3) + 8) return false;
  return true;
}

const ALLOWED_METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'DELETE', 'OPTIONS']);

/**
 * The outbound half of desk pairing. Connects to Pinpoint Cloud, announces the
 * desk name, answers relayed HTTP requests with its own in-process app, and
 * reconnects with backoff. Nothing is written to disk here.
 */
export class DeskClient {
  private readonly options: DeskClientOptions;
  private readonly url: string;
  private readonly log: (line: string) => void;
  private readonly maxBytes: number;
  private ws: WebSocket | null = null;
  private stopped = false;
  private connected = false;
  private attempts = 0;
  private reconnectTimer: NodeJS.Timeout | undefined;
  private pairOnStartDone = false;
  private waiters = new Map<string, Waiter>();
  private started = false;

  constructor(options: DeskClientOptions) {
    this.options = options;
    this.url = deskSocketUrl(options.cloudUrl);
    this.log = options.log ?? ((line: string) => console.info(line));
    this.maxBytes = Math.max(1_024, options.maxBytes ?? RELAY_MAX_BYTES);
  }

  get isConnected(): boolean {
    return this.connected && this.ws?.readyState === WebSocket.OPEN;
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.stopped = false;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
    this.failWaiters(new Error('Desk stopped'));
    const ws = this.ws;
    this.ws = null;
    this.connected = false;
    if (ws) {
      try {
        ws.close(1000, 'desk stopping');
      } catch {
        // Already closed.
      }
    }
  }

  /** Ask the cloud for a fresh pairing code (the desk must be connected). */
  async requestPairCode(timeoutMs = 15_000): Promise<{ code: string; expiresAt: string }> {
    await this.ensureConnected(timeoutMs);
    const id = newRequestId();
    const reply = await this.waitFor(id, 'pair', timeoutMs, () => {
      this.send({ type: 'request-pair-code', id });
    });
    if (!('code' in reply)) throw new Error('Unexpected pairing reply');
    return reply;
  }

  /** Revoke every device paired to this desk. */
  async requestUnpairAll(timeoutMs = 15_000): Promise<number> {
    await this.ensureConnected(timeoutMs);
    const id = newRequestId();
    const reply = await this.waitFor(id, 'unpair', timeoutMs, () => {
      this.send({ type: 'unpair-all', id });
    });
    if (!('removed' in reply)) throw new Error('Unexpected unpair reply');
    return reply.removed;
  }

  private connect(): void {
    if (this.stopped) return;
    const Impl = this.options.WebSocketImpl ?? WebSocket;
    this.log(`[desk] connecting to ${this.url} name="${this.options.name}"`);
    let ws: WebSocket;
    try {
      ws = new Impl(this.url, {
        headers: { Authorization: `Bearer ${this.options.secret}` },
        handshakeTimeout: 12_000,
        maxPayload: 6 * 1024 * 1024,
      });
    } catch (error) {
      this.log(`[desk] connect failed: ${(error as Error).message}`);
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;

    ws.on('open', () => {
      if (this.stopped || this.ws !== ws) return;
      this.connected = true;
      this.attempts = 0;
      this.send({ type: 'hello', name: this.options.name });
      this.log('[desk] connected');
      if (this.options.pairOnStart && !this.pairOnStartDone) {
        this.pairOnStartDone = true;
        // onPairCode prints it; the cloud answers on this same socket.
        void this.requestPairCode().catch((error: Error) =>
          this.log(`[desk] pairing code failed: ${error.message}`),
        );
      }
    });

    ws.on('message', (raw, isBinary) => {
      if (this.stopped || this.ws !== ws) return;
      if (isBinary) {
        ws.close(4003, 'text messages only');
        return;
      }
      let message: CloudToDesk;
      try {
        message = JSON.parse(raw.toString()) as CloudToDesk;
      } catch {
        return;
      }
      if (!message || typeof message !== 'object') return;
      this.handle(message);
    });

    ws.on('close', (code: number, reason: Buffer) => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.connected = false;
      this.failWaiters(new Error('Disconnected from Pinpoint Cloud'));
      const why = reason.toString().trim();
      this.log(`[desk] disconnected code=${code}${why ? ` reason="${why}"` : ''}`);
      if (code === 4001) {
        // Another process replaced this desk; reconnecting would fight it.
        this.log('[desk] another desk process is using this secret; stopping this one');
        this.stopped = true;
        return;
      }
      this.scheduleReconnect();
    });

    ws.on('error', (error: Error) => {
      if (this.stopped) return;
      this.log(`[desk] socket error: ${error.message}`);
      try {
        ws.close();
      } catch {
        // Close follows anyway.
      }
    });
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.options.reconnect === false || this.reconnectTimer) return;
    const min = Math.max(100, this.options.minBackoffMs ?? 1_000);
    const max = Math.max(min, this.options.maxBackoffMs ?? 30_000);
    const base = Math.min(max, min * 2 ** Math.min(this.attempts, 8));
    const jitter = base * 0.2 * (Math.random() * 2 - 1);
    const wait = Math.max(100, Math.round(base + jitter));
    this.attempts += 1;
    this.log(`[desk] reconnecting in ${(wait / 1_000).toFixed(1)}s`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      this.connect();
    }, wait);
    this.reconnectTimer.unref?.();
  }

  private handle(message: CloudToDesk): void {
    switch (message.type) {
      case 'request':
        void this.answerRequest(message.request);
        return;
      case 'pair-code': {
        const waiter = this.waiters.get(message.id);
        if (waiter?.kind === 'pair') {
          this.waiters.delete(message.id);
          clearTimeout(waiter.timer);
          waiter.resolve({ code: message.code, expiresAt: message.expiresAt });
        }
        this.options.onPairCode?.(message.code, message.expiresAt);
        return;
      }
      case 'unpaired': {
        const waiter = this.waiters.get(message.id);
        if (waiter?.kind === 'unpair') {
          this.waiters.delete(message.id);
          clearTimeout(waiter.timer);
          waiter.resolve({ removed: message.removed });
        }
        return;
      }
      case 'error': {
        if (message.id) {
          const waiter = this.waiters.get(message.id);
          if (waiter) {
            this.waiters.delete(message.id);
            clearTimeout(waiter.timer);
            waiter.reject(new Error(message.error));
          }
        }
        this.log(`[desk] cloud error: ${message.error}`);
        return;
      }
    }
  }

  private async answerRequest(request: RelayRequest): Promise<void> {
    if (!validRelayRequest(request) || !ALLOWED_METHODS.has(request.method)) {
      this.sendResponse(request?.id ?? newRequestId(), 400, {
        error: 'Invalid relayed request',
        code: 'bad_request',
      });
      return;
    }
    const started = Date.now();
    let status = 500;
    try {
      const headers = new Headers();
      if (request.contentType) headers.set('Content-Type', request.contentType);
      const body =
        request.method === 'GET' || request.method === 'HEAD' || request.bodyBase64.length === 0
          ? undefined
          : Buffer.from(request.bodyBase64, 'base64');
      const response = await this.options.answer(
        new Request(relayUrl(request), {
          method: request.method,
          headers,
          ...(body ? { body } : {}),
        }),
      );
      status = response.status;
      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.length > this.maxBytes) {
        this.log(
          `[desk] ${request.method} ${request.path} ${status} ${Date.now() - started}ms too-large=${buffer.length}`,
        );
        this.sendResponse(request.id, 502, {
          error: 'The desk response is larger than 2 MB.',
          code: 'too_large',
        });
        return;
      }
      const responseContentType = response.headers.get('content-type') ?? 'application/json';
      const relayed: RelayResponse = {
        id: request.id,
        status,
        contentType: responseContentType,
        bodyBase64: buffer.toString('base64'),
      };
      this.send({ type: 'response', response: relayed });
      this.log(`[desk] ${request.method} ${request.path} ${status} ${Date.now() - started}ms`);
    } catch (error) {
      this.log(
        `[desk] ${request.method} ${request.path} failed after ${Date.now() - started}ms: ${(error as Error).message}`,
      );
      this.sendResponse(request.id, 500, {
        error: 'Pinpoint desk could not answer.',
        code: 'desk_error',
      });
    }
  }

  private sendResponse(
    id: string,
    status: number,
    body: { error: string; code: string },
  ): void {
    const buffer = Buffer.from(JSON.stringify(body));
    this.send({
      type: 'response',
      response: {
        id,
        status,
        contentType: 'application/json',
        bodyBase64: buffer.toString('base64'),
      },
    });
  }

  private waitFor(
    id: string,
    kind: 'pair' | 'unpair',
    timeoutMs: number,
    send: () => void,
  ): Promise<{ code: string; expiresAt: string } | { removed: number }> {
    if (this.stopped) return Promise.reject(new Error('Desk is not running'));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters.delete(id);
        reject(new Error('Pinpoint Cloud did not answer in time'));
      }, timeoutMs);
      timer.unref?.();
      this.waiters.set(id, { resolve, reject, timer, kind });
      try {
        send();
      } catch (error) {
        clearTimeout(timer);
        this.waiters.delete(id);
        reject(error as Error);
      }
    });
  }

  private async ensureConnected(timeoutMs: number): Promise<void> {
    if (this.isConnected) return;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (this.stopped) throw new Error('Desk is not running');
      if (this.isConnected) return;
      await delay(100);
    }
    throw new Error('The desk is not connected to Pinpoint Cloud yet');
  }

  private send(message: Record<string, unknown>): void {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    try {
      ws.send(JSON.stringify(message));
    } catch {
      // The reconnect path reports the failure.
    }
  }

  private failWaiters(error: Error): void {
    for (const [id, waiter] of this.waiters) {
      clearTimeout(waiter.timer);
      waiter.reject(error);
      this.waiters.delete(id);
    }
  }
}
