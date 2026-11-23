/**
 * Remove credentials from anything that might reach a log line or an HTTP
 * error response. The server only logs what it must; this is the last line of
 * defence for a provider error that echoes a request URL or header.
 */
const RULES: ReadonlyArray<readonly [RegExp, string]> = [
  // Telegram bot tokens look like 123456789:AA... in URLs and error bodies.
  [/\b\d{6,12}:[A-Za-z0-9_-]{20,}\b/g, '***'],
  // Bearer credentials in headers or error text.
  [/\b(Bearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi, '$1***'],
  // JWTs (T3 session tokens may use this shape).
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, '***'],
  // Provider API keys.
  [/\bsk-(?:or-v1-)?[A-Za-z0-9_-]{16,}\b/g, '***'],
  // Query parameters that carry tickets or keys.
  [/([?&](?:wsTicket|ticket|token|key|api_key|access_token)=)[^&\s"']+/gi, '$1***'],
  // Environment-style assignments if a config dump ever reaches a log.
  [
    /\b(T3_TOKEN|TELEGRAM_BOT_TOKEN|ANTHROPIC_API_KEY|OPENROUTER_API_KEY)\s*=\s*[^\s"']+/g,
    '$1=***',
  ],
];

export function redactSecrets(value: string): string {
  let redacted = value;
  for (const [pattern, replacement] of RULES) redacted = redacted.replace(pattern, replacement);
  return redacted;
}
