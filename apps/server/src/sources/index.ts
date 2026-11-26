import type { Connectors } from '../connectors/types.js';
import { loadConnectors } from '../connectors/index.js';
import type { Env } from '../core/env.js';
import type { T3Client } from '../core/types.js';
import { FixtureReviewSource } from './fixture.js';
import { GmailDraftSource } from './gmail.js';
import { NotionReviewSource } from './notion.js';
import { T3ReviewSource } from './t3.js';
import type { ReviewSource } from './types.js';

export * from './types.js';
export { T3ReviewSource } from './t3.js';
export { NotionReviewSource, notionCommentBody, anchorFor } from './notion.js';
export { GmailDraftSource } from './gmail.js';
export { FixtureReviewSource } from './fixture.js';
export { notionReceipt, gmailReceipt } from './receipts.js';

export interface CreateSourcesOptions {
  demo?: boolean;
  /** Tests may inject connectors; production loads them from env + dataDir. */
  connectors?: Connectors;
}

export interface SourcesSetup {
  sources: ReviewSource[];
  connectors: Connectors;
}

/**
 * Live mode merges every configured review source:
 *   T3 Code (always, ids unchanged) · Notion review pages · Gmail drafts.
 * Demo mode adds fixture-backed Notion/Gmail sources so the same screens work
 * offline; cloud mode builds its own sample workspace and never calls this.
 */
export function createSources(
  env: Env,
  t3: T3Client,
  options: CreateSourcesOptions = {},
): SourcesSetup {
  if (options.demo || env.mode === 'demo') {
    return {
      sources: [
        new T3ReviewSource(t3, { demo: true }),
        new FixtureReviewSource('notion', t3),
        new FixtureReviewSource('gmail', t3),
      ],
      connectors: {},
    };
  }

  const connectors = options.connectors ?? loadConnectors(env, env.dataDir);
  const sources: ReviewSource[] = [new T3ReviewSource(t3, { demo: false })];

  if (env.notionToken && env.notionReviewDb && connectors.reviews) {
    sources.push(new NotionReviewSource({ notion: connectors.reviews }));
  } else if (env.notionToken && !env.notionReviewDb) {
    console.info('[sources] Notion review skipped: NOTION_REVIEW_DB is not set');
  }

  if (connectors.drafts) {
    sources.push(
      new GmailDraftSource({
        drafts: connectors.drafts,
        ...(connectors.notes ? { notes: connectors.notes } : {}),
        query: env.gmailDraftsQuery,
      }),
    );
  }

  return { sources, connectors };
}
