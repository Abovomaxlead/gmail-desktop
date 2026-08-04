import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DownloadRecord } from '../electron/ipc';
import {
  DownloadHistoryStore,
  MAX_RECORDS,
  parseRecords,
  trimRecords,
} from '../electron/download-history';

let dir: string;
let file: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'download-history-'));
  file = join(dir, 'downloads.json');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

// Een regel maken kost anders vijf velden per test, en dan gaat de test over het
// invullen van velden in plaats van over wat hij bewijst.
function record(patch: Partial<DownloadRecord> = {}): DownloadRecord {
  return {
    filename: 'factuur.pdf',
    path: 'C:\\Users\\rene\\Downloads\\factuur.pdf',
    url: 'https://mail.google.com/factuur.pdf',
    bytes: 12345,
    startedAt: 1_700_000_000_000,
    state: 'completed',
    ...patch,
  };
}

describe('DownloadHistoryStore', () => {
  // De eerste keer dat het paneel opengaat bestaat het bestand nog niet. Dat is de
  // gewone toestand en geen fout, dus er hoort een lege lijst uit te komen en geen
  // uitzondering die het instellingenpaneel wit laat.
  it('returns an empty list when the file is missing', () => {
    expect(new DownloadHistoryStore(file).all()).toEqual([]);
  });

  // Het logboek moet een herstart overleven — dat is de hele reden dat het op
  // schijf staat. Een tweede instantie op hetzelfde pad is wat er na een herstart
  // gebeurt.
  it('persists a record and reads it back from a fresh instance', () => {
    new DownloadHistoryStore(file).add(record());
    expect(new DownloadHistoryStore(file).all()).toEqual([record()]);
  });

  // De nieuwste bovenaan, want zo leest de tabel en zo hoeft de renderer niet te
  // sorteren. Dit vastleggen omdat `add` prepend doet en een latere "kleine
  // opschoning" er zo een push van maakt.
  it('keeps the newest record first', () => {
    const store = new DownloadHistoryStore(file);
    store.add(record({ filename: 'oud.pdf' }));
    store.add(record({ filename: 'nieuw.pdf' }));
    expect(store.all().map((r) => r.filename)).toEqual(['nieuw.pdf', 'oud.pdf']);
  });

  // Zonder bodem groeit het bestand tot het inlezen bij het opstarten merkbaar
  // wordt. De test controleert ook wélke regel afvalt: de oudste, nooit de nieuwste.
  //
  // De volle lijst wordt rechtstreeks weggeschreven in plaats van er
  // tweehonderd keer `add` op te doen: dat is tweehonderd keer hetzelfde bestand
  // lezen én schrijven, en de test gaat over de grens en niet over de schijf.
  it('trims to MAX_RECORDS and drops the oldest', () => {
    const full = Array.from({ length: MAX_RECORDS }, (_, i) => record({ filename: `oud-${i}.pdf` }));
    writeFileSync(file, JSON.stringify(full), 'utf8');
    const store = new DownloadHistoryStore(file);
    store.add(record({ filename: 'nieuw.pdf' }));
    const all = store.all();
    expect(all).toHaveLength(MAX_RECORDS);
    expect(all[0].filename).toBe('nieuw.pdf');
    expect(all.some((r) => r.filename === `oud-${MAX_RECORDS - 1}.pdf`)).toBe(false);
  });

  // Wissen is niet terug te draaien, dus het moet ook echt alles weghalen — en het
  // resultaat moet er hetzelfde uitzien als een logboek dat nog nooit iets zag.
  it('clears the whole list', () => {
    const store = new DownloadHistoryStore(file);
    store.add(record());
    store.clear();
    expect(store.all()).toEqual([]);
    expect(new DownloadHistoryStore(file).all()).toEqual([]);
  });

  // Het bestand staat in userData en kan halfgeschreven achterblijven als de
  // computer tijdens het wegschrijven uitvalt. De app hoort dan te starten met een
  // leeg lijstje, niet te weigeren.
  it('tolerates a corrupt file by returning an empty list', () => {
    writeFileSync(file, '[{"filename": "half', 'utf8');
    expect(new DownloadHistoryStore(file).all()).toEqual([]);
  });

  // Geldige JSON die geen array is (iemand maakte er met de hand een object van)
  // is net zo onbruikbaar als kapotte JSON, en mag dus ook niets opgooien.
  it('ignores a file that holds something other than an array', () => {
    writeFileSync(file, '{"downloads": []}', 'utf8');
    expect(new DownloadHistoryStore(file).all()).toEqual([]);
  });

  // Na een kapot bestand moet je er nog wél iets bij kunnen zetten: `add` leest,
  // en als dat lezen faalt hoort het te schrijven alsof de lijst leeg was.
  it('recovers by writing a fresh list after a corrupt read', () => {
    writeFileSync(file, 'niet eens json', 'utf8');
    const store = new DownloadHistoryStore(file);
    store.add(record());
    expect(new DownloadHistoryStore(file).all()).toEqual([record()]);
  });
});

describe('parseRecords', () => {
  // Eén verpeste regel mag de rest niet meenemen: dat is het verschil tussen "een
  // download uit de lijst kwijt" en "de hele lijst kwijt".
  it('drops junk entries and keeps the usable ones', () => {
    const parsed = parseRecords([
      null,
      'een tekst',
      42,
      ['een array'],
      {}, // geen pad en geen naam: er valt niets te tonen en niets te openen
      { filename: '   ', path: '' },
      record({ filename: 'goed.pdf' }),
    ]);
    expect(parsed.map((r) => r.filename)).toEqual(['goed.pdf']);
  });

  // Een stand die de app niet kent wordt 'interrupted' en niet 'completed': op
  // 'completed' zet het paneel de knop aan die het bestand opent, en een bestand
  // dat er niet is openen leest als een fout van de app.
  it('coerces an unknown state to interrupted', () => {
    expect(parseRecords([record({ state: 'geslaagd?' as DownloadRecord['state'] })])[0].state).toBe(
      'interrupted',
    );
    expect(parseRecords([{ ...record(), state: undefined }])[0].state).toBe('interrupted');
  });

  // Een maat of tijd die geen getal is zou in de tabel als "NaN kB" of als een
  // onmogelijke datum eindigen. Nul is niet mooi, maar het is te lezen.
  it('replaces a non-numeric size or time with zero', () => {
    const parsed = parseRecords([{ ...record(), bytes: 'veel', startedAt: 'gisteren' }]);
    expect(parsed[0].bytes).toBe(0);
    expect(parsed[0].startedAt).toBe(0);
  });

  // Een regel zonder naam maar mét pad is bruikbaar — de naam staat al in het pad.
  // Dat scheelt een lege eerste kolom in de tabel.
  it('falls back to the basename when the filename is missing', () => {
    const parsed = parseRecords([{ path: '/home/rene/Downloads/bon.pdf' }]);
    expect(parsed[0].filename).toBe('bon.pdf');
  });
});

describe('trimRecords', () => {
  // De grens zit op MAX_RECORDS, en de kant waar hij afkapt is de achterkant.
  // Zuiver getest, want dit is de enige afspraak in het bestand die je per ongeluk
  // omdraait.
  it('keeps the first max records', () => {
    const records = [record({ filename: 'a' }), record({ filename: 'b' }), record({ filename: 'c' })];
    expect(trimRecords(records, 2).map((r) => r.filename)).toEqual(['a', 'b']);
    expect(trimRecords(records)).toHaveLength(3);
    expect(trimRecords(records, 0)).toEqual([]);
  });
});
