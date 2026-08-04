// De meldingsgeluiden van de app, gemaakt met de Web Audio API in plaats van
// meegebundeld als bestand. Waarom niet gewoon een paar mp3'jes: elk geluidje dat
// je downloadt hangt aan een licentie, en dit is een app die we uitleveren — dan is
// "waar komt dit bestand vandaan en mag het mee" een vraag die iemand ooit moet
// beantwoorden. Een toon die de app zelf berekent heeft geen herkomst, geen
// bestandsgrootte en werkt op elk platform hetzelfde.
//
// Dit bestand staat onder renderer/lib/ om dezelfde reden als surfaces.ts: dat is de
// enige map die zowel Next.js (die niet buiten zijn eigen root kan importeren) als
// esbuild en vitest kunnen lezen. Zie de kop van surfaces.ts.
//
// Belangrijk voor de tests: hier staat geen enkele aanroep van Web Audio op
// moduleniveau. Alles wat een AudioContext aanraakt zit binnen `playSound`, achter
// een check. Zo is deze module ook onder gewoon Node te importeren — daar bestaat
// `AudioContext` niet, en een aanraking bij het inlezen zou elke test die dit
// bestand importeert laten klappen nog voordat hij iets test.

// De DOM-types (`AudioContext`, `OscillatorType`) komen uit de lib "dom", die de
// renderer-tsconfig wel heeft en de root-tsconfig — waarmee de tests worden
// getypecheckt — niet. Een lib toevoegen aan die tsconfig zou de hele
// main-processcode ineens `window` en `document` laten zien, en dat is precies de
// vergissing die je daar wil kunnen maken. Daarom staan hier de minimale vormen die
// we echt gebruiken. Ze zijn structureel gelijk aan de echte, dus een echte
// AudioContext past er zonder cast in — vandaar dat 'custom' hieronder meedoet
// hoewel wij het nooit gebruiken: laat je het weg, dan past de echte
// OscillatorNode.type niet meer en is de hele context onverenigbaar.
export type OscillatorType = 'sine' | 'square' | 'sawtooth' | 'triangle' | 'custom';

// Wat een recept mag bevatten. 'custom' hoort daar niet bij: die vorm bestaat pas als
// je met `setPeriodicWave` een eigen golf hebt opgegeven, en een noot die dat niet
// doet zou stil blijven. Weren in het type in plaats van erop controleren.
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
  // Optioneel, zodat een neptest-context maar drie dingen hoeft te kunnen. In een
  // echte browser bestaan ze altijd; zie `resumeIfSuspended` voor waarom we ze
  // nodig hebben.
  readonly state?: string;
  resume?(): Promise<void>;
}

export interface SoundNote {
  freq: number;
  // Vanaf het moment dat het geluid begint, niet vanaf nu: `playSound` legt er de
  // `currentTime` van de context bij op. Zo is een recept los van wanneer het speelt.
  startMs: number;
  durationMs: number;
  type: SoundWave;
  // 0..1, de luidheid van deze noot binnen het geluid. Wordt nog vermenigvuldigd
  // met het volume uit de voorkeuren.
  gain: number;
}

export interface SoundSpec {
  // De sleutel die in de voorkeuren staat (`notifications.soundName`). Verander die
  // nooit van een bestaand geluid: dan wijst het opgeslagen bestand van iemand naar
  // niets meer en valt hij stil terug op het systeemgeluid.
  name: string;
  label: string;
  readonly notes: readonly SoundNote[];
}

// Een geluid is data, geen functie. Een nieuw geluid toevoegen is daarom een regel
// in deze lijst en niet een nieuwe tak in `playSound` — en de tests kunnen elk
// recept nakijken (lengte, luidheid) zonder iets te laten klinken.
//
// Alle frequenties zijn echte noten in gelijkzwevende stemming met A4 = 440 Hz, en
// de afstanden ertussen zijn muzikale intervallen. Twee willekeurige getallen naast
// elkaar klinken als een storing; een kwint of een terts klinkt als een signaal.
//
// Alles blijft onder ~600 ms. Een meldingsgeluid dat langer duurt dan de melding
// zelf op het scherm staat, of dat nog naklinkt als je al aan het typen bent, wordt
// het eerste wat iemand uitzet. Kort is hier geen zuinigheid maar het ontwerp.
export const SOUNDS: readonly SoundSpec[] = [
  {
    name: 'chime',
    label: 'Chime',
    // Twee tonen die omhoog gaan: C5 (523,25) naar G5 (783,99), een reine kwint.
    // Omhoog klinkt als "er is iets bijgekomen"; omlaag klinkt als een foutmelding,
    // en dat is niet wat nieuwe post is. De kwint is het meest neutrale, open
    // interval dat er is — hij klinkt niet blij en niet triest, dus hij wordt niet
    // vervelend als je hem twintig keer per dag hoort. Driehoeksgolf: zachter dan
    // een blokgolf, iets meer lichaam dan een sinus.
    notes: [
      { freq: 523.25, startMs: 0, durationMs: 190, type: 'triangle', gain: 0.5 },
      { freq: 783.99, startMs: 110, durationMs: 260, type: 'triangle', gain: 0.45 },
    ],
  },
  {
    name: 'ping',
    label: 'Ping',
    // Eén zachte sinus op A5 (880 Hz, de a boven de stemvork-a). Een pure sinus
    // heeft geen boventonen en snijdt dus niet; op deze hoogte hoor je hem door
    // muziek of gepraat heen zonder dat hij schel is. Het kortste bruikbare geluid
    // dat nog een toon is en geen tik.
    notes: [{ freq: 880, startMs: 0, durationMs: 220, type: 'sine', gain: 0.42 }],
  },
  {
    name: 'arpeggio',
    label: 'Arpeggio',
    // Een gebroken C-majeurdrieklank: C5 (523,25) - E5 (659,25) - G5 (783,99), dus
    // grote terts plus kleine terts. Drie noten na elkaar is het maximum: bij vier
    // wordt het een melodietje, en een melodietje bij elke mail is te veel. 90 ms
    // ertussen is snel genoeg om als één gebaar te klinken in plaats van als drie
    // losse piepjes.
    notes: [
      { freq: 523.25, startMs: 0, durationMs: 150, type: 'triangle', gain: 0.4 },
      { freq: 659.25, startMs: 90, durationMs: 150, type: 'triangle', gain: 0.4 },
      { freq: 783.99, startMs: 180, durationMs: 220, type: 'triangle', gain: 0.38 },
    ],
  },
  {
    name: 'knock',
    label: 'Knock',
    // Twee lage tikken die omlaag gaan: D3 (146,83) naar A2 (110), een reine kwart
    // omlaag. Zo laag en zo kort klinkt een toon niet meer als een noot maar als een
    // klop op hout — het oor hoort bij deze frequenties eerder de aanzet dan de
    // toonhoogte. Niet nóg lager (A1, 55 Hz) hoewel dat "houter" zou zijn: een
    // laptopluidspreker geeft onder ongeveer 150 Hz nauwelijks nog iets, en een
    // meldingsgeluid dat je op de helft van de machines niet hoort is geen geluid.
    // Sinus, want een blokgolf hier onderin geeft boventonen die wél schel zijn.
    notes: [
      { freq: 146.83, startMs: 0, durationMs: 90, type: 'sine', gain: 0.6 },
      { freq: 110, startMs: 100, durationMs: 130, type: 'sine', gain: 0.55 },
    ],
  },
  {
    name: 'tick',
    label: 'Tick',
    // Eén heel korte, zachte hoge toon: E6 (1318,51). 45 ms is ongeveer 60 golven —
    // net genoeg om een toonhoogte te hebben en niet genoeg om als toon te
    // registreren, dus je hoort een tik. Bewust op lage `gain`: dit is het geluid
    // voor wie eigenlijk niets wil horen maar wel wil weten dát er iets was.
    notes: [{ freq: 1318.51, startMs: 0, durationMs: 45, type: 'triangle', gain: 0.22 }],
  },
];

// Onbekend is hier geen fout maar de normale toestand: een lege naam betekent in de
// voorkeuren "laat het besturingssysteem zijn eigen meldingsgeluid spelen", en dat
// is de stand waarmee iedereen begint. Een oude naam uit een voorkeurenbestand van
// een vorige versie komt hier ook uit, en moet net zo stil eindigen als hij nooit
// heeft bestaan — niet in een uitzondering.
export function soundByName(name: string): SoundSpec | null {
  return SOUNDS.find((s) => s.name === name) ?? null;
}

// De totale lengte is niet de som van de noten maar het einde van de laatste die
// afloopt: de noten overlappen met opzet (dat is wat een akkoord of een naklank is),
// dus optellen zou een veel te hoog getal geven. De tests gebruiken dit om de
// grens van ~600 ms te bewaken.
export function totalDurationMs(spec: SoundSpec): number {
  let end = 0;
  for (const note of spec.notes) {
    const noteEnd = note.startMs + note.durationMs;
    if (noteEnd > end) end = noteEnd;
  }
  return end;
}

// Hoe snel een noot op volume komt. Zonder aanloop zou de golf van 0 naar zijn
// volle waarde springen, en zo'n sprong is een klik — je hoort hem als een tik vóór
// de toon, bij elke melding. 8 ms is kort genoeg om nog als "direct" te voelen en
// lang genoeg om de klik weg te halen.
const ATTACK_S = 0.008;
// Waar de uitdoving naartoe gaat. `exponentialRampToValueAtTime` kan niet naar 0
// (dat is in een exponentiële curve oneindig ver weg en de browser gooit een fout),
// dus mikken we op een waarde die ver onder het gehoor ligt. Exponentieel en niet
// lineair omdat een geluid dat lineair uitdooft halverwege al hoorbaar "afgeknepen"
// klinkt; exponentieel is hoe een aangeslagen snaar of bel wegvalt.
const SILENCE = 0.0001;
// Iets extra ruimte voordat de oscillator stopt. Precies op het einde stoppen kan de
// laatste stap van de uitdoving afkappen, en een afgekapte golf is opnieuw een klik.
const STOP_PADDING_S = 0.02;

// Eén AudioContext voor de hele levensduur van het venster. Per melding een nieuwe
// maken lekt: een context houdt een audio-thread en een hardware-verbinding vast tot
// hij expliciet gesloten wordt, en Chromium staat er maar een handvol per pagina toe
// — na een paar dozijn meldingen krijg je geen geluid meer, en de fout die je dan
// ziet zegt niets over de oorzaak.
let sharedCtx: AudioContextLike | null = null;

// De echte context, of null als er geen audio bestaat. Dat laatste is geen
// uitzonderingsgeval: deze module wordt ook onder Node geïmporteerd (tests), en daar
// is `AudioContext` er simpelweg niet. Via `globalThis` en een typeof-check in plaats
// van een directe verwijzing, want een directe verwijzing zou onder Node al bij het
// inlezen een ReferenceError geven.
function defaultCtxFactory(): AudioContextLike | null {
  const g = globalThis as unknown as { AudioContext?: unknown };
  const ctor = g.AudioContext;
  if (typeof ctor !== 'function') return null;
  try {
    return new (ctor as new () => AudioContextLike)();
  } catch {
    // Een browser mag het aanmaken weigeren (te veel contexten, geen audio-apparaat).
    // Een melding is het niet waard om de renderer op te blazen.
    return null;
  }
}

// Chromium start een context "suspended" tot de pagina een echte gebruikersklik heeft
// gehad (het autoplay-beleid). In een Electron-venster is dat vrijwel altijd al
// gebeurd — je hebt de app aangeklikt om hem te gebruiken — maar niet gegarandeerd:
// een melding die binnenkomt terwijl het venster net is geopend en nog nergens op is
// geklikt, treft een slapende context. `resume()` is dan het enige wat helpt, en de
// belofte die hij teruggeeft mag afketsen zonder dat het iets kapotmaakt: dan blijft
// die ene melding stil in plaats van dat de renderer een onafgehandelde afwijzing
// logt.
function resumeIfSuspended(ctx: AudioContextLike): void {
  if (ctx.state !== 'suspended' || !ctx.resume) return;
  void ctx.resume().catch(() => {});
}

// 0..1. Buiten bereik wordt naar binnen getrokken en niet geweigerd, net als
// `unitRange` in prefs-store.ts: 1.5 betekent onmiskenbaar "hard", en dan is 1 het
// juiste antwoord. NaN betekent niets en wordt daarom 0 — stil is de veilige kant.
function clampVolume(volume: number): number {
  if (!Number.isFinite(volume)) return 0;
  return Math.min(1, Math.max(0, volume));
}

/**
 * Speelt een geluid uit `SOUNDS`. Geeft terug of er daadwerkelijk iets is
 * ingepland, zodat de aanroeper kan zien of het zin heeft (en een test het kan
 * nakijken) — maar gooit nooit: een melding hoort geen renderer om te kunnen leggen.
 *
 * `ctxFactory` bestaat voor de tests. Wordt hij meegegeven, dan slaan we het
 * resultaat niet op in `sharedCtx`: twee tests achter elkaar moeten elk hun eigen
 * nepcontext zien, anders meet de tweede wat de eerste heeft opgebouwd.
 */
export function playSound(
  name: string,
  volume: number,
  ctxFactory?: () => AudioContextLike | null,
): boolean {
  const spec = soundByName(name);
  if (!spec) return false;

  const level = clampVolume(volume);
  // Op nul geen knopen bouwen. Niet uit zuinigheid: een geluid van niets is nog
  // steeds een geluid dat de context wakker maakt, en op sommige systemen hoor je
  // dan een zacht plopje van de audio-uitgang die aanslaat.
  if (level <= 0) return false;

  let ctx: AudioContextLike | null;
  if (ctxFactory) {
    ctx = ctxFactory();
  } else {
    sharedCtx ??= defaultCtxFactory();
    ctx = sharedCtx;
  }
  // Geen audio beschikbaar: Node, of een venster waar audio nog geblokkeerd is.
  // Stil terug, geen fout.
  if (!ctx) return false;

  resumeIfSuspended(ctx);

  // Alle tijden komen van de context zelf. Date.now() of een setTimeout zou de noten
  // meten met een andere klok dan die waarop ze klinken, en dan schuift een akkoord
  // uit elkaar zodra de renderer even druk is. `currentTime` is de klok van de
  // audio-thread en die hapert niet mee.
  const now = ctx.currentTime;

  for (const note of spec.notes) {
    const start = now + note.startMs / 1000;
    const end = start + note.durationMs / 1000;
    const peak = note.gain * level;
    // Bij een heel korte noot (de tik) zou een vaste aanloop van 8 ms een derde van
    // de noot zijn en de uitdoving geen ruimte laten; dan gaat de aanloop mee omlaag.
    const attackEnd = start + Math.min(ATTACK_S, note.durationMs / 3000);

    const osc = ctx.createOscillator();
    const env = ctx.createGain();

    osc.type = note.type;
    // setValueAtTime en niet `frequency.value =`: die laatste geldt onmiddellijk, en
    // bij overlappende noten is "onmiddellijk" het verkeerde moment.
    osc.frequency.setValueAtTime(note.freq, start);

    // De omhullende: vanaf bijna-stil omhoog in ATTACK_S, daarna exponentieel weg.
    // Beginnen op SILENCE en niet op 0, want een exponentiële ramp die op 0 begint
    // blijft daar (0 maal wat dan ook is 0).
    env.gain.setValueAtTime(SILENCE, start);
    env.gain.linearRampToValueAtTime(peak, attackEnd);
    env.gain.exponentialRampToValueAtTime(SILENCE, end);

    osc.connect(env);
    env.connect(ctx.destination);
    osc.start(start);
    // Stoppen is verplicht, niet netjes: een oscillator die je niet stopt blijft
    // draaien tot de context weg is. Onhoorbaar door de omhullende, maar hij kost
    // rekentijd en er komt er een bij per melding.
    osc.stop(end + STOP_PADDING_S);
  }

  return true;
}
