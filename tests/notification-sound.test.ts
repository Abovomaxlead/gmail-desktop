import { describe, it, expect } from 'vitest';
import {
  SOUNDS,
  soundByName,
  totalDurationMs,
  playSound,
  type AudioContextLike,
} from '../renderer/lib/notification-sound';

// Deze test loopt in Node, zonder jsdom en dus zonder Web Audio. Dat is met opzet:
// de belangrijkste eigenschap van deze module is dat hij overleeft waar geen audio
// is, en dat kun je niet nakijken in een omgeving die audio nabootst. Waar we wel
// willen zien wát er wordt ingepland, bouwen we hieronder een nepcontext die
// meeschrijft in plaats van geluid te maken.

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

// Eén oscillator plus één gain-knoop per noot, zoals playSound ze aanmaakt. De
// nepcontext koppelt ze op de volgorde van aanmaken aan elkaar: playSound maakt
// altijd eerst de oscillator en dan de gain voor dezelfde noot, dus de laatst
// aangemaakte oscillator is degene waar de volgende gain bij hoort.
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

// Er is geen opruimhaak nodig voor de gedeelde context binnen de module: die wordt
// alleen gevuld door de eigen fabriek, en die geeft onder Node altijd null. Elke test
// die iets wil zien geeft zijn eigen nepcontext mee, en die wordt met opzet niet
// bewaard — anders zou de tweede test meten wat de eerste heeft opgebouwd.

describe('SOUNDS', () => {
  // Dubbele namen zouden pas opvallen als iemand een geluid kiest en er een ander
  // klinkt: `soundByName` pakt de eerste, de instellingenlijst toont beide.
  it('has unique names', () => {
    const names = SOUNDS.map((s) => s.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('offers between four and six sounds', () => {
    expect(SOUNDS.length).toBeGreaterThanOrEqual(4);
    expect(SOUNDS.length).toBeLessThanOrEqual(6);
  });

  // Een lege naam is in de voorkeuren de sleutel voor "gebruik het geluid van het
  // besturingssysteem". Een geluid dat óók '' heet zou die betekenis overschrijven
  // en dus onbereikbaar maken.
  it('never uses the empty name, which means "let the OS play its own sound"', () => {
    expect(SOUNDS.some((s) => s.name === '')).toBe(false);
  });

  it('gives every sound a label and at least one note', () => {
    for (const s of SOUNDS) {
      expect(s.label.length).toBeGreaterThan(0);
      expect(s.notes.length).toBeGreaterThan(0);
    }
  });

  // De grens die het ontwerp draagt: een geluid dat langer duurt dan de melding op
  // het scherm staat wordt het eerste wat iemand uitzet. Zonder deze test schuift
  // een nieuw geluid daar ongemerkt langs.
  it('keeps every sound under 600ms', () => {
    for (const s of SOUNDS) {
      expect(totalDurationMs(s)).toBeGreaterThan(0);
      expect(totalDurationMs(s)).toBeLessThan(600);
    }
  });

  // Noten mogen overlappen, dus de totale duur is het einde van de laatste noot en
  // niet de som. Optellen zou hier 450 geven in plaats van 370 en de grens hierboven
  // op het verkeerde getal bewaken.
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

  // Elke noot moet in het hoorbare bereik liggen en binnen 0..1 blijven: een gain
  // boven 1 klipt hoorbaar zodra er twee noten tegelijk klinken.
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

  // Niet gooien maar null. Een voorkeurenbestand van een oudere versie kan een naam
  // bevatten die we niet meer hebben, en dan moet de app stil zijn, niet stuk.
  it('returns null for an unknown name and for the empty name', () => {
    expect(soundByName('does-not-exist')).toBeNull();
    expect(soundByName('')).toBeNull();
  });
});

describe('playSound', () => {
  // Het geval dat er echt om gaat. Deze regel loopt hier onder Node, waar
  // `AudioContext` niet bestaat, maar hij loopt in de app ook in een venster dat nog
  // niet is aangeklikt: Chromium weigert dan audio. Beide keren mag er alleen
  // `false` uitkomen — een uitzondering hier zou de listener in de topbalk breken,
  // en dat is de renderer die de tabbladen tekent.
  it('returns false when no audio context is available', () => {
    expect(() => playSound('chime', 1, () => null)).not.toThrow();
    expect(playSound('chime', 1, () => null)).toBe(false);
  });

  // En zonder injectie: onder Node is er geen `AudioContext` op globalThis, dus dit
  // is dezelfde weg maar via de echte fabriek. Zo weten we dat die fabriek zelf niet
  // gooit bij een ontbrekende constructor.
  it('returns false under plain Node, using its own factory', () => {
    expect(playSound('chime', 1)).toBe(false);
  });

  it('returns false for an unknown sound', () => {
    const ctx = makeFakeContext();
    expect(playSound('nope', 1, () => ctx)).toBe(false);
    expect(ctx.notes).toHaveLength(0);
  });

  // Op nul bouwen we niets: knopen aanmaken voor stilte maakt de audio-uitgang wakker
  // en dat is op sommige systemen een hoorbaar plopje.
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

  // Alles hangt aan `currentTime` en niet aan Date.now(): de audioklok is de enige
  // klok waarop de noten daadwerkelijk klinken. Met een context die op 5 seconden
  // staat moet de eerste noot dus op 5 beginnen en niet op 0.
  it('schedules relative to the context clock', () => {
    const ctx = makeFakeContext(5);
    playSound('chime', 1, () => ctx);
    const spec = soundByName('chime')!;
    expect(ctx.notes[0].startedAt).toBeCloseTo(5, 6);
    expect(ctx.notes[1].startedAt).toBeCloseTo(5 + spec.notes[1].startMs / 1000, 6);
    // Stoppen gebeurt ná het einde van de noot, met wat marge: precies op het einde
    // afkappen geeft een klik.
    const end = 5 + (spec.notes[0].startMs + spec.notes[0].durationMs) / 1000;
    expect(ctx.notes[0].stoppedAt).toBeGreaterThan(end);
  });

  // Zonder omhullende klikt elke noot hoorbaar. De vorm die we eisen: begin bijna
  // stil, lineair omhoog naar de piek, dan exponentieel weg — en nooit exact naar 0,
  // want een exponentiële ramp naar 0 gooit in de browser een fout.
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

  // Het volume komt uit de voorkeuren en die worden ook met de hand bewerkt. Naar
  // binnen trekken in plaats van weigeren, zoals prefs-store.ts het ook doet: 1.5
  // betekent "hard", en dat is 1.
  it('clamps a volume above 1 to 1', () => {
    const spec = soundByName('ping')!;
    const ctx = makeFakeContext();
    expect(playSound('ping', 1.5, () => ctx)).toBe(true);
    expect(ctx.notes[0].gains[1].value).toBeCloseTo(spec.notes[0].gain, 6);
  });

  // Een negatief volume is geen "extra stil" maar een omgekeerde golf: hij zou net
  // zo hard klinken, alleen in tegenfase. Daarom naar 0 en dus stil.
  it('treats a negative volume as silence', () => {
    const ctx = makeFakeContext();
    expect(playSound('ping', -1, () => ctx)).toBe(false);
    expect(ctx.notes).toHaveLength(0);
  });

  // NaN kan uit een kapot voorkeurenbestand komen. Doorgeven zou de gain op NaN
  // zetten en dan zwijgt de hele audiograaf van dat venster, ook voor volgende
  // meldingen — een fout die pas veel later opvalt.
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

  // Een slapende context (het autoplay-beleid van Chromium) wordt gewekt, en een
  // afketsende belofte mag niets breken — anders logt de renderer een onafgehandelde
  // afwijzing bij elke melding die te vroeg komt.
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

  // Elk geluid uit de lijst moet daadwerkelijk te spelen zijn. Zonder deze test kan
  // een nieuw geluid in `SOUNDS` staan met een typefout in een veld en pas opvallen
  // wanneer iemand het kiest.
  it('plays every sound in the list', () => {
    for (const s of SOUNDS) {
      const ctx = makeFakeContext();
      expect(playSound(s.name, 1, () => ctx)).toBe(true);
      expect(ctx.notes).toHaveLength(s.notes.length);
    }
  });
});
