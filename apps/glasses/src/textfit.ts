// G2 glyph metrics, generated from @evenrealities/pretext 0.1.4.
//
// The library embeds the firmware's LVGL advance and kerning tables. This file
// keeps only the printable ASCII we display, plus the middle dot and ellipsis,
// so the glasses bundle does not carry every language table. The measurement
// method and the container widths are recorded in docs/device-readiness.md §6.
//
// Widths are integer pixels, rounded per glyph the same way LVGL does:
//   advance = (rawAdvanceIn16ths + kerningIn16ths + 8) >> 4
// The firmware draws a 4 px placeholder for a printable glyph it does not know.

export const LINE_HEIGHT = 27;
export const ROW_MAX_PX = 540;
export const LIST_ITEM_MAX_PX = 476;
export const HEADER_MAX_PX = 544;
export const PANE_MAX_PX = 534;
export const PREVIEW_MAX_PX = 504;
export const ROW_MAX_CHARS = 56;
export const LIST_MAX_CHARS = 52;

const ADVANCE: Record<number, number> = {"32":80,"33":64,"34":96,"35":240,"37":224,"38":256,"39":64,"40":112,"41":112,"42":128,"43":160,"44":80,"45":160,"46":80,"47":128,"48":192,"49":128,"50":192,"51":192,"52":208,"53":192,"54":192,"55":208,"56":192,"57":192,"58":64,"59":80,"60":160,"61":160,"62":160,"63":192,"64":272,"65":224,"66":192,"67":192,"68":192,"69":176,"70":176,"71":192,"72":192,"73":96,"74":144,"75":192,"76":160,"77":256,"78":192,"79":192,"80":192,"81":192,"82":192,"83":192,"84":192,"85":192,"86":224,"87":256,"88":224,"89":224,"90":208,"91":112,"92":128,"93":112,"94":160,"95":144,"97":192,"98":176,"99":176,"100":176,"101":176,"102":160,"103":176,"104":176,"105":64,"106":112,"107":160,"108":64,"109":256,"110":176,"111":176,"112":176,"113":176,"114":128,"115":176,"116":128,"117":192,"118":192,"119":256,"120":192,"121":192,"122":160,"123":144,"124":64,"125":144,"126":256,"183":80,"8211":240,"8212":240,"8230":160};
const LEFT: Record<number, number> = {"32":0,"33":1,"34":2,"35":3,"37":4,"38":5,"39":2,"40":6,"41":7,"42":4,"43":4,"44":1,"45":4,"46":1,"47":8,"48":7,"49":9,"50":10,"51":7,"52":11,"53":12,"54":7,"55":13,"56":7,"57":7,"58":14,"59":1,"60":4,"61":4,"62":4,"63":15,"64":16,"65":17,"66":18,"67":19,"68":7,"69":20,"70":21,"71":22,"72":9,"73":23,"74":12,"75":24,"76":25,"77":9,"78":9,"79":7,"80":26,"81":7,"82":10,"83":27,"84":28,"85":12,"86":13,"87":29,"88":6,"89":30,"90":6,"91":6,"92":17,"93":9,"94":4,"95":1,"97":31,"98":32,"99":33,"100":9,"101":34,"102":35,"103":36,"104":37,"105":38,"106":38,"107":39,"108":9,"109":40,"110":37,"111":32,"112":32,"113":41,"114":42,"115":43,"116":44,"117":45,"118":46,"119":46,"120":47,"121":46,"122":3,"123":6,"124":9,"125":4,"126":4,"183":4,"8211":4,"8212":4,"8230":1};
const RIGHT: Record<number, number> = {"32":0,"33":1,"34":2,"35":3,"37":4,"38":5,"39":2,"40":6,"41":7,"42":8,"43":9,"44":10,"45":9,"46":10,"47":11,"48":6,"49":12,"50":13,"51":14,"52":15,"53":16,"54":6,"55":17,"56":6,"57":6,"58":18,"59":19,"60":20,"61":9,"62":21,"63":22,"64":23,"65":11,"66":24,"67":6,"68":24,"69":24,"70":24,"71":6,"72":24,"73":25,"74":26,"75":24,"76":24,"77":24,"78":24,"79":6,"80":24,"81":6,"82":24,"83":27,"84":28,"85":29,"86":30,"87":31,"88":7,"89":32,"90":7,"91":24,"92":33,"93":7,"94":34,"95":35,"97":36,"98":24,"99":37,"100":37,"101":37,"102":38,"103":39,"104":24,"105":40,"106":41,"107":24,"108":24,"109":42,"110":42,"111":37,"112":43,"113":37,"114":42,"115":44,"116":45,"117":46,"118":47,"119":47,"120":48,"121":49,"122":50,"123":51,"124":24,"125":7,"126":9,"183":9,"8211":9,"8212":9,"8230":10};
const KERN_VALUES = [0, 16, -16, -32, -48, -64] as const;
const KERN: string = "000000100000201012000000102021212200002002012002000000000000000020000200002000002020220000200300020202000002000200022200000000200030200020000000040020022220202222222202322223002222223242323320222204222222222200020002000222000200002000302020220000000400200222202022222222023222230022222232423233202222042223222222202222222202222322003232023222222220223204223323232200020002000222020202000002203020220020200400220222202203232222242224222222230242222222223333242233233332100200000002200202000000002020202000202004002202222000222202220222020200222202323020222022220400220222222022222222023222230022022222323333202232042222022222000200020002220202000000002020202200202004002202222022032322222422242222222322422222222233332422332333320000000000002000020000000000202022000020030002020200022220022223220302020200003030202222202203000002202000020002000232020300002002223032430220220400220222200022222222024223240022322222424344202232242223232322000200020002220202000000022230202200202004002202222000222222220222222200222222223222222022222422222222222022222222023223222222222232222222203232042223232322322333223334222422333323224222222233433325323333333300020002000222020200002002203022220020200400220222202002022200022222020000020222202022002232040022022220202222222202222322003232023222223220223204223323232220423232440242332400424222334243444032422422333424240223222222232224022222220242302022023222242222222222000202020002220202000002022230222200222003002202222022242332222433342222223322533222222243332433433444420002020200032203020000020032202022002222040222022220222524222224322422223224224222222222443325334333333220222222220242322300223222334232432022322522232323220002000200023202030000200222303243022222040022022220000202220002322203000022222230324300223224222222222000020202000232020300002202223032430022220400220222202223232222343224223322332252222222234343253343333332000200020002320203000020022030302300202002002202222000020002000232020300002000223030330022200300220222200000000000022000020000000020202022002020130002020200202222222202322223002222223242323320222204222222232200020002000232020300002000223030430022200300220222200002000000023002030000200220303023002020020022022220322222232234332423232223234242324323333325223323232200222222220242222300222222224232432022320422222222222022222222023222232022222222323233203222242223222222202222222202322223002222223242324320223224222323232202232223222322232322222222424232332232222522222222222022222222023222230022222222423233202222042222222222";
const RIGHT_COUNT = 52;

function kern(cp: number, next: number): number {
  const left = LEFT[cp];
  const right = RIGHT[next];
  if (left === undefined || right === undefined) return 0;
  const digit = KERN.charCodeAt(left * RIGHT_COUNT + right) - 48;
  return KERN_VALUES[digit] ?? 0;
}

/** Width of one codepoint in whole pixels, before kerning with its neighbour. */
export function glyphWidth(cp: number): number {
  const raw = ADVANCE[cp];
  if (raw === undefined && cp >= 32) return 4;
  return ((raw ?? 0) + 8) >> 4;
}

/** Exact single-line width of already-normalised text, in pixels. */
export function textWidth(text: string): number {
  const cps = Array.from(text, (char) => char.codePointAt(0) ?? 0);
  let total = 0;
  for (let index = 0; index < cps.length; index++) {
    const cp = cps[index]!;
    const raw = ADVANCE[cp];
    if (raw === undefined && cp >= 32) {
      total += 4;
      continue;
    }
    total += ((raw ?? 0) + kern(cp, cps[index + 1] ?? 0) + 8) >> 4;
  }
  return total;
}

/** Cut a single line to a pixel budget, adding "..." when it was too long. */
export function pxTruncate(text: string, maxPx: number): string {
  if (textWidth(text) <= maxPx) return text;
  const chars = Array.from(text);
  let low = 0;
  let high = chars.length;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if (textWidth(chars.slice(0, middle).join("") + "...") <= maxPx) low = middle;
    else high = middle - 1;
  }
  return chars.slice(0, low).join("") + "...";
}

/** Cut a line to a pixel budget and force an ellipsis even if it just fit. */
export function pxEllipsize(text: string, maxPx: number): string {
  if (textWidth(text + "...") <= maxPx) return text + "...";
  const chars = Array.from(text);
  let low = 0;
  let high = chars.length;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if (textWidth(chars.slice(0, middle).join("") + "...") <= maxPx) low = middle;
    else high = middle - 1;
  }
  return low === 0 ? "..." : chars.slice(0, low).join("") + "...";
}

function longestPrefix(text: string, maxPx: number): string {
  const chars = Array.from(text);
  let count = 0;
  while (count < chars.length) {
    const next = chars.slice(0, count + 1).join("");
    if (textWidth(next) > maxPx) break;
    count++;
  }
  return chars.slice(0, Math.max(1, count)).join("");
}

/**
 * Greedy word wrap that respects the real pixel width and a fallback character
 * cap. Explicit newlines are treated as spaces because the caller has already
 * normalised the text to one paragraph.
 */
export function wrapText(
  text: string,
  maxPx: number,
  maxLines: number,
  maxChars = ROW_MAX_CHARS,
): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean || maxLines <= 0) return "";
  const words = clean.split(" ");
  const lines: string[] = [];
  let line = "";
  let index = 0;
  let truncated = false;

  while (index < words.length) {
    let word = words[index]!;
    const candidate = line ? `${line} ${word}` : word;
    if (candidate.length <= maxChars && textWidth(candidate) <= maxPx) {
      line = candidate;
      index++;
      continue;
    }
    if (line) {
      lines.push(line);
      line = "";
      if (lines.length >= maxLines) {
        truncated = true;
        break;
      }
      continue;
    }
    if (word.length > maxChars) word = word.slice(0, maxChars);
    if (textWidth(word) <= maxPx) {
      line = word;
      index++;
      continue;
    }
    const prefix = longestPrefix(word, maxPx);
    lines.push(prefix);
    if (lines.length >= maxLines) {
      truncated = true;
      break;
    }
    const rest = word.slice(prefix.length);
    if (rest) words[index] = rest;
    else index++;
  }

  if (line) {
    if (lines.length < maxLines) lines.push(line);
    else truncated = true;
  }
  if (index < words.length) truncated = true;
  if (truncated && lines.length > 0) {
    lines[lines.length - 1] = pxEllipsize(lines[lines.length - 1]!, maxPx);
  }
  return lines.slice(0, maxLines).join("\n");
}
