#!/usr/bin/env node
// Verifies demo/fixtures/*.json against shared/contract.ts and SPEC §7/§12:
// every quote must be an exact substring of the source text, glances must fit
// one 44-character ASCII line, questions need 2-4 short options.
//
// Usage: node demo/scripts/verify-fixtures.mjs [--dir demo/fixtures] [--quiet]

import { readFileSync, readdirSync, statSync } from "node:fs";
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
const dir = resolve(repo, argValue("--dir", "demo/fixtures"));

const MAX_GLANCE = 44;
const MAX_OPTION = 24;
const MAX_QUOTE = 200;
const MIN_WORDS = 250;
const MAX_WORDS = 700;
const ATTENTION = new Set(["question", "plan", "failed", "report"]);
const KINDS = new Set(["step", "claim", "question", "risk", "draft"]);
const SOURCE_KINDS = new Set(["plan", "reply", "question"]);

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

const files = readdirSync(dir)
  .filter((name) => name.endsWith(".json"))
  .sort()
  .map((name) => join(dir, name))
  .filter((path) => statSync(path).isFile());

if (files.length === 0) {
  console.error(`no fixtures in ${dir}`);
  process.exit(1);
}

const seenThreads = new Set();
const seenSources = new Set();

for (const path of files) {
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

  // source
  check(`${label} source`, typeof source.sourceMessageId === "string" && source.sourceMessageId.length > 0, "sourceMessageId missing");
  check(`${label} source`, !seenSources.has(source.sourceMessageId), `duplicate sourceMessageId ${source.sourceMessageId}`);
  seenSources.add(source.sourceMessageId);
  check(`${label} source`, SOURCE_KINDS.has(source.kind), `kind "${source.kind}" not in ${[...SOURCE_KINDS].join("|")}`);
  const text = typeof source.text === "string" ? source.text : "";
  if (check(`${label} source`, text.length > 0, "text missing")) {
    const count = words(text);
    check(`${label} source`, count >= MIN_WORDS && count <= MAX_WORDS, `text is ${count} words (expected ${MIN_WORDS}-${MAX_WORDS})`);
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
