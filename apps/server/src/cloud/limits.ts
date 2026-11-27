/**
 * PINPOINT_MODE=cloud limits. Kept in one file so the HTTP layer and the
 * device store cannot drift apart.
 */

/** 30 s of 16 kHz mono s16le PCM. */
export const CLOUD_MAX_AUDIO_BYTES = 960_000;

/** At most this many live device workspaces stay in memory. */
export const CLOUD_MAX_DEVICES = 5_000;

/** A device that has not called for this long is treated as gone. */
export const CLOUD_DEVICE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Per-IP request budget (all /api requests, preflights excluded). */
export const CLOUD_IP_REQUESTS_PER_MINUTE = 300;

/** Per-device request budget, shared by every route. */
export const CLOUD_DEVICE_REQUESTS_PER_MINUTE = 120;

/** Voice requests per device; checked before transcription starts. */
export const CLOUD_VOICE_REQUESTS_PER_MINUTE = 20;

/** whisper-cli processes that may run at once. */
export const CLOUD_VOICE_CONCURRENCY = 2;

/** How long a queued voice request waits for a free whisper slot. */
export const CLOUD_VOICE_QUEUE_MS = 20_000;

/** Model-phrased Ask answers per device per minute; beyond it the exact sentence is returned unphrased. */
export const CLOUD_ASK_LLM_PER_MINUTE = 20;
