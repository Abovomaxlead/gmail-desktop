// The app's notification sounds, synthesised with the Web Audio API. Nothing here
// touches Web Audio at module level: `AudioContext` does not exist under Node, where
// the tests import this module, so every call sits inside playSound behind a check.
// One AudioContext is shared for the window's lifetime - Chromium allows only a
// handful per page. Sound names are preference keys (`notifications.soundName`), so
// renaming one makes a stored preference fall back to the system sound silently.
// `exponentialRampToValueAtTime` cannot target 0, hence the near-silent SILENCE, and
// 'custom' stays in OscillatorType only so a real OscillatorNode remains assignable.

export type OscillatorType = 'sine' | 'square' | 'sawtooth' | 'triangle' | 'custom';

export type SoundWave = Exclude<OscillatorType, 'custom'>;

interface AudioParamLike {
  setValueAtTime(value: number, startTime: number): void;
  linearRampToValueAtTime(value: number, endTime: number): void;
  exponentialRampToValueAtTime(value: number, endTime: number): void;
}

interface AudioNodeLike {
  connect(destination: AudioNodeLike): void;
}

interface OscillatorLike extends AudioNodeLike {
  type: OscillatorType;
  readonly frequency: AudioParamLike;
  start(when: number): void;
  stop(when: number): void;
}

interface GainLike extends AudioNodeLike {
  readonly gain: AudioParamLike;
}

export interface AudioContextLike {
  readonly currentTime: number;
  readonly destination: AudioNodeLike;
  createOscillator(): OscillatorLike;
  createGain(): GainLike;
  readonly state?: string;
  resume?(): Promise<void>;
}

export interface SoundNote {
  freq: number;
  startMs: number;
  durationMs: number;
  type: SoundWave;
  gain: number;
}

export interface SoundSpec {
  name: string;
  label: string;
  readonly notes: readonly SoundNote[];
}

export const SOUNDS: readonly SoundSpec[] = [
  {
    name: 'chime',
    label: 'Chime',
    notes: [
      { freq: 523.25, startMs: 0, durationMs: 190, type: 'triangle', gain: 0.5 },
      { freq: 783.99, startMs: 110, durationMs: 260, type: 'triangle', gain: 0.45 },
    ],
  },
  {
    name: 'ping',
    label: 'Ping',
    notes: [{ freq: 880, startMs: 0, durationMs: 220, type: 'sine', gain: 0.42 }],
  },
  {
    name: 'arpeggio',
    label: 'Arpeggio',
    notes: [
      { freq: 523.25, startMs: 0, durationMs: 150, type: 'triangle', gain: 0.4 },
      { freq: 659.25, startMs: 90, durationMs: 150, type: 'triangle', gain: 0.4 },
      { freq: 783.99, startMs: 180, durationMs: 220, type: 'triangle', gain: 0.38 },
    ],
  },
  {
    name: 'knock',
    label: 'Knock',
    notes: [
      { freq: 146.83, startMs: 0, durationMs: 90, type: 'sine', gain: 0.6 },
      { freq: 110, startMs: 100, durationMs: 130, type: 'sine', gain: 0.55 },
    ],
  },
  {
    name: 'tick',
    label: 'Tick',
    notes: [{ freq: 1318.51, startMs: 0, durationMs: 45, type: 'triangle', gain: 0.22 }],
  },
];

export function soundByName(name: string): SoundSpec | null {
  return SOUNDS.find((s) => s.name === name) ?? null;
}

export function totalDurationMs(spec: SoundSpec): number {
  let end = 0;
  for (const note of spec.notes) {
    const noteEnd = note.startMs + note.durationMs;
    if (noteEnd > end) end = noteEnd;
  }
  return end;
}

const ATTACK_S = 0.008;
const SILENCE = 0.0001;
const STOP_PADDING_S = 0.02;

let sharedCtx: AudioContextLike | null = null;

function defaultCtxFactory(): AudioContextLike | null {
  const g = globalThis as unknown as { AudioContext?: unknown };
  const ctor = g.AudioContext;
  if (typeof ctor !== 'function') return null;
  try {
    return new (ctor as new () => AudioContextLike)();
  } catch {
    return null;
  }
}

function resumeIfSuspended(ctx: AudioContextLike): void {
  if (ctx.state !== 'suspended' || !ctx.resume) return;
  void ctx.resume().catch(() => {});
}

function clampVolume(volume: number): number {
  if (!Number.isFinite(volume)) return 0;
  return Math.min(1, Math.max(0, volume));
}

export function playSound(
  name: string,
  volume: number,
  ctxFactory?: () => AudioContextLike | null,
): boolean {
  const spec = soundByName(name);
  if (!spec) return false;

  const level = clampVolume(volume);
  if (level <= 0) return false;

  let ctx: AudioContextLike | null;
  if (ctxFactory) {
    ctx = ctxFactory();
  } else {
    sharedCtx ??= defaultCtxFactory();
    ctx = sharedCtx;
  }
  if (!ctx) return false;

  resumeIfSuspended(ctx);

  const now = ctx.currentTime;

  for (const note of spec.notes) {
    const start = now + note.startMs / 1000;
    const end = start + note.durationMs / 1000;
    const peak = note.gain * level;
    const attackEnd = start + Math.min(ATTACK_S, note.durationMs / 3000);

    const osc = ctx.createOscillator();
    const env = ctx.createGain();

    osc.type = note.type;
    osc.frequency.setValueAtTime(note.freq, start);

    env.gain.setValueAtTime(SILENCE, start);
    env.gain.linearRampToValueAtTime(peak, attackEnd);
    env.gain.exponentialRampToValueAtTime(SILENCE, end);

    osc.connect(env);
    env.connect(ctx.destination);
    osc.start(start);
    osc.stop(end + STOP_PADDING_S);
  }

  return true;
}
