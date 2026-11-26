#!/usr/bin/env node
// One-shot Telegram verification for the plain-language demo threads.
//
// It drives the real notifier (apps/server/src/telegram/index.ts) exactly as the server
// does, so the run proves the whole design:
//
//   1. removes earlier Pinpoint test topics (the agent, page and draft fixtures),
//   2. posts and pins the General-topic legend once,
//   3. login-fix: card + silent full text, then a review with one change on point 4,
//      one quote-reply per note, the summary, the reviewed card and a done topic icon,
//   4. read-on-phone on point 4: a notifying quote-reply with the whole step paragraph,
//   5. payment-upgrade: question card (option buttons), answer "Wait until Monday",
//      quote-reply, summary, reviewed card,
//   6. launch-post: Notion card (Approve + Read page), one comment on the rollout line,
//      its quote-reply, receipt with the page link and the card's comment count,
//   7. draft-priya: Gmail card (Read draft + Send as written), the in-place edit
//      "Net-45, not net-60.", the quote-reply, receipt with the sent-message link,
//      the card's "Sent to Priya: 1 change" line,
//   8. prints a t.me link for every message and reports quote fallbacks.
//
// Live run (needs the real bot, Node 22 and tsx):
//   npx tsx --env-file=apps/server/.env scripts/telegram-verify.mjs
//
// Dry run (no token, no network, writes the dry-run log and prints fake links):
//   npx tsx scripts/telegram-verify.mjs --dry-run
//
// Optional: --data-dir <path> (default: PINPOINT_DATA_DIR or apps/server/.data).
//
// The bot token is read from TELEGRAM_BOT_TOKEN and is never printed.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const argv = process.argv.slice(2);
const has = (name) => argv.includes(name);
const valueOf = (name) => {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
};

if (has('--help') || has('-h')) {
  console.log(
    [
      'Usage:',
      '  npx tsx --env-file=apps/server/.env scripts/telegram-verify.mjs',
      '  npx tsx scripts/telegram-verify.mjs --dry-run',
      '',
      'Runs login-fix (one change) and payment-upgrade (answer "Wait until Monday")',
      'through the real notifier, then prints every message link.',
      'A live run needs TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in the environment or',
      'apps/server/.env. --dry-run never contacts Telegram.',
    ].join('\n'),
  );
  process.exit(0);
}

const dryRun = has('--dry-run');
// Dry runs use their own store: cleanup deletes store records, and the real
// apps/server/.data must keep its live topic ids intact.
const dataDir =
  valueOf('--data-dir') ??
  process.env.PINPOINT_DATA_DIR ??
  (dryRun
    ? join(ROOT, 'apps/server/.data/telegram-verify-dry')
    : join(ROOT, 'apps/server/.data'));

if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_CHAT_ID) {
  // The documented command passes --env-file. Loading the file here makes the script work
  // with plain `npx tsx` too, and keeps one source of truth for the values.
  try {
    process.loadEnvFile(join(ROOT, 'apps/server/.env'));
  } catch {
    // No .env file; the checks below explain what is missing.
  }
}

const token = (process.env.TELEGRAM_BOT_TOKEN ?? '').trim();
const chatId = (process.env.TELEGRAM_CHAT_ID ?? '').trim();

if (!dryRun && !token) {
  console.error('TELEGRAM_BOT_TOKEN is not set, so this script will not contact Telegram.');
  console.error('');
  console.error('Set it in apps/server/.env (see docs/telegram-setup.md, steps 1-4):');
  console.error('  TELEGRAM_BOT_TOKEN=<token from @BotFather>');
  console.error('  TELEGRAM_CHAT_ID=-100...');
  console.error('');
  console.error('Then run:');
  console.error('  npx tsx --env-file=apps/server/.env scripts/telegram-verify.mjs');
  console.error('');
  console.error('To check the flow without a bot, run:');
  console.error('  npx tsx scripts/telegram-verify.mjs --dry-run');
  process.exit(1);
}

if (!dryRun && !chatId) {
  console.error('TELEGRAM_CHAT_ID is not set, so the bot has nowhere to post.');
  console.error('Find the group id with getUpdates (docs/telegram-setup.md, step 3), add');
  console.error('TELEGRAM_CHAT_ID=-100... to apps/server/.env, then run this script again.');
  process.exit(1);
}

const effectiveChatId = chatId || '-1001234567890';

async function loadIntegration() {
  const base = new URL('../apps/server/src/', import.meta.url);
  const importFile = (path) => import(new URL(path, base).href);
  const [telegram, store, transport, composer, fixtures, fakes] = await Promise.all([
    importFile('telegram/index.ts'),
    importFile('telegram/store.ts'),
    importFile('telegram/transport.ts'),
    importFile('core/composer.ts'),
    importFile('sources/fixture.ts'),
    importFile('core/fakes.ts'),
  ]);
  return {
    createTelegramNotifier: telegram.createTelegramNotifier,
    findQuoteMatch: telegram.findQuoteMatch,
    messageLink: telegram.messageLink,
    JsonStateStore: store.JsonStateStore,
    TelegramTransport: transport.TelegramTransport,
    composeReview: composer.composeReview,
    FixtureReviewSource: fixtures.FixtureReviewSource,
    FakeT3Client: fakes.FakeT3Client,
  };
}

let integration;
try {
  integration = await loadIntegration();
} catch (error) {
  const message = error instanceof Error ? error.message.split('\n')[0] : String(error);
  const underTsx = process.execArgv.some((arg) => /[\\/]tsx[\\/]/.test(arg));
  if (underTsx) {
    console.error('Could not load the server modules.');
    console.error(`  ${message}`);
    console.error('Install the server dependencies first: npm --prefix apps/server ci');
    process.exit(1);
  }
  console.error('This script imports the server TypeScript modules, which plain node cannot run.');
  console.error(`  Load error: ${message}`);
  console.error('Run it through tsx instead:');
  console.error('  npx tsx --env-file=apps/server/.env scripts/telegram-verify.mjs');
  console.error('  npx tsx scripts/telegram-verify.mjs --dry-run');
  process.exit(1);
}

const {
  createTelegramNotifier,
  findQuoteMatch,
  messageLink,
  JsonStateStore,
  TelegramTransport,
  composeReview,
  FixtureReviewSource,
  FakeT3Client,
} = integration;

async function loadFixture(name) {
  const path = new URL(`../demo/fixtures/${name}.json`, import.meta.url);
  return JSON.parse(await readFile(path, 'utf8'));
}

const login = await loadFixture('login-fix');
const payment = await loadFixture('payment-upgrade');
const launch = await loadFixture('launch-post');
const draftPriya = await loadFixture('draft-priya');
const allFixtures = [login, payment, launch, draftPriya];

// The demo review sources write nothing real: they hand back the same receipt the
// live Notion/Gmail sources produce, so the run proves the card and receipt wording.
const demoFixtures = allFixtures.map((fixture) => ({
  thread: fixture.thread,
  source: fixture.source,
  ...(fixture.deck ? { deck: fixture.deck } : {}),
}));
const demoT3 = new FakeT3Client(demoFixtures);
const notionSource = new FixtureReviewSource('notion', demoT3);
const gmailSource = new FixtureReviewSource('gmail', demoT3);

// Prove every quote lands before posting anything; a missing quote would fall back to a
// plain reply, which the run reports but should not happen with these fixtures.
for (const fixture of allFixtures) {
  for (const point of fixture.deck.points) {
    const parts = [{ plain: fixture.source.text }];
    if (!findQuoteMatch(parts, point.quote)) {
      console.error(
        `Refusing to post: the quote for ${fixture.thread.threadId}/${point.id} is not in its source text.`,
      );
      process.exit(1);
    }
  }
}

const cleanupStore = new JsonStateStore(join(dataDir, 'telegram.json'));
const cleanupTransport = new TelegramTransport({
  token,
  dryRun,
  logPath: join(dataDir, 'telegram-dryrun.log'),
  allocateId: () =>
    cleanupStore.update((state) => {
      const id = state.fakeNextId;
      state.fakeNextId = id + 1;
      return id;
    }),
  minIntervalMs: 1100,
});

const CLEANUP_THREADS = [
  'auth-refresh-fix',
  'login-fix',
  'payment-upgrade',
  'launch-post',
  'draft-priya',
];
const removed = [];

async function cleanupOldTopics() {
  for (const threadId of CLEANUP_THREADS) {
    const state = await cleanupStore.get();
    const record = state.topics[threadId];
    if (!record?.topicId) continue;
    if (!dryRun) {
      try {
        await cleanupTransport.call('deleteForumTopic', {
          chat_id: effectiveChatId,
          message_thread_id: record.topicId,
        });
        removed.push(`${record.title} (topic ${record.topicId})`);
      } catch (error) {
        const description = error instanceof Error ? error.message : String(error);
        if (!/TOPIC_ID_INVALID|thread not found|topic.*not found/i.test(description)) {
          console.warn(`Could not delete ${record.title}: ${description}`);
        }
      }
    }
    await cleanupStore.update((next) => {
      delete next.topics[threadId];
    });
  }

  // The verification run proves the legend is posted and pinned. Remove the previous
  // legend message (if any, fake or real) so the group ends with exactly one.
  const state = await cleanupStore.get();
  const previousLegend = state.generalMessageId;
  if (!dryRun && previousLegend !== undefined) {
    await cleanupTransport
      .call('deleteMessage', { chat_id: effectiveChatId, message_id: previousLegend })
      .catch(() => undefined);
  }
  await cleanupStore.update((next) => {
    delete next.generalMessageId;
    delete next.legendText;
  });
}

const links = [];
const initialCards = {};
const addLink = (label, messageId, topicId) => {
  const url = messageLink(effectiveChatId, messageId, topicId);
  links.push({ label, url });
  return url;
};

const readState = async () =>
  JSON.parse(await readFile(join(dataDir, 'telegram.json'), 'utf8'));

const fallbacks = [];
let notifier;

function buildAnswerDraft(fixture, pointId, option) {
  return {
    threadId: fixture.thread.threadId,
    sourceMessageId: fixture.source.sourceMessageId,
    notes: [{ pointId, verdict: 'answer', option }],
    seen: [pointId],
    updatedAt: new Date().toISOString(),
  };
}

notifier = createTelegramNotifier(
  dryRun
    ? { dataDir }
    : { TELEGRAM_BOT_TOKEN: token, TELEGRAM_CHAT_ID: chatId, dataDir },
  {
    onAgreeAll: async (threadId) => {
      console.log(`[verify] onAgreeAll called for ${threadId} (button path; unused in this run)`);
    },
    onAnswer: async (threadId, pointId, option) => {
      // Same path as answering on the glasses: save the answer, then send the review.
      const fixture = threadId === payment.thread.threadId ? payment : login;
      const draft = buildAnswerDraft(fixture, pointId, option);
      const composed = composeReview(fixture.deck, draft);
      await notifier.onReviewSent(fixture.thread, fixture.deck, draft, composed.message, undefined, {
        via: 'telegram',
      });
    },
    onQuoteFallback: (info) => {
      fallbacks.push(info);
      console.warn(`[verify] quote refused, plain reply sent: ${info.reason}`);
    },
  },
);

function linkTopicCard(record, label) {
  if (record?.headerMessageId === undefined) return;
  addLink(label, record.headerMessageId, record.topicId);
}

async function main() {
  console.log(
    dryRun
      ? 'DRY RUN: nothing is sent to Telegram. Links below are fake and only show the order.'
      : 'LIVE RUN: posting to Telegram now.',
  );
  console.log(`Data: ${dataDir}`);
  console.log('');

  await cleanupOldTopics();
  if (removed.length > 0) {
    console.log('Removed earlier test topics:');
    removed.forEach((entry) => console.log(`  - ${entry}`));
    console.log('');
  }

  // start() posts and pins the legend once, then long-polls for button taps.
  await notifier.start();
  const stateAfterStart = await readState();
  if (stateAfterStart.generalMessageId !== undefined) {
    addLink('General legend (pinned)', stateAfterStart.generalMessageId);
  }

  // ---- login-fix: plan review with one change on point 4 -------------------
  await notifier.onAttention(login.thread, login.source, login.deck);
  let state = await readState();
  let record = state.topics[login.thread.threadId];
  initialCards[login.thread.threadId] = record.headerText;
  linkTopicCard(record, 'login-fix card');
  record.parts.forEach((part, index) => {
    addLink(
      `login-fix full text ${index + 1}/${record.parts.length}`,
      part.messageId,
      record.topicId,
    );
  });
  console.log(`login-fix card: ${JSON.stringify(record.headerText)}`);
  console.log('');

  const loginNotes = [
    {
      pointId: 'p4',
      verdict: 'object',
      text: "Don't sign everyone out. Just fix the broken logins.",
    },
  ];
  const loginDraft = {
    threadId: login.thread.threadId,
    sourceMessageId: login.source.sourceMessageId,
    notes: loginNotes,
    seen: ['p4'],
    updatedAt: new Date().toISOString(),
  };
  const loginReview = await notifier.onReviewSent(
    login.thread,
    login.deck,
    loginDraft,
    composeReview(login.deck, loginDraft).message,
  );
  for (const message of loginReview.messages ?? []) {
    if (message.kind === 'card') continue;
    addLink(
      message.kind === 'note'
        ? `login-fix change on ${message.pointId}`
        : 'login-fix summary',
      message.messageId,
      record.topicId,
    );
  }

  const loginPoint4 = login.deck.points.find((point) => point.id === 'p4');
  const read = await notifier.readOnPhone(login.thread, login.deck, loginPoint4);
  if (read.messageId !== undefined) {
    addLink('login-fix read-on-phone (point 4)', read.messageId, record.topicId);
  }

  // ---- payment-upgrade: question answered "Wait until Monday" --------------
  await notifier.onAttention(payment.thread, payment.source, payment.deck);
  state = await readState();
  record = state.topics[payment.thread.threadId];
  initialCards[payment.thread.threadId] = record.headerText;
  linkTopicCard(record, 'payment-upgrade question card');
  record.parts.forEach((part, index) => {
    addLink(
      `payment-upgrade full text ${index + 1}/${record.parts.length}`,
      part.messageId,
      record.topicId,
    );
  });
  console.log(`payment-upgrade card: ${JSON.stringify(record.headerText)}`);
  console.log('');

  const paymentDraft = buildAnswerDraft(payment, 'p1', 'Wait until Monday');
  const paymentReview = await notifier.onReviewSent(
    payment.thread,
    payment.deck,
    paymentDraft,
    composeReview(payment.deck, paymentDraft).message,
    undefined,
    { via: 'telegram' },
  );
  for (const message of paymentReview.messages ?? []) {
    if (message.kind === 'card') continue;
    addLink(
      message.kind === 'note'
        ? `payment-upgrade answer on ${message.pointId}`
        : 'payment-upgrade summary',
      message.messageId,
      record.topicId,
    );
  }

  // ---- launch-post: Notion page, one comment on the rollout line -----------
  const launchDetail = await notionSource.getSource(launch.thread.threadId);
  await notifier.onAttention(launch.thread, launchDetail.source, launch.deck);
  state = await readState();
  record = state.topics[launch.thread.threadId];
  initialCards[launch.thread.threadId] = record.headerText;
  linkTopicCard(record, 'launch-post card');
  record.parts.forEach((part, index) => {
    addLink(
      `launch-post full text ${index + 1}/${record.parts.length}`,
      part.messageId,
      record.topicId,
    );
  });
  console.log(`launch-post card: ${JSON.stringify(record.headerText)}`);
  console.log('');

  const launchDraft = {
    threadId: launch.thread.threadId,
    sourceMessageId: launch.source.sourceMessageId,
    notes: [
      {
        pointId: 'p4',
        verdict: 'note',
        text: 'Check the rollout date before this goes out.',
      },
    ],
    seen: ['p4'],
    updatedAt: new Date().toISOString(),
  };
  const launchMessage = composeReview(launch.deck, launchDraft).message;
  const launchDelivery = await notionSource.deliver({
    thread: launch.thread,
    deck: launch.deck,
    draft: launchDraft,
    message: launchMessage,
    source: launchDetail.source,
  });
  const launchReview = await notifier.onReviewSent(
    launch.thread,
    launch.deck,
    launchDraft,
    launchMessage,
    launchDelivery.receipt,
  );
  for (const message of launchReview.messages ?? []) {
    if (message.kind === 'card') continue;
    addLink(
      message.kind === 'note'
        ? `launch-post comment on ${message.pointId}`
        : message.kind === 'receipt'
          ? 'launch-post receipt'
          : 'launch-post summary',
      message.messageId,
      record.topicId,
    );
  }

  // ---- draft-priya: Gmail draft, fix net-60, then send ---------------------
  const gmailDetail = await gmailSource.getSource(draftPriya.thread.threadId);
  await notifier.onAttention(draftPriya.thread, gmailDetail.source, draftPriya.deck);
  state = await readState();
  record = state.topics[draftPriya.thread.threadId];
  initialCards[draftPriya.thread.threadId] = record.headerText;
  linkTopicCard(record, 'draft-priya card');
  record.parts.forEach((part, index) => {
    addLink(
      `draft-priya full text ${index + 1}/${record.parts.length}`,
      part.messageId,
      record.topicId,
    );
  });
  console.log(`draft-priya card: ${JSON.stringify(record.headerText)}`);
  console.log('');

  const netLine = draftPriya.deck.points.find((point) => point.id === 'p2');
  if (!netLine) throw new Error('draft-priya fixture has no p2 line to edit');
  const edit = await gmailSource.edit({
    thread: draftPriya.thread,
    point: netLine,
    before: netLine.quote,
    text: 'Net-45, not net-60.',
  });
  if (!edit.ok || edit.after === undefined) {
    throw new Error(`The demo draft edit failed: ${edit.error ?? 'no replacement'}`);
  }
  console.log(`draft-priya edit: ${JSON.stringify(netLine.quote)} -> ${JSON.stringify(edit.after)}`);
  console.log('');

  const gmailDraft = {
    threadId: draftPriya.thread.threadId,
    sourceMessageId: draftPriya.source.sourceMessageId,
    notes: [
      {
        pointId: 'p2',
        verdict: 'note',
        text: 'Net-45, not net-60.',
        after: edit.after,
      },
    ],
    seen: ['p2'],
    updatedAt: new Date().toISOString(),
  };
  const gmailMessage = composeReview(draftPriya.deck, gmailDraft).message;
  const gmailDelivery = await gmailSource.deliver({
    thread: draftPriya.thread,
    deck: draftPriya.deck,
    draft: gmailDraft,
    message: gmailMessage,
    source: gmailDetail.source,
  });
  const gmailReview = await notifier.onReviewSent(
    draftPriya.thread,
    draftPriya.deck,
    gmailDraft,
    gmailMessage,
    gmailDelivery.receipt,
  );
  for (const message of gmailReview.messages ?? []) {
    if (message.kind === 'card') continue;
    addLink(
      message.kind === 'note'
        ? `draft-priya edit on ${message.pointId}`
        : message.kind === 'receipt'
          ? 'draft-priya receipt'
          : 'draft-priya summary',
      message.messageId,
      record.topicId,
    );
  }

  const finalState = await readState();
  console.log('Posted, in order:');
  links.forEach((entry, index) => {
    console.log(`${String(index + 1).padStart(2)}. ${entry.label}`);
    console.log(`    ${entry.url}`);
  });
  console.log('');
  console.log('Final store:');
  for (const fixture of allFixtures) {
    const saved = finalState.topics[fixture.thread.threadId];
    console.log(
      `  ${fixture.thread.threadId}: topic ${saved.topicId}, status ${saved.status}, card ${saved.headerMessageId}, ${saved.parts.length} full-text message(s)`,
    );
  }
  console.log(`  legend message: ${finalState.generalMessageId ?? 'none'}`);
  console.log('');
  console.log('Initial card text (before the review):');
  for (const fixture of allFixtures) {
    console.log(`  ${fixture.thread.threadId}:`);
    String(initialCards[fixture.thread.threadId] ?? '')
      .split('\n')
      .forEach((line) => console.log(`    ${line}`));
  }
  console.log('');
  console.log('Card text after the send:');
  for (const fixture of allFixtures) {
    const saved = finalState.topics[fixture.thread.threadId];
    console.log(`  ${fixture.thread.threadId}:`);
    String(saved.headerText ?? '')
      .split('\n')
      .forEach((line) => console.log(`    ${line}`));
  }
  console.log('');
  console.log(
    fallbacks.length === 0
      ? 'Quote replies: all accepted by Telegram (attached to the exact sentences).'
      : `Quote replies: ${fallbacks.length} refused, posted as plain replies. Reason: ${fallbacks[0]?.reason}`,
  );

  await notifier.stop();

  if (dryRun) {
    console.log('');
    console.log('Dry run finished. Every intended Bot API call is in:');
    console.log(`  ${join(dataDir, 'telegram-dryrun.log')}`);
    console.log('Run again without --dry-run once the token and chat id are in apps/server/.env.');
  }
}

try {
  await main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Telegram verification failed: ${message}`);
  await notifier?.stop().catch(() => undefined);
  process.exit(1);
}
