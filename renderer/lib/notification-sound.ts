// The app's notification sounds. They are audio files under renderer/public/sounds, which
// Next copies verbatim into the export, so a root-relative path resolves against the dev
// server and against app://bundle alike and the page never has to know which one it is
// running under. Nothing here touches `Audio` at module level: it does not exist under
// Node, where the tests import this module, so the constructor sits inside playSound
// behind a check.
//
// Sound names are preference keys (`notifications.soundName`). A stored name that no longer
// exists — a renamed file, or a sound dropped from the list — must not resolve to silence:
// there is no system sound to fall back on now that the app draws its own notifications.
// That is why soundNameOrDefault resolves anything it cannot find rather than only the
// empty string, and why the test asserting DEFAULT_SOUND names a real entry is the one that
// matters most in this file. The synthesised sounds these replaced were removed with their
// names, so every preference written before this change lands on that path.
//
// A fresh element per play, rather than one reused per sound, so two notifications close
// together overlap instead of the second cutting the first off. Main's SOUND_GAP_MS
// throttle is what keeps that from becoming a pile.

export interface SoundSpec {
  name: string;
  label: string;
  /** Root-relative, so it resolves under both the dev origin and app://bundle. */
  file: string;
}

export const SOUNDS: readonly SoundSpec[] = [
  { name: 'notify-1', label: 'Notification 1', file: '/sounds/notify-1.mp3' },
  { name: 'notify-2', label: 'Notification 2', file: '/sounds/notify-2.mp3' },
  { name: 'notify-3', label: 'Notification 3', file: '/sounds/notify-3.mp3' },
  { name: 'notify-4', label: 'Notification 4', file: '/sounds/notify-4.mp3' },
];

export function soundByName(name: string): SoundSpec | null {
  return SOUNDS.find((s) => s.name === name) ?? null;
}

export const DEFAULT_SOUND = 'notify-1';

/** The sound to actually play for a stored preference. Resolves an empty *or* unknown name
 *  to the default, so a preference written before a sound was removed is still audible. */
export function soundNameOrDefault(name: string): string {
  return soundByName(name) ? name : DEFAULT_SOUND;
}

/** The slice of HTMLAudioElement this module uses, so the tests can stand in for it. */
export interface AudioLike {
  volume: number;
  play(): Promise<void> | void;
}

function clampVolume(volume: number): number {
  if (!Number.isFinite(volume)) return 0;
  return Math.min(1, Math.max(0, volume));
}

function defaultAudioFactory(src: string): AudioLike | null {
  const g = globalThis as unknown as { Audio?: unknown };
  const ctor = g.Audio;
  if (typeof ctor !== 'function') return null;
  try {
    return new (ctor as new (src: string) => AudioLike)(src);
  } catch {
    return null;
  }
}

/** Plays one sound. False means there was nothing to play — an unknown name, a muted
 *  volume, or an environment without Audio — so a caller can tell those apart from a
 *  sound that played and simply was not heard. A rejected play() is swallowed: Chromium
 *  rejects it when the page has had no user gesture, and there is nothing useful to do. */
export function playSound(
  name: string,
  volume: number,
  audioFactory: (src: string) => AudioLike | null = defaultAudioFactory,
): boolean {
  const spec = soundByName(name);
  if (!spec) return false;

  const level = clampVolume(volume);
  if (level <= 0) return false;

  const audio = audioFactory(spec.file);
  if (!audio) return false;

  audio.volume = level;
  try {
    const played = audio.play() as Promise<void> | void;
    if (played && typeof (played as Promise<void>).then === 'function') {
      void (played as Promise<void>).catch(() => {});
    }
  } catch {
    return false;
  }
  return true;
}
