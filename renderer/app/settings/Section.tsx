'use client';

import type { ReactNode } from 'react';
import { BLOCK_TITLE, HAIRLINE, HINT, SECTION_TITLE } from './tokens';

// De vorm die elke sectie van het instellingenpaneel deelt: een kop, en daaronder
// groepen. Zodat een sectie met twee instellingen er precies zo uitziet als een
// sectie met tien, en er nergens een eigen marge boven een kop wordt verzonnen.
export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col">
      {/* `pr-14` houdt de titel uit de sluitknop, die in de hoek van het witte
          vlak zweeft. Op een breed venster is die ruimte er toch — de kolom is dan
          smaller dan het vlak — maar op het smalste venster (800px) loopt de
          rechterkant van de kolom tot net onder die knop. */}
      <h2 className={`pr-14 ${SECTION_TITLE}`}>{title}</h2>
      {/* De groepen zijn directe kinderen van dit vlak, want `SettingsGroup`
          gebruikt `first:` om te weten dat hij bovenaan staat en dan geen lijn
          boven zichzelf hoort te zetten. Zet er een div tussen en elke groep is
          de eerste. */}
      <div className="mt-6 flex flex-col">{children}</div>
    </section>
  );
}

// Een groep instellingen die over hetzelfde ding gaan, met een haarlijn erboven en
// meestal een kop. De eerste groep van een sectie krijgt geen van beide: daar is
// de sectietitel de kop, en een lijn direct onder een titel scheidt niets.
//
// De lijn staat dus tussen groepen en niet tussen rijen. Dat is wat "Opstarten" in
// het ontwerp doet: de twee rijen eronder horen bij elkaar, en de lijn zegt dat de
// rij erboven ergens anders over ging.
export function SettingsGroup({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <div
      className={`flex flex-col border-t pt-5 first:border-t-0 first:pt-0 ${HAIRLINE} mt-4 first:mt-0`}
    >
      {title && <h3 className={BLOCK_TITLE}>{title}</h3>}
      {children}
    </div>
  );
}

// Wat er in een sectie staat die nog niets bevat. Eén regel op de plek waar de
// eerste instelling komt, in de maat van een bijtekst: het is geen lege staat met
// een plaatje eromheen, want dat suggereert dat er iets kwijt is. Er is hier nog
// niets ingericht, en dat is precies wat er staat.
export function EmptyNote({ children }: { children: ReactNode }) {
  return <p className={`max-w-[46ch] ${HINT}`}>{children}</p>;
}
