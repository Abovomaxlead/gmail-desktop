// What kind of destination a label is, which decides the icon and colour the picker
// shows. Keyed on the id and not the name: Gmail's system labels are called something
// different in every language, but their ids are fixed.

export type LabelKind = 'inbox' | 'starred' | 'important' | 'user';

/**
 * What kind of destination a label is
 *
 * @param id
 * @returns 'user' for anything that is not one of Gmail's own
 */
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
