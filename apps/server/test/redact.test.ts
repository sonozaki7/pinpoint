import { describe, expect, it } from 'vitest';
import { errorMessage } from '../src/core/errors.js';
import { redactSecrets } from '../src/core/redact.js';

describe('secret redaction', () => {
  it('removes bot tokens, bearer headers, tickets, JWTs and provider keys', () => {
    const raw = [
      'bot 123456789:AAHfakefakefakefakefakefake',
      'Authorization: Bearer abcdefghijklmnopqrstuvwxyz',
      'https://127.0.0.1/ws?wsTicket=ticket-value-123',
      'T3_TOKEN=super-secret-value',
      'key sk-abcdefghijklmnopqrst',
      'jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signaturepart',
    ].join(' ');

    const clean = redactSecrets(raw);
    expect(clean).not.toContain('AAHfake');
    expect(clean).not.toContain('abcdefghijklmnopqrstuvwxyz');
    expect(clean).not.toContain('ticket-value-123');
    expect(clean).not.toContain('super-secret-value');
    expect(clean).not.toContain('sk-abcdefghijklmnopqrst');
    expect(clean).not.toContain('eyJhbGciOiJIUzI1NiJ9');
    expect(clean).toContain('Bearer ***');
  });

  it('leaves ordinary review text untouched and redacts errorMessage output', () => {
    const text = 'No, migrate the existing sessions instead.';
    expect(redactSecrets(text)).toBe(text);
    expect(errorMessage(new Error(`failed: ${text}`))).toBe(`failed: ${text}`);
    expect(errorMessage(new Error('bearer ABCDEFGHIJKLMNOPQRSTUVWXYZ'))).not.toContain(
      'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
    );
  });
});
