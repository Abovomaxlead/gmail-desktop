// What kind of destination a label is, which decides the icon and colour the picker
// shows. Keyed on the id and not the name: Gmail's system labels are called something
// different in every language, but their ids are fixed.
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
