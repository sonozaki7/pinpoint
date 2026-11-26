import type { AppId, Receipt, ReceiptLine } from '../../../../shared/contract.js';
import { clipText, toAscii } from '../core/text.js';

/** Receipt lines are one glasses line: <= 44 ASCII chars, like a glance. */
function line(app: AppId, text: string, ok: boolean, link?: string): ReceiptLine {
  const clean = clipText(toAscii(text.trim()), 44, '...');
  return { app, text: clean, ok, ...(link ? { link } : {}) };
}

export interface NotionReceiptInput {
  comments: number;
  failed: number;
  /** Short page name, e.g. "Launch post". */
  name: string;
  status: string;
  link?: string;
  /** " (sample)" for the cloud sample workspace. */
  suffix?: string;
}

export function notionReceipt(input: NotionReceiptInput): Receipt {
  const suffix = input.suffix ?? '';
  const noun = input.comments === 1 ? 'comment' : 'comments';
  const lines: ReceiptLine[] = [
    line(
      'notion',
      `${input.comments} ${noun} on ${input.name}${suffix}`,
      input.failed === 0,
      input.link,
    ),
    line('notion', `Status: ${input.status}${suffix}`, true, input.link),
  ];
  if (input.failed > 0) {
    lines.push(line('notion', `${input.failed} comment failed${suffix}`, false, input.link));
  }
  return { lines };
}

export interface GmailReceiptInput {
  /** First name the draft is addressed to. */
  to: string;
  link?: string;
  suffix?: string;
}

export function gmailReceipt(input: GmailReceiptInput): Receipt {
  const suffix = input.suffix ?? '';
  return {
    lines: [line('gmail', `Sent to ${input.to}${suffix}`, true, input.link)],
  };
}

/** Demo fixtures have no real backend; this receipt says what would have happened. */
export function fixtureReceipt(app: AppId, lines: string[], link?: string): Receipt {
  return { lines: lines.map((text) => line(app, text, true, link)) };
}
