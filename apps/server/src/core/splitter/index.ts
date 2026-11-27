import { DeepseekLlmConnector } from '../../connectors/deepseek.js';
import type { LlmConnector } from '../../connectors/types.js';
import type { Env } from '../env.js';
import { errorMessage } from '../errors.js';
import { findSplitPayload } from './json.js';
import { naiveSplit } from './naive.js';
import { buildSplitPrompt, normalizeHeadline, SYSTEM_PROMPT } from './prompt.js';
import { runOpencode } from './opencode.js';
import { splitWithAnthropic } from './httpProviders.js';
import { rawPointSchema } from '../schemas.js';
import { SplitterError, type RawSplit, type SplitInput, type Splitter } from './types.js';

export type { Splitter, SplitInput, RawSplit } from './types.js';
export { SPLITTER_TIMEOUT_MS } from './opencode.js';

export interface SplitterOptions {
  /** Desk reviewer model (DeepSeek when its key is set). Tests inject a fake. */
  llm?: LlmConnector;
}

function labelFor(provider: Env['splitterProvider'] | 'deepseek', model: string): string {
  switch (provider) {
    case 'deepseek':
      return `deepseek:${model.replace(/^deepseek[-:]/i, '')}`;
    case 'opencode':
      return `opencode:${model.replace(/^opencode-go\//, '')}`;
    case 'anthropic':
      return `anthropic:${model}`;
    case 'fixture':
      return 'fixture';
  }
}

function fromModelText(text: string): { headline?: unknown; points: unknown[] } | null {
  return findSplitPayload(text);
}

/**
 * Builds the reviewer used for splitting, sorting and evidence.
 *
 * DeepSeek wins whenever DEEPSEEK_API_KEY is set (the owner's choice: about a
 * second per call). Without the key the existing opencode CLI path stays the
 * fallback, and `SPLITTER_PROVIDER=fixture` / `anthropic` still means what it says.
 */
export function createSplitter(env: Env, options: SplitterOptions = {}): Splitter {
  const configured = env.splitterProvider;
  const useDeepseek =
    env.mode !== 'demo' &&
    env.deepseekKey.length > 0 &&
    configured !== 'fixture' &&
    configured !== 'anthropic';
  const provider: Env['splitterProvider'] | 'deepseek' = useDeepseek ? 'deepseek' : configured;
  const model =
    provider === 'deepseek'
      ? env.deepseekModel
      : provider === 'anthropic'
        ? env.anthropicModel
        : env.splitterModel;
  const label = labelFor(provider, model);
  const deepseek =
    provider === 'deepseek'
      ? (options.llm ??
        new DeepseekLlmConnector({ apiKey: env.deepseekKey, model: env.deepseekModel }))
      : undefined;

  return {
    label,
    async split(input: SplitInput): Promise<RawSplit> {
      const fallback = (reason?: string): RawSplit => {
        if (reason) {
          console.warn(`[splitter] ${provider} failed, using naive split: ${errorMessage(reason)}`);
        }
        const naive = naiveSplit(input);
        return {
          headline: naive.headline,
          points: naive.points,
          splitter: provider === 'fixture' ? 'fixture' : 'fallback:naive',
        };
      };

      if (provider === 'fixture') return fallback();

      const started = Date.now();
      let text: string;
      try {
        if (provider === 'deepseek' && deepseek) {
          text = await deepseek.complete({
            system: SYSTEM_PROMPT,
            user: buildSplitPrompt(input),
            json: true,
            maxTokens: 2_400,
          });
        } else if (provider === 'opencode') {
          text = await runOpencode(buildSplitPrompt(input), model);
        } else if (provider === 'anthropic') {
          text = await splitWithAnthropic(input, env.anthropicKey, model);
        } else {
          return fallback();
        }
      } catch (error) {
        return fallback(errorMessage(error));
      }

      const payload = fromModelText(text);
      if (!payload || payload.points.length === 0) {
        return fallback('model output contained no points array');
      }
      // Zod validation per point: a malformed item is dropped, not the whole deck.
      const points = payload.points.flatMap((raw) => {
        const parsed = rawPointSchema.safeParse(raw);
        return parsed.success ? [parsed.data] : [];
      });
      if (points.length === 0) {
        return fallback('model output had no valid points');
      }
      const elapsed = Date.now() - started;
      console.info(
        `[splitter] ${label} validated ${points.length}/${payload.points.length} points in ${elapsed}ms`,
      );
      return {
        headline: normalizeHeadline(payload.headline, ''),
        points,
        splitter: label,
      };
    },
  };
}

export function createNaiveSplitter(): Splitter {
  return {
    label: 'fixture',
    async split(input) {
      const naive = naiveSplit(input);
      return { headline: naive.headline, points: naive.points, splitter: 'fixture' };
    },
  };
}

export { SplitterError };
