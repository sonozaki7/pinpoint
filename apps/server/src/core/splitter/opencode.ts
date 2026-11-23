import { spawn } from 'node:child_process';
import { SplitterError } from './types.js';

export const SPLITTER_TIMEOUT_MS = 60_000;

/** Run `opencode run` once and return stdout. Rejects on timeout, spawn failure or empty output. */
export function runOpencode(
  prompt: string,
  model: string,
  timeoutMs = SPLITTER_TIMEOUT_MS,
): Promise<string> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let stdout = '';
    let stderr = '';
    const child = spawn('opencode', ['run', '--standalone', '--model', model, prompt], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    });

    const finish = (error: Error | null, output?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(output ?? '');
    };

    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 2_000).unref();
      finish(new SplitterError(`opencode timed out after ${Math.round(timeoutMs / 1000)}s`));
    }, timeoutMs);
    timer.unref();

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
      if (stdout.length > 2_000_000) {
        child.kill('SIGTERM');
        finish(new SplitterError('opencode output exceeded 2 MB'));
      }
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      if (stderr.length < 8_000) stderr += chunk.toString('utf8');
    });
    child.on('error', (error) => {
      finish(new SplitterError(`opencode could not start: ${error.message}`));
    });
    child.on('close', (code) => {
      if (stdout.trim().length === 0) {
        const tail = stderr.trim().slice(-500);
        finish(
          new SplitterError(
            `opencode exited with code ${code ?? 'null'} and no output${tail ? `: ${tail}` : ''}`,
          ),
        );
        return;
      }
      finish(null, stdout);
    });
  });
}
