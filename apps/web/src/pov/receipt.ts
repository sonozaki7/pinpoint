import type { AppId } from "../../../../shared/contract";

export interface SentNote {
  quote: string;
  text: string;
  after?: string;
  verdict: "object" | "note" | "answer";
}

export interface SentReview {
  kind: "review";
  threadId: string;
  app: AppId;
  title: string;
  destination: string;
  /** The exact message the agent received (composed by the app). */
  review: string;
  notes: SentNote[];
  reply?: string;
  taps: number;
  sentences: number;
}

export interface SentTask {
  kind: "task";
  destination: string;
  request: string;
  agent: string;
  result?: string;
  taps: number;
  sentences: number;
}

export type Sent = SentReview | SentTask;

function block(label: string, className: string, text: string): HTMLElement {
  const section = document.createElement("section");
  section.className = "receipt-block";
  const heading = document.createElement("p");
  heading.className = "receipt-label";
  heading.textContent = label;
  const body = document.createElement("p");
  body.className = className;
  body.textContent = text;
  section.append(heading, body);
  return section;
}

function waiting(label: string, text: string): HTMLElement {
  const section = block(label, "receipt-wait", text);
  return section;
}

function status(text: string): HTMLElement {
  const line = document.createElement("p");
  line.className = "receipt-status";
  line.textContent = text;
  return line;
}

export function destinationFor(app: AppId, to: string | undefined): string {
  if (app === "notion") return "Notion";
  if (app === "gmail") return to ? `Gmail · ${to}` : "Gmail";
  return "your coding agent";
}

export function tallyLine(sent: Sent): string {
  const parts: string[] = [];
  if (sent.taps > 0) parts.push(`${sent.taps} tap${sent.taps === 1 ? "" : "s"}`);
  if (sent.sentences > 0) parts.push(`${sent.sentences} sentence${sent.sentences === 1 ? "" : "s"}`);
  else if (sent.kind === "review" && sent.notes.some((note) => note.verdict === "answer")) parts.push("1 answer");
  else if (sent.kind === "review" && sent.notes.length === 0) parts.push("no changes");
  return parts.join(" · ");
}

/** One compact card that shows where the words landed, in the app they were meant for. */
export function renderReceipt(
  parts: { where: HTMLElement; title: HTMLElement; body: HTMLElement; foot: HTMLElement },
  sent: Sent,
): void {
  const { where, title, body, foot } = parts;
  body.replaceChildren();
  where.textContent = sent.destination;
  title.textContent = "Sent";

  if (sent.kind === "task") {
    body.append(block("You said", "receipt-quote", sent.request));
    body.append(block("Started in", "receipt-copy", sent.agent));
    body.append(
      sent.result
        ? block("A few seconds later", "receipt-copy", sent.result)
        : waiting("A few seconds later", "Working on it…"),
    );
    foot.textContent = "Sample · a made-up result, to show the loop.";
    return;
  }

  if (sent.app === "t3") {
    body.append(block("The agent received", "receipt-copy receipt-mono", sent.review || "Review sent."));
    body.append(
      sent.reply
        ? block("It replied", "receipt-copy", sent.reply)
        : waiting("It replied", "Reading the change…"),
    );
    foot.textContent = "Sample workspace · this exact message is composed by the app.";
    return;
  }

  if (sent.app === "notion") {
    if (sent.notes.length === 0) body.append(block("The page", "receipt-copy", "Approved with no comments."));
    for (const note of sent.notes) {
      body.append(block("On this paragraph", "receipt-quote", note.quote));
      if (note.text) body.append(block("Your comment", "receipt-copy", note.text));
    }
    body.append(status("Posted to Notion"));
    foot.textContent = "Sample page · the comment attaches to that block.";
    return;
  }

  if (sent.notes.length === 0) body.append(block("The draft", "receipt-copy", "Sent as written."));
  for (const note of sent.notes) {
    body.append(block("Was", "receipt-old", note.quote));
    body.append(block("Now", "receipt-new", note.after ?? "Line removed"));
  }
  body.append(status("Sent"));
  foot.textContent = "Sample draft · only that one sentence changed.";
}

/** The agent's sample reply, built only from what was sent. */
export function sampleReply(review: SentReview): string {
  const first = review.notes[0];
  if (!first) return "Thanks. Continuing with the plan as written.";
  const said = (first.text || "").replace(/[.!?]+$/, "").trim();
  if (first.verdict === "answer") return `Thanks. I'll go with “${said}” and keep going.`;
  const lead = said ? said.charAt(0).toLowerCase() + said.slice(1) : "make that change";
  return `Thanks. I'll ${lead}, then re-check the steps that depend on it.`;
}

/** What a started task comes back with, a few seconds later (sample). */
export function sampleResult(request: string): string {
  if (/dentist/i.test(request)) {
    return "Found 3 dentists open Saturday morning. It will ask you which one: one tap to choose.";
  }
  if (/(fix|bug|test|deploy|build|code|merge|ci)\b/i.test(request)) {
    return "Opened a branch, made the change, and the tests pass. A short summary is waiting for your review.";
  }
  return "Done. A short summary is waiting for you, and it will show up here when it needs a decision.";
}
