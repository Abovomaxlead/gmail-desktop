# Instellingen: nieuwe schil en negentien secties

Datum: 2026-08-04

## Waarom

Het instellingenpaneel had vier secties (Algemeen, Meldingen, Accounts, Over) in
een schil met een kop erboven: paneeltitel links, "Opgeslagen ✓", een
Bewaren-knop en een Sluiten-knop rechts. De gebruiker wees een ander
instellingenpaneel aan — een kolom met veel secties naast één wit vlak, met een
ronde sluitknop in de hoek en "ESC" eronder — en wil dat ontwerp, met alle secties
uit die kolom aanwezig. De inhoud per sectie volgt daarna, in overleg.

Dit is dus twee dingen tegelijk: een verbouwing van de schil, en een indeling die
plaats maakt voor secties die nog leeg zijn.

## Beslissingen

1. **De Bewaren-knop verdwijnt, en de titel van het paneel ook.** De knop legde
   niets vast wat niet al vastlag — elke control schrijft zichzelf meteen weg — en
   de titel stond boven de titel van de sectie ("Instellingen" boven "Algemeen").
   Wat blijft is de knop die er wel hoort: sluiten, in de hoek van het witte vlak.
   Esc doet hetzelfde en staat er als opschrift onder. Beide gaan langs één
   `close()`, die eerst de focus wegneemt: een accountnaam wordt op blur
   weggeschreven, en zonder die blur verdwijnt het paneel met de wijziging er nog
   in.

2. **De inhoud staat gecentreerd in het witte vlak.** Dat is het omgekeerde van
   wat er in de vorige schil stond, en met reden: daar was de paneeltitel de tekst
   die op de as van de navigatiekolom lijnde, en een gecentreerde inhoudskolom
   naast een vastgezette kolom las als een fout. Die tweede as is weg — de
   sectietitel is nu de bovenste tekst ín het vlak. Wat overblijft is één kolom
   tekst in een wit vlak, en die hoort in het midden.

3. **De haarlijn scheidt groepen, niet rijen.** In de vorige schil zat elke
   instelling in een kaart met een `divide-y`, dus onder elke rij stond een lijn.
   Nu staan de rijen los op het witte vlak en staat de lijn alleen tussen groepen,
   met de kop van de groep eronder ("Opstarten"). Rijen binnen een groep gaan over
   hetzelfde ding en horen als blok te lezen; een lijn onder elke rij maakt van
   vijf instellingen vijf onderwerpen.

4. **Losse aan/uit-instellingen worden schakelaars; het rooster houdt vakjes.**
   Een pil van 36×20, donker als hij aan staat en niet blauw — kleur betekent in
   dit paneel identiteit, de knop die een update uitvoert, of gevaar, en "staat
   aan" is geen van die drie. Het rooster met de meldingen per account houdt
   selectievakjes: dertig pillen naast elkaar is een muur, en in een cel van 64px
   is een vakje het juiste ding.

5. **Negentien secties in drie groepen.** Wat je hebt gehaald; de voorkeuren
   zelf (Algemeen vooraan, dan alfabetisch, Geavanceerd achteraan); en wat er over
   de app te lezen valt. De groepen staan in `nav.ts` en niet in de opmaak, want
   ze zijn een uitspraak over wat waar hoort. De platte volgorde — waar de
   pijltjestoetsen over lopen — is eruit afgeleid en niet met de hand bijgehouden.

6. **Wat er al was, verhuist naar de sectie waar het hoort.** Het thema naar
   Weergave, de map voor gesleepte mail naar Downloads, en wat een klik op een
   melding doet naar Meldingen. Bijwerken en Wat is er nieuw worden eigen secties
   in plaats van blokken onder Over; het puntje voor een klaarstaande update
   verhuist mee naar Bijwerken, want een puntje hoort bij de sectie waar je de
   knop indrukt. Er gaat niets verloren en er komt niets bij dat niet werkt.

7. **Een sectie zonder inhoud zegt dat, en doet niet alsof.** Elf secties zijn
   nu een kop met één regel eronder. Ze staan in de `default` van de router in
   `SettingsPanel.tsx`: een sectie krijgt inhoud door daar een `case` te worden.
   Geen lijst met uitzonderingen om bij te houden.

8. **Twee instellingen uit het ontwerp worden echt gebouwd.** "Launch at Login"
   bestond al (`autoStart`). "Launch Minimized" is nieuw: een eigen veld in de
   voorkeuren, en `createWindow` minimaliseert het venster als het aan staat —
   alleen bij de eerste keer dat er in een procesgang een venster wordt gebouwd,
   want dezelfde functie wordt ook aangeroepen als je op een melding klikt terwijl
   het venster gesloten was. `minimize()` en niet `show: false`: een venster dat
   nooit is getoond staat ook niet in de taakbalk, en dan is de app gestart zonder
   dat er iets is om op te klikken.

9. **De standaard-mailclient wordt een schakelaar, en dat kost een regel bij het
   opstarten.** Het ontwerp zet er een schakelaar, dus moet uitzetten ook kunnen:
   `removeAsDefaultProtocolClient`. Daarvoor stond er in `main.ts` bij elke start
   een onvoorwaardelijke `setAsDefaultProtocolClient('mailto')`, waardoor uitzetten
   de volgende start weer werd teruggedraaid. Die regel is weg. Wie de standaard al
   is blijft het — het register houdt die keuze vast en er wordt niets weggehaald —
   maar een verse installatie claimt de mailto:-standaard nu pas als de gebruiker
   erom vraagt. Dat is ook het gedrag dat je van een mailprogramma verwacht.

## Wat er niet in zit

- **De inhoud van de elf lege secties.** Die komt in overleg, sectie voor sectie.
- **Een warme grijstint.** Het aangewezen ontwerp is iets warmer grijs
  (`stone`-achtig); dit paneel blijft `neutral`, want de balk van 40px erboven is
  dat ook en een warm vlak onder een koele balk geeft een naad.
- **Een eigen sectie per taal.** "Talen" staat in de kolom maar de app heeft
  alleen de Rene-stand, en die hangt aan een toetsenreeks. Wat daar komt is een
  gesprek en geen verbouwing.
