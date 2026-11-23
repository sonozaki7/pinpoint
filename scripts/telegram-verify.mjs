#!/usr/bin/env node
// One-shot Telegram verification for the demo plan fixture `auth-refresh-fix`.
//
// It drives the server's real Telegram code: the same transport, HTML renderer, quote
// matcher, review formatter and topic store the server uses. In one run it:
//
//   1. creates the topic for the thread (or reuses the stored one),
//   2. posts the header and the full plan,
//   3. posts the composed review (objection on point 4, note on point 6),
//   4. posts each note as a quote-reply on the exact plan sentence,
//   5. posts the "read on phone" marker for point 4,
//   6. prints a t.me link for every message it posted.
//
// Live run (needs the real bot, Node 22 and tsx):
//   npx tsx --env-file=apps/server/.env scripts/telegram-verify.mjs
//
// Dry run (no token, no network, writes to the dry-run log and prints fake links):
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
      'Posts the auth-refresh-fix topic, plan, review and quote-replies, then prints every link.',
      'A live run needs TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in the environment or',
      'apps/server/.env. --dry-run never contacts Telegram.',
    ].join('\n'),
  );
  process.exit(0);
}

const dryRun = has('--dry-run');
const dataDir = valueOf('--data-dir') ?? process.env.PINPOINT_DATA_DIR ?? join(ROOT, 'apps/server/.data');

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
  const [telegram, transport, store, format, composer] = await Promise.all([
    importFile('telegram/index.ts'),
    importFile('telegram/transport.ts'),
    importFile('telegram/store.ts'),
    importFile('telegram/format.ts'),
    importFile('core/composer.ts'),
  ]);
  return {
    findQuoteMatch: telegram.findQuoteMatch,
    messageLink: telegram.messageLink,
    renderParts: telegram.renderParts,
    splitPlainText: telegram.splitPlainText,
    TelegramTransport: transport.TelegramTransport,
    TelegramApiError: transport.TelegramApiError,
    JsonStateStore: store.JsonStateStore,
    headerText: format.headerText,
    reviewLine: format.reviewLine,
    pointReplyText: format.pointReplyText,
    topicName: format.topicName,
    composeReview: composer.composeReview,
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
  findQuoteMatch,
  messageLink,
  renderParts,
  splitPlainText,
  TelegramTransport,
  TelegramApiError,
  JsonStateStore,
  headerText,
  reviewLine,
  pointReplyText,
  topicName,
  composeReview,
} = integration;

const fixturePath = new URL('../demo/fixtures/auth-refresh-fix.json', import.meta.url);
const fixture = JSON.parse(await readFile(fixturePath, 'utf8'));
const { thread, source, deck } = fixture;

// The two notes the demo records for this plan, from demo/fixtures/transcripts.json.
const transcripts = JSON.parse(
  await readFile(new URL('../demo/fixtures/transcripts.json', import.meta.url), 'utf8'),
);
const transcriptFor = (pointId) => {
  const entry = (transcripts.notes ?? []).find(
    (note) => note.threadId === thread.threadId && note.pointId === pointId,
  );
  if (!entry?.text) throw new Error(`No demo transcript for ${thread.threadId} ${pointId}`);
  return entry.text;
};

const notes = [
  { pointId: 'p4', verdict: 'object', text: transcriptFor('p4') },
  { pointId: 'p6', verdict: 'note', text: transcriptFor('p6') },
];
const draft = {
  threadId: thread.threadId,
  sourceMessageId: source.sourceMessageId,
  notes,
  seen: ['p4', 'p6'],
  updatedAt: new Date().toISOString(),
};
const composed = composeReview(deck, draft);
const point4 = deck.points.find((point) => point.id === 'p4');
const point6 = deck.points.find((point) => point.id === 'p6');
if (!point4 || !point6) throw new Error('The fixture deck is missing point 4 or point 6.');

// Render the plan before posting anything, then prove both note quotes land on a real
// message part. A missing quote would otherwise send a plain reply instead of a quote-reply.
const planParts = renderParts(source.text);
const match4 = findQuoteMatch(planParts, point4.quote);
const match6 = findQuoteMatch(planParts, point6.quote);
if (!match4 || !match6) {
  const missing = [!match4 && 'point 4', !match6 && 'point 6'].filter(Boolean).join(' and ');
  console.error(`Refusing to post: the exact quote for ${missing} is not in the fixture plan text.`);
  process.exit(1);
}

const store = new JsonStateStore(join(dataDir, 'telegram.json'));
const transport = new TelegramTransport({
  token,
  dryRun,
  logPath: join(dataDir, 'telegram-dryrun.log'),
  allocateId: () =>
    store.update((state) => {
      const id = state.fakeNextId;
      state.fakeNextId = id + 1;
      return id;
    }),
  minIntervalMs: 1100,
});

const links = [];
const addLink = (label, messageId, topicId) => {
  links.push({ label, url: messageLink(effectiveChatId, messageId, topicId) });
  return messageId;
};

function saveRecord(mutate) {
  return store.update((state) => {
    const record = state.topics[thread.threadId];
    if (!record) return undefined;
    mutate(record);
    record.updatedAt = new Date().toISOString();
    return record;
  });
}

async function ensureTopic() {
  const state = await store.get();
  const existing = state.topics[thread.threadId];
  if (existing?.topicId) {
    if (existing.title !== thread.title) {
      await transport.call('editForumTopic', {
        chat_id: effectiveChatId,
        message_thread_id: existing.topicId,
        name: topicName(thread.title),
      });
      await saveRecord((record) => {
        record.title = thread.title;
      });
    }
    return existing;
  }

  const created = await transport.call('createForumTopic', {
    chat_id: effectiveChatId,
    name: topicName(thread.title),
  });
  const record = {
    threadId: thread.threadId,
    chatId: effectiveChatId,
    topicId: created.message_thread_id,
    title: thread.title,
    project: thread.project ?? '',
    attention: thread.attention,
    pointCount: 0,
    sourceMessageIds: [],
    parts: [],
    updatedAt: new Date().toISOString(),
  };
  await store.update((state) => {
    state.topics[thread.threadId] = { ...record };
  });
  return record;
}

async function ensureHeader(record) {
  const text = headerText(thread.attention, deck.points.length);
  const keyboard = {
    inline_keyboard: [
      [{ text: 'Agree all & continue', callback_data: `agree:${thread.threadId}` }],
    ],
  };

  if (record.headerMessageId === undefined) {
    const sent = await transport.call('sendMessage', {
      chat_id: effectiveChatId,
      message_thread_id: record.topicId,
      text,
      reply_markup: keyboard,
    });
    await saveRecord((next) => {
      next.headerMessageId = sent.message_id;
      next.headerText = text;
      next.attention = thread.attention;
      next.pointCount = deck.points.length;
    });
    return { messageId: sent.message_id, text };
  }

  if (record.headerText !== text) {
    await transport.call('editMessageText', {
      chat_id: effectiveChatId,
      message_id: record.headerMessageId,
      text,
      reply_markup: keyboard,
    });
    await saveRecord((next) => {
      next.headerText = text;
      next.attention = thread.attention;
      next.pointCount = deck.points.length;
    });
  }
  return { messageId: record.headerMessageId, text };
}

async function ensurePlan(record) {
  if (record.sourceMessageId === source.sourceMessageId && record.parts.length > 0) {
    return record.parts;
  }
  const posted = [];
  for (const part of planParts) {
    const sent = await transport.call('sendMessage', {
      chat_id: effectiveChatId,
      message_thread_id: record.topicId,
      text: part.html,
      parse_mode: 'HTML',
      disable_notification: true,
      link_preview_options: { is_disabled: true },
    });
    posted.push({ messageId: sent.message_id, plain: part.plain });
    await store.update((state) => {
      const next = state.topics[thread.threadId];
      if (!next) return;
      next.parts = [...posted];
      next.sourceMessageIds = posted.map((entry) => entry.messageId);
      next.sourceMessageId = source.sourceMessageId;
      next.updatedAt = new Date().toISOString();
    });
  }
  return posted;
}

async function postQuote(topicId, targetMessageId, quote, text, fallbackMessageId) {
  try {
    const sent = await transport.call('sendMessage', {
      chat_id: effectiveChatId,
      message_thread_id: topicId,
      text,
      reply_parameters: {
        message_id: targetMessageId,
        quote,
        allow_sending_without_reply: true,
      },
    });
    return { messageId: sent.message_id, mode: 'quote' };
  } catch (error) {
    // Same fallback as the notifier: a quote that Telegram refuses still gets posted.
    if (error instanceof TelegramApiError && error.code === 400 && /quote/i.test(error.description)) {
      const sent = await transport.call('sendMessage', {
        chat_id: effectiveChatId,
        message_thread_id: topicId,
        text,
        reply_parameters: {
          message_id: fallbackMessageId ?? targetMessageId,
          allow_sending_without_reply: true,
        },
      });
      return { messageId: sent.message_id, mode: 'plain-reply' };
    }
    throw error;
  }
}

async function main() {
  console.log(
    dryRun
      ? 'DRY RUN: nothing is sent to Telegram. Links below are fake and only show the order.'
      : 'LIVE RUN: posting to Telegram now.',
  );
  console.log(`Thread: ${thread.title} (${thread.threadId}), ${deck.points.length} points`);
  console.log(`Data:   ${dataDir}`);
  console.log('');

  const topic = await ensureTopic();

  const header = await ensureHeader(topic);
  addLink(`Topic "${topicName(thread.title)}"`, topic.topicId);
  addLink(`Header: ${header.text}`, header.messageId, topic.topicId);

  const parts = await ensurePlan(topic);
  parts.forEach((part, index) => {
    addLink(`Plan text ${index + 1}/${parts.length}`, part.messageId, topic.topicId);
  });

  const reviewChunks = splitPlainText(composed.message.trim());
  const reviewIds = [];
  for (let index = 0; index < reviewChunks.length; index += 1) {
    const chunk = reviewChunks[index];
    const sent =
      index === 0
        ? await transport.call('sendMessage', {
            chat_id: effectiveChatId,
            message_thread_id: topic.topicId,
            text: chunk,
            reply_parameters: {
              message_id: header.messageId,
              allow_sending_without_reply: true,
            },
          })
        : await transport.call('sendMessage', {
            chat_id: effectiveChatId,
            message_thread_id: topic.topicId,
            text: chunk,
          });
    reviewIds.push(sent.message_id);
  }
  await saveRecord((next) => {
    next.reviewMessageId = reviewIds[0];
  });
  reviewIds.forEach((messageId, index) => {
    addLink(
      reviewIds.length === 1 ? 'Composed review' : `Composed review ${index + 1}/${reviewIds.length}`,
      messageId,
      topic.topicId,
    );
  });

  const quoteResults = [];
  for (const note of draft.notes) {
    const point = deck.points.find((candidate) => candidate.id === note.pointId);
    if (!point) continue;
    const match = findQuoteMatch(parts, point.quote);
    const target = match ? parts[match.partIndex] : undefined;
    const text = reviewLine(point, note);
    let result;
    if (match && target) {
      result = await postQuote(topic.topicId, target.messageId, match.quote, text, header.messageId);
    } else {
      const sent = await transport.call('sendMessage', {
        chat_id: effectiveChatId,
        message_thread_id: topic.topicId,
        text,
        reply_parameters: {
          message_id: header.messageId,
          allow_sending_without_reply: true,
        },
      });
      result = { messageId: sent.message_id, mode: 'plain-reply' };
    }
    quoteResults.push({ point, text, ...result });
    addLink(`Quote-reply on point ${point.index}`, result.messageId, topic.topicId);
  }

  const readText = pointReplyText(point4);
  const readMatch = findQuoteMatch(parts, point4.quote);
  const readTarget = readMatch ? parts[readMatch.partIndex] : undefined;
  const readResult =
    readMatch && readTarget
      ? await postQuote(topic.topicId, readTarget.messageId, readMatch.quote, readText, header.messageId)
      : { messageId: header.messageId, mode: 'plain-reply' };
  addLink('Read-on-phone marker for point 4', readResult.messageId, topic.topicId);

  console.log('Posted, in order:');
  links.forEach((entry, index) => {
    console.log(`${String(index + 1).padStart(2)}. ${entry.label}`);
    console.log(`    ${entry.url}`);
  });

  console.log('');
  console.log('Review text:');
  composed.message.split('\n').forEach((line) => console.log(`  ${line}`));
  console.log('');
  console.log('Quote-replies:');
  for (const entry of quoteResults) {
    const verdict = entry.mode === 'quote' ? 'exact quote' : 'plain reply (quote refused)';
    console.log(`  point ${entry.point.index}: ${verdict}`);
  }
  if (quoteResults.some((entry) => entry.mode !== 'quote')) {
    console.log('One or more quote-replies fell back to a plain reply. Check the plan text above.');
  }

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
  process.exit(1);
}
