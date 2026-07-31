'use client';

// Eén gesleept gesprek, zoals het main-proces het na het opslaan doorgeeft.
// Nog niet getoond — de modal laat voorlopig alleen "Test" zien.
export interface MailDropItem {
  threadId: string;
  subject: string;
  saved: number;
  error?: string;
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
