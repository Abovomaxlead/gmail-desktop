// The settings sections, their grouping in the nav column, and whether a section
// carries an attention dot. Pure, and the only logic in the panel that is not
// presentation. It imports nothing, not even types: an `import type` from page.tsx
// would pull a .tsx file into the test compilation, which runs without JSX.


//===========================
// Types
//===========================

export type SettingsSection =
  | 'download-history'
  | 'general'
  | 'accounts'
  | 'appearance'
  | 'downloads'
  | 'google-apps'
  | 'notifications'
  | 'phishing-protection'
  | 'updates'
  | 'verification-codes'
  | 'advanced'
  | 'whats-new'
  | 'about';

export type AttentionUpdateState =
  | 'idle'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'error'
  | 'dev';

export interface AttentionInput {
  dnd: boolean;
  dndUntil?: number;
  updateReady: boolean;
}


//===========================
// Constants
//===========================

export const SETTINGS_GROUPS: readonly (readonly SettingsSection[])[] = [
  ['download-history'],
  [
    'general',
    'accounts',
    'appearance',
    'downloads',
    'google-apps',
    'notifications',
    'phishing-protection',
    'updates',
    'verification-codes',
    'advanced',
  ],
  ['whats-new', 'about'],
];

export const SETTINGS_SECTIONS: readonly SettingsSection[] = SETTINGS_GROUPS.flat();

export const DEFAULT_SECTION: SettingsSection = 'general';


//===========================
// Exported functions
//===========================

/**
 * Whether a section carries an attention dot
 *
 * @param section
 * @param input
 * @returns true when something in that section wants looking at
 */
export function needsAttention(section: SettingsSection, input: AttentionInput): boolean {
  if (section === 'notifications') return input.dnd || (input.dndUntil ?? 0) > 0;
  if (section === 'updates') return input.updateReady;
  return false;
}

/**
 * Boils what the panel knows down to what the dots need
 *
 * @param notifications
 * @param updateState
 * @returns {AttentionInput}
 */
export function attentionFrom(
  notifications: { dnd: boolean; dndUntil?: number } | undefined,
  updateState: AttentionUpdateState | undefined,
): AttentionInput {
  return {
    dnd: notifications?.dnd === true,
    dndUntil: notifications?.dndUntil,
    updateReady: updateState === 'available' || updateState === 'downloaded',
  };
}
