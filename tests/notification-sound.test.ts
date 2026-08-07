// The notification sounds. These used to be synthesised with the Web Audio API and the
// tests checked oscillator envelopes; they are audio files now, so what is worth asserting
// changed completely. Two of these tests exist to catch a specific way this feature has
// already broken once: a stored preference naming a sound that no longer exists must land
// on the default rather than on silence, and DEFAULT_SOUND itself must name a real entry.
// The file-on-disk test is the third guard in that family — a renamed or forgotten asset is
// invisible to the compiler and would only show up as notifications that make no sound.

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_SOUND,
  SOUNDS,
  playSound,
  soundByName,
  soundNameOrDefault,
  type AudioLike,
} from '../renderer/lib/notification-sound';

const REPO_ROOT = join(__dirname, '..');

function fakeAudio(): AudioLike & { played: number } {
  return {
    volume: -1,
    played: 0,
    play() {
      this.played += 1;
    },
  };
}

describe('SOUNDS', () => {
  it('offers four sounds', () => {
    expect(SOUNDS).toHaveLength(4);
  });

  it('gives every sound a unique name', () => {
    const names = SOUNDS.map((s) => s.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('points every sound at a root-relative mp3 under /sounds', () => {
    for (const s of SOUNDS) {
      expect(s.file, s.name).toMatch(/^\/sounds\/[a-z0-9-]+\.mp3$/);
    }
  });

  it('leaves no label empty', () => {
    for (const s of SOUNDS) expect(s.label.trim(), s.name).not.toBe('');
  });

  // A path that resolves to nothing is silence, and silence is what this feature keeps
  // getting wrong. The renderer serves renderer/public at the root, so the file for
  // `/sounds/x.mp3` is renderer/public/sounds/x.mp3.
  it('ships the file every sound names', () => {
    for (const s of SOUNDS) {
      const onDisk = join(REPO_ROOT, 'renderer', 'public', s.file);
      expect(existsSync(onDisk), `${s.name} -> ${s.file}`).toBe(true);
    }
  });
});

describe('soundByName', () => {
  it('finds a sound that exists', () => {
    expect(soundByName('notify-2')?.file).toBe('/sounds/notify-2.mp3');
  });

  it('returns null for a name that does not', () => {
    expect(soundByName('chime')).toBeNull();
    expect(soundByName('')).toBeNull();
  });
});

describe('DEFAULT_SOUND', () => {
  // The one that matters most: rename a sound and forget this constant, and every
  // untouched preference in the wild goes quiet with nothing to point at.
  it('names a sound that actually exists', () => {
    expect(soundByName(DEFAULT_SOUND)).not.toBeNull();
  });
});

describe('soundNameOrDefault', () => {
  it('resolves the empty preference to the default', () => {
    expect(soundNameOrDefault('')).toBe(DEFAULT_SOUND);
  });

  // The migration case: the synthesised sounds this replaced were removed along with
  // their names, so an existing prefs file can name one of them.
  it('resolves a name that no longer exists to the default', () => {
    expect(soundNameOrDefault('chime')).toBe(DEFAULT_SOUND);
    expect(soundNameOrDefault('arpeggio')).toBe(DEFAULT_SOUND);
  });

  it('leaves a name that does exist alone', () => {
    expect(soundNameOrDefault('notify-3')).toBe('notify-3');
  });
});

describe('playSound', () => {
  it('plays the file the named sound points at', () => {
    const audio = fakeAudio();
    const factory = vi.fn(() => audio);
    expect(playSound('notify-4', 0.5, factory)).toBe(true);
    expect(factory).toHaveBeenCalledWith('/sounds/notify-4.mp3');
    expect(audio.played).toBe(1);
    expect(audio.volume).toBe(0.5);
  });

  it('does not reach for audio at all when the name is unknown', () => {
    const factory = vi.fn(() => fakeAudio());
    expect(playSound('chime', 1, factory)).toBe(false);
    expect(factory).not.toHaveBeenCalled();
  });

  it('does not reach for audio when the volume is zero', () => {
    const factory = vi.fn(() => fakeAudio());
    expect(playSound('notify-1', 0, factory)).toBe(false);
    expect(factory).not.toHaveBeenCalled();
  });

  it('treats a volume that is not a number as muted', () => {
    const factory = vi.fn(() => fakeAudio());
    expect(playSound('notify-1', Number.NaN, factory)).toBe(false);
    expect(factory).not.toHaveBeenCalled();
  });

  it('clamps a volume above one', () => {
    const audio = fakeAudio();
    playSound('notify-1', 4, () => audio);
    expect(audio.volume).toBe(1);
  });

  it('reports false in an environment with no audio', () => {
    expect(playSound('notify-1', 1, () => null)).toBe(false);
  });

  // Chromium rejects play() when the page has had no user gesture. There is nothing
  // useful to do about it, but it must not surface as an unhandled rejection.
  it('swallows a rejected play', () => {
    const audio: AudioLike = { volume: 0, play: () => Promise.reject(new Error('gesture')) };
    expect(() => playSound('notify-1', 1, () => audio)).not.toThrow();
    expect(playSound('notify-1', 1, () => audio)).toBe(true);
  });

  it('reports false when play throws outright', () => {
    const audio: AudioLike = {
      volume: 0,
      play: () => {
        throw new Error('no');
      },
    };
    expect(playSound('notify-1', 1, () => audio)).toBe(false);
  });
});
