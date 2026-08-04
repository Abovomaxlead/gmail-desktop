import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { basename, dirname } from 'node:path';
import type { DownloadRecord } from './ipc';

// Het logboek van wat er is gehaald: één JSON-array met de nieuwste regel vooraan.
//
// Een eigen bestand en geen voorkeur, zoals de opmerking bij
// `IPC.DOWNLOAD_HISTORY_GET` al zegt: dit is een lijst die groeit. In prefs.json
// zou hij bij elke download het hele voorkeurenbestand herschrijven, en één
// halfgeschreven regel zou dan álle instellingen meesleuren.
//
// Alleen een type-import van `./ipc`: de vorm van een regel hoort bij het
// contract dat main, preload en renderer delen, en een echte import zou een
// kring maken (ipc.ts hoort niets van de opslag te weten).

// Hoeveel regels het logboek onthoudt. Een logboek zonder bodem groeit tot het
// inlezen bij het opstarten merkbaar wordt, en na tweehonderd bestanden ga je niet
// meer in deze lijst zoeken maar in de map zelf. Geëxporteerd omdat de test op
// precies deze grens hoort te controleren en niet op zijn eigen getal.
export const MAX_RECORDS = 200;

// De drie standen waarin Electron een download achterlaat. Als losse lijst, zodat
// het coërceren hieronder één plek heeft.
const STATES: readonly DownloadRecord['state'][] = ['completed', 'cancelled', 'interrupted'];

// Alles wat geen bekende stand is wordt 'interrupted' en niet 'completed'. Dat is
// de veilige kant op: 'completed' zet in het paneel een knop aan die het bestand
// opent, en een bestand dat er niet is openen leest als een fout van de app. Een
// regel te veel als mislukt tonen is hinderlijk; een regel te veel als gelukt
// tonen is een leugen.
function toState(raw: unknown): DownloadRecord['state'] {
  return STATES.find((s) => s === raw) ?? 'interrupted';
}

// Eén regel uit het bestand, of `null` als er niets bruikbaars in staat.
function toRecord(raw: unknown): DownloadRecord | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const path = typeof r.path === 'string' ? r.path.trim() : '';
  const filename = typeof r.filename === 'string' ? r.filename.trim() : '';
  // Zonder pad én zonder naam is de regel niets: er valt niets te tonen en niets
  // te openen. Eén van de twee is genoeg — een geannuleerde download heeft soms
  // geen opslagpad, en een met de hand geschreven regel soms geen naam.
  if (!path && !filename) return null;
  return {
    filename: filename || basename(path),
    path,
    url: typeof r.url === 'string' ? r.url : '',
    // Geen maat bekend is 0 en niet weggelaten: het veld is verplicht in het
    // contract, en de renderer hoort geen `undefined` te hoeven opvangen.
    bytes: typeof r.bytes === 'number' && Number.isFinite(r.bytes) && r.bytes >= 0 ? r.bytes : 0,
    startedAt: typeof r.startedAt === 'number' && Number.isFinite(r.startedAt) ? r.startedAt : 0,
    state: toState(r.state),
  };
}

// Wat er van een ingelezen bestand overblijft. Apart van de klasse en zuiver,
// zodat de tolerantie te testen is zonder een bestand op schijf te zetten.
//
// Tolerant zijn is hier de hele opdracht: dit bestand staat in userData, is met
// de hand te openen, en kan halfgeschreven achterblijven als de computer tijdens
// het wegschrijven uitvalt. Eén verpeste regel mag de andere honderdnegenennegentig
// niet meenemen — dus verkeerde regels vallen weg en de rest blijft staan.
export function parseRecords(raw: unknown): DownloadRecord[] {
  if (!Array.isArray(raw)) return [];
  const out: DownloadRecord[] = [];
  for (const item of raw) {
    const record = toRecord(item);
    if (record) out.push(record);
  }
  return out;
}

// De lijst afkappen op `max`. Zuiver en apart, want dit is de enige regel in dit
// bestand waar een afspraak in zit ("de oudste valt af, niet de nieuwste") en die
// hoort in een test te staan.
export function trimRecords(
  records: readonly DownloadRecord[],
  max: number = MAX_RECORDS,
): DownloadRecord[] {
  if (max <= 0) return [];
  return records.slice(0, max);
}

export class DownloadHistoryStore {
  constructor(private readonly filePath: string) {}

  // Nieuwste eerst, altijd. De volgorde in het bestand ís de volgorde: `add`
  // zet er vooraan bij, dus de rij staat op volgorde van afgerond zijn. Er wordt
  // met opzet niet op `startedAt` gesorteerd — een grote download die eerder
  // begon kan later klaar zijn, en dan is "toen was het er" niet de volgorde
  // waarin je het zag gebeuren.
  //
  // De renderer krijgt dit rechtstreeks over IPC, dus hier sorteren betekent dat
  // de tabel het nooit hoeft.
  all(): DownloadRecord[] {
    if (!existsSync(this.filePath)) return [];
    try {
      return parseRecords(JSON.parse(readFileSync(this.filePath, 'utf8')));
    } catch {
      // Halfgeschreven of met de hand verpest: een leeg logboek is jammer, maar
      // de app hoort niet te weigeren op te starten omdat een lijstje van wat je
      // gisteren hebt gehaald stuk is.
      return [];
    }
  }

  // Eén regel erbij, vooraan. De beller geeft `startedAt` mee en de store roept
  // nooit zelf `Date.now()` aan: dan is dit te testen zonder de klok te
  // vervalsen, en de tijd in de lijst is de tijd van de dównload en niet die van
  // het wegschrijven — dat scheelt bij een grote download minuten.
  add(record: DownloadRecord): void {
    this.write(trimRecords([record, ...this.all()]));
  }

  // De hele lijst weg. Het bestand blijft staan met een lege array erin en wordt
  // niet verwijderd: een bestand dat er is en leeg is, is hetzelfde als een
  // bestand dat er niet is (zie `all`), en verwijderen kan mislukken op een pad
  // dat een virusscanner net vasthoudt.
  clear(): void {
    this.write([]);
  }

  private write(records: readonly DownloadRecord[]): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(records, null, 2), 'utf8');
  }
}
