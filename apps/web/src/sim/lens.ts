import type { PageModel } from "../../../glasses/src/display";

const WIDTH = 576;
const HEIGHT = 288;

/**
 * The simulated G2 panel. Everything it shows comes from `pageFor()` in the
 * glasses app: the same title, list, four point rows, quote pane and footer.
 */
export class G2Lens {
  private readonly viewport: HTMLElement;
  private readonly screen: HTMLElement;
  private readonly head: HTMLElement;
  private readonly list: HTMLOListElement;
  private readonly rows: HTMLElement;
  private readonly pane: HTMLElement;
  private readonly footer: HTMLElement;
  private readonly summary: HTMLElement;
  private frame = 0;

  constructor(root: HTMLElement) {
    this.viewport = root.querySelector<HTMLElement>("[data-g2-viewport]")!;
    this.screen = root.querySelector<HTMLElement>("[data-g2-screen]")!;
    this.head = root.querySelector<HTMLElement>("[data-g2-head]")!;
    this.list = root.querySelector<HTMLOListElement>("[data-g2-list]")!;
    this.rows = root.querySelector<HTMLElement>("[data-g2-rows]")!;
    this.pane = root.querySelector<HTMLElement>("[data-g2-pane]")!;
    this.footer = root.querySelector<HTMLElement>("[data-g2-footer]")!;
    this.summary = root.querySelector<HTMLElement>("[data-g2-summary]")!;
    this.fit();
    if (typeof ResizeObserver === "function") {
      new ResizeObserver(() => this.fit()).observe(this.viewport);
    } else {
      window.addEventListener("resize", () => this.fit());
    }
  }

  private fit(): void {
    const width = this.viewport.clientWidth;
    if (width <= 0) return;
    const scale = width / WIDTH;
    this.screen.style.transform = `scale(${scale})`;
    this.viewport.style.height = `${HEIGHT * scale}px`;
    cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(() => this.viewport.classList.add("is-ready"));
  }

  render(page: PageModel): void {
    this.head.textContent = page.subtitle ? `${page.title}\n${page.subtitle}` : page.title;
    this.list.replaceChildren();
    this.list.hidden = !page.list;
    for (const [index, text] of (page.list ?? []).entries()) {
      const item = document.createElement("li");
      item.textContent = text;
      item.className = index === page.listFocus ? "is-focus" : "";
      this.list.append(item);
    }

    this.rows.replaceChildren();
    this.rows.hidden = page.rows.length === 0;
    for (const row of page.rows) {
      const node = document.createElement("div");
      node.className = "g2-row";
      node.dataset.brightness = String(row.brightness);
      // The G2 pads a closing word with real spaces measured in firmware pixels.
      // In a browser font those spaces overflow, so the closing word becomes a
      // right-aligned label while the words themselves stay untouched.
      const leading = row.text.match(/^ */)?.[0] ?? "";
      const rest = row.text.slice(leading.length);
      const split = /^(.+?)( {2,})(\S.*)$/.exec(rest);
      if (split) {
        const body = document.createElement("span");
        body.className = "row-body";
        body.textContent = `${leading}${split[1] ?? ""}`;
        const label = document.createElement("span");
        label.className = "row-label";
        label.textContent = split[3] ?? "";
        node.append(body, label);
      } else {
        node.textContent = row.text;
      }
      this.rows.append(node);
    }

    const pane = page.pane ?? page.message ?? "";
    this.pane.hidden = pane.length === 0;
    this.pane.textContent = pane;
    this.footer.textContent = page.footer;

    const spoken = [
      page.title,
      page.list ? page.list.map((line, index) => (index === page.listFocus ? `Selected: ${line}` : line)).join(". ") : "",
      page.rows.map((row) => row.text.replace(/^>\s*/, "Selected: ").trim()).join(". "),
      pane,
      page.footer,
    ].filter(Boolean).join(". ");
    this.summary.textContent = spoken;
  }
}
