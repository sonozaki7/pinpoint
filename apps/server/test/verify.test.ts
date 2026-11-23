import { describe, expect, it } from 'vitest';
import { BUILTIN_FIXTURES } from '../src/core/builtinFixtures.js';
import { bestSentence, quoteKey, verifyQuote } from '../src/core/splitter/verify.js';

describe('verifyQuote', () => {
  it('keeps an exact substring', () => {
    const source = 'Wrap refreshToken() in a mutex shared by all handlers.';
    const result = verifyQuote(source, 'Wrap refreshToken() in a mutex shared by all handlers.');
    expect(result).toEqual({
      quote: 'Wrap refreshToken() in a mutex shared by all handlers.',
      match: 'exact',
    });
  });

  it('matches through markdown emphasis and returns the original text', () => {
    const source = 'Step 4: **Force-logout** every user by truncating the sessions table.';
    const result = verifyQuote(source, 'Force-logout every user by truncating the sessions table');
    expect(result?.match).toBe('normalized');
    expect(result?.quote).toContain('Force-logout');
    expect(source.includes(result!.quote)).toBe(true);
  });

  it('matches across newlines and whitespace', () => {
    const source = 'Add a 30s\n\n   timeout to the logout endpoint.';
    const result = verifyQuote(source, 'Add a 30s timeout to the logout endpoint.');
    expect(result?.match).toBe('normalized');
    expect(source.includes(result!.quote)).toBe(true);
    expect(result?.quote.replace(/\s+/g, ' ')).toBe('Add a 30s timeout to the logout endpoint.');
  });

  it('matches smart quotes to straight quotes', () => {
    const source = 'Use "quoted" identifiers in the config file.';
    const result = verifyQuote(source, 'Use “quoted” identifiers in the config file.');
    expect(result?.match).toBe('normalized');
    expect(result?.quote).toBe('Use "quoted" identifiers in the config file.');
  });

  it('falls back to the best source sentence when wording drifts', () => {
    const source =
      'We should migrate the session store before deleting the legacy index. Then we can deploy.';
    const result = verifyQuote(
      source,
      'We should migrate the session store, then delete the legacy index.',
    );
    expect(result?.match).toBe('fallback');
    expect(result?.quote).toBe(
      'We should migrate the session store before deleting the legacy index.',
    );
  });

  it('drops a quote that has no relationship to the source', () => {
    const source = 'Alpha beta gamma delta epsilon.';
    expect(verifyQuote(source, 'Completely unrelated purple elephant')).toBeNull();
  });

  it('never returns more than 200 characters and stays a substring', () => {
    const sentence = `Add ${'very '.repeat(60)}long logging to every request path in the server.`;
    const result = verifyQuote(sentence, sentence);
    expect(result).not.toBeNull();
    expect(result!.quote.length).toBeLessThanOrEqual(200);
    expect(sentence.includes(result!.quote)).toBe(true);
  });

  it('verifies every built-in fixture deck quote against its source', () => {
    for (const fixture of BUILTIN_FIXTURES) {
      expect(fixture.deck, fixture.thread.threadId).toBeDefined();
      for (const point of fixture.deck!.points) {
        const result = verifyQuote(fixture.source.text, point.quote);
        expect(result, `${fixture.thread.threadId}/${point.id}`).not.toBeNull();
        expect(result!.match).toBe('exact');
      }
    }
  });

  it('builds stable dedupe keys', () => {
    expect(quoteKey('Wrap `refreshToken()` in a mutex.')).toBe(
      quoteKey('wrap refreshToken() in a mutex.'),
    );
  });

  it('bestSentence returns null when nothing matches', () => {
    expect(bestSentence('Alpha beta gamma delta.', 'Zeta eta theta iota.')).toBeNull();
  });
});
