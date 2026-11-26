import type { PairResult } from '../../../../shared/contract.js';
import {
  RELAY_MAX_BYTES,
  RELAY_TIMEOUT_MS,
  cleanDeskName,
  newRequestId,
  shortHash,
  type CloudToDesk,
  type DeskToCloud,
  type RelayRequest,
  type RelayResponse,
} from '../relay/protocol.js';
import { PairingStore } from './pairing.js';

/** Minimal socket surface, so tests can use a plain in-memory pair. */
export interface DeskSocket {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  isOpen(): boolean;
  onMessage(listener: (data: string) => void): void;
  onClose(listener: () => void): void;
}

export interface DeskHubOptions {
  now?: () => number;
  relayTimeoutMs?: number;
  pairing?: PairingStore;
  maxDesks?: number;
  /** Test hook: one line per desk event. Defaults to console.info. */
  log?: (line: string) => void;
  helloTimeoutMs?: number;
}

export class DeskOfflineError extends Error {
  constructor() {
    super('Your desk is offline. Start Pinpoint on your computer.');
    this.name = 'DeskOfflineError';
  }
}

export class DeskTimeoutError extends Error {
  constructor() {
    super('Your desk took too long to answer.');
    this.name = 'DeskTimeoutError';
  }
}

export class RelayTooLargeError extends Error {
  constructor() {
    super('The desk response is larger than 2 MB.');
    this.name = 'RelayTooLargeError';
  }
}

export class RelayProtocolError extends Error {
  constructor(message = 'The desk sent an invalid response.') {
    super(message);
    this.name = 'RelayProtocolError';
  }
}

export interface DeskPresence {
  deskId: string;
  name: string;
  online: boolean;
}

export interface DeskPairReply extends PairResult {
  /** HTTP status the cloud should use. */
  status: number;
  retryAfterSeconds?: number;
}

interface DeskEntry {
  deskId: string;
  name: string;
  socket: DeskSocket | null;
  connectedAt: number | null;
  /** Incremented on every attach; stale sockets may not mutate the entry. */
  generation: number;
}

interface PendingRelay {
  deskId: string;
  resolve: (response: RelayResponse) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

const DEFAULT_MAX_DESKS = 5_000;
const HELLO_TIMEOUT_MS = 10_000;

/**
 * The cloud's live-desk registry: one socket per secret hash, pairing codes on
 * request, and request/response relaying.
 *
 * The secret itself is never passed here: the WebSocket upgrade hashes it, and
 * only that SHA-256 becomes the desk id. No inbox, deck, review or voice body is
 * ever stored; relayed bodies live only inside one pending promise.
 */
export class DeskHub {
  readonly pairing: PairingStore;
  private readonly desks = new Map<string, DeskEntry>();
  private readonly pending = new Map<string, PendingRelay>();
  private readonly now: () => number;
  private readonly relayTimeoutMs: number;
  private readonly maxDesks: number;
  private readonly log: (line: string) => void;
  private readonly helloTimeoutMs: number;

  constructor(options: DeskHubOptions = {}) {
    this.now = options.now ?? Date.now;
    this.relayTimeoutMs = Math.max(50, options.relayTimeoutMs ?? RELAY_TIMEOUT_MS);
    this.pairing = options.pairing ?? new PairingStore({ now: this.now });
    this.maxDesks = Math.max(1, options.maxDesks ?? DEFAULT_MAX_DESKS);
    this.log = options.log ?? ((line: string) => console.info(line));
    this.helloTimeoutMs = Math.max(10, options.helloTimeoutMs ?? HELLO_TIMEOUT_MS);
  }

  get deskCount(): number {
    return this.desks.size;
  }

  get onlineCount(): number {
    let online = 0;
    for (const entry of this.desks.values()) {
      if (entry.socket?.isOpen()) online += 1;
    }
    return online;
  }

  /**
   * Attach a freshly authenticated socket. The desk must say hello before any
   * other message is accepted; a reconnect with the same secret replaces the
   * old socket instead of running two.
   */
  attach(deskId: string, socket: DeskSocket): boolean {
    let existing = this.desks.get(deskId);
    if (!existing) {
      if (this.desks.size >= this.maxDesks) {
        socket.close(4009, 'too many desks');
        return false;
      }
      existing = {
        deskId,
        name: 'Desk',
        socket: null,
        connectedAt: null,
        generation: 0,
      };
      this.desks.set(deskId, existing);
    }
    const entry = existing;

    const previous = entry.socket;
    if (previous && previous !== socket) {
      this.failPending(deskId, new DeskOfflineError());
      previous.close(4001, 'replaced by a new connection');
      this.log(`[desk] replaced desk=${shortHash(deskId)}`);
    }

    entry.generation += 1;
    entry.socket = socket;
    entry.connectedAt = this.now();
    const generation = entry.generation;

    let greeted = false;
    const helloTimer = setTimeout(() => {
      if (!greeted && entry.socket === socket && entry.generation === generation) {
        socket.close(4008, 'hello timeout');
      }
    }, this.helloTimeoutMs);
    helloTimer.unref?.();

    const isCurrent = () => entry.socket === socket && entry.generation === generation;

    socket.onMessage((raw) => {
      if (!isCurrent()) return;
      let message: DeskToCloud;
      try {
        message = JSON.parse(raw) as DeskToCloud;
      } catch {
        socket.close(4003, 'invalid message');
        return;
      }
      if (!message || typeof message !== 'object' || typeof message.type !== 'string') {
        socket.close(4003, 'invalid message');
        return;
      }
      if (!greeted) {
        if (message.type !== 'hello') {
          socket.close(4003, 'hello required');
          return;
        }
        greeted = true;
        clearTimeout(helloTimer);
        entry.name = cleanDeskName(message.name);
        this.log(
          `[desk] online desk=${shortHash(deskId)} online=${this.onlineCount} total=${this.deskCount}`,
        );
        return;
      }
      this.handleMessage(entry, socket, message);
    });

    socket.onClose(() => {
      clearTimeout(helloTimer);
      if (!isCurrent()) return;
      entry.socket = null;
      this.failPending(deskId, new DeskOfflineError());
      // A socket that never said hello and has no pairings is a ghost; drop it
      // so unauthenticated upgrade spam cannot fill the desk cap.
      if (!greeted && !this.pairing.deskHasState(deskId)) {
        this.desks.delete(deskId);
      }
      this.log(`[desk] offline desk=${shortHash(deskId)} online=${this.onlineCount}`);
    });

    return true;
  }

  private handleMessage(entry: DeskEntry, socket: DeskSocket, message: DeskToCloud): void {
    switch (message.type) {
      case 'hello':
        entry.name = cleanDeskName(message.name);
        return;
      case 'request-pair-code':
        this.sendPairCode(entry, socket, message.id);
        return;
      case 'response':
        this.complete(entry.deskId, message.response);
        return;
      case 'unpair-all': {
        const removed = this.unpairAll(entry.deskId);
        this.send(socket, { type: 'unpaired', id: message.id, removed });
        return;
      }
    }
  }

  private sendPairCode(entry: DeskEntry, socket: DeskSocket, id: string): void {
    if (typeof id !== 'string' || id.length === 0) return;
    const created = this.pairing.createCode(entry.deskId);
    this.send(socket, {
      type: 'pair-code',
      id,
      code: created.code,
      expiresAt: new Date(created.expiresAt).toISOString(),
    });
  }

  /** Redeem a code from a device; maps the outcome to an HTTP-friendly reply. */
  pair(input: { code: string | null | undefined; deviceId: string; ip: string }): DeskPairReply {
    const outcome = this.pairing.redeem({
      code: input.code,
      deviceId: input.deviceId,
      ip: input.ip,
      deskExists: (deskId) => this.desks.has(deskId),
    });
    if (!outcome.ok) {
      const status =
        outcome.reason === 'rate_limited' ? 429 : outcome.reason === 'unknown_desk' ? 503 : 400;
      return {
        ok: false,
        status,
        error: outcome.error,
        ...(outcome.retryAfterSeconds !== undefined
          ? { retryAfterSeconds: outcome.retryAfterSeconds }
          : {}),
      };
    }
    const entry = this.desks.get(outcome.deskId);
    return {
      ok: true,
      status: 200,
      token: outcome.token,
      desk: { name: entry?.name ?? 'Desk' },
    };
  }

  /** Drop the pairing presented by this device; idempotent for the caller. */
  unpair(deviceId: string, token: string | null | undefined): boolean {
    const pair = this.pairing.resolve(deviceId, token);
    if (!pair) return false;
    this.pairing.revokeDevice(deviceId);
    this.log(`[cloud] unpair desk=${shortHash(pair.deskId)} device=ok`);
    return true;
  }

  unpairAll(deskId: string): number {
    const removed = this.pairing.revokeDesk(deskId);
    this.log(`[desk] unpair-all desk=${shortHash(deskId)} devices=${removed}`);
    return removed;
  }

  /** What the device is paired to, including whether the desk is connected now. */
  check(deviceId: string, token: string | null | undefined): DeskPresence | null {
    const pair = this.pairing.resolve(deviceId, token);
    if (!pair) return null;
    const entry = this.desks.get(pair.deskId);
    if (!entry) return null;
    return {
      deskId: entry.deskId,
      name: entry.name,
      online: entry.socket?.isOpen() === true,
    };
  }

  /** Send one request and wait for its matching response. */
  relay(deskId: string, request: RelayRequest): Promise<RelayResponse> {
    const entry = this.desks.get(deskId);
    const socket = entry?.socket;
    if (!socket || !socket.isOpen()) {
      return Promise.reject(new DeskOfflineError());
    }
    const id = request.id || newRequestId();
    const relayed: RelayRequest = { ...request, id };
    return new Promise<RelayResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new DeskTimeoutError());
      }, this.relayTimeoutMs);
      timer.unref?.();
      this.pending.set(id, { deskId, resolve, reject, timer });
      try {
        this.send(socket, { type: 'request', request: relayed });
      } catch {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(new DeskOfflineError());
      }
    });
  }

  stop(): void {
    this.failPending('*', new DeskOfflineError());
    for (const entry of this.desks.values()) {
      try {
        entry.socket?.close(1001, 'server shutting down');
      } catch {
        // Closing a dead socket is fine.
      }
      entry.socket = null;
    }
    this.desks.clear();
    this.pairing.clear();
  }

  private complete(deskId: string, response: RelayResponse): void {
    if (!response || typeof response !== 'object' || typeof response.id !== 'string') return;
    const pending = this.pending.get(response.id);
    // A desk may only answer requests the cloud sent to that same desk.
    if (!pending || pending.deskId !== deskId) return;

    const status = response.status;
    if (!Number.isInteger(status) || status < 100 || status > 599) {
      this.finish(response.id, pending, new RelayProtocolError('The desk sent an invalid status.'));
      return;
    }
    const bodyBase64 = typeof response.bodyBase64 === 'string' ? response.bodyBase64 : '';
    if (bodyBase64.length > Math.ceil((RELAY_MAX_BYTES * 4) / 3) + 8) {
      this.finish(response.id, pending, new RelayTooLargeError());
      return;
    }
    const decoded = Buffer.from(bodyBase64, 'base64');
    if (decoded.length > RELAY_MAX_BYTES) {
      this.finish(response.id, pending, new RelayTooLargeError());
      return;
    }
    this.pending.delete(response.id);
    clearTimeout(pending.timer);
    pending.resolve({
      id: response.id,
      status,
      contentType:
        typeof response.contentType === 'string' && response.contentType.length <= 200
          ? response.contentType
          : 'application/octet-stream',
      bodyBase64: decoded.toString('base64'),
    });
  }

  private finish(id: string, pending: PendingRelay, error: Error): void {
    this.pending.delete(id);
    clearTimeout(pending.timer);
    pending.reject(error);
  }

  private failPending(deskId: string, error: Error): void {
    for (const [id, pending] of [...this.pending]) {
      if (deskId !== '*' && pending.deskId !== deskId) continue;
      this.pending.delete(id);
      clearTimeout(pending.timer);
      pending.reject(error);
    }
  }

  private send(socket: DeskSocket, message: CloudToDesk): void {
    try {
      socket.send(JSON.stringify(message));
    } catch {
      // The close handler rejects the pending request.
    }
  }
}
