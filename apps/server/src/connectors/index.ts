// Public entry point for the connectors. loadConnectors(env, dataDir) builds
// only the integrations that are actually configured:
//  - Google: needs google-client.json + google-token.json in dataDir (Gmail drafts)
//  - Notion: needs NOTION_TOKEN (review pages, notes search)
//  - LLM: the opencode CLI (desk/live only; cloud never calls a model)
//
// Cloud mode returns no connectors at all: the public sample workspace has no
// owner mail, notes or model spend.

import path from 'node:path';
import { GmailConnector } from './gmail.js';
import { GoogleAuth, hasGoogleCredentials } from './googleAuth.js';
import { NotionConnector } from './notion.js';
import { OpencodeLlmConnector } from './opencode.js';
import type { Connectors } from './types.js';

export * from './types.js';
export { GmailConnector, stripQuotedHistory } from './gmail.js';
export {
  GoogleAuth,
  GOOGLE_SCOPES,
  GOOGLE_SCOPE_STRING,
  googleClientPath,
  googleTokenPath,
  hasGoogleCredentials,
  readGoogleClient,
  readGoogleToken,
  saveGoogleToken,
} from './googleAuth.js';
export type { GoogleClient, GoogleToken } from './googleAuth.js';
export { NotionConnector, NOTION_API_VERSION } from './notion.js';
export { OpencodeLlmConnector } from './opencode.js';

/**
 * The subset of the server env the connectors read. The real Env object is
 * structurally compatible. Uppercase keys may also be passed directly (useful
 * in tests); process.env is the final fallback, matching tsx --env-file.
 */
export interface ConnectorEnv {
  mode?: string;
  splitterModel?: string;
  notionToken?: string;
  notionReviewDb?: string;
  notionStatusProp?: string;
  notionTasksDb?: string;
  notionNotesRoot?: string;
  gmailQuery?: string;
  GMAIL_QUERY?: string;
  NOTION_TOKEN?: string;
  NOTION_REVIEW_DB?: string;
  NOTION_STATUS_PROP?: string;
  NOTION_TASKS_DB?: string;
  NOTION_NOTES_ROOT?: string;
  SPLITTER_MODEL?: string;
  PINPOINT_MODE?: string;
}

export function loadConnectors(env: ConnectorEnv, dataDir: string): Connectors {
  const mode = (setting(env, 'PINPOINT_MODE') || env.mode || 'live').toLowerCase();
  if (mode === 'cloud') return {};

  const dir = path.resolve(dataDir);
  const connectors: Connectors = {};

  if (hasGoogleCredentials(dir)) {
    const auth = GoogleAuth.fromDataDir(dir);
    if (auth) {
      const gmail = new GmailConnector({
        auth,
        query: setting(env, 'GMAIL_QUERY') || env.gmailQuery,
      });
      connectors.mail = gmail;
      connectors.drafts = gmail;
    }
  }

  const notionToken = setting(env, 'NOTION_TOKEN') || env.notionToken || '';
  if (notionToken) {
    const notion = new NotionConnector({
      token: notionToken,
      tasksDb: setting(env, 'NOTION_TASKS_DB') || env.notionTasksDb,
      reviewDb: setting(env, 'NOTION_REVIEW_DB') || env.notionReviewDb,
      statusProp: setting(env, 'NOTION_STATUS_PROP') || env.notionStatusProp,
      notesRoot: setting(env, 'NOTION_NOTES_ROOT') || env.notionNotesRoot,
    });
    connectors.notes = notion;
    connectors.reviews = notion;
  }

  if (mode !== 'demo') {
    connectors.llm = new OpencodeLlmConnector({
      model: setting(env, 'SPLITTER_MODEL') || env.splitterModel,
    });
  }

  return connectors;
}

function setting(env: ConnectorEnv, key: string): string {
  const record = env as unknown as Record<string, unknown>;
  const direct = record[key];
  if (typeof direct === 'string' && direct.trim() !== '') return direct.trim();
  const fromProcess = process.env[key];
  if (typeof fromProcess === 'string' && fromProcess.trim() !== '') return fromProcess.trim();
  return '';
}
