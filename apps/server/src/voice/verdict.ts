const OBJECT_START =
  /^\s*(?:no|nope|not|wrong|instead|stop|never|don'?t|do not|doesn'?t|isn'?t|can'?t|cannot)\b/i;

export type VoiceVerdict = 'object' | 'note';

/** SPEC §9: a spoken note is an objection when it starts with a negative/corrective word. */
export function verdictForTranscript(text: string): VoiceVerdict {
  const clean = text
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/^[\s\-*]+/, '')
    .trim();
  return OBJECT_START.test(clean) ? 'object' : 'note';
}
