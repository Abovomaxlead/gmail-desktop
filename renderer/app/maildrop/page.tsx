'use client';

import { useEffect, useState } from 'react';
import type {
  MailDropItem,
  MailDropCopyProgress,
  MailDropCopyResult,
  MailDropCopyDuplicate,
  MailDropCopyMode,
} from '../MailDropModal';
import { labelKind, type LabelKind } from '../label-kind';

// Eigen pagina, alleen voor de modal die bovenóp Gmail in een eigen view wordt
// getoond. Bewust géén gedeelde pagina met de zijbalk: die moest dan aan een
// vlag herkennen in welke view ze draaide, en dat kwam niet aan.

interface Label {
  id: string;
  name: string;
}
interface AccountLabels {
  email: string;
  labels: Label[];
  error?: string;
}

// Het kopiëren duurt zichtbaar lang — eerst een zoekopdracht en dan een insert
// per bericht per account — dus de modal loopt door standen: kiezen, bezig,
// eventueel bevestigen als er al mail staat, en klaar.
type Phase =
  | { kind: 'picking' }
  | { kind: 'copying'; phase: 'check' | 'copy'; done: number; total: number; email: string }
  | { kind: 'confirm'; duplicates: MailDropCopyDuplicate[]; newCount: number }
  | { kind: 'done'; result: MailDropCopyResult };

export default function MailDropModalPage() {
  const [items, setItems] = useState<MailDropItem[]>([]);
  const [accounts, setAccounts] = useState<AccountLabels[] | null>(null);
  // Aangevinkte labels per account: e-mailadres -> label-ids.
  const [picked, setPicked] = useState<Record<string, string[]>>({});
  const [phase, setPhase] = useState<Phase>({ kind: 'picking' });

  useEffect(() => {
    const bridge = window.desktop;
    if (!bridge) return;
    // Labels komen van de Gmail API, per gekoppeld account. Bij elke sleep
    // opnieuw: deze view blijft bestaan tussen sleeps door, en welke accounts
    // een doel zijn hangt af van waar je uit sleept.
    const loadLabels = () => {
      setAccounts(null);
      void bridge
        .getLabels()
        .then(({ accounts: a }) => setAccounts(a))
        .catch(() => setAccounts([]));
    };
    // Ophalen én luisteren: het main-proces kan de items al gestuurd hebben
    // voordat deze pagina klaar was met laden.
    void bridge.getMailDropPreview().then(({ items: i }) => {
      if (i.length > 0) setItems(i);
    });
    // De eerste push hoort bij de sleep die deze view net opende; daar zijn de
    // labels hieronder al voor opgehaald. Pas een vólgende sleep vraagt om een
    // nieuwe lijst.
    let seenPreview = false;
    bridge.onMailDropPreview(({ items: i }) => {
      setItems(i);
      // Een nieuwe sleep terwijl de modal nog een oude uitkomst toont: terug
      // naar kiezen, anders kopieer je met één klik de vorige mail nog eens.
      setPicked({});
      setPhase({ kind: 'picking' });
      if (seenPreview) loadLabels();
      seenPreview = true;
    });
    loadLabels();
    bridge.onMailDropCopyProgress((p: MailDropCopyProgress) =>
      setPhase((cur) => (cur.kind === 'copying' ? { kind: 'copying', ...p } : cur)),
    );
  }, []);

  const n = items.length;
  const close = () => window.desktop?.closeMailDropPreview();

  const toggle = (email: string, labelId: string) => {
    setPicked((cur) => {
      const mine = cur[email] ?? [];
      return {
        ...cur,
        [email]: mine.includes(labelId) ? mine.filter((l) => l !== labelId) : [...mine, labelId],
      };
    });
  };

  const targets = Object.entries(picked)
    .map(([email, labelIds]) => ({ email, labelIds }))
    .filter((t) => t.labelIds.length > 0);
  const pickedCount = targets.reduce((s, t) => s + t.labelIds.length, 0);

  // Wat er te kopiëren valt: de berichten die de sleep daadwerkelijk opleverde.
  const savedCount = items.reduce((s, i) => s + i.saved, 0);

  // 'check' kijkt eerst en vraagt; 'new' slaat over wat er al staat; 'all' zet
  // alles er alsnog bij.
  const copy = async (mode: MailDropCopyMode = 'check') => {
    const bridge = window.desktop;
    if (!bridge || targets.length === 0) return;
    setPhase({
      kind: 'copying',
      phase: mode === 'all' ? 'copy' : 'check',
      done: 0,
      total: 0,
      email: targets[0].email,
    });
    try {
      const result = await bridge.copyMailDrop(targets, mode);
      setPhase(
        result.needsConfirm
          ? {
              kind: 'confirm',
              duplicates: result.duplicates ?? [],
              newCount: result.newCount ?? 0,
            }
          : { kind: 'done', result },
      );
    } catch (e) {
      setPhase({
        kind: 'done',
        result: {
          ok: false,
          copied: 0,
          skipped: 0,
          total: 0,
          accounts: [],
          error: (e as Error).message,
        },
      });
    }
  };

  // Van label-id naar de naam die de gebruiker heeft aangevinkt, zodat de
  // waarschuwing de map noemt en niet een intern id.
  const labelName = (email: string, labelId: string) =>
    accounts?.find((a) => a.email === email)?.labels.find((l) => l.id === labelId)?.name ?? labelId;

  return (
    <>
      {/* Moet in de opgemaakte html staan, niet pas na een effect: zodra
          Chromium één frame een dichte achtergrond tekent, flitst Gmail weg. */}
      <style>{'html,body{background:transparent}'}</style>

      <div
        className="flex h-screen w-full items-center justify-center bg-black/40 p-6"
        onClick={phase.kind === 'copying' ? undefined : close}
      >
        <div
          className="flex max-h-full w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-neutral-900"
          onClick={(e) => e.stopPropagation()}
        >
          <header className="flex shrink-0 items-center justify-between gap-3 border-b border-black/10 px-5 py-3.5 dark:border-white/10">
            <h1 className="truncate text-[15px] font-semibold text-neutral-900 dark:text-neutral-100">
              {n === 1 ? 'Kopieer 1 conversatie' : `Kopieer ${n} conversaties`}
            </h1>
            <button
              onClick={close}
              disabled={phase.kind === 'copying'}
              aria-label="Sluiten"
              className="-mr-1.5 shrink-0 rounded-lg p-1.5 text-neutral-500 transition hover:bg-black/5 hover:text-neutral-900 disabled:opacity-40 dark:hover:bg-white/10 dark:hover:text-neutral-100"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                style={{ height: 18, width: 18 }}
              >
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </header>

          <div className="flex-1 overflow-y-auto px-5 py-4">
            {phase.kind === 'done' ? (
              <CopyReport result={phase.result} />
            ) : phase.kind === 'confirm' ? (
              <DuplicateWarning
                duplicates={phase.duplicates}
                newCount={phase.newCount}
                labelName={labelName}
              />
            ) : accounts === null ? (
              <p className="text-sm text-neutral-500">Labels ophalen…</p>
            ) : accounts.length === 0 ? (
              <p className="text-sm text-neutral-500">Geen ander gekoppeld account.</p>
            ) : (
              <div
                className="grid gap-x-5 gap-y-2"
                style={{ gridTemplateColumns: `repeat(${accounts.length}, minmax(0, 1fr))` }}
              >
                {accounts.map((acc) => (
                  <div key={acc.email} className="flex min-w-0 flex-col">
                    <div
                      className="mb-2 truncate border-b border-black/5 pb-1.5 text-xs font-semibold text-neutral-900 dark:border-white/10 dark:text-neutral-100"
                      title={acc.email}
                    >
                      {acc.email}
                    </div>
                    {acc.error ? (
                      <span className="text-xs text-red-600 dark:text-red-500">{acc.error}</span>
                    ) : acc.labels.length === 0 ? (
                      <span className="text-xs text-neutral-400">Geen labels</span>
                    ) : (
                      <div className="flex flex-col gap-0.5">
                        {acc.labels.map((label) => {
                          const on = (picked[acc.email] ?? []).includes(label.id);
                          return (
                            <label
                              key={label.id}
                              // Een aangevinkte bestemming krijgt een eigen vlak:
                              // waar de mail heen gaat moet je kunnen zien zonder
                              // de vinkjes af te lopen.
                              className={`flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-sm transition ${
                                on
                                  ? 'bg-blue-50 text-neutral-900 dark:bg-blue-500/15 dark:text-neutral-100'
                                  : 'text-neutral-700 hover:bg-black/[0.04] dark:text-neutral-300 dark:hover:bg-white/5'
                              }`}
                            >
                              <input
                                type="checkbox"
                                checked={on}
                                disabled={phase.kind === 'copying'}
                                onChange={() => toggle(acc.email, label.id)}
                                className="h-4 w-4 shrink-0 accent-blue-600"
                              />
                              <LabelIcon id={label.id} />
                              <span className="truncate" title={label.name}>
                                {label.name}
                              </span>
                            </label>
                          );
                        })}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-black/10 px-5 py-3 dark:border-white/10">
            <Status phase={phase} pickedCount={pickedCount} savedCount={savedCount} />
            {phase.kind === 'done' ? (
              <button
                onClick={close}
                className="rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-medium text-white transition hover:bg-blue-700"
              >
                Sluiten
              </button>
            ) : phase.kind === 'confirm' ? (
              <div className="flex shrink-0 items-center gap-2">
                {/* Annuleren gaat terug naar het kiezen in plaats van te sluiten:
                    meestal wil je dan één label uitvinken en de rest wél doen. */}
                <button
                  onClick={() => setPhase({ kind: 'picking' })}
                  className="rounded-lg px-4 py-1.5 text-sm font-medium text-neutral-700 transition hover:bg-black/5 dark:text-neutral-300 dark:hover:bg-white/10"
                >
                  Annuleren
                </button>
                <button
                  onClick={() => void copy('all')}
                  className="rounded-lg px-4 py-1.5 text-sm font-medium text-amber-700 transition hover:bg-amber-500/10 dark:text-amber-500"
                >
                  Alles kopiëren
                </button>
                {/* De gewone keuze staat vooraan en is de blauwe knop: wat er al
                    staat overslaan en alleen de nieuwe mail erbij zetten. Weg
                    als er niets nieuws is — dan is er niets te doen. */}
                {phase.newCount > 0 && (
                  <button
                    onClick={() => void copy('new')}
                    className="rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-medium text-white transition hover:bg-blue-700"
                  >
                    {phase.newCount === 1
                      ? 'Alleen de nieuwe kopiëren'
                      : `Alleen de ${phase.newCount} nieuwe kopiëren`}
                  </button>
                )}
              </div>
            ) : (
              <button
                onClick={() => void copy()}
                disabled={pickedCount === 0 || savedCount === 0 || phase.kind === 'copying'}
                className="rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-medium text-white transition hover:bg-blue-700 disabled:opacity-50"
              >
                {phase.kind === 'copying' ? 'Bezig…' : 'Kopieer'}
              </button>
            )}
          </footer>
        </div>
      </div>
    </>
  );
}

function Status({
  phase,
  pickedCount,
  savedCount,
}: {
  phase: Phase;
  pickedCount: number;
  savedCount: number;
}) {
  if (phase.kind === 'copying') {
    const doing = phase.phase === 'check' ? 'Controleren' : 'Kopiëren';
    // Vóór de eerste voortgangstik is het totaal nog niet bekend; dan alleen
    // zeggen wat er gebeurt in plaats van "0 van 0".
    const text =
      phase.total > 0
        ? `${doing}: ${phase.done} van ${phase.total} — ${phase.email}`
        : `${doing} bij ${phase.email}…`;
    return <span className="text-xs text-neutral-500">{text}</span>;
  }
  if (phase.kind === 'confirm') {
    const n = phase.duplicates.reduce((s, d) => s + d.count, 0);
    return (
      <span className="text-xs text-amber-700 dark:text-amber-500">
        {n === 1 ? 'Deze mail staat er al' : `${n} van deze berichten staan er al`}
        {phase.newCount > 0 &&
          `, ${phase.newCount} ${phase.newCount === 1 ? 'is' : 'zijn'} nieuw`}
      </span>
    );
  }
  if (phase.kind === 'done') {
    const r = phase.result;
    const bad = !r.ok || r.accounts.some((a) => a.error);
    const skipped = r.skipped > 0 ? `, ${r.skipped} overgeslagen` : '';
    return (
      <span className={`text-xs ${bad ? 'text-red-600 dark:text-red-500' : 'text-green-700 dark:text-green-500'}`}>
        {r.ok ? `${r.copied} gekopieerd${skipped}` : (r.error ?? 'Niets gekopieerd')}
      </span>
    );
  }
  if (savedCount === 0) {
    return <span className="text-xs text-neutral-500">Niets opgeslagen om te kopiëren</span>;
  }
  return (
    <span className="text-xs text-neutral-500">
      {pickedCount === 0
        ? 'Kies waar de mail naartoe moet'
        : `${savedCount} ${savedCount === 1 ? 'bericht' : 'berichten'} naar ${pickedCount} ${
            pickedCount === 1 ? 'label' : 'labels'
          }`}
    </span>
  );
}

// Eén vorm per soort bestemming. Materials iconen, zodat ze hetzelfde lezen als
// wat Gmail er zelf naast zet.
const ICON_PATH: Record<LabelKind, string> = {
  inbox:
    'M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 12h-4c0 1.66-1.35 3-3 3s-3-1.34-3-3H4.99V5H19v10z',
  starred: 'M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z',
  important:
    'M3.5 18.99l11 .01c.67 0 1.27-.33 1.63-.84L20.5 12l-4.37-6.16c-.36-.51-.96-.84-1.63-.84l-11 .01L8 12l-4.5 6.99z',
  user: 'M21.41 11.58l-9-9C12.05 2.22 11.55 2 11 2H4c-1.1 0-2 .9-2 2v7c0 .55.22 1.05.59 1.42l9 9c.36.36.86.58 1.41.58s1.05-.22 1.41-.59l7-7c.37-.36.59-.86.59-1.41s-.23-1.06-.59-1.42zM5.5 7C4.67 7 4 6.33 4 5.5S4.67 4 5.5 4 7 4.67 7 5.5 6.33 7 5.5 7z',
};

// Kleur per soort, niet per label: het gaat erom dat een postvak niet op een
// eigen map lijkt. Elke vorm heeft een eigen tint, ook al zijn ster en
// belangrijk in Gmail allebei geel.
const ICON_COLOR: Record<LabelKind, string> = {
  inbox: 'text-blue-600 dark:text-blue-400',
  starred: 'text-amber-500 dark:text-amber-400',
  important: 'text-orange-500 dark:text-orange-400',
  user: 'text-neutral-400 dark:text-neutral-500',
};

const KIND_TITLE: Record<LabelKind, string> = {
  inbox: 'Postvak',
  starred: 'Met ster',
  important: 'Belangrijk',
  user: 'Eigen label',
};

function LabelIcon({ id, className = '' }: { id: string; className?: string }) {
  const kind = labelKind(id);
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      role="img"
      // Geen aria-hidden: het soort bestemming staat nergens anders, dus dit
      // icoon draagt informatie. De <title> is meteen de tooltip.
      className={`${ICON_COLOR[kind]} ${className}`}
      style={{ height: 15, width: 15, flexShrink: 0 }}
    >
      <title>{KIND_TITLE[kind]}</title>
      <path d={ICON_PATH[kind]} />
    </svg>
  );
}

// Wat er al in het doellabel staat. Het punt is dubbele mail voorkomen, dus
// noem wélke labels het betreft en welke berichten — anders is "toch kopiëren?"
// een vraag zonder houvast.
function DuplicateWarning({
  duplicates,
  newCount,
  labelName,
}: {
  duplicates: MailDropCopyDuplicate[];
  newCount: number;
  labelName: (email: string, labelId: string) => string;
}) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-neutral-700 dark:text-neutral-300">
        {newCount > 0
          ? `Een deel staat op de bestemming al. "Alleen de nieuwe kopiëren" slaat die over en zet
             ${newCount === 1 ? 'het ene nieuwe bericht' : `de ${newCount} nieuwe berichten`} erbij;
             "Alles kopiëren" maakt van de bestaande een tweede exemplaar.`
          : 'Alles wat je sleepte staat op de bestemming al. Kopiëren maakt er van elk een tweede exemplaar bij.'}
      </p>
      <ul className="flex flex-col gap-3">
        {duplicates.map((d) => (
          <li
            key={`${d.email}:${d.labelId}`}
            className="rounded-lg border border-amber-500/40 bg-amber-50 px-3 py-2 dark:bg-amber-950/30"
          >
            <div className="flex min-w-0 items-center gap-1.5 text-sm font-medium text-neutral-900 dark:text-neutral-100">
              <LabelIcon id={d.labelId} />
              <span className="truncate">
                {labelName(d.email, d.labelId)}
                <span className="font-normal text-neutral-500"> · {d.email}</span>
              </span>
            </div>
            <div className="mt-0.5 text-xs text-amber-700 dark:text-amber-500">
              {d.count === 1 ? 'staat er al' : `${d.count} berichten staan er al`}
            </div>
            <ul className="mt-1.5 flex flex-col gap-0.5">
              {d.subjects.map((s, i) => (
                <li key={i} className="truncate text-xs text-neutral-600 dark:text-neutral-400" title={s}>
                  {s}
                </li>
              ))}
              {d.count > d.subjects.length && (
                <li className="text-xs text-neutral-500">
                  en nog {d.count - d.subjects.length}…
                </li>
              )}
            </ul>
          </li>
        ))}
      </ul>
    </div>
  );
}

// Per account wat het geworden is. Een fout hier is de enige plek waar de
// gebruiker leest waarom een postvak leeg bleef.
function CopyReport({ result }: { result: MailDropCopyResult }) {
  if (result.error) {
    return <p className="text-sm text-red-600 dark:text-red-500">{result.error}</p>;
  }
  return (
    <ul className="flex flex-col gap-2">
      {result.accounts.map((a) => (
        <li key={a.email} className="flex flex-col gap-0.5">
          <span className="truncate text-sm font-medium text-neutral-900 dark:text-neutral-100">
            {a.email}
          </span>
          <span
            className={`text-xs ${
              a.error ? 'text-red-600 dark:text-red-500' : 'text-neutral-500'
            }`}
          >
            {a.error
              ? `${a.copied} van ${a.total} gekopieerd — ${a.error}`
              : `${a.copied} ${a.copied === 1 ? 'bericht' : 'berichten'} gekopieerd` +
                (a.skipped > 0 ? `, ${a.skipped} stond er al` : '')}
          </span>
        </li>
      ))}
    </ul>
  );
}
