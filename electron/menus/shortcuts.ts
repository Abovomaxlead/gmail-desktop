// Maps a key event from a view into an app action. Ctrl/Cmd+Shift+I is the only way
// to open devtools on a Gmail page, so it stays.

export interface KeyInput {
  type: string;
  key: string;
  control: boolean;
  meta: boolean;
  shift: boolean;
  alt: boolean;
}

export type Action =
  | { type: 'switch'; n: number }
  | { type: 'compose' }
  | { type: 'zoom'; dir: 'in' | 'out' | 'reset' }
  | { type: 'reload' }
  | { type: 'devtools' };

/**
 * Turns a key event from a view into an app action
 *
 * @param input
 * @returns the action, or null when the app claims nothing for this combination
 */
export function resolveShortcut(input: KeyInput): Action | null {
  if (input.type !== 'keyDown') return null;
  const mod = input.control || input.meta;
  if (!mod) return null;
  const key = input.key.toLowerCase();
  if (input.shift && key === 'i') return { type: 'devtools' };
  // There is no app menu and so no reload role: without this a Gmail page that has hung
  // can only be got back by restarting the app. Shift is not looked at, so the browser's
  // hard-reload finger memory lands here too.
  if (key === 'r') return { type: 'reload' };
  if (key === 'n') return { type: 'compose' };
  if (key === '0') return { type: 'zoom', dir: 'reset' };
  if (key === '=' || key === '+') return { type: 'zoom', dir: 'in' };
  if (key === '-' || key === '_') return { type: 'zoom', dir: 'out' };
  if (/^[1-9]$/.test(key)) return { type: 'switch', n: Number(key) };
  return null;
}
