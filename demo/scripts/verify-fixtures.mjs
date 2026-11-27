#!/usr/bin/env node
// Verifies demo/fixtures/*.json against shared/contract.ts and SPEC §7/§12:
// every quote must be an exact substring of the source text, glances must fit
// one 44-character ASCII line, questions need 2-4 short options.
//
// Usage: node demo/scripts/verify-fixtures.mjs [--dir demo/fixtures] [--quiet]

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../..");

const args = process.argv.slice(2);
const argValue = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const quiet = args.includes("--quiet");
const customDir = args.includes("--dir");
const dir = resolve(repo, argValue("--dir", "demo/fixtures"));
// Sample-only threads (cloud "Since you looked" targets) are checked with the same rules.
const sampleThreadsDir = resolve(repo, "demo/sample/threads");

const MAX_GLANCE = 44;
const MAX_OPTION = 24;
const MAX_QUOTE = 200;
const MIN_WORDS = 250;
const MIN_WORDS_NOTION = 100;
const MIN_WORDS_SAMPLE = 40;
const MAX_WHY = 60;
const MAX_WORDS = 700;
const ATTENTION = new Set(["question", "plan", "failed", "report"]);
const KINDS = new Set(["step", "claim", "question", "risk", "draft"]);
const SOURCE_KINDS = new Set(["plan", "reply", "question"]);
const APPS = new Set(["t3", "notion", "gmail", "telegram", "slack", "discord"]);

const errors = [];
const notes = [];
let checks = 0;

const fail = (where, message) => errors.push(`${where}: ${message}`);
const ok = () => { checks += 1; };

const isAscii = (text) => /^[\x20-\x7e]+$/.test(text);
const words = (text) => text.trim().split(/\s+/).filter(Boolean).length;

function check(where, condition, message) {
  if (condition) ok();
  else fail(where, message);
  return condition;
}

function checkGlance(where, value) {
  if (!check(where, typeof value === "string" && value.length > 0, "glance missing")) return;
  check(where, value.length <= MAX_GLANCE, `glance is ${value.length} chars (max ${MAX_GLANCE}): "${value}"`);
  check(where, isAscii(value), `glance is not plain ASCII: "${value}"`);
}

function checkOptions(where, options) {
  if (!check(where, Array.isArray(options), "options missing for a question point")) return;
  check(where, options.length >= 2 && options.length <= 4, `has ${options?.length} options (expected 2-4)`);
  for (const option of options ?? []) {
    check(where, typeof option === "string" && option.length > 0 && option.length <= MAX_OPTION,
      `option "${option}" is ${option?.length} chars (max ${MAX_OPTION})`);
    check(where, isAscii(option), `option is not plain ASCII: "${option}"`);
  }
}

const listFiles = (folder, sample) =>
  readdirSync(folder)
    .filter((name) => name.endsWith(".json"))
    .filter((name) => name !== "transcripts.json") // scripted voice notes, not a thread fixture
    .sort()
    .map((name) => ({ path: join(folder, name), sample }))
    .filter((entry) => statSync(entry.path).isFile());

const files = [
  ...listFiles(dir, false),
  ...(!customDir && existsSync(sampleThreadsDir) ? listFiles(sampleThreadsDir, true) : []),
];
const threadsById = new Map(); // threadId -> { thread, source, deck }

if (files.length === 0) {
  console.error(`no fixtures in ${dir}`);
  process.exit(1);
}

const seenThreads = new Set();
const seenSources = new Set();

for (const { path, sample: sampleOnly } of files) {
  const label = relative(repo, path);
  let fixture;
  try {
    fixture = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    fail(label, `invalid JSON: ${error.message}`);
    continue;
  }

  const { thread, source, deck } = fixture;
  if (!check(`${label} thread`, thread && typeof thread === "object", "missing thread object")) continue;
  if (!check(`${label} source`, source && typeof source === "object", "missing source object")) continue;
  if (!check(`${label} deck`, deck && typeof deck === "object", "missing deck object")) continue;

  // thread
  check(`${label} thread`, typeof thread.threadId === "string" && thread.threadId.length > 0, "threadId missing");
  check(`${label} thread`, path.endsWith(`${thread.threadId}.json`), `file name should be <threadId>.json (${thread.threadId})`);
  check(`${label} thread`, !seenThreads.has(thread.threadId), `duplicate threadId ${thread.threadId}`);
  seenThreads.add(thread.threadId);
  check(`${label} thread`, typeof thread.title === "string" && thread.title.length > 0, "title missing");
  check(`${label} thread`, typeof thread.project === "string" && thread.project.length > 0, "project missing");
  check(`${label} thread`, ATTENTION.has(thread.attention), `attention "${thread.attention}" not in ${[...ATTENTION].join("|")}`);
  check(`${label} thread`, !Number.isNaN(Date.parse(thread.updatedAt ?? "")), `updatedAt not a date: ${thread.updatedAt}`);
  if (thread.app !== undefined) {
    check(`${label} thread`, APPS.has(thread.app), `app "${thread.app}" not in ${[...APPS].join("|")}`);
  }

  // source
  check(`${label} source`, typeof source.sourceMessageId === "string" && source.sourceMessageId.length > 0, "sourceMessageId missing");
  check(`${label} source`, !seenSources.has(source.sourceMessageId), `duplicate sourceMessageId ${source.sourceMessageId}`);
  seenSources.add(source.sourceMessageId);
  check(`${label} source`, SOURCE_KINDS.has(source.kind), `kind "${source.kind}" not in ${[...SOURCE_KINDS].join("|")}`);
  const text = typeof source.text === "string" ? source.text : "";
  if (check(`${label} source`, text.length > 0, "text missing")) {
    const count = words(text);
    // A Gmail draft is short by design: one point per sentence, not a long report.
    const minWords = sampleOnly ? MIN_WORDS_SAMPLE : thread.app === "gmail" ? 60 : thread.app === "notion" ? MIN_WORDS_NOTION : MIN_WORDS;
    check(`${label} source`, count >= minWords && count <= MAX_WORDS, `text is ${count} words (expected ${minWords}-${MAX_WORDS})`);
  }
  if (source.kind === "question") {
    const question = source.question;
    if (check(`${label} source`, question && typeof question === "object", "question kind needs source.question")) {
      check(`${label} source`, typeof question.requestId === "string" && question.requestId.length > 0, "question.requestId missing");
      check(`${label} source`, Array.isArray(question.questions) && question.questions.length > 0, "question.questions missing");
      for (const [i, q] of (question.questions ?? []).entries()) {
        const qw = `${label} question[${i}]`;
        check(qw, typeof q?.id === "string" && q.id.length > 0, "id missing");
        check(qw, typeof q?.question === "string" && q.question.length > 0, "question text missing");
        checkOptions(qw, q?.options);
        check(qw, text.includes(q?.question ?? "\u0000"), `question text is not a quote from source.text: "${q?.question}"`);
      }
    }
  } else {
    check(`${label} source`, source.question === undefined, `question block on a non-question source (kind ${source.kind})`);
  }

  threadsById.set(thread.threadId, { thread, source, deck });

  // deck
  check(`${label} deck`, deck.threadId === thread.threadId, `deck.threadId ${deck.threadId} != thread.threadId ${thread.threadId}`);
  check(`${label} deck`, deck.sourceMessageId === source.sourceMessageId, "deck.sourceMessageId does not match source");
  check(`${label} deck`, deck.attention === thread.attention, "deck.attention does not match thread");
  check(`${label} deck`, deck.title === thread.title, "deck.title does not match thread.title");
  check(`${label} deck`, deck.points.length >= 4 && deck.points.length <= 10, `has ${deck.points.length} points (expected 4-10)`);
  const headline = typeof deck.headline === "string" ? deck.headline : "";
  check(`${label} deck`, headline.length > 0 && headline.length <= MAX_GLANCE, `headline is ${headline.length} chars (max ${MAX_GLANCE})`);
  check(`${label} deck`, isAscii(headline), `headline is not plain ASCII: "${headline}"`);
  check(`${label} deck`, typeof deck.splitter === "string" && deck.splitter.length > 0, "splitter missing");
  check(`${label} deck`, !Number.isNaN(Date.parse(deck.createdAt ?? "")), `createdAt not a date: ${deck.createdAt}`);

  for (const [i, point] of deck.points.entries()) {
    const where = `${label} p${i + 1}`;
    check(where, typeof point?.id === "string" && point.id.length > 0, "id missing");
    check(where, point?.index === i + 1, `index is ${point?.index}, expected ${i + 1} (1-based, in order)`);
    check(where, point?.id === `p${i + 1}`, `id "${point?.id}" should be p${i + 1} to match index`);
    check(where, KINDS.has(point?.kind), `kind "${point?.kind}" not in ${[...KINDS].join("|")}`);
    checkGlance(where, point?.glance);

    const quote = typeof point?.quote === "string" ? point.quote : "";
    if (check(where, quote.length > 0, "quote missing")) {
      check(where, text.includes(quote), `quote is not an exact substring of source.text: "${quote.slice(0, 60)}..."`);
      check(where, quote.length <= MAX_QUOTE, `quote is ${quote.length} chars (max ${MAX_QUOTE})`);
    }

    if (point?.flag !== undefined) {
      check(where, typeof point.flag === "string" && point.flag.length > 0 && point.flag.length <= 24,
        `flag is ${String(point.flag).length} chars (max 24): "${point.flag}"`);
      check(where, isAscii(point.flag), `flag is not plain ASCII: "${point.flag}"`);
    }

    if (point?.why !== undefined) {
      check(where, point.flag !== undefined, "why without a flag");
      check(where, typeof point.why === "string" && point.why.length > 0 && point.why.length <= MAX_WHY,
        `why is ${String(point.why).length} chars (max ${MAX_WHY}): "${point.why}"`);
      check(where, isAscii(String(point.why)), `why is not plain ASCII: "${point.why}"`);
      // Grounded: every number in the why appears in the source, a linked note or is a named heuristic.
      const evidence = [text, ...(source.evidence?.notes ?? []).map((n) => `${n.title} ${n.text}`)].join("\n");
      for (const number of String(point.why).match(/\d[\d,.]*/g) ?? []) {
        check(where, evidence.includes(number.replace(/[,.]$/, "")), `why mentions "${number}", which is nowhere in the source or its notes`);
      }
    }
    if (point?.flag !== undefined) {
      check(where, point.why !== undefined, `flag "${point.flag}" has no why (a flag needs grounded evidence)`);
    }

    if (point?.kind === "question") {
      checkOptions(where, point.options);
      const ids = new Set((source.question?.questions ?? []).map((q) => q.id));
      check(where, typeof point.questionId === "string" && ids.has(point.questionId),
        `questionId "${point.questionId}" does not match a source question id`);
    } else {
      check(where, point?.options === undefined, "options on a non-question point");
    }

    if (point?.kind === "risk") {
      check(where, point?.risk === "low" || point?.risk === "high", `risk point needs risk low|high, got "${point?.risk}"`);
    } else {
      check(where, point?.risk === undefined, "risk flag on a non-risk point");
    }
  }

  const highs = deck.points.filter((p) => p.risk === "high").length;
  const drafts = deck.points.filter((p) => p.kind === "draft").length;
  const questions = deck.points.filter((p) => p.kind === "question").length;
  notes.push(`${relative(repo, path)}: ${deck.points.length} points${highs ? `, ${highs} high risk` : ""}${questions ? `, ${questions} question` : ""}${drafts ? `, ${drafts} drafts` : ""}`);
}

// --- Pinpoint Cloud sample: personas, catch-up lines, transcripts ---------------------------------
if (!customDir) {
  const sampleDir = resolve(repo, "demo/sample");
  const readJson = (file) => {
    try {
      return JSON.parse(readFileSync(file, "utf8"));
    } catch (error) {
      fail(relative(repo, file), `invalid JSON: ${error.message}`);
      return null;
    }
  };
  const workspace = readJson(join(sampleDir, "workspace.json"));
  const catchUp = readJson(join(sampleDir, "catch-up.json"));
  const transcripts = readJson(join(dir, "transcripts.json"));
  const PERSONAS = ["mixed", "developer", "everyday"];
  const EXPECTED = {
    developer: ["login-fix", "payment-upgrade", "launch-post", "draft-priya"],
    everyday: ["saturday-plan", "flight-price", "landlord-reply", "school-newsletter"],
    mixed: ["login-fix", "saturday-plan", "flight-price", "landlord-reply", "launch-post"],
  };
  const sampleThreadIds = new Set();
  if (workspace) {
    for (const persona of PERSONAS) {
      const ids = workspace.personas?.[persona];
      if (!check(`workspace.json ${persona}`, Array.isArray(ids) && ids.length > 0, "persona missing")) continue;
      check(`workspace.json ${persona}`, JSON.stringify(ids) === JSON.stringify(EXPECTED[persona]),
        `expected ${EXPECTED[persona].join(", ")} but found ${ids.join(", ")}`);
      for (const id of ids) {
        sampleThreadIds.add(id);
        check(`workspace.json ${persona}`, threadsById.has(id), `thread "${id}" has no fixture`);
      }
      const status = workspace.status?.[persona];
      check(`workspace.json ${persona}`, Number.isInteger(status?.working) && Number.isInteger(status?.doneToday), "status needs integer working and doneToday");
    }
  }
  if (catchUp) {
    for (const persona of PERSONAS) {
      const entries = catchUp[persona];
      if (!check(`catch-up.json ${persona}`, Array.isArray(entries) && entries.length >= 3, "needs at least 3 lines")) continue;
      for (const [i, entry] of entries.entries()) {
        const where = `catch-up.json ${persona}[${i}]`;
        checkGlance(where, entry.line);
        check(where, threadsById.has(entry.threadRef), `threadRef "${entry.threadRef}" has no fixture`);
        check(where, String(entry.line).startsWith(`${entry.threadRef}:`), `line should start with "${entry.threadRef}:"`);
        sampleThreadIds.add(entry.threadRef);
      }
    }
  }
  if (transcripts) {
    const have = new Set();
    for (const [i, note] of (transcripts.notes ?? []).entries()) {
      const where = `transcripts.json note ${i + 1}`;
      const found = threadsById.get(note.threadId);
      if (!check(where, found !== undefined, `thread "${note.threadId}" has no fixture`)) continue;
      check(where, found.deck.points.some((p) => p.id === note.pointId), `point ${note.pointId} is not in ${note.threadId}`);
      check(where, typeof note.text === "string" && note.text.trim().length > 0, "text missing");
      have.add(`${note.threadId}/${note.pointId}`);
    }
    // Every flagged line of the sample workspace has a scripted spoken note.
    for (const id of sampleThreadIds) {
      for (const point of threadsById.get(id)?.deck.points ?? []) {
        if (point.flag !== undefined) {
          check(`transcripts.json ${id}/${point.id}`, have.has(`${id}/${point.id}`), "flagged sample line has no transcript");
        }
      }
    }
  }
}

if (!quiet) {
  for (const note of notes) console.log(`  ${note}`);
}

const totalPoints = notes.reduce((sum, line) => sum + Number(line.match(/: (\d+) points/)?.[1] ?? 0), 0);

if (errors.length > 0) {
  console.error(`\n${errors.length} problem${errors.length === 1 ? "" : "s"}:`);
  for (const error of errors) console.error(`  - ${error}`);
  console.error(`\nFAIL ${files.length} fixtures, ${totalPoints} points, ${checks} checks`);
  process.exit(1);
}

console.log(`\nOK ${files.length} fixtures, ${totalPoints} points, ${checks} checks: quotes are exact substrings, glances fit 44 ASCII chars, options fit 24.`);
