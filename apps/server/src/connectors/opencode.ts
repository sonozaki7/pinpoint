// LlmConnector fallback for the desk when OPENROUTER_API_KEY is not set.
// Reuses the existing opencode CLI path (core/splitter/opencode.ts) unchanged;
// it is not used in cloud mode.

import { ConnectorError, type LlmConnector } from './types.js';
import { runOpencode } from '../core/splitter/opencode.js';

export interface OpencodeLlmConnectorOptions {
  model?: string;
  timeoutMs?: number;
}

export class OpencodeLlmConnector implements LlmConnector {
  readonly name: string;
  private readonly model: string;
  private readonly timeoutMs: number;

  constructor(options: OpencodeLlmConnectorOptions = {}) {
    this.model = options.model?.trim() || 'opencode-go/deepseek-v4.1-flash';
    this.name = `opencode:${this.model}`;
    this.timeoutMs = options.timeoutMs ?? 60_000;
  }

  async complete(input: {
    system: string;
    user: string;
    json?: boolean;
    maxTokens?: number;
  }): Promise<string> {
    const parts = [String(input.system ?? '').trim(), String(input.user ?? '').trim()].filter(
      (part) => part.length > 0,
    );
    if (parts.length === 0) throw new ConnectorError('opencode', 'prompt is empty');
    const prompt = input.json
      ? `${parts.join('\n\n')}\n\nReply with a single JSON object and no prose.`
      : parts.join('\n\n');

    const output = (await runOpencode(prompt, this.model, this.timeoutMs)).trim();
    if (!output) throw new ConnectorError('opencode', 'opencode returned no text');
    return output;
  }
}
