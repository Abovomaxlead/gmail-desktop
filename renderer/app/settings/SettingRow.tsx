'use client';

import type { ReactNode } from 'react';

// Eén regel in het instellingenpaneel: naam links, control rechts. Elke
// instelling gebruikt deze rij, zodat alle controls op dezelfde lijn eindigen en
// de blik langs de rechterkant naar beneden kan lopen.
//
// De haarlijn tússen rijen zit hier niet in. De rij weet niet of hij de laatste
// is, dus de kaart eromheen zet die lijn met een divide op de container:
//
//   <div className="divide-y divide-black/[0.08] rounded-xl bg-white px-4
//                   dark:divide-white/[0.08] dark:bg-neutral-900">
//     <SettingRow …/><SettingRow …/>
//   </div>
//
// Zo krijgt de laatste rij vanzelf geen rand, en hoeft er nergens geteld te
// worden. Let op de haakjes: `divide-black/8` bestaat niet in Tailwind 3 (de
// standaardschaal gaat per 5), `divide-black/[0.08]` wel — zonder haakjes valt
// de lijn stil weg.
export function SettingRow({
  label,
  description,
  children,
  htmlFor,
}: {
  label: string;
  description?: string;
  children: ReactNode;
  htmlFor?: string;
}) {
  // min-h-[44px]: een rij met bijtekst en een rij zonder zijn even hoog, dus de
  // controls blijven op een vast raster staan in plaats van te verspringen zodra
  // er een regel uitleg bij komt. Het is ook de ondergrens voor iets dat je met
  // een muis of vinger moet raken.
  const shape = 'flex min-h-[44px] items-center justify-between gap-4 py-2.5';

  const text = (
    <span className="flex min-w-0 flex-col gap-0.5">
      <span className="text-[13.5px] font-medium leading-tight">{label}</span>
      {description && (
        <span className="text-xs font-normal leading-snug text-neutral-500">{description}</span>
      )}
    </span>
  );

  // shrink-0: de control geeft nooit ruimte terug aan de tekst — een half
  // afgeknipt selectievakje is erger dan een afgekapte naam.
  const control = <span className="flex shrink-0 items-center gap-2">{children}</span>;

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
