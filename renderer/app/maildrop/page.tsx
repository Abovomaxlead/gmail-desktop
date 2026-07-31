'use client';

import { useEffect, useState } from 'react';
import type { MailDropItem } from '../MailDropModal';

// Eigen pagina, alleen voor de modal die bovenóp Gmail in een eigen view wordt
// getoond. Bewust géén gedeelde pagina met de zijbalk: die moest dan aan een
// vlag herkennen in welke view ze draaide, en dat kwam niet aan.

// Voorlopig verzonnen mappen, alleen om de indeling te tonen.
const FOLDERS = [
  'Archief',
  'Klanten',
  'Offertes',
  'Facturen',
  'Projecten',
  'Leveranciers',
  'Personeel',
  'Marketing',
  'Contracten',
];

export default function MailDropModalPage() {
  const [items, setItems] = useState<MailDropItem[]>([]);

  useEffect(() => {
    const bridge = window.desktop;
    if (!bridge) return;
    // Ophalen én luisteren: het main-proces kan de items al gestuurd hebben
    // voordat deze pagina klaar was met laden.
    void bridge.getMailDropPreview().then(({ items: i }) => {
      if (i.length > 0) setItems(i);
    });
    bridge.onMailDropPreview(({ items: i }) => setItems(i));
  }, []);

  const n = items.length;
  const close = () => window.desktop?.closeMailDropPreview();

  return (
    <>
      {/* Moet in de opgemaakte html staan, niet pas na een effect: zodra
          Chromium één frame een dichte achtergrond tekent, flitst Gmail weg. */}
      <style>{'html,body{background:transparent}'}</style>

      <div
        className="flex h-screen w-full items-center justify-center bg-black/40 p-6"
        onClick={close}
      >
        <div
          className="flex max-h-full w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-neutral-900"
          onClick={(e) => e.stopPropagation()}
        >
          <header className="flex shrink-0 items-center justify-between gap-3 border-b border-black/10 px-5 py-3.5 dark:border-white/10">
            <h1 className="truncate text-[15px] font-semibold text-neutral-900 dark:text-neutral-100">
              {n === 1 ? 'Verplaats 1 conversatie' : `Verplaats ${n} conversaties`}
            </h1>
            <button
              onClick={close}
              aria-label="Sluiten"
              className="-mr-1.5 shrink-0 rounded-lg p-1.5 text-neutral-500 transition hover:bg-black/5 hover:text-neutral-900 dark:hover:bg-white/10 dark:hover:text-neutral-100"
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

          <div className="grid flex-1 grid-cols-3 gap-x-4 gap-y-2.5 overflow-y-auto px-5 py-4">
            {FOLDERS.map((folder) => (
              <label
                key={folder}
                className="flex cursor-pointer items-center gap-2 text-sm text-neutral-700 dark:text-neutral-300"
              >
                <input type="checkbox" className="h-4 w-4 shrink-0 accent-blue-600" />
                <span className="truncate" title={folder}>
                  {folder}
                </span>
              </label>
            ))}
          </div>

          <footer className="flex shrink-0 justify-end border-t border-black/10 px-5 py-3 dark:border-white/10">
            <button className="rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-medium text-white transition hover:bg-blue-700">
              Verplaats
            </button>
          </footer>
        </div>
      </div>
    </>
  );
}
