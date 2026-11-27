import type { PageModel } from "../../../glasses/src/display";

/** The G2 panel is 576 × 288, one green. Draw it at 2× for a crisp texture. */
const W = 576;
const H = 288;
const SCALE = 2;
const FONT = '"IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace';
const GREEN = "206, 255, 222";
const GREEN_DIM = "132, 214, 168";
const GREEN_FAINT = "96, 164, 126";

function fit(ctx: CanvasRenderingContext2D, text: string, max: number): string {
  if (ctx.measureText(text).width <= max) return text;
  let low = 0;
  let high = text.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (ctx.measureText(`${text.slice(0, mid).trimEnd()}…`).width <= max) low = mid;
    else high = mid - 1;
  }
  return `${text.slice(0, Math.max(0, low)).trimEnd()}…`;
}

/** Set the largest font size, from `from` down to `to`, at which `text` fits `max`; false if none does. */
function shrinkToFit(
  ctx: CanvasRenderingContext2D,
  text: string,
  weight: number,
  from: number,
  to: number,
  max: number,
): void {
  for (let size = from; size >= to; size -= 0.5) {
    ctx.font = `${weight} ${size}px ${FONT}`;
    if (ctx.measureText(text).width <= max) return;
  }
}

/**
 * The glasses wrap their own text to the G2 pixel width; on the big display a
 * greedy wrap can leave one orphan word on its own line. This keeps the same
 * words and balances the lines so a quote reads naturally at this size.
 */
function wrapBalanced(
  ctx: CanvasRenderingContext2D,
  text: string,
  max: number,
  maxLines: number,
): string[] {
  const words = text.split(" ").filter(Boolean);
  if (words.length === 0) return [];
  let natural = 1;
  let width = 0;
  for (const word of words) {
    const wordWidth = ctx.measureText(`${word} `).width;
    if (width > 0 && width + wordWidth > max) {
      natural++;
      width = wordWidth;
    } else {
      width += wordWidth;
    }
  }
  const count = Math.min(natural, maxLines);
  if (count <= 1) return [fit(ctx, text, max)];
  const target = Math.min(max, ctx.measureText(text).width / count + 8);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(candidate).width > target && lines.length < count - 1) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  while (lines.length > count) {
    const last = lines.pop() as string;
    lines[lines.length - 1] = `${lines[lines.length - 1]} ${last}`;
  }
  return lines.map((entry) => fit(ctx, entry, max));
}

/**
 * Paints the real `PageModel` the glasses app returns. The same canvas is the
 * hero's lens texture and the large display in first person, so what you see is
 * the app's own screen, not a mock-up.
 */
export class LensPainter {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private page: PageModel | null = null;
  private compact = false;
  private secondary = 13;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    canvas.width = W * SCALE;
    canvas.height = H * SCALE;
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) throw new Error("Canvas 2D is unavailable");
    this.ctx = ctx;
    this.ctx.scale(SCALE, SCALE);
  }

  get hasPage(): boolean {
    return this.page !== null;
  }

  draw(page: PageModel): void {
    this.page = page;
    // On a phone the whole 576-wide screen is squeezed into ~380 CSS px, so
    // the 12–13 px secondary lines would land near 8 px. Bump just those two
    // lines when the rendered panel is small; the desktop panel is unchanged.
    const cssWidth = this.canvas.getBoundingClientRect().width;
    this.compact = cssWidth > 0 && cssWidth < 500;
    // 19 units is ~11.5 CSS px at 348 px wide; on anything narrower (small
    // phones) raise it just enough to stay near 11 CSS px, capped at 21.
    this.secondary = this.compact
      ? Math.min(21, Math.max(19, (11 * W) / Math.max(cssWidth, 1)))
      : 13;
    const ctx = this.ctx;
    ctx.save();
    ctx.setTransform(SCALE, 0, 0, SCALE, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.textBaseline = "alphabetic";
    ctx.shadowColor = `rgba(${GREEN}, 0.48)`;
    ctx.shadowBlur = 6;

    this.drawHeader(page);

    let y = page.subtitle ? (this.compact ? 86 : 82) : 60;
    if (page.list && page.list.length > 0) {
      // Five rows fit; the window follows the cursor, as the native list does.
      const focus = page.listFocus ?? 0;
      const start = Math.min(Math.max(0, focus - 4), Math.max(0, page.list.length - 5));
      const rows = page.list.slice(start, start + 5);
      for (const [index, item] of rows.entries()) {
        this.drawListRow(item, start + index === focus, y);
        y += 31;
      }
    } else if (page.rows.length > 0) {
      for (const row of page.rows.slice(0, 4)) {
        this.drawPointRow(row.text, row.brightness, y);
        y += 34;
      }
    }

    const pane = page.pane ?? page.message ?? "";
    if (pane) {
      const top = page.rows.length > 0 || (page.list?.length ?? 0) > 0 ? y + 14 : 118;
      ctx.font = `400 18.5px ${FONT}`;
      ctx.fillStyle = `rgba(${GREEN}, 0.9)`;
      const lines = wrapBalanced(ctx, pane.replace(/\s+/g, " ").trim(), 532, top > 220 ? 2 : 3);
      for (const [index, line] of lines.entries()) {
        ctx.fillText(line, 22, top + index * 22);
      }
    }

    ctx.shadowBlur = 0;
    const footerSize = this.secondary;
    ctx.font = `400 ${footerSize}px ${FONT}`;
    ctx.fillStyle = `rgba(${GREEN_FAINT}, 0.92)`;
    ctx.fillText(fit(ctx, page.footer, 530), 22, this.compact ? 282 : 280);
    ctx.restore();
  }

  private drawHeader(page: PageModel): void {
    const ctx = this.ctx;
    shrinkToFit(ctx, page.title, 500, 21, 15.5, 532);
    ctx.fillStyle = `rgba(${GREEN}, 0.98)`;
    ctx.fillText(fit(ctx, page.title, 532), 22, 30);
    if (page.subtitle) {
      const size = this.compact ? this.secondary : 13;
      ctx.font = `400 ${size}px ${FONT}`;
      ctx.fillStyle = `rgba(${GREEN_DIM}, ${this.compact ? 0.9 : 0.82})`;
      ctx.fillText(fit(ctx, page.subtitle, 532), 22, this.compact ? 56 + Math.max(0, size - 19) : 51);
    }
  }

  private drawListRow(text: string, focused: boolean, y: number): void {
    const ctx = this.ctx;
    const maxRow = focused ? 496 : 514;
    shrinkToFit(ctx, text, focused ? 500 : 400, 20, 16, maxRow);
    const news = /^.{0,12}Since you looked/.test(text);
    if (focused) {
      ctx.fillStyle = `rgba(${GREEN}, 1)`;
      ctx.fillText("›", 20, y);
      ctx.shadowBlur = 10;
    }
    ctx.fillStyle = focused
      ? `rgba(${GREEN}, 0.99)`
      : news ? `rgba(${GREEN_FAINT}, 0.78)` : `rgba(${GREEN}, 0.8)`;
    ctx.fillText(fit(ctx, text, maxRow), focused ? 38 : 22, y);
    ctx.shadowBlur = 6;
  }

  /**
   * Review rows come in three tones, as on the glasses: the focused row is full
   * and glowing, a line that needs you (CHECK, CHANGE, a note) is bright, and
   * routine lines (+N routine · agreed) sit back, dim.
   */
  private drawPointRow(text: string, brightness: number, y: number): void {
    const ctx = this.ctx;
    const focused = brightness >= 4;
    const lead = text.replace(/^(?:> | {1,3})/, "");
    const match = /^(.*?\S)( {2,})(\S.*)$/.exec(lead);
    let body = match?.[1] ?? lead;
    const label = match?.[3] ?? "";
    const hasCursor = text.startsWith("> ");
    body = body.trimEnd();
    const needs = label.length > 0 && !/^(OPEN|SEND)$/.test(label);
    const routine = /^\+\d+ routine/.test(body);
    const tone = focused ? 1 : needs && !routine ? 0.94 : 0.5;
    const rgb = focused || (needs && !routine) ? GREEN : GREEN_DIM;

    ctx.font = `${focused ? 500 : 400} 19.5px ${FONT}`;
    let labelWidth = 0;
    if (label) {
      ctx.font = `${needs ? 500 : 400} 12px ${FONT}`;
      labelWidth = ctx.measureText(label).width + 18;
      ctx.fillStyle = `rgba(${needs ? GREEN : GREEN_FAINT}, ${focused || needs ? 0.98 : 0.8})`;
      ctx.fillText(label, 554 - ctx.measureText(label).width, y);
      ctx.font = `${focused ? 500 : 400} 19.5px ${FONT}`;
    }

    if (hasCursor) {
      ctx.fillStyle = `rgba(${GREEN}, 1)`;
      ctx.fillText("›", 20, y);
      ctx.shadowBlur = 10;
    }
    shrinkToFit(ctx, body, focused ? 500 : 400, 19.5, 16, 532 - labelWidth - 16);
    ctx.fillStyle = `rgba(${rgb}, ${tone})`;
    if (!focused && !needs) ctx.shadowBlur = 0;
    ctx.fillText(fit(ctx, body, 532 - labelWidth - 16), 38, y);
    ctx.shadowBlur = 6;
  }
}
