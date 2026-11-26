// Notion integration for notes search and task creation.
//
// Pinned to Notion-Version 2026-03-11 (verified against the current docs). The
// 2025-09-03 "data sources" split therefore applies: page creation and queries
// use a data_source_id, while NOTION_TASKS_DB may name either the database or
// the data source. __resolveTasksSchema() discovers the right id from
// GET /v1/databases/:id and reads the property schema from /v1/data_sources/:id.
//
// Search is title-based at the API (POST /v1/search); the note text comes from
// flattening the returned pages' blocks, capped at 4,000 characters per note.

import {
  ConnectorError,
  clampCount,
  type NoteHit,
  type NotesConnector,
} from './types.js';
import { retryDelayMs, safeErrorCode, sleep, type FetchLike } from './http.js';

const NOTION_BASE = 'https://api.notion.com/v1';
export const NOTION_API_VERSION = '2026-03-11';
const MAX_NOTE_CHARS = 4_000;
const MAX_PAGE_CHARS = 2_000;

interface RichTextItem {
  plain_text?: string;
  text?: { content?: string };
  equation?: { expression?: string };
}

interface NotionProperty {
  id?: string;
  name?: string;
  type?: string;
  title?: RichTextItem[];
  rich_text?: RichTextItem[];
  date?: { start?: string };
}

interface NotionPage {
  object?: string;
  id?: string;
  url?: string;
  in_trash?: boolean;
  parent?: { type?: string; page_id?: string; data_source_id?: string; database_id?: string };
  properties?: Record<string, NotionProperty>;
}

interface NotionBlock {
  id?: string;
  type?: string;
  has_children?: boolean;
  child_page?: { title?: string };
  [key: string]: unknown;
}

interface NotionList<T> {
  results?: T[];
  next_cursor?: string | null;
  has_more?: boolean;
}

interface DataSourceTaskSchema {
  dataSourceId: string;
  properties: Record<string, NotionProperty>;
}

export interface NotionConnectorOptions {
  token: string;
  /** NOTION_TASKS_DB: database id or data source id. */
  tasksDb?: string;
  /** NOTION_NOTES_ROOT: preferred notes page; used only to rank search hits. */
  notesRoot?: string;
  fetchImpl?: FetchLike;
  baseUrl?: string;
  retryDelay?: number;
}

export class NotionConnector implements NotesConnector {
  private readonly token: string;
  private readonly tasksDb: string;
  private readonly notesRoot: string;
  private readonly fetchImpl: FetchLike;
  private readonly baseUrl: string;
  private readonly retryDelay: number;
  private schemaPromise: Promise<DataSourceTaskSchema> | undefined;

  constructor(options: NotionConnectorOptions) {
    if (!options.token) throw new ConnectorError('notion', 'NOTION_TOKEN is not set');
    this.token = options.token;
    this.tasksDb = (options.tasksDb ?? '').trim();
    this.notesRoot = (options.notesRoot ?? '').trim();
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.baseUrl = options.baseUrl ?? NOTION_BASE;
    this.retryDelay = options.retryDelay ?? 700;
  }

  async search(query: string, max: number): Promise<NoteHit[]> {
    const limit = clampCount(max, 1, 20, 5);
    const payload = await this.request<NotionList<NotionPage>>('/search', {
      method: 'POST',
      body: {
        query: query ?? '',
        filter: { property: 'object', value: 'page' },
        sort: { direction: 'descending', timestamp: 'last_edited_time' },
        page_size: Math.min(100, Math.max(limit, 10)),
      },
    });

    const pages = (payload?.results ?? [])
      .filter((page): page is NotionPage & { id: string } => {
        return (
          page.object === 'page' &&
          typeof page.id === 'string' &&
          page.id.length > 0 &&
          page.in_trash !== true
        );
      })
      .sort((a, b) => this.rootRank(b) - this.rootRank(a))
      .slice(0, limit);

    const hits: NoteHit[] = [];
    for (const page of pages) {
      const title = pageTitle(page);
      let text = '';
      try {
        text = await this.pageText(page.id);
      } catch {
        // A page the connection can see but not read still has a usable title.
      }
      hits.push({
        id: page.id,
        title,
        text,
        url: page.url ?? `https://www.notion.so/${page.id.replace(/-/g, '')}`,
      });
    }
    return hits;
  }

  async createTask(input: {
    title: string;
    due?: string;
    details?: string;
    sourceUrl?: string;
  }): Promise<{ id: string; url: string }> {
    const title = String(input.title ?? '').trim();
    if (!title) throw new ConnectorError('notion', 'task title is empty');
    if (!this.tasksDb) {
      throw new ConnectorError(
        'notion',
        'NOTION_TASKS_DB is not set; run "node scripts/connect-notion.mjs"',
      );
    }

    const schema = await this.resolveTasksSchema();
    const titleEntry = Object.entries(schema.properties).find(([, value]) => value.type === 'title');
    if (!titleEntry) {
      throw new ConnectorError('notion', 'tasks database has no title property');
    }
    const dateEntry = pickDateProperty(schema.properties);

    const properties: Record<string, unknown> = {
      [titleEntry[0]]: {
        title: [{ type: 'text', text: { content: title.slice(0, MAX_PAGE_CHARS) } }],
      },
    };

    let details = String(input.details ?? '');
    if (input.sourceUrl) {
      details = `${details}${details ? '\n' : ''}Source: ${input.sourceUrl}`;
    }

    if (input.due && dateEntry) {
      properties[dateEntry[0]] = { date: { start: input.due } };
    } else if (input.due && !dateEntry) {
      details = `Due: ${input.due}${details ? `\n${details}` : ''}`;
    }

    const children = paragraphBlocks(details);
    const page = await this.request<NotionPage>('/pages', {
      method: 'POST',
      body: {
        parent: { type: 'data_source_id', data_source_id: schema.dataSourceId },
        properties,
        ...(children.length > 0 ? { children } : {}),
      },
    });

    if (!page?.id) throw new ConnectorError('notion', 'notion create page returned no id');
    return {
      id: page.id,
      url: page.url ?? `https://www.notion.so/${page.id.replace(/-/g, '')}`,
    };
  }

  private rootRank(page: NotionPage): number {
    return this.notesRoot && page.parent?.page_id === this.notesRoot ? 1 : 0;
  }

  private async resolveTasksSchema(): Promise<DataSourceTaskSchema> {
    if (!this.schemaPromise) {
      this.schemaPromise = this.loadTasksSchema().catch((error) => {
        this.schemaPromise = undefined;
        throw error;
      });
    }
    return this.schemaPromise;
  }

  private async loadTasksSchema(): Promise<DataSourceTaskSchema> {
    const reference = this.tasksDb;
    if (!reference) throw new ConnectorError('notion', 'NOTION_TASKS_DB is not set');

    let firstError: unknown;
    try {
      const database = await this.request<{
        data_sources?: Array<{ id?: string; name?: string }>;
        properties?: Record<string, NotionProperty>;
      }>(`/databases/${encodeURIComponent(reference)}`, { method: 'GET' });

      const sources = Array.isArray(database?.data_sources) ? database.data_sources : [];
      const source =
        sources.find((entry) => (entry.name ?? '').toLowerCase() === 'tasks') ?? sources[0];
      if (source?.id) {
        const dataSource = await this.request<{ id?: string; properties?: Record<string, NotionProperty> }>(
          `/data_sources/${encodeURIComponent(source.id)}`,
          { method: 'GET' },
        );
        if (!dataSource?.properties) {
          throw new ConnectorError('notion', 'tasks data source returned no property schema');
        }
        return {
          dataSourceId: dataSource.id ?? source.id,
          properties: dataSource.properties,
        };
      }
      if (database?.properties) {
        // Defensive support for an older database-shaped payload.
        return { dataSourceId: reference, properties: database.properties };
      }
    } catch (error) {
      firstError = error;
    }

    // NOTION_TASKS_DB may already be a data source id.
    try {
      const dataSource = await this.request<{ id?: string; properties?: Record<string, NotionProperty> }>(
        `/data_sources/${encodeURIComponent(reference)}`,
        { method: 'GET' },
      );
      if (dataSource?.properties) {
        return { dataSourceId: dataSource.id ?? reference, properties: dataSource.properties };
      }
    } catch (error) {
      if (!firstError) firstError = error;
    }

    throw new ConnectorError(
      'notion',
      'NOTION_TASKS_DB could not be read; check the id and share the database with the integration',
      { cause: firstError },
    );
  }

  private async pageText(pageId: string): Promise<string> {
    const lines: string[] = [];
    let cursor: string | undefined;
    let page = 0;
    while (page < 3) {
      const params = new URLSearchParams({ page_size: '100' });
      if (cursor) params.set('start_cursor', cursor);
      const listing = await this.request<NotionList<NotionBlock>>(
        `/blocks/${encodeURIComponent(pageId)}/children?${params.toString()}`,
        { method: 'GET' },
      );
      for (const block of listing?.results ?? []) {
        const line = blockText(block);
        if (line) lines.push(line);
        if (lines.join('\n').length >= MAX_NOTE_CHARS) break;
      }
      if (lines.join('\n').length >= MAX_NOTE_CHARS) break;
      cursor = listing?.has_more && listing.next_cursor ? listing.next_cursor : undefined;
      page += 1;
      if (!cursor) break;
    }
    return lines.join('\n').slice(0, MAX_NOTE_CHARS).trim();
  }

  private async request<T>(
    path: string,
    init: { method: string; body?: unknown },
  ): Promise<T> {
    const body = init.body === undefined ? undefined : JSON.stringify(init.body);
    let lastResponse: Response | undefined;

    for (let attempt = 0; attempt < 2; attempt += 1) {
      let response: Response;
      try {
        response = await this.fetchImpl(`${this.baseUrl}${path}`, {
          method: init.method,
          headers: {
            authorization: `Bearer ${this.token}`,
            'notion-version': NOTION_API_VERSION,
            ...(body === undefined ? {} : { 'content-type': 'application/json' }),
          },
          body,
          signal: AbortSignal.timeout(20_000),
        });
      } catch (error) {
        const name = error instanceof Error ? error.name : 'network error';
        throw new ConnectorError('notion', `notion could not be reached (${name})`, { cause: error });
      }

      lastResponse = response;
      const text = await response.text();

      if (response.status === 429 || response.status === 529 || response.status >= 500) {
        if (attempt === 0) {
          await sleep(retryDelayMs(response, this.retryDelay));
          continue;
        }
      }

      if (!response.ok) {
        const code = safeErrorCode(text);
        throw new ConnectorError(
          'notion',
          `notion returned HTTP ${response.status}${code ? ` (${code})` : ''}`,
          { status: response.status },
        );
      }
      if (text.trim() === '') return {} as T;
      try {
        return JSON.parse(text) as T;
      } catch (error) {
        throw new ConnectorError('notion', 'notion returned a non-JSON reply', {
          status: lastResponse.status,
          cause: error,
        });
      }
    }

    throw new ConnectorError('notion', 'notion is rate limited', {
      status: lastResponse?.status,
    });
  }
}

function pageTitle(page: NotionPage): string {
  for (const property of Object.values(page.properties ?? {})) {
    if (property.type !== 'title') continue;
    return richText(property.title);
  }
  return '(untitled)';
}

function pickDateProperty(
  properties: Record<string, NotionProperty>,
): [string, NotionProperty] | undefined {
  const entries = Object.entries(properties).filter(([, value]) => value.type === 'date');
  if (entries.length === 0) return undefined;
  return entries.find(([name]) => /due|date|deadline/i.test(name)) ?? entries[0];
}

function richText(items: RichTextItem[] | undefined): string {
  return (items ?? [])
    .map((item) => item.plain_text ?? item.text?.content ?? item.equation?.expression ?? '')
    .join('')
    .trim();
}

function blockText(block: NotionBlock): string {
  if (block.child_page?.title) return block.child_page.title;
  const type = block.type;
  if (!type) return '';
  const payload = block[type] as
    | { rich_text?: RichTextItem[]; caption?: RichTextItem[]; title?: string }
    | undefined;
  if (!payload || typeof payload !== 'object') return '';
  if (Array.isArray(payload.rich_text)) return richText(payload.rich_text);
  if (Array.isArray(payload.caption)) return richText(payload.caption);
  if (typeof payload.title === 'string') return payload.title;
  return '';
}

function paragraphBlocks(details: string): Array<Record<string, unknown>> {
  const lines = String(details ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(0, 40);

  return lines.map((line) => ({
    object: 'block',
    type: 'paragraph',
    paragraph: {
      rich_text: [{ type: 'text', text: { content: line.slice(0, MAX_PAGE_CHARS) } }],
    },
  }));
}
