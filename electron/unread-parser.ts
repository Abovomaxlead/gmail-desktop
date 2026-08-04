// Of de paginatitel de vorm heeft die Gmail pas aanneemt als het postvak echt
// staat: "<map> (<n>) - <adres> - Gmail". Daarvoor is de titel kaal ("Gmail"),
// een inlogpagina, of het achtervoegsel zonder adres.
//
// Bewust getoetst op vorm en niet op tekst: de mapnaam is vertaald, het adres en
// het achtervoegsel niet. Dit leest dezelfde bron als parseUnreadCount, waar de
// app toch al aan hangt — een selector op Gmail's berichtenlijst zou nauwkeuriger
// zijn maar een nieuw breukvlak met Google's interne markup openen.
export function mailboxTitleLoaded(title: string | null | undefined): boolean {
  if (!title) return false;
  if (!/\s-\sGmail\s*$/.test(title)) return false;
  return /[^\s@]+@[^\s@]+\.[^\s@]+/.test(title);
}

export function parseUnreadCount(title: string | null | undefined): number {
  if (!title) return 0;
  const match = title.match(/\((\d+)\)/);
  if (!match) return 0;
  const n = parseInt(match[1], 10);
  return Number.isFinite(n) ? n : 0;
}
