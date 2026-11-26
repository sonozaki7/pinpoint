import type { Note } from "../../../../shared/contract";
import type { SimThread } from "./datasets/types";
import type { ThreadHistory } from "./backend";

export interface PanelView {
  thread: SimThread | null;
  isReply: boolean;
  notes: Note[];
  history: ThreadHistory;
}

function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function noteLabel(note: Note): string {
  if (note.verdict === "object") return "Correction";
  if (note.verdict === "answer") return "Answer";
  return "Note";
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

/**
 * Two plain-language panels beside the lens. No third-party UI imitation:
 * the app is named in text, and the layout is ours.
 */
export class SidePanels {
  private readonly agentBody: HTMLElement;
  private readonly deskBody: HTMLElement;
  private readonly agentLabel: HTMLElement;
  private readonly deskLabel: HTMLElement;
  private signature = "";

  constructor() {
    this.agentBody = document.querySelector<HTMLElement>("#agent-panel-body")!;
    this.deskBody = document.querySelector<HTMLElement>("#desk-panel-body")!;
    this.agentLabel = document.querySelector<HTMLElement>("#agent-panel-label")!;
    this.deskLabel = document.querySelector<HTMLElement>("#desk-panel-label")!;
  }

  render(view: PanelView): void {
    const signature = JSON.stringify({
      id: view.thread?.threadId ?? "",
      reply: view.isReply,
      notes: view.notes,
      sent: view.history.sent?.message ?? "",
      agentReply: view.history.reply ?? "",
    });
    if (signature === this.signature) return;
    this.signature = signature;
    this.renderAgent(view);
    this.renderDesk(view);
  }

  private empty(target: HTMLElement, title: string, body: string): void {
    const wrap = h("div", "panel-empty");
    wrap.append(h("b", undefined, title), document.createTextNode(body));
    target.replaceChildren(wrap);
  }

  private renderAgent(view: PanelView): void {
    const { thread } = view;
    this.agentLabel.textContent = thread
      ? `${thread.panel.agent} · ${thread.panel.agentRole}`
      : "T3 Code · sample";
    if (!thread) {
      this.empty(
        this.agentBody,
        "No thread open.",
        "Scroll to login-fix in the simulator, then tap. Your agent’s plan appears here, then your review, then its reply.",
      );
      return;
    }

    const fragment = document.createDocumentFragment();
    const label = thread.deck.attention === "question"
      ? `One decision · ${thread.deck.points.length} points`
      : thread.deck.attention === "plan"
        ? `Proposed plan · ${thread.deck.points.length} steps`
        : `Agent message · ${thread.deck.points.length} points`;
    fragment.append(h("p", "plan-label", label), h("p", "plan-context", thread.panel.context));

    const list = h("ol", "agent-plan");
    for (const point of thread.deck.points) {
      const item = h("li");
      item.append(h("span", "n", String(point.index)), h("span", "g", point.glance));
      list.append(item);
    }
    fragment.append(list);

    const { history } = view;
    if (history.sent) {
      const msg = h("div", "msg msg-user");
      const head = h("div", "msg-head");
      head.append(h("strong", undefined, "You · via Pinpoint"), h("span", undefined, "sent"));
      msg.append(head, h("pre", "msg-review", history.sent.message));
      fragment.append(msg);
    }
    if (history.sent && !history.reply) {
      const typing = h("div", "typing");
      typing.append(h("i"), h("i"), h("i"), document.createTextNode("Agent is reading your review"));
      fragment.append(typing);
    }
    if (history.reply) {
      const msg = h("div", "msg msg-agent");
      const head = h("div", "msg-head");
      head.append(h("strong", undefined, thread.panel.agent), h("span", undefined, "reply"));
      msg.append(head, h("p", "msg-body", history.reply));
      fragment.append(msg);
    }
    if (view.isReply) {
      const note = h("p", "plan-label");
      note.style.marginTop = "10px";
      note.textContent = "This thread is now the agent’s reply.";
      fragment.append(note);
    }
    this.agentBody.replaceChildren(fragment);
    this.agentBody.scrollTop = this.agentBody.scrollHeight;
  }

  private renderDesk(view: PanelView): void {
    const { thread } = view;
    this.deskLabel.textContent = thread ? thread.panel.desk : "private sample desk";
    if (!thread) {
      this.empty(
        this.deskBody,
        "The full text lives here.",
        "Pinpoint Desk keeps every point and attaches your note to the exact sentence it answers.",
      );
      return;
    }

    const fragment = document.createDocumentFragment();
    const card = h("div", "desk-card");
    const head = h("div", "desk-card-head");
    const title = h("b", undefined, thread.title);
    const meta = thread.deck.attention === "question"
      ? "question"
      : thread.deck.attention === "plan"
        ? `plan · ${plural(thread.deck.points.length, "step")}`
        : `${thread.deck.points.length} points`;
    head.append(title, h("span", undefined, meta));
    card.append(head);

    const points = h("ol", "desk-points");
    let focusNote: HTMLElement | null = null;
    for (const point of thread.deck.points) {
      const item = h("li", "desk-point");
      const top = h("div", "desk-point-top");
      top.append(h("span", "desk-num", String(point.index)), h("span", "desk-glance", point.glance));
      item.append(top, h("p", "desk-quote", `“${point.quote}”`));
      const note = view.notes.find((entry) => entry.pointId === point.id);
      if (note) {
        const bubble = h("div", "desk-note");
        bubble.append(h("small", undefined, noteLabel(note)));
        bubble.append(document.createTextNode(note.option ?? note.text ?? "Noted."));
        if (note.after) {
          bubble.append(h("span", "desk-note-after", `Now: ${note.after}`));
        }
        item.append(bubble);
        focusNote = bubble;
      }
      points.append(item);
    }
    card.append(points);

    const { history } = view;
    const status = h("p", "desk-status");
    if (history.sent) {
      const counts = history.sent.counts;
      const changes = counts.objections + counts.answers + counts.notes;
      status.classList.add("is-sent");
      status.append(
        document.createTextNode(
          `Sent to the agent: ${plural(changes, "change")}, ${counts.agreed} agreed.`,
        ),
      );
      if (history.reply) status.append(document.createElement("br"), document.createTextNode("Agent replied."));
    } else if (view.notes.length > 0) {
      const agreed = thread.deck.points.length - view.notes.length;
      status.textContent = `Draft: ${plural(view.notes.length, "change")}, ${agreed} agreed. Silence still agrees with the rest.`;
    } else {
      status.textContent = `No notes yet. Silence agrees with all ${thread.deck.points.length} points.`;
    }
    card.append(status);
    fragment.append(card);
    this.deskBody.replaceChildren(fragment);

    // Keep the live part in view: the sent summary when there is one, else the
    // first note the user just attached.
    const target = history.sent ? status : focusNote;
    if (target) {
      const bodyRect = this.deskBody.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();
      const delta = targetRect.top - bodyRect.top;
      if (targetRect.bottom > bodyRect.bottom || delta < 0) {
        this.deskBody.scrollTop += delta - 52;
      }
    }
  }
}
