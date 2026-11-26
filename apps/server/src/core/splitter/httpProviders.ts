import { buildSplitPrompt, SYSTEM_PROMPT } from './prompt.js';
import { SplitterError, type SplitInput } from './types.js';

const TIMEOUT_MS = 60_000;

async function postJson(url: string, headers: Record<string, string>, body: unknown): Promise<unknown> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new SplitterError(`HTTP ${response.status}: ${text.slice(0, 300)}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new SplitterError('provider returned non-JSON HTTP body');
  }
}

export async function splitWithAnthropic(
  input: SplitInput,
  apiKey: string,
  model: string,
): Promise<string> {
  if (!apiKey) throw new SplitterError('ANTHROPIC_API_KEY is not set');
  const payload = (await postJson(
    'https://api.anthropic.com/v1/messages',
    { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    {
      model,
      max_tokens: 4096,
      temperature: 0,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildSplitPrompt(input) }],
    },
  )) as { content?: { type?: string; text?: string }[] };
  const text = (payload.content ?? [])
    .filter((block) => block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n');
  if (!text.trim()) throw new SplitterError('anthropic returned no text');
  return text;
}
