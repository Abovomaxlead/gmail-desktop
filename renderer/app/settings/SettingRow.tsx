'use client';

import type { ReactNode } from 'react';
import { HINT } from './tokens';

// Eén regel in het instellingenpaneel: naam links, control rechts. Elke
// instelling gebruikt deze rij, zodat alle controls op dezelfde lijn eindigen en
// de blik langs de rechterkant naar beneden kan lopen.
//
// Er zit geen haarlijn tussen twee rijen. Die staat alleen tussen twee *groepen*
// (zie `SettingsGroup`), en dat is een keuze over wat de lijn moet zeggen: rijen
// binnen een groep gaan over hetzelfde ding en horen als blok te lezen, terwijl
// een groep ergens anders over gaat. Een lijn onder elke rij maakt van vijf
// instellingen een tabel met vijf onderwerpen.
export function SettingRow({
  label,
  description,
  children,
  htmlFor,
}: {
  label: string;
  // Een `ReactNode` en niet een `string`: de bijtekst is soms gegevens waar een
  // klasse op moet. De statusregel van een update bevat een percentage dat per
  // tiende verspringt, en dat hoort in `tabular-nums` te staan; een mislukking
  // hoort rood te zijn. Met een `string` kon dat alleen door de rij open te
  // breken. Gewone tekst blijft gewoon werken.
  description?: ReactNode;
  children: ReactNode;
  htmlFor?: string;
}) {
  // `items-start` en niet `items-center`: bij een bijtekst van twee regels hoort
  // de schakelaar naast de náám te staan en niet halverwege de uitleg. De control
  // en de eerste regel tekst zijn allebei 20px hoog (`leading-5` links,
  // `h-5` rechts), dus ze staan op precies dezelfde lijn.
  // `gap-10` is 40px, en dat is de leegte die de uitleg van de control scheidt. Er
  // staat geen bovengrens op de breedte van de tekst: de kolom is al 560px breed en
  // niet meer, dus de regel kan nergens te lang worden. Met een maat van 46 tekens
  // erop brak de uitleg halverwege de beschikbare ruimte af en stond er een gat van
  // 150px in elke rij.
  const shape = 'flex items-start justify-between gap-10 py-3';

  const text = (
    <span className="flex min-w-0 flex-col">
      <span className="text-[13.5px] font-medium leading-5">{label}</span>
      {description && <span className={`mt-1 ${HINT}`}>{description}</span>}
    </span>
  );

  // shrink-0: de control geeft nooit ruimte terug aan de tekst — een half
  // afgeknipt selectievakje is erger dan een afgekapte naam.
  //
  // `min-h-5` en niet `h-5`: 20px is de hoogte van een schakelaar en van de eerste
  // regel tekst links, dus die twee staan op één lijn. Een rij met een knop of een
  // keuzelijst erin is hoger, en met een vaste hoogte zou die buiten de rij vallen
  // en over de rij eronder heen liggen.
  const control = <span className="flex min-h-5 shrink-0 items-center gap-2">{children}</span>;

  // Met `htmlFor` is de naam een echt label en schakelt een klik op de naam de
  // control om; dat is bij een aan/uit-schakelaar de helft van het doelgebied.
  // Zonder `htmlFor` — een rij met twee knoppen, of met alleen tekst rechts —
  // zou een label naar niets wijzen, en is het een div.
  if (htmlFor) {
    return (
      <label htmlFor={htmlFor} className={`${shape} cursor-pointer`}>
        {text}
        {control}
      </label>
    );
  }

  return (
    <div className={shape}>
      {text}
      {control}
    </div>
  );
}
