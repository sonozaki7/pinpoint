// OpenRouter chat completion connector. One retry on 429/5xx, 30 s timeout,
// JSON mode on request. The API key and prompt never appear in errors.

import { ConnectorError, type LlmConnector } from './types.js';
import { retryDelayMs, safeErrorCode, sleep, type FetchLike } from './http.js';

export const DEFAULT_OPENROUTER_MODEL = 'deepseek/deepseek-v4.1-flash';
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

export interface OpenRouterConnectorOptions {
  apiKey: string;
  model?: string;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  retryDelay?: number;
}

interface ChatPayload {
  choices?: Array<{
    message?: {
      content?: unknown;
    };
  }>;
}

export class OpenRouterConnector implements LlmConnector {
  readonly name: string;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;
  private readonly retryDelay: number;

  constructor(options: OpenRouterConnectorOptions) {
    if (!options.apiKey) throw new ConnectorError('openrouter', 'OPENROUTER_API_KEY is not set');
    this.apiKey = options.apiKey;
    this.model = options.model?.trim() || DEFAULT_OPENROUTER_MODEL;
    this.name = `openrouter:${this.model}`;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.retryDelay = options.retryDelay ?? 700;
  }

  async complete(input: {
    system: string;
    user: string;
    json?: boolean;
    maxTokens?: number;
  }): Promise<string> {
    const maxTokens = Math.min(
      8_192,
      Math.max(1, Math.trunc(Number.isFinite(input.maxTokens) ? input.maxTokens! : 1_024)),
    );
    const body = JSON.stringify({
      model: this.model,
      temperature: 0,
      max_tokens: maxTokens,
      messages: [
        { role: 'system', content: input.system ?? '' },
        { role: 'user', content: input.user ?? '' },
      ],
      ...(input.json ? { response_format: { type: 'json_object' } } : {}),
    });

    let lastStatus = 0;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      let response: Response;
      try {
        response = await this.fetchImpl(OPENROUTER_URL, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${this.apiKey}`,
            'HTTP-Referer': 'https://pinpoint.qolso.com',
            'X-Title': 'Pinpoint',
            'content-type': 'application/json',
          },
          body,
          signal: AbortSignal.timeout(this.timeoutMs),
        });
      } catch (error) {
        const name = error instanceof Error ? error.name : 'network error';
        throw new ConnectorError('openrouter', `openrouter could not be reached (${name})`, {
          cause: error,
        });
      }

      lastStatus = response.status;
      const text = await response.text();

      if (response.status === 429 || response.status >= 500) {
        if (attempt === 0) {
          await sleep(retryDelayMs(response, this.retryDelay));
          continue;
        }
      }

      if (!response.ok) {
        const code = safeErrorCode(text);
        throw new ConnectorError(
          'openrouter',
          `openrouter returned HTTP ${response.status}${code ? ` (${code})` : ''}`,
          { status: response.status },
        );
      }

      let payload: ChatPayload;
      try {
        payload = JSON.parse(text) as ChatPayload;
      } catch (error) {
        throw new ConnectorError('openrouter', 'openrouter returned a non-JSON reply', {
          status: response.status,
          cause: error,
        });
      }

      const content = payload?.choices?.[0]?.message?.content;
      const textContent =
        typeof content === 'string'
          ? content
          : Array.isArray(content)
            ? content
                .map((part) => {
                  if (typeof part === 'string') return part;
                  if (part && typeof part === 'object') {
                    const value = (part as { text?: unknown }).text;
                    if (typeof value === 'string') return value;
                  }
                  return '';
                })
                .join('')
            : '';

      if (!textContent.trim()) {
        throw new ConnectorError('openrouter', 'openrouter returned no text');
      }
      return textContent;
    }

    throw new ConnectorError('openrouter', `openrouter returned HTTP ${lastStatus}`, {
      status: lastStatus,
    });
  }
}
