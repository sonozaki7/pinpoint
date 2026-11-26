import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocket, WebSocketServer } from 'ws';
import { isDeskSecret, shortHash, sha256Hex } from '../relay/protocol.js';
import type { DeskHub, DeskSocket } from './deskHub.js';

export const DESK_CONNECT_PATH = '/api/desk/connect';

export interface DeskSocketServerOptions {
  /** Ping every desk this often and drop sockets that miss a pong. */
  heartbeatMs?: number;
  /** Test hook: one line per upgrade event. */
  log?: (line: string) => void;
}

function bearerSecret(header: string | string[] | undefined): string | null {
  const value = Array.isArray(header) ? header[0] : header;
  if (!value) return null;
  const match = /^Bearer\s+(.+)$/i.exec(value.trim());
  if (!match) return null;
  const secret = match[1]!.trim();
  return isDeskSecret(secret) ? secret : null;
}

function reject(socket: Duplex, status: number, message: string): void {
  try {
    socket.write(
      `HTTP/1.1 ${status} ${message}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
    );
  } finally {
    socket.destroy();
  }
}

function toDeskSocket(ws: WebSocket): DeskSocket {
  return {
    send(data: string) {
      if (ws.readyState === WebSocket.OPEN) ws.send(data);
    },
    close(code?: number, reason?: string) {
      try {
        ws.close(code, reason);
      } catch {
        // Already closing.
      }
    },
    isOpen() {
      return ws.readyState === WebSocket.OPEN;
    },
    onMessage(listener: (data: string) => void) {
      ws.on('message', (data, isBinary) => {
        if (isBinary) {
          ws.close(4003, 'text messages only');
          return;
        }
        listener(data.toString());
      });
    },
    onClose(listener: () => void) {
      ws.on('close', listener);
    },
  };
}

/**
 * Attach `GET /api/desk/connect` to the cloud's HTTP server.
 *
 * Desk keeps a single outbound WebSocket; nginx and Cloudflare already pass
 * upgrades to the container. Authentication is `Authorization: Bearer
 * <deskSecret>`; the hub only ever sees the SHA-256 of that secret.
 */
export function attachDeskSocket(
  server: Server,
  hub: DeskHub,
  options: DeskSocketServerOptions = {},
): () => void {
  const log = options.log ?? ((line: string) => console.info(line));
  const heartbeatMs = Math.max(1_000, options.heartbeatMs ?? 30_000);
  const wss = new WebSocketServer({ noServer: true, maxPayload: 6 * 1024 * 1024 });
  const alive = new WeakMap<WebSocket, boolean>();

  const onUpgrade = (request: IncomingMessage, socket: Duplex, head: Buffer): void => {
    let pathname: string;
    try {
      pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
    } catch {
      reject(socket, 400, 'Bad Request');
      return;
    }
    if (pathname !== DESK_CONNECT_PATH) {
      reject(socket, 404, 'Not Found');
      return;
    }

    const secret = bearerSecret(request.headers.authorization);
    if (!secret) {
      log('[desk] upgrade rejected reason=auth');
      reject(socket, 401, 'Unauthorized');
      return;
    }

    // Only the hash goes any further; the raw secret is never stored.
    const deskId = sha256Hex(secret);
    wss.handleUpgrade(request, socket, head, (ws) => {
      alive.set(ws, true);
      ws.on('pong', () => alive.set(ws, true));
      ws.on('message', () => alive.set(ws, true));
      ws.on('error', () => {
        // Close follows; the hub clears the desk on close.
      });
      const attached = hub.attach(deskId, toDeskSocket(ws));
      if (!attached) return;
      log(`[desk] upgrade desk=${shortHash(deskId)}`);
    });
  };

  server.on('upgrade', onUpgrade);

  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (alive.get(ws) === false) {
        ws.terminate();
        continue;
      }
      alive.set(ws, false);
      try {
        ws.ping();
      } catch {
        ws.terminate();
      }
    }
  }, heartbeatMs);
  heartbeat.unref?.();

  return () => {
    clearInterval(heartbeat);
    server.off('upgrade', onUpgrade);
    for (const ws of wss.clients) {
      try {
        ws.close(1001, 'server shutting down');
      } catch {
        ws.terminate();
      }
    }
    wss.close();
  };
}
