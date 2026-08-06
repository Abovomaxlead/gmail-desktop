// The synthesised notification sounds: their recipes, lookup by name and scheduling.

import { describe, it, expect } from 'vitest';
import {
  DEFAULT_SOUND,
  SOUNDS,
  soundByName,
  soundNameOrDefault,
  totalDurationMs,
  playSound,
  type AudioContextLike,
} from '../renderer/lib/notification-sound';

interface RecordedRamp {
  kind: 'set' | 'linear' | 'exponential';
  value: number;
  time: number;
}

interface RecordedNote {
  type: string;
  freqs: RecordedRamp[];
  gains: RecordedRamp[];
  startedAt: number | null;
  stoppedAt: number | null;
  connectedToGain: boolean;
  gainConnectedToDestination: boolean;
}

interface FakeContext extends AudioContextLike {
  notes: RecordedNote[];
}

function makeFakeContext(currentTime = 5): FakeContext {
  const notes: RecordedNote[] = [];
  const destination = { connect: (): void => {} };

  const param = (into: RecordedRamp[]) => ({
    setValueAtTime: (value: number, time: number): void => {
      into.push({ kind: 'set', value, time });
    },
    linearRampToValueAtTime: (value: number, time: number): void => {
      into.push({ kind: 'linear', value, time });
    },
    exponentialRampToValueAtTime: (value: number, time: number): void => {
      into.push({ kind: 'exponential', value, time });
    },
  });

  return {
    currentTime,
    destination,
    notes,
    createOscillator() {
      const note: RecordedNote = {
        type: '',
        freqs: [],
        gains: [],
        startedAt: null,
        stoppedAt: null,
        connectedToGain: false,
        gainConnectedToDestination: false,
      };
      notes.push(note);
      return {
        set type(v: string) {
          note.type = v;
        },
        get type() {
          return note.type;
        },
        frequency: param(note.freqs),
        connect: (): void => {
          note.connectedToGain = true;
        },
        start: (when: number): void => {
          note.startedAt = when;
        },
        stop: (when: number): void => {
          note.stoppedAt = when;
        },
      } as unknown as ReturnType<AudioContextLike['createOscillator']>;
    },
    createGain() {
      const note = notes[notes.length - 1];
      return {
        gain: param(note.gains),
        connect: (): void => {
          note.gainConnectedToDestination = true;
        },
      } as unknown as ReturnType<AudioContextLike['createGain']>;
    },
  };
}

describe('SOUNDS', () => {
  it('has unique names', () => {
    const names = SOUNDS.map((s) => s.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('offers between four and six sounds', () => {
    expect(SOUNDS.length).toBeGreaterThanOrEqual(4);
    expect(SOUNDS.length).toBeLessThanOrEqual(6);
  });

  it('never uses the empty name, which is the sentinel for "the default sound"', () => {
    expect(SOUNDS.some((s) => s.name === '')).toBe(false);
  });

  it('gives every sound a label and at least one note', () => {
    for (const s of SOUNDS) {
      expect(s.label.length).toBeGreaterThan(0);
      expect(s.notes.length).toBeGreaterThan(0);
    }
  });

  it('keeps every sound under 600ms', () => {
    for (const s of SOUNDS) {
      expect(totalDurationMs(s)).toBeGreaterThan(0);
      expect(totalDurationMs(s)).toBeLessThan(600);
    }
  });

  it('measures duration as the end of the last note, not the sum', () => {
    expect(
      totalDurationMs({
        name: 'x',
        label: 'X',
        notes: [
          { freq: 440, startMs: 0, durationMs: 200, type: 'sine', gain: 1 },
          { freq: 440, startMs: 100, durationMs: 250, type: 'sine', gain: 1 },
        ],
      }),
    ).toBe(350);
  });

  it('keeps notes audible and within unit gain', () => {
    for (const s of SOUNDS) {
      for (const n of s.notes) {
        expect(n.freq).toBeGreaterThan(20);
        expect(n.freq).toBeLessThan(20000);
        expect(n.gain).toBeGreaterThan(0);
        expect(n.gain).toBeLessThanOrEqual(1);
        expect(n.durationMs).toBeGreaterThan(0);
      }
    }
  });
});

describe('soundByName', () => {
  it('finds a known sound', () => {
    expect(soundByName('chime')?.label).toBe('Chime');
  });

  it('returns null for an unknown name and for the empty name', () => {
    expect(soundByName('does-not-exist')).toBeNull();
    expect(soundByName('')).toBeNull();
  });
});

describe('soundNameOrDefault', () => {
  it('turns the empty stored preference into the default sound', () => {
    expect(soundNameOrDefault('')).toBe(DEFAULT_SOUND);
  });

  it('returns a chosen sound unchanged', () => {
    for (const s of SOUNDS) {
      expect(soundNameOrDefault(s.name)).toBe(s.name);
    }
  });

  // The whole point of the fallback is that it plays. A rename in SOUNDS that leaves
  // DEFAULT_SOUND pointing at nothing would make every default-preferences notification
  // silent again, which is the bug this replaced and which nothing else would catch.
  it('names a sound that actually exists', () => {
    expect(soundByName(DEFAULT_SOUND)).not.toBeNull();
  });

  it('resolves the empty preference to something playSound accepts', () => {
    const ctx = makeFakeContext();
    expect(playSound(soundNameOrDefault(''), 1, () => ctx)).toBe(true);
    expect(ctx.notes.length).toBeGreaterThan(0);
  });
});

describe('playSound', () => {
  it('returns false when no audio context is available', () => {
    expect(() => playSound('chime', 1, () => null)).not.toThrow();
    expect(playSound('chime', 1, () => null)).toBe(false);
  });

  it('returns false under plain Node, using its own factory', () => {
    expect(playSound('chime', 1)).toBe(false);
  });

  it('returns false for an unknown sound', () => {
    const ctx = makeFakeContext();
    expect(playSound('nope', 1, () => ctx)).toBe(false);
    expect(ctx.notes).toHaveLength(0);
  });

  it('returns false and builds nothing at volume 0', () => {
    const ctx = makeFakeContext();
    expect(playSound('chime', 0, () => ctx)).toBe(false);
    expect(ctx.notes).toHaveLength(0);
  });

  it('schedules one oscillator per note with the right frequencies', () => {
    const ctx = makeFakeContext();
    expect(playSound('arpeggio', 1, () => ctx)).toBe(true);
    const spec = soundByName('arpeggio');
    expect(spec).not.toBeNull();
    expect(ctx.notes).toHaveLength(spec!.notes.length);
    expect(ctx.notes.map((n) => n.freqs[0].value)).toEqual(spec!.notes.map((n) => n.freq));
    expect(ctx.notes.map((n) => n.type)).toEqual(spec!.notes.map((n) => n.type));
  });

  it('schedules relative to the context clock', () => {
    const ctx = makeFakeContext(5);
    playSound('chime', 1, () => ctx);
    const spec = soundByName('chime')!;
    expect(ctx.notes[0].startedAt).toBeCloseTo(5, 6);
    expect(ctx.notes[1].startedAt).toBeCloseTo(5 + spec.notes[1].startMs / 1000, 6);
    const end = 5 + (spec.notes[0].startMs + spec.notes[0].durationMs) / 1000;
    expect(ctx.notes[0].stoppedAt).toBeGreaterThan(end);
  });

  it('gives every note an attack and an exponential release', () => {
    const ctx = makeFakeContext();
    playSound('ping', 1, () => ctx);
    const gains = ctx.notes[0].gains;
    expect(gains.map((g) => g.kind)).toEqual(['set', 'linear', 'exponential']);
    expect(gains[0].value).toBeGreaterThan(0);
    expect(gains[0].value).toBeLessThan(0.001);
    expect(gains[1].time).toBeGreaterThan(gains[0].time);
    expect(gains[2].value).toBeGreaterThan(0);
    expect(gains[2].time).toBeGreaterThan(gains[1].time);
  });

  it('scales the peak gain by the volume argument', () => {
    const spec = soundByName('ping')!;
    const loud = makeFakeContext();
    playSound('ping', 1, () => loud);
    const soft = makeFakeContext();
    playSound('ping', 0.25, () => soft);

    expect(loud.notes[0].gains[1].value).toBeCloseTo(spec.notes[0].gain, 6);
    expect(soft.notes[0].gains[1].value).toBeCloseTo(spec.notes[0].gain * 0.25, 6);
  });

  it('clamps a volume above 1 to 1', () => {
    const spec = soundByName('ping')!;
    const ctx = makeFakeContext();
    expect(playSound('ping', 1.5, () => ctx)).toBe(true);
    expect(ctx.notes[0].gains[1].value).toBeCloseTo(spec.notes[0].gain, 6);
  });

  it('treats a negative volume as silence', () => {
    const ctx = makeFakeContext();
    expect(playSound('ping', -1, () => ctx)).toBe(false);
    expect(ctx.notes).toHaveLength(0);
  });

  it('treats a non-finite volume as silence', () => {
    const ctx = makeFakeContext();
    expect(playSound('ping', Number.NaN, () => ctx)).toBe(false);
    expect(ctx.notes).toHaveLength(0);
  });

  it('connects every oscillator through its gain to the destination', () => {
    const ctx = makeFakeContext();
    playSound('knock', 0.8, () => ctx);
    for (const note of ctx.notes) {
      expect(note.connectedToGain).toBe(true);
      expect(note.gainConnectedToDestination).toBe(true);
    }
  });

  it('resumes a suspended context without letting a rejection escape', () => {
    let resumed = 0;
    const base = makeFakeContext();
    const ctx: FakeContext = {
      ...base,
      state: 'suspended',
      resume: () => {
        resumed += 1;
        return Promise.reject(new Error('not allowed'));
      },
    };
    expect(() => playSound('ping', 1, () => ctx)).not.toThrow();
    expect(resumed).toBe(1);
  });

  it('plays every sound in the list', () => {
    for (const s of SOUNDS) {
      const ctx = makeFakeContext();
      expect(playSound(s.name, 1, () => ctx)).toBe(true);
      expect(ctx.notes).toHaveLength(s.notes.length);
    }
  });
});
