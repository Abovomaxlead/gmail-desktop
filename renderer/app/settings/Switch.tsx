'use client';

// De schakelaar van een losse instelling: een pil van 36×20 met een knopje dat
// naar rechts schuift. Aan is donker, niet blauw — kleur betekent in dit paneel
// precies drie dingen (van wie iets is, de knop die een update uitvoert, gevaar),
// en "deze stand staat aan" is geen van die drie.
//
// Het is een echt `<input type="checkbox">` en geen `<button role="switch">`, en
// dat is met opzet: `SettingRow` zet de naam van de rij ernaast met `htmlFor`, en
// dan schakelt een klik op de naam mee. Dat is bij een instelling met bijtekst het
// grootste deel van het doelgebied.
//
// Het vakje zelf ligt onzichtbaar over de pil in plaats van in `sr-only`. Dan is
// de pil zélf ook aan te klikken, ook op een plek waar geen `<label>` omheen zit,
// en blijft het een gewoon vakje voor het toetsenbord (spatie) en voor een
// schermlezer. `appearance-none` haalt het systeemvakje weg zonder het element weg
// te halen.
//
// Geen `<label>` in dit bestand: `SettingRow` is er al een als hij `htmlFor`
// krijgt, en een label in een label is ongeldige HTML.
export function Switch({
  id,
  checked,
  onChange,
  disabled,
  label,
  title,
}: {
  id?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  // Alleen nodig waar de rij geen naam met `htmlFor` aanlevert. Staat er een
  // rijlabel, laat dit dan weg — twee namen op één ding leest een schermlezer als
  // één lange naam.
  label?: string;
  title?: string;
}) {
  return (
    <span className="relative inline-flex h-5 w-9 shrink-0">
      <input
        id={id}
        type="checkbox"
        role="switch"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        aria-label={label}
        title={title}
        className="peer absolute inset-0 z-10 m-0 h-full w-full cursor-pointer appearance-none rounded-full bg-transparent outline-none disabled:cursor-not-allowed"
      />
      {/* De baan. `peer-focus-visible` en niet `focus-visible`: de ring hoort om
          de pil te liggen en niet om het onzichtbare vakje, dat precies even groot
          is maar geen achtergrond heeft om een ring op te laten zien. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded-full bg-neutral-200 transition-colors peer-checked:bg-neutral-900 peer-focus-visible:ring-2 peer-focus-visible:ring-blue-600 peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-white peer-disabled:opacity-50 dark:bg-neutral-700 dark:peer-checked:bg-neutral-100 dark:peer-focus-visible:ring-offset-neutral-900 motion-reduce:transition-none"
      />
      {/* Het knopje. In de lichte stand altijd wit; in de donkere stand licht als
          hij uit staat en donker als hij aan staat, want daar wisselt de baan van
          donker naar licht en zou één kleur aan de ene of de andere kant
          wegvallen. */}
      <span
        aria-hidden
        className="pointer-events-none absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform peer-checked:translate-x-4 peer-disabled:opacity-50 dark:bg-neutral-300 dark:peer-checked:bg-neutral-900 motion-reduce:transition-none"
      />
    </span>
  );
}
