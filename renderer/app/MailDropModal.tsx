'use client';

// Eén gesleept gesprek, zoals het main-proces het na het opslaan doorgeeft.
// Nog niet getoond — de modal laat voorlopig alleen "Test" zien.
export interface MailDropItem {
  threadId: string;
  subject: string;
  saved: number;
  error?: string;
}

// Waar de sleep naartoe gekopieerd wordt: per account de aangevinkte labels.
export interface MailDropCopyTarget {
  email: string;
  labelIds: string[];
}

export interface MailDropCopyAccountResult {
  email: string;
  copied: number;
  // Berichten die overgeslagen zijn omdat ze al onder elk gekozen label stonden.
  skipped: number;
  total: number;
  error?: string;
}

// Wat er met de duplicaten moet gebeuren. 'check' is de eerste ronde: kijken en
// vragen. De andere twee zijn het antwoord van de gebruiker.
export type MailDropCopyMode = 'check' | 'new' | 'all';

// Mail die in een doellabel al blijkt te staan, per account-en-label. `subjects`
// is een steekproef, `count` het echte aantal.
export interface MailDropCopyDuplicate {
  email: string;
  labelId: string;
  count: number;
  subjects: string[];
}

export interface MailDropCopyResult {
  ok: boolean;
  copied: number;
  skipped: number;
  total: number;
  accounts: MailDropCopyAccountResult[];
  error?: string;
  // Er is niets gekopieerd: er staat al mail in een doellabel en de gebruiker
  // moet eerst zeggen wat daarmee moet.
  needsConfirm?: boolean;
  duplicates?: MailDropCopyDuplicate[];
  newCount?: number; // hoeveel er overblijven als de duplicaten wegvallen
}

// Bij een labelsleep zijn dit honderden verzoeken, dus de modal telt mee.
export interface MailDropCopyProgress {
  phase: 'check' | 'copy';
  done: number;
  total: number;
  email: string;
}

// Vult zijn eigen view helemaal: het main-proces maakt die view precies zo groot
// als dit venster hoort te zijn.
export function MailDropModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="flex h-screen w-full flex-col items-center justify-center gap-4 border border-black/10 bg-white shadow-2xl dark:border-white/10 dark:bg-neutral-900">
      <p className="text-lg font-medium text-neutral-900 dark:text-neutral-100">Test</p>
      <button
        onClick={onClose}
        className="rounded-lg bg-neutral-200 px-4 py-2 text-sm font-medium text-neutral-900 transition hover:bg-neutral-300 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700"
      >
        Sluiten
      </button>
    </div>
  );
}
