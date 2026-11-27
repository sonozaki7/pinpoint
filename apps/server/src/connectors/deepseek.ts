// DeepSeek LlmConnector (OpenAI-compatible chat completions).
//
// The reviewer brain on the desk and the optional answer phraser in Pinpoint
// Cloud. Rules from the owner:
//   - one retry on HTTP 429 / 5xx, other failures fail fast;
//   - a hard timeout on every request;
//   - prompts and completions are never logged or put into an error message.

import { ConnectorError, type LlmConnector } from './types.js';
import { retryDelayMs, safeErrorCode, sleep, type FetchLike } from './http.js';

export const DEEPSEEK_URL = 'https://api.deepseek.com/chat/completions';
export const DEEPSEEK_DEFAULT_MODEL = 'deepseek-flash';
export const DEEPSEEK_DEFAULT_TIMEOUT_MS = 12_000;

export interface DeepseekLlmConnectorOptions {
  apiKey: string;
  model?: string;
  baseUrl?: string;
  timeoutMs?: number;
  fetchImpl?: FetchLike;
  /** Injectable for tests; defaults to a real timer. */
  sleepImpl?: (ms: number) => Promise<void>;
}

interface DeepseekChoice {
  message?: { content?: unknown };
}

interface DeepseekResponse {
  choices?: DeepseekChoice[];
}

function contentOf(payload: unknown): string {
  const choices = (payload as DeepseekResponse | null)?.choices;
  const content = Array.isArray(choices) ? choices[0]?.message?.content : undefined;
  return typeof content === 'string' ? content.trim() : '';
}

function retryable(status: number): boolean {
  return status === 429 || status >= 500;
}

export class DeepseekLlmConnector implements LlmConnector {
  readonly name: string;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly url: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: FetchLike;
  private readonly sleepImpl: (ms: number) => Promise<void>;

  constructor(options: DeepseekLlmConnectorOptions) {
    const key = options.apiKey?.trim() ?? '';
    if (key.length === 0) throw new ConnectorError('deepseek', 'DEEPSEEK_API_KEY is empty');
    this.apiKey = key;
    this.model = options.model?.trim() || DEEPSEEK_DEFAULT_MODEL;
    this.name = `deepseek:${this.model}`;
    this.url = options.baseUrl?.trim() || DEEPSEEK_URL;
    this.timeoutMs = options.timeoutMs ?? DEEPSEEK_DEFAULT_TIMEOUT_MS;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.sleepImpl = options.sleepImpl ?? sleep;
  }

  async complete(input: {
    system: string;
    user: string;
    json?: boolean;
    maxTokens?: number;
  }): Promise<string> {
    const system = String(input.system ?? '').trim();
    const user = String(input.user ?? '').trim();
    if (system.length === 0 && user.length === 0) {
      throw new ConnectorError('deepseek', 'prompt is empty');
    }

    const body: Record<string, unknown> = {
      model: this.model,
      messages: [
        ...(system.length > 0 ? [{ role: 'system', content: system }] : []),
        ...(user.length > 0 ? [{ role: 'user', content: user }] : []),
      ],
      stream: false,
      // deepseek-flash reasons by default and can spend the whole token budget
      // before answering; every call here wants a short direct answer.
      thinking: { type: 'disabled' },
      max_tokens: Math.max(1, Math.min(4_000, input.maxTokens ?? 1_500)),
    };
    if (input.json) body.response_format = { type: 'json_object' };

    let lastStatus: number | undefined;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      let response: Response;
      try {
        response = await this.fetchImpl(this.url, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${this.apiKey}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(this.timeoutMs),
        });
      } catch (error) {
        const name = error instanceof Error ? error.name : 'network error';
        throw new ConnectorError('deepseek', `deepseek could not be reached (${name})`, {
          cause: error,
        });
      }

      let text = '';
      try {
        text = await response.text();
      } catch (error) {
        throw new ConnectorError('deepseek', 'deepseek reply could not be read', {
          status: response.status,
          cause: error,
        });
      }

      if (!response.ok) {
        lastStatus = response.status;
        // Only a machine-readable code is kept: response bodies can echo prompts.
        const code = safeErrorCode(text);
        if (attempt === 0 && retryable(response.status)) {
          await this.sleepImpl(retryDelayMs(response, 500));
          continue;
        }
        throw new ConnectorError(
          'deepseek',
          `deepseek returned HTTP ${response.status}${code ? ` (${code})` : ''}`,
          { status: response.status },
        );
      }

      let payload: unknown;
      try {
        payload = JSON.parse(text) as unknown;
      } catch (error) {
        throw new ConnectorError('deepseek', 'deepseek returned a non-JSON reply', {
          status: response.status,
          cause: error,
        });
      }
      const content = contentOf(payload);
      if (content.length === 0) {
        throw new ConnectorError('deepseek', 'deepseek returned no text', {
          status: response.status,
        });
      }
      return content;
    }

    throw new ConnectorError('deepseek', `deepseek returned HTTP ${lastStatus ?? 'unknown'}`, {
      ...(lastStatus === undefined ? {} : { status: lastStatus }),
    });
  }
}
