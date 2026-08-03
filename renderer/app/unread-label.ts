// Het ongelezen-getal in een tabblad. Twee dingen moeten kloppen.
//
// 1. Het getal mag het tabblad niet breder maken dan de naam zelf mag worden.
//    De naam heeft een eigen max-breedte met afkapping; een teller van vijf
//    cijfers zou daar dwars door heen groeien, want een badge kapt niet af.
// 2. Duizenden moeten leesbaar blijven. De zijbalk kapte af op `99+`, maar het
//    ontwerp van de balk rekent juist op een teller als `1.324`: bij een postvak
//    dat niemand opruimt is "99+" geen informatie meer.
//
// Vandaar een bovengrens van 9999: vier cijfers plus scheidingsteken is de
// breedste vorm die naast een naam past, en daarboven staat er `9.999+`.
export const UNREAD_CAP = 9999;

// De scheiding volgt de taal van de app (`numberLocale` in strings.ts): 1.324 in
// het Nederlands, 1,324 in het Engels. Hardcoderen zou in één van de twee talen
// als een kommagetal gelezen worden.
export function unreadLabel(count: number, locale: string): string {
  const capped = Math.min(Math.floor(count), UNREAD_CAP);
  const text = capped.toLocaleString(locale);
  return count > capped ? `${text}+` : text;
}
