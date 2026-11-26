// Public entry point for the connectors. loadConnectors(env, dataDir) builds
// only the integrations that are actually configured:
//  - Google: needs google-client.json + google-token.json in dataDir
//  - Notion: needs NOTION_TOKEN
//  - LLM: OpenRouter when OPENROUTER_API_KEY is set, otherwise the opencode CLI
//    (desk/live only; cloud never calls a model)
//
// Cloud mode returns no connectors at all: the public sample workspace has no
// owner mail, calendar, notes or model spend.

import path from 'node:path';
import { GmailConnector } from './gmail.js';
import { GoogleCalendarConnector } from './calendar.js';
import { GoogleAuth, hasGoogleCredentials } from './googleAuth.js';
import { NotionConnector } from './notion.js';
import { OpencodeLlmConnector } from './opencode.js';
import { DEFAULT_OPENROUTER_MODEL, OpenRouterConnector } from './openrouter.js';
import type { Connectors } from './types.js';

export * from './types.js';
export * from './fake.js';
export { GmailConnector, stripQuotedHistory } from './gmail.js';
export { GoogleCalendarConnector } from './calendar.js';
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
export { OpenRouterConnector, DEFAULT_OPENROUTER_MODEL } from './openrouter.js';
export { OpencodeLlmConnector } from './opencode.js';

/**
 * The subset of the server env the connectors read. The real Env object is
 * structurally compatible. Uppercase keys may also be passed directly (useful
 * in tests); process.env is the final fallback, matching tsx --env-file.
 */
export interface ConnectorEnv {
  mode?: string;
  openrouterKey?: string;
  openrouterModel?: string;
  splitterModel?: string;
  notionToken?: string;
  notionTasksDb?: string;
  notionNotesRoot?: string;
  gmailQuery?: string;
  gcalCalendar?: string;
  GMAIL_QUERY?: string;
  GCAL_CALENDAR?: string;
  NOTION_TOKEN?: string;
  NOTION_TASKS_DB?: string;
  NOTION_NOTES_ROOT?: string;
  OPENROUTER_API_KEY?: string;
  OPENROUTER_MODEL?: string;
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
      connectors.mail = new GmailConnector({
        auth,
        query: setting(env, 'GMAIL_QUERY') || env.gmailQuery,
      });
      connectors.calendar = new GoogleCalendarConnector({
        auth,
        calendar: setting(env, 'GCAL_CALENDAR') || env.gcalCalendar,
      });
    }
  }

  const notionToken = setting(env, 'NOTION_TOKEN') || env.notionToken || '';
  if (notionToken) {
    connectors.notes = new NotionConnector({
      token: notionToken,
      tasksDb: setting(env, 'NOTION_TASKS_DB') || env.notionTasksDb,
      notesRoot: setting(env, 'NOTION_NOTES_ROOT') || env.notionNotesRoot,
    });
  }

  const openrouterKey = setting(env, 'OPENROUTER_API_KEY') || env.openrouterKey || '';
  if (openrouterKey) {
    connectors.llm = new OpenRouterConnector({
      apiKey: openrouterKey,
      // Deliberately not env.openrouterModel: core/env.ts defaults that to a
      // Claude id. The brief's default should be the cheap DeepSeek chat model.
      model: setting(env, 'OPENROUTER_MODEL') || DEFAULT_OPENROUTER_MODEL,
    });
  } else if (mode !== 'demo') {
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
