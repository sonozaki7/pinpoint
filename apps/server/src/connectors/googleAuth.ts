// Google OAuth 2.0 for an installed (desktop) app, using the loopback redirect.
// No googleapis dependency: the connect script performs consent, this module
// keeps the token fresh for the Gmail and Calendar connectors.
//
// Tokens live only in <dataDir>/google-token.json (mode 0600); the downloaded
// client JSON lives in <dataDir>/google-client.json. Both are gitignored.

import fs from 'node:fs';
import path from 'node:path';
import { ConnectorError, type AccessTokenProvider } from './types.js';
import { safeErrorCode, type FetchLike } from './http.js';

/**
 * Least-privilege scopes for the server:
 *  - gmail.modify        read + label + insert + send + mark read, without the
 *                        all-mail "permanently delete" scope
 *  - calendar.events     read/write events on the owner's calendars, without
 *                        calendar sharing/settings access
 *
 * Demo setup additionally needs two narrow scopes:
 *  - calendar.calendarlist.readonly  resolve the "Pinpoint demo" calendar by name
 *  - calendar.app.created            create that one secondary demo calendar
 * There is no narrower Google scope that can create a secondary calendar.
 * `calendar.events` does not cover calendarList.list, calendars.insert or the
 * freeBusy endpoint; free/busy is therefore derived from events.list.
 */
export const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
  'https://www.googleapis.com/auth/calendar.app.created',
] as const;

export const GOOGLE_SCOPE_STRING = GOOGLE_SCOPES.join(' ');

export interface GoogleClient {
  clientId: string;
  clientSecret: string;
}

export interface GoogleToken {
  access_token: string;
  /** Epoch milliseconds. */
  expires_at: number;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
}

export function googleClientPath(dataDir: string): string {
  return path.join(path.resolve(dataDir), 'google-client.json');
}

export function googleTokenPath(dataDir: string): string {
  return path.join(path.resolve(dataDir), 'google-token.json');
}

export function hasGoogleCredentials(dataDir: string): boolean {
  return fs.existsSync(googleClientPath(dataDir)) && fs.existsSync(googleTokenPath(dataDir));
}

/** Read the OAuth client JSON downloaded from the Google Cloud Console. */
export function readGoogleClient(dataDir: string): GoogleClient | null {
  const file = googleClientPath(dataDir);
  if (!fs.existsSync(file)) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    throw new ConnectorError('google', 'google-client.json is not valid JSON', { cause: error });
  }
  const record = raw as { installed?: Record<string, unknown>; web?: Record<string, unknown> };
  const entry = record.installed ?? record.web;
  const clientId = entry?.client_id;
  const clientSecret = entry?.client_secret;
  if (typeof clientId !== 'string' || typeof clientSecret !== 'string' || !clientId || !clientSecret) {
    throw new ConnectorError(
      'google',
      'google-client.json is not a desktop OAuth client (missing client_id/client_secret)',
    );
  }
  return { clientId, clientSecret };
}

/** Read the saved token. Returns null when the owner has not connected yet. */
export function readGoogleToken(dataDir: string): GoogleToken | null {
  const file = googleTokenPath(dataDir);
  if (!fs.existsSync(file)) return null;
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
  } catch (error) {
    throw new ConnectorError('google', 'google-token.json is not valid JSON', { cause: error });
  }
  const accessToken = raw.access_token;
  if (typeof accessToken !== 'string' || accessToken.length === 0) {
    throw new ConnectorError('google', 'google-token.json has no access token; reconnect Google');
  }
  const expires = raw.expires_at ?? raw.expiry_date;
  const expiresAt = typeof expires === 'number' ? expires : Number(expires);
  return {
    access_token: accessToken,
    expires_at: Number.isFinite(expiresAt) ? expiresAt : 0,
    ...(typeof raw.refresh_token === 'string' ? { refresh_token: raw.refresh_token } : {}),
    ...(typeof raw.scope === 'string' ? { scope: raw.scope } : {}),
    ...(typeof raw.token_type === 'string' ? { token_type: raw.token_type } : {}),
  };
}

/** Write the token atomically with owner-only permissions (0600). */
export function saveGoogleToken(dataDir: string, token: GoogleToken): void {
  const dir = path.resolve(dataDir);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const target = googleTokenPath(dir);
  const temp = `${target}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(token, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  fs.chmodSync(temp, 0o600);
  fs.renameSync(temp, target);
  fs.chmodSync(target, 0o600);
}

interface TokenRefreshPayload {
  access_token?: unknown;
  expires_in?: unknown;
  refresh_token?: unknown;
  scope?: unknown;
  token_type?: unknown;
  error?: unknown;
}

/**
 * Keeps one Google access token fresh. Refresh is single-flight so a burst of
 * Gmail/Calendar calls cannot start several refreshes with the same refresh
 * token (Google may rotate it).
 */
export class GoogleAuth implements AccessTokenProvider {
  private token: GoogleToken;
  private readonly client: GoogleClient;
  private readonly dataDir: string;
  private readonly fetchImpl: FetchLike;
  private readonly now: () => number;
  private refreshing: Promise<string> | undefined;

  constructor(options: {
    dataDir: string;
    client: GoogleClient;
    token: GoogleToken;
    fetchImpl?: FetchLike;
    now?: () => number;
  }) {
    this.dataDir = path.resolve(options.dataDir);
    this.client = options.client;
    this.token = options.token;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.now = options.now ?? Date.now;
  }

  /** Build an auth helper when both files exist, otherwise null. */
  static fromDataDir(
    dataDir: string,
    options?: { fetchImpl?: FetchLike; now?: () => number },
  ): GoogleAuth | null {
    const client = readGoogleClient(dataDir);
    const token = readGoogleToken(dataDir);
    if (!client || !token) return null;
    return new GoogleAuth({ dataDir, client, token, ...options });
  }

  /** Current token string, refreshing first when it is close to expiry. */
  async accessToken(): Promise<string> {
    if (this.isFresh()) return this.token.access_token;
    if (!this.refreshing) {
      this.refreshing = this.refresh().finally(() => {
        this.refreshing = undefined;
      });
    }
    return this.refreshing;
  }

  private isFresh(): boolean {
    return (
      typeof this.token.access_token === 'string' &&
      this.token.access_token.length > 0 &&
      this.token.expires_at - this.now() > 60_000
    );
  }

  private async refresh(): Promise<string> {
    const refreshToken = this.token.refresh_token;
    if (!refreshToken) {
      throw new ConnectorError(
        'google',
        'Google token has no refresh token; run "node scripts/connect-google.mjs" again',
      );
    }

    const body = new URLSearchParams({
      client_id: this.client.clientId,
      client_secret: this.client.clientSecret,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    });

    let response: Response;
    try {
      response = await this.fetchImpl('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body,
        signal: AbortSignal.timeout(15_000),
      });
    } catch (error) {
      throw new ConnectorError('google', 'Google token refresh could not be reached', {
        cause: error,
      });
    }

    const text = await response.text();
    if (!response.ok) {
      const code = safeErrorCode(text);
      throw new ConnectorError(
        'google',
        `Google token refresh returned HTTP ${response.status}${code ? ` (${code})` : ''}; ` +
          'run "node scripts/connect-google.mjs" again',
        { status: response.status },
      );
    }

    let payload: TokenRefreshPayload;
    try {
      payload = JSON.parse(text) as TokenRefreshPayload;
    } catch (error) {
      throw new ConnectorError('google', 'Google token refresh returned non-JSON', {
        cause: error,
      });
    }

    if (typeof payload.access_token !== 'string' || payload.access_token.length === 0) {
      throw new ConnectorError('google', 'Google token refresh returned no access token');
    }

    const expiresIn = Number(payload.expires_in);
    const next: GoogleToken = {
      access_token: payload.access_token,
      expires_at: this.now() + (Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : 3_600) * 1_000,
      refresh_token:
        typeof payload.refresh_token === 'string' && payload.refresh_token.length > 0
          ? payload.refresh_token
          : refreshToken,
      ...(typeof payload.scope === 'string'
        ? { scope: payload.scope }
        : this.token.scope
          ? { scope: this.token.scope }
          : {}),
      ...(typeof payload.token_type === 'string' ? { token_type: payload.token_type } : {}),
    };

    this.token = next;
    saveGoogleToken(this.dataDir, next);
    return next.access_token;
  }
}
