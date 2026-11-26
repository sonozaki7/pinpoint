import { describe, expect, it } from 'vitest';
import { PairingStore } from '../src/cloud/pairing.js';
import {
  PAIR_ATTEMPT_WINDOW_MS,
  PAIR_CODE_TTL_MS,
  formatPairCode,
  normalizePairCode,
  sha256Hex,
} from '../src/relay/protocol.js';

const DESK = sha256Hex('desk-secret-for-tests');
const DESK_2 = sha256Hex('another-desk-secret-for-tests');
const DEVICE_A = '11111111-1111-4111-8111-111111111111';
const DEVICE_B = '22222222-2222-4222-8222-222222222222';

function makeStore(clock: { now: number }, options: { maxAttempts?: number } = {}) {
  return new PairingStore({
    now: () => clock.now,
    ...(options.maxAttempts ? { maxAttempts: options.maxAttempts } : {}),
  });
}

function redeem(store: PairingStore, code: string | null, deviceId = DEVICE_A, ip = '203.0.113.9') {
  return store.redeem({
    code,
    deviceId,
    ip,
    deskExists: (deskId) => deskId === DESK || deskId === DESK_2,
  });
}

describe('pairing codes', () => {
  it('formats an unambiguous 8-character code as XXXX-XXXX', () => {
    const clock = { now: 1_000_000 };
    const store = makeStore(clock);
    const created = store.createCode(DESK);
    expect(created.code).toMatch(/^[A-HJ-KM-NP-Z2-9]{4}-[A-HJ-KM-NP-Z2-9]{4}$/);
    expect(created.code).not.toMatch(/[01OIL]/);
    expect(created.expiresAt).toBe(clock.now + PAIR_CODE_TTL_MS);
    expect(normalizePairCode(created.code)).toBe(created.compact);
    expect(formatPairCode(created.compact)).toBe(created.code);
  });

  it('accepts lower case, spaces and no dash', () => {
    const clock = { now: 1_000_000 };
    const store = makeStore(clock);
    const { compact } = store.createCode(DESK);
    expect(normalizePairCode(compact.toLowerCase())).toBe(compact);
    expect(normalizePairCode(`${compact.slice(0, 4)} ${compact.slice(4).toLowerCase()}`)).toBe(
      compact,
    );
    expect(normalizePairCode(`${compact.slice(0, 4)}-${compact.slice(4)}`)).toBe(compact);
    expect(normalizePairCode('K7Q4-2MX')).toBeNull();
    expect(normalizePairCode('K7Q4-2MXP0')).toBeNull();
    expect(normalizePairCode('IIII-1111')).toBeNull();
  });

  it('expires after ten minutes', () => {
    const clock = { now: 1_000_000 };
    const store = makeStore(clock);
    const { code } = store.createCode(DESK);
    clock.now += PAIR_CODE_TTL_MS;
    const outcome = redeem(store, code);
    expect(outcome).toMatchObject({ ok: false, reason: 'invalid_code' });
    expect(store.codeCount).toBe(0);
  });

  it('is single use and returns a token bound to the device and desk', () => {
    const clock = { now: 1_000_000 };
    const store = makeStore(clock);
    const { code } = store.createCode(DESK);
    const first = redeem(store, code);
    expect(first.ok).toBe(true);
    if (!first.ok) throw new Error('expected a token');
    expect(first.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(store.resolve(DEVICE_A, first.token)).toMatchObject({
      deviceId: DEVICE_A,
      deskId: DESK,
    });
    expect(store.resolve(DEVICE_B, first.token)).toBeNull();

    const second = redeem(store, code, DEVICE_B);
    expect(second).toMatchObject({ ok: false, reason: 'invalid_code' });
  });

  it('invalidates the previous code when the desk asks for a new one', () => {
    const clock = { now: 1_000_000 };
    const store = makeStore(clock);
    const old = store.createCode(DESK);
    const fresh = store.createCode(DESK);
    expect(redeem(store, old.code)).toMatchObject({ ok: false });
    expect(redeem(store, fresh.code).ok).toBe(true);
  });

  it('rejects a code whose desk no longer exists', () => {
    const clock = { now: 1_000_000 };
    const store = makeStore(clock);
    const { code } = store.createCode(sha256Hex('gone-desk'));
    const outcome = store.redeem({
      code,
      deviceId: DEVICE_A,
      ip: '203.0.113.9',
      deskExists: () => false,
    });
    expect(outcome).toMatchObject({ ok: false, reason: 'unknown_desk' });
  });

  it('replaces the previous token when the same device pairs again', () => {
    const clock = { now: 1_000_000 };
    const store = makeStore(clock);
    const first = redeem(store, store.createCode(DESK).code);
    const second = redeem(store, store.createCode(DESK_2).code);
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) throw new Error('expected tokens');
    expect(store.resolve(DEVICE_A, first.token)).toBeNull();
    expect(store.resolve(DEVICE_A, second.token)).toMatchObject({ deskId: DESK_2 });
    expect(store.tokenCount).toBe(1);
  });
});

describe('pairing attempt limits', () => {
  it('allows five attempts per device per ten minutes', () => {
    const clock = { now: 1_000_000 };
    const store = makeStore(clock);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const outcome = redeem(store, 'AAAA-BBBB', DEVICE_A, `198.51.100.${attempt}`);
      expect(outcome).toMatchObject({ ok: false, reason: 'invalid_code' });
    }
    const limited = redeem(store, 'AAAA-BBBB', DEVICE_A, '198.51.100.99');
    expect(limited).toMatchObject({ ok: false, reason: 'rate_limited' });
    if (limited.ok) throw new Error('expected a limit');
    expect(limited.retryAfterSeconds).toBeGreaterThan(0);

    clock.now += PAIR_ATTEMPT_WINDOW_MS;
    const allowed = redeem(store, 'AAAA-BBBB', DEVICE_A, '198.51.100.99');
    expect(allowed).toMatchObject({ ok: false, reason: 'invalid_code' });
  });

  it('allows five attempts per IP across devices', () => {
    const clock = { now: 1_000_000 };
    const store = makeStore(clock);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const device = `00000000-0000-4000-8000-00000000000${attempt}`;
      expect(redeem(store, 'CCCC-DDDD', device, '203.0.113.7')).toMatchObject({ ok: false });
    }
    const limited = redeem(
      store,
      'CCCC-DDDD',
      '00000000-0000-4000-8000-000000000009',
      '203.0.113.7',
    );
    expect(limited).toMatchObject({ ok: false, reason: 'rate_limited' });
  });

  it('counts a correct code against the attempt budget too', () => {
    const clock = { now: 1_000_000 };
    const store = makeStore(clock);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      redeem(store, 'EEEE-FFFF', DEVICE_A, '203.0.113.20');
    }
    const { code } = store.createCode(DESK);
    expect(redeem(store, code, DEVICE_A, '203.0.113.20')).toMatchObject({
      ok: false,
      reason: 'rate_limited',
    });
  });
});

describe('unpairing', () => {
  it('revokes every token for one device', () => {
    const clock = { now: 1_000_000 };
    const store = makeStore(clock);
    const a = redeem(store, store.createCode(DESK).code, DEVICE_A);
    const b = redeem(store, store.createCode(DESK).code, DEVICE_B);
    if (!a.ok || !b.ok) throw new Error('expected tokens');
    expect(store.revokeDevice(DEVICE_A)).toBe(1);
    expect(store.resolve(DEVICE_A, a.token)).toBeNull();
    expect(store.resolve(DEVICE_B, b.token)).not.toBeNull();
  });

  it('revokes every device and code for a desk', () => {
    const clock = { now: 1_000_000 };
    const store = makeStore(clock);
    const a = redeem(store, store.createCode(DESK).code, DEVICE_A);
    const b = redeem(store, store.createCode(DESK).code, DEVICE_B);
    store.createCode(DESK_2);
    if (!a.ok || !b.ok) throw new Error('expected tokens');
    expect(store.revokeDesk(DESK)).toBe(2);
    expect(store.resolve(DEVICE_A, a.token)).toBeNull();
    expect(store.resolve(DEVICE_B, b.token)).toBeNull();
    expect(store.codeCount).toBe(1); // the other desk's code stays
  });
});
