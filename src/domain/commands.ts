import type { ContinueOptions } from './models.js';

export type ParsedCommand =
  | { kind: 'sessions' }
  | { kind: 'status' }
  | { kind: 'stop' }
  | { kind: 'new' }
  | { kind: 'continue'; prompt?: string; options: ContinueOptions };

export function parseCommand(input: string): ParsedCommand | null {
  const text = input.trim();
  if (!text.startsWith('/codex')) {
    return null;
  }

  const rest = text.slice('/codex'.length).trim();
  if (!rest || rest === 'sessions') {
    return { kind: 'sessions' };
  }

  if (rest === 'status') {
    return { kind: 'status' };
  }

  if (rest === 'stop') {
    return { kind: 'stop' };
  }

  if (rest === 'new') {
    return { kind: 'new' };
  }

  if (rest.startsWith('continue')) {
    const prompt = rest.slice('continue'.length).trim();
    return {
      kind: 'continue',
      prompt: prompt || undefined,
      options: {
        syncLatest: false,
        readOnly: false,
        planOnly: false,
      },
    };
  }

  return null;
}
