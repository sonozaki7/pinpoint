import type { Env } from '../env.js';
import { findSplitPayload } from './json.js';
import { naiveSplit } from './naive.js';
import { buildSplitPrompt, normalizeHeadline } from './prompt.js';
import { runOpencode } from './opencode.js';
import { splitWithAnthropic, splitWithOpenRouter } from './httpProviders.js';
import { rawPointSchema } from '../schemas.js';
import { SplitterError, type RawSplit, type SplitInput, type Splitter } from './types.js';

export type { Splitter, SplitInput, RawSplit } from './types.js';
export { SPLITTER_TIMEOUT_MS } from './opencode.js';

function labelFor(provider: Env['splitterProvider'], model: string): string {
  switch (provider) {
    case 'opencode':
      return `opencode:${model.replace(/^opencode-go\//, '')}`;
    case 'anthropic':
      return `anthropic:${model}`;
    case 'openrouter':
      return `openrouter:${model}`;
    case 'fixture':
      return 'fixture';
  }
}

function fromModelText(text: string): { headline?: unknown; points: unknown[] } | null {
  return findSplitPayload(text);
}

/** Builds the splitter selected by SPLITTER_PROVIDER. Model failures fall back to naive splitting. */
export function createSplitter(env: Env): Splitter {
  const provider = env.splitterProvider;
  const model =
    provider === 'anthropic'
      ? env.anthropicModel
      : provider === 'openrouter'
        ? env.openrouterModel
        : env.splitterModel;
  const label = labelFor(provider, model);

  return {
    label,
    async split(input: SplitInput): Promise<RawSplit> {
      const fallback = (reason?: string): RawSplit => {
        if (reason) console.warn(`[splitter] ${provider} failed, using naive split: ${reason}`);
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
        if (provider === 'opencode') {
          text = await runOpencode(buildSplitPrompt(input), model);
        } else if (provider === 'anthropic') {
          text = await splitWithAnthropic(input, env.anthropicKey, model);
        } else {
          text = await splitWithOpenRouter(input, env.openrouterKey, model);
        }
      } catch (error) {
        return fallback((error as Error).message);
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
