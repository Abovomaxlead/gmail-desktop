// Wat voor soort bestemming een label is. Bepaalt welk icoon en welke kleur de
// keuzelijst toont, zodat je in één oogopslag ziet of je in het postvak, bij de
// sterren of in een eigen map droppt.
//
// Op het id en niet op de naam: Gmail's systeemlabels heten in elke taal anders,
// maar hun id ligt vast.
export type LabelKind = 'inbox' | 'starred' | 'important' | 'user';

export function labelKind(id: string): LabelKind {
  switch ((id ?? '').toUpperCase()) {
    case 'INBOX':
      return 'inbox';
    case 'STARRED':
      return 'starred';
    case 'IMPORTANT':
      return 'important';
    default:
      return 'user';
  }
}
