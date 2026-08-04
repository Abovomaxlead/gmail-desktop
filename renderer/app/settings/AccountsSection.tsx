'use client';

import { useRef, useState } from 'react';
import type { AccountPref, Prefs, Profile } from '../page';
import type { UiStrings } from '../strings';
import { Section, SettingsGroup } from './Section';
import { SettingRow } from './SettingRow';
import {
  BUTTON,
  DANGER_BUTTON,
  DANGER_PANEL,
  FOCUS_RING,
  HAIRLINE,
  HINT,
  PANEL,
  SURFACE_FOCUS_RING,
} from './tokens';

// De zes tinten die een account kan hebben. Dezelfde lijst als in het oude
// paneel; dit is de kleur die in dit paneel zegt van wie iets is.
const SWATCHES = ['#4285F4', '#EA4335', '#34A853', '#FBBC05', '#A142F4', '#00ACC1'];

// De accountkaart is grijs en niet wit (`PANEL`). Dat is een afwijking van de
// regel in `tokens.ts` — "een omlijnd blok bínnen het witte vlak staat op wit" —
// en de reden is dat een kaart hier een ding is dat je kan verslepen, verslepen
// vraagt om een vlak dat je als geheel ziet, en een haarlijn om wit op wit doet
// dat niet.
//
// Er komt geen nieuwe tint in het paneel bij: `neutral-100` is precies de tint van
// `NOTICE` en `FIELD` en van de navigatiekolom, en `neutral-950` is de
// achtergrond van de schil. In het donker is de kaart dus dónkerder dan het vlak
// eromheen (`neutral-900`) en niet lichter, en dat is geen smaak: `neutral-800` is
// de kleur van `BUTTON` en `FIELD`, dus een kaart in die tint zou de grijze
// knoppen en velden erín opslokken.
const CARD = 'rounded-xl bg-neutral-100 dark:bg-neutral-950';

// Het paar tinten van de kaart is hetzelfde paar als dat van de navigatiekolom,
// dus de ring die daarvoor al bestaat past hier precies. Dat is de reden dat er
// geen derde soort focusring in dit bestand staat: `FOCUS_RING` zet zijn offset in
// de kleur van het wítte vlak, en die laat een wit randje om elke gefocuste knop
// op deze kaart achter.
const CARD_FOCUS_RING = SURFACE_FOCUS_RING;

function initial(p: Profile): string {
  return (p.name || p.email || '?').trim().charAt(0).toUpperCase() || '?';
}

function TrashIcon({ className = '' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6M10 11v6M14 11v6" />
    </svg>
  );
}

function PencilIcon({ className = '' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M4 20h4L19.5 8.5a2.12 2.12 0 0 0-3-3L5 17v3z" />
    </svg>
  );
}

// Zes puntjes in twee kolommen: het teken dat je iets kan verslepen. Geen tekst en
// geen streepjes, want dit is precies het teken dat elk ander programma hiervoor
// gebruikt en dat is de hele reden dat het zonder uitleg werkt.
function GripIcon({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 10 16" fill="currentColor" className={className} aria-hidden>
      <circle cx="3" cy="4" r="1.3" />
      <circle cx="7" cy="4" r="1.3" />
      <circle cx="3" cy="8" r="1.3" />
      <circle cx="7" cy="8" r="1.3" />
      <circle cx="3" cy="12" r="1.3" />
      <circle cx="7" cy="12" r="1.3" />
    </svg>
  );
}

// Hetzelfde icoontje als op een gedelegeerd tabblad in de balk, zodat een
// gedeelde postbus hier op dezelfde manier te herkennen is als daar. Het
// icoontje is aria-hidden; wat het betekent staat er in woorden naast.
function DelegatedIcon({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5s-3 1.34-3 3 1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z" />
    </svg>
  );
}

interface Chip {
  key: string;
  label: string;
  // De hele zin uit `strings.ts` ("Meldingen voor de post van deze meneer of
  // mevrouw"): het opschrift op de pil is één woord, en één woord zegt niet of het
  // om post of om de knop in de balk gaat.
  title: string;
  on: boolean;
  set(v: boolean): void;
}

// De standen die op de kaart als pil staan. Alleen de drie die zeggen óf je iets
// van dit account merkt; geluid en blijven-staan zeggen hóe een melding eruitziet
// en die staan in Meldingen, want vijf pillen onder een naam is een tabel en geen
// kaart.
//
// De polariteit is letterlijk die van `NotificationsSection`: `!== false` waar de
// stand aan staat tenzij je hem uitzet, `=== true` waar hij uit staat tenzij je hem
// aanzet. Staat hier `!== false` bij de agenda, dan liegt de pil van elk account
// dat nog nooit is aangeraakt.
//
// Er komt geen pil voor iets wat de app niet heeft (een gezamenlijk postvak
// bijvoorbeeld): een pil is een stand, en een stand die nergens over gaat is een
// leugen die je niet kan omzetten.
function chipsFor(S: UiStrings, p: Profile, a: AccountPref | undefined): Chip[] {
  const chips: Chip[] = [
    {
      key: 'notify',
      label: S.mailToggle,
      title: S.mailToggleTitle,
      on: a?.notify !== false,
      set: (v) => window.desktop?.setAccountPref({ email: p.email, notify: v }),
    },
    {
      key: 'badge',
      label: S.badgeToggle,
      title: S.badgeToggleTitle,
      on: a?.badgeCount !== false,
      set: (v) => window.desktop?.setAccountPref({ email: p.email, badgeCount: v }),
    },
  ];
  // Een gedeeld postvak zonder agenda heeft geen agenda om meldingen van te geven.
  // Dan staat er geen pil, en niet een uitgezette pil: uit betekent "je hebt hem
  // uitgezet" en dat is hier niet wat er aan de hand is. Hetzelfde onderscheid als
  // de lege cel in het rooster in Meldingen.
  if (p.hasCalendar) {
    chips.push({
      key: 'calendar',
      label: S.calendarToggle,
      title: S.calendarToggleTitle,
      on: a?.calendarNotify === true,
      set: (v) => window.desktop?.setAccountPref({ email: p.email, calendarNotify: v }),
    });
  }
  return chips;
}

// Een stand als pil onder de naam. Het is een knop en geen tekstje, en dat is de
// enige eerlijke vorm: een uitgezette pil blijft staan (anders verspringt de rij
// per account), en iets dat er als een uitgezette schakelaar uitziet en niet aan
// te zetten is, is een dood knopje.
//
// Aan en uit verschillen in vulling én in tekstkleur, niet alleen in kleur — en
// `aria-pressed` zegt het in woorden, want een schermlezer ziet geen vulling.
function ChipButton({ chip }: { chip: Chip }) {
  return (
    <button
      type="button"
      onClick={() => chip.set(!chip.on)}
      aria-pressed={chip.on}
      title={chip.title}
      className={`rounded-full border px-2 py-0.5 text-[11px] font-medium leading-4 transition motion-reduce:transition-none ${HAIRLINE} ${CARD_FOCUS_RING} ${
        chip.on
          ? 'bg-white text-neutral-700 hover:bg-white/60 dark:bg-neutral-900 dark:text-neutral-200 dark:hover:bg-neutral-900/60'
          : 'bg-transparent text-neutral-400 hover:bg-black/[0.03] dark:text-neutral-600 dark:hover:bg-white/[0.04]'
      }`}
    >
      {chip.label}
    </button>
  );
}

// Accounts: één grijze kaart per account, met de greep om hem te verslepen links,
// de naam en de standen in het midden, en helemaal rechts de twee dingen die je
// met een account doet — een andere naam geven, of hem weghalen.
//
// Deze sectie gaat over wíe een account is: de naam, de kleur, de plek in de balk,
// en hem weghalen. Wat een account aan meldingen mag geven staat in
// `NotificationsSection`, want daar ga je kijken als je je afvraagt wat je
// bereikt. De pillen op de kaart zijn daar geen kopie van maar een samenvatting:
// drie van de vijf standen, om te kunnen zien wat er aan staat zonder van sectie te
// wisselen.
//
// `prefs` is optioneel omdat de standen daaruit komen en de sectie het zonder ook
// moet uithouden (het paneel kan getekend zijn voordat de voorkeuren binnen zijn).
// Zonder `prefs` staan er geen pillen: een pil raden is erger dan geen pil.
export function AccountsSection({
  S,
  profiles,
  prefs,
  onRedetect,
}: {
  S: UiStrings;
  profiles: Profile[];
  prefs?: Prefs | null;
  onRedetect: () => void;
}) {
  const [brokenAvatars, setBrokenAvatars] = useState<Record<string, boolean>>({});
  const [confirmEmail, setConfirmEmail] = useState<string | null>(null);
  // Welke kaart in de hand zit en waar hij boven hangt. Twee losse waarden en niet
  // één: de kaart die je optilt wordt doorzichtig, en de kaart waar hij op zou
  // landen krijgt een rand — dat zijn twee verschillende kaarten.
  const [dragEmail, setDragEmail] = useState<string | null>(null);
  const [overEmail, setOverEmail] = useState<string | null>(null);

  // De naamvelden, per adres. Het potloodje hoort iets te dóen, en het enige eerlijke
  // wat het kan doen is de cursor in het veld zetten dat er al staat: een tweede
  // venster om dezelfde naam in te typen zou een tweede plek zijn waar de naam
  // vandaan komt.
  const nameFields = useRef<Record<string, HTMLInputElement | null>>({});

  // Dezelfde berekening als `reorder` in `page.tsx` voor de tabbladen in de balk, en
  // met opzet dezelfde: dit is dezelfde volgorde. Main krijgt de hele rij adressen
  // en niet "van hier naar daar", want de rij is de waarheid en een verschuiving is
  // een aanname over wat main al weet.
  function reorder(fromEmail: string, toEmail: string) {
    if (fromEmail === toEmail) return;
    const emails = profiles.map((p) => p.email);
    const from = emails.indexOf(fromEmail);
    const to = emails.indexOf(toEmail);
    if (from < 0 || to < 0) return;
    emails.splice(to, 0, emails.splice(from, 1)[0]);
    window.desktop?.setAccountOrder(emails);
  }

  function endDrag() {
    setDragEmail(null);
    setOverEmail(null);
  }

  return (
    <Section title={S.navAccounts}>
      {/* De knop om er iemand bij te doen staat rechts uitgelijnd bóven de kaarten
          en niet op de regel van de sectietitel, en dat is geen luiheid: de
          sluitknop van het paneel zweeft in de rechterbovenhoek van het witte vlak,
          en op het smalste venster loopt de kolom tot net onder die knop — daarom
          houdt `Section` zijn kop al met `pr-14` uit die hoek. Een pil die daar
          tegen de rechterrand staat, ligt op een venster van 800px onder de
          sluitknop. Deze regel is dezelfde regel voor elke breedte. */}
      <SettingsGroup>
        <div className="mb-3 flex items-center justify-end">
          {/* Zwart gevuld, en dat is binnen de regel over kleur in `tokens.ts`: dit
              is de enige knop in de sectie die iets toevoegt in plaats van iets
              wijzigt, "aan is donker, niet blauw" is de taal die het paneel al
              spreekt, en blauw is hier bezet door de focusring. In het donker
              draait hij om, want een zwarte pil op een donker vlak is geen knop
              meer. */}
          <button
            type="button"
            onClick={() => window.desktop?.addAccount()}
            // Op de pil staat één woord en in de tooltip de hele zin: "Doe er iemand
            // bij" past niet in een pil van deze maat, maar is wél wat de knop doet,
            // en dat hoort de toegankelijke naam te zijn.
            aria-label={S.addAccountLabel}
            title={S.addAccountLabel}
            className={`shrink-0 rounded-full bg-neutral-900 px-3 py-1 text-[13px] font-medium text-white transition hover:bg-neutral-700 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300 motion-reduce:transition-none ${FOCUS_RING}`}
          >
            {S.addShort}
          </button>
        </div>

        {/* `gap-2` tussen de kaarten: ze zijn nu gevuld in plaats van omlijnd, dus
            de leegte ertussen is het enige dat de ene van de andere scheidt — maar
            te veel leegte maakt van een lijst die je kan sorteren een reeks losse
            dingen. */}
        <div className="flex flex-col gap-2">
          {profiles.length === 0 && (
            <p className={`${PANEL} px-4 py-3.5 text-[13.5px] text-neutral-500`}>{S.noAccounts}</p>
          )}

          {profiles.map((p) => {
            const showImg = p.avatarUrl && !brokenAvatars[p.avatarUrl];
            const delegated = p.kind === 'delegated';
            const chips = prefs ? chipsFor(S, p, prefs.accounts[p.email]) : [];
            const dragging = dragEmail === p.email;
            const target = overEmail === p.email && dragEmail !== null && !dragging;

            return (
              <div
                key={p.email}
                // De kaart is het doel en niet de sleper: je pakt hem bij de greep
                // vast (zie hieronder), maar je mag hem overal op laten vallen.
                // Zonder `preventDefault` op dragover weigert de browser de drop en
                // gebeurt er niets — dat is de meest gemaakte fout hierin.
                onDragOver={(e) => {
                  if (!dragEmail) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'move';
                  if (overEmail !== p.email) setOverEmail(p.email);
                }}
                onDragLeave={() => setOverEmail((cur) => (cur === p.email ? null : cur))}
                onDrop={(e) => {
                  e.preventDefault();
                  if (dragEmail) reorder(dragEmail, p.email);
                  endDrag();
                }}
                className={`${CARD} px-3 py-3 transition motion-reduce:transition-none ${
                  dragging ? 'opacity-50' : ''
                } ${target ? 'ring-2 ring-inset ring-neutral-300 dark:ring-neutral-700' : ''}`}
              >
                <div className="flex items-start gap-2.5">
                  {/* De greep, en hij sleept echt: main zet de volgorde vast
                      (`setAccountOrder`) en de balk staat er meteen naar. Alleen de
                      greep is `draggable` en niet de hele kaart, want een kaart die
                      je overal kan oppakken laat je de naam erin niet meer met de
                      muis selecteren.
                      `aria-hidden` en geen knop: slepen is met een muis, en er is
                      nog geen tekst in `strings.ts` om deze greep een naam te geven
                      of een toetsenbordweg naast te leggen. Een knop zonder naam in
                      de tabreeks is erger dan een greep die er niet in staat — de
                      volgorde van de tabbladen in de balk is met de muis net zo
                      onbereikbaar en dat is dezelfde afspraak. */}
                  <span
                    aria-hidden
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.effectAllowed = 'move';
                      setDragEmail(p.email);
                    }}
                    onDragEnd={endDrag}
                    className="mt-1 flex h-5 w-4 shrink-0 cursor-grab select-none items-center justify-center text-neutral-400 transition hover:text-neutral-600 active:cursor-grabbing dark:text-neutral-600 dark:hover:text-neutral-400 motion-reduce:transition-none"
                  >
                    <GripIcon className="h-4 w-2.5" />
                  </span>

                  {/* Het bolletje in de accountkleur is nu ook de foto: het is één
                      rond dingetje op één plek dat zegt van wie de kaart is, en twee
                      dingen die dat zeggen (een streep langs de rand én een bolletje)
                      is er één te veel. Valt de foto weg, dan blijft de kleur met de
                      eerste letter erin staan. */}
                  <span
                    aria-hidden
                    className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded-full text-[10px] font-semibold text-white"
                    style={{ backgroundColor: p.color }}
                  >
                    {showImg ? (
                      <img
                        src={p.avatarUrl}
                        alt=""
                        referrerPolicy="no-referrer"
                        draggable={false}
                        onError={() => setBrokenAvatars((b) => ({ ...b, [p.avatarUrl]: true }))}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      initial(p)
                    )}
                  </span>

                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    {/* Het label is een veld zonder omlijsting tot je het aanwijst:
                        het staat op de plek van een naam en gedraagt zich als een
                        naam. Vaste padding met een negatieve marge ernaast, zodat de
                        tekst op dezelfde lijn staat als het adres eronder en er bij
                        focus niets verschuift.
                        `font-normal` en niet `font-medium`: op een gevulde kaart met
                        pillen eronder is de naam al het eerste wat je leest, en vet
                        maakt van elke kaart een kopje. */}
                    <input
                      ref={(el) => {
                        nameFields.current[p.email] = el;
                      }}
                      aria-label={S.accountLabelField}
                      defaultValue={p.label ?? p.name ?? ''}
                      placeholder={p.name || p.email}
                      onKeyDown={(e) => {
                        // Vastleggen op Enter — de blur hieronder slaat op.
                        if (e.key === 'Enter') e.currentTarget.blur();
                      }}
                      onBlur={(e) => {
                        const v = e.target.value.trim();
                        if (v !== (p.label ?? p.name ?? ''))
                          window.desktop?.setAccountPref({ email: p.email, label: v });
                      }}
                      className={`-ml-1.5 w-full truncate rounded-md bg-transparent px-1.5 py-0.5 text-[13.5px] leading-tight transition hover:bg-black/[0.04] focus:bg-white dark:hover:bg-white/[0.06] dark:focus:bg-neutral-900 motion-reduce:transition-none ${CARD_FOCUS_RING}`}
                    />
                    <span className="flex min-w-0 items-center gap-1.5 text-xs text-neutral-500">
                      <span className="truncate">{p.email}</span>
                      {delegated && (
                        <>
                          <DelegatedIcon className="h-3 w-3 shrink-0" />
                          <span className="truncate">{S.delegatedTooltipSuffix}</span>
                        </>
                      )}
                    </span>

                    {/* De standen links, de kleur rechts: allebei dingen die je aan
                        deze kaart kan zetten, dus ze staan op één regel onder de
                        naam en niet naast hem. Dat de kleurstaaltjes van de bovenste
                        regel naar deze zijn gezakt, is de reden dat de naam nu een
                        halve kaart breed kan zijn in plaats van een derde.
                        `flex-wrap`: op het smalste venster zakt de kleurenrij onder
                        de pillen in plaats van dat er een staaltje afvalt. */}
                    <div className="mt-0.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
                      <span className="flex flex-wrap items-center gap-1.5">
                        {chips.map((c) => (
                          <ChipButton key={c.key} chip={c} />
                        ))}
                      </span>

                      {/* De kleurkiezer. Het gekozen staaltje krijgt een ring in de
                          tekstkleur en niet in een tint: de tinten zijn hier de
                          gegevens, dus de markering eromheen moet neutraal zijn. De
                          offset van die ring staat in de kleur van de kaart en niet
                          van het witte vlak — anders zit er een wit randje om het
                          gekozen staaltje. */}
                      <span
                        role="group"
                        aria-label={S.accountColor}
                        className="flex shrink-0 items-center gap-1.5"
                      >
                        {SWATCHES.map((c) => {
                          const on = p.color.toLowerCase() === c.toLowerCase();
                          return (
                            <button
                              key={c}
                              type="button"
                              onClick={() => window.desktop?.setColor(p.email, c)}
                              aria-label={S.colorName(c)}
                              aria-pressed={on}
                              title={S.colorName(c)}
                              className={`h-4 w-4 rounded-full transition hover:scale-110 motion-reduce:transition-none motion-reduce:hover:scale-100 ${CARD_FOCUS_RING} ${
                                on
                                  ? 'ring-2 ring-neutral-900 ring-offset-2 ring-offset-neutral-100 dark:ring-neutral-100 dark:ring-offset-neutral-950'
                                  : ''
                              }`}
                              style={{ backgroundColor: c }}
                            />
                          );
                        })}
                      </span>
                    </div>
                  </div>

                  {/* De twee dingen die je met de kaart zelf doet, helemaal rechts en
                      naast elkaar: een andere naam geven, of hem weghalen. */}
                  <span className="flex shrink-0 items-center gap-0.5">
                    <button
                      type="button"
                      onClick={() => {
                        const el = nameFields.current[p.email];
                        el?.focus();
                        // `select()` erbij: het veld staat al vol met de naam die er
                        // is, en zonder selectie moet je die eerst met de hand
                        // weghalen voordat je een andere kan typen.
                        el?.select();
                      }}
                      // Een eigen naam en niet `accountLabelField`: dat is de naam van
                      // het veld ernaast, en twee dingen die op één kaart hetzelfde
                      // heten zijn voor een schermlezer niet van elkaar te houden.
                      aria-label={S.renameAccount}
                      title={S.renameAccount}
                      className={`flex h-7 w-7 items-center justify-center rounded-md text-neutral-500 transition hover:bg-black/5 hover:text-neutral-900 dark:hover:bg-white/10 dark:hover:text-neutral-100 motion-reduce:transition-none ${CARD_FOCUS_RING}`}
                    >
                      <PencilIcon className="h-4 w-4" />
                    </button>

                    <button
                      type="button"
                      onClick={() => setConfirmEmail(p.email)}
                      aria-label={S.removeAccount}
                      title={S.removeAccount}
                      className={`flex h-7 w-7 items-center justify-center rounded-md text-neutral-500 transition hover:bg-black/5 hover:text-neutral-900 dark:hover:bg-white/10 dark:hover:text-neutral-100 motion-reduce:transition-none ${CARD_FOCUS_RING}`}
                    >
                      <TrashIcon className="h-4 w-4" />
                    </button>
                  </span>
                </div>

                {/* Rood, en dit is een van de twee plekken in het paneel waar dat mag:
                    een account weghalen is niet terug te draaien met dezelfde knop.
                    Het vlak is getint zodat de vraag zich losmaakt van de kaart
                    eromheen, de tekstkleur komt uit `DANGER_PANEL` mee, en de knop die
                    het doet is vol rood. Annuleren blijft grijs: dat is de veilige
                    uitgang, en die hoort niet mee te schreeuwen. */}
                {confirmEmail === p.email && (
                  <div
                    className={`${DANGER_PANEL} mt-3 flex items-center justify-between gap-3 px-3 py-2`}
                  >
                    <span className="text-xs">
                      {S.removeConfirmBefore}
                      <span className="font-semibold">+</span>
                      {S.removeConfirmAfter}
                    </span>
                    <div className="flex shrink-0 gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          window.desktop?.removeAccount(p.email);
                          setConfirmEmail(null);
                        }}
                        className={DANGER_BUTTON}
                      >
                        {S.remove}
                      </button>
                      <button type="button" onClick={() => setConfirmEmail(null)} className={BUTTON}>
                        {S.cancel}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </SettingsGroup>

      <SettingsGroup>
        {/* Een eigen sleutel en niet `navAccounts`: die staat al als kop boven
            deze sectie, en een rij die net zo heet als het kopje erboven ("Wie
            doet mee?" onder "Wie doet mee?") zegt niet wat de rij doet. */}
        <SettingRow label={S.redetectLabel} description={S.redetectDescription}>
          <button type="button" onClick={onRedetect} className={BUTTON}>
            {S.redetect}
          </button>
        </SettingRow>

        {/* De voetnoot hoort bij de rij erboven — hij legt uit waar accounts
            vandaan komen, en dat is het antwoord op de vraag die je stelt als je
            net op "nog een keer zoeken" hebt gedrukt. Daarom staat hij in dezelfde
            groep en niet los onderaan de sectie. */}
        <p className={`mt-1 max-w-[46ch] leading-relaxed ${HINT}`}>
          {S.accountsFootnoteBefore}
          <span className="font-medium text-neutral-900 dark:text-neutral-100">+</span>
          {S.accountsFootnoteAfter}
        </p>
      </SettingsGroup>
    </Section>
  );
}
