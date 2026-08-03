'use client';

import { useEffect, useState } from 'react';

// Blijvende melding voor accounts waarvan de Gmail-koppeling niet meer werkt.
// Bewust zonder sluitknop: hij verdwijnt pas als elk account weer verbonden is.
// Draait in een eigen view rechtsonder, dus de rest van Gmail blijft bruikbaar.
export default function ReconnectPage() {
  const [emails, setEmails] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    const bridge = window.desktop;
    if (!bridge) return;
    // Ophalen én luisteren: het main-proces kan de lijst al gestuurd hebben
    // voordat deze pagina klaar was met laden.
    void bridge.getReconnectList().then(({ emails: e }) => {
      if (e.length > 0) setEmails(e);
    });
    bridge.onReconnectList(({ emails: e }) => setEmails(e));
  }, []);

  const reconnect = (email: string) => {
    setBusy(email);
    setErrors((cur) => ({ ...cur, [email]: '' }));
    void window.desktop?.reconnectOAuth(email).then((r) => {
      setBusy(null);
      if (!r.ok) setErrors((cur) => ({ ...cur, [email]: r.error ?? 'Mislukt' }));
    });
  };

  const many = emails.length > 1;

  return (
    <>
      {/* In de opgemaakte html, niet pas na een effect: één frame met een dichte
          achtergrond laat Gmail zichtbaar wegflitsen. */}
      <style>{'html,body{background:transparent}'}</style>

      <div className="flex h-screen w-full flex-col overflow-hidden rounded-xl border border-amber-300 bg-white shadow-2xl dark:border-amber-700/60 dark:bg-neutral-900">
        <div className="flex shrink-0 items-start gap-2.5 border-b border-black/5 px-4 py-3 dark:border-white/10">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ height: 18, width: 18 }}
            className="mt-px shrink-0 text-amber-500"
          >
            <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0zM12 9v4M12 17h.01" />
          </svg>
          <div className="flex min-w-0 flex-col">
            <span className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
              {many ? `${emails.length} accounts opnieuw verbinden` : 'Verbinding met Gmail verlopen'}
            </span>
            <span className="text-xs text-neutral-500">
              {many
                ? 'Zonder verbinding kan er geen mail verplaatst worden.'
                : 'Verbind opnieuw om mail te kunnen verplaatsen.'}
            </span>
          </div>
        </div>

        <ul className="flex-1 divide-y divide-black/5 overflow-y-auto dark:divide-white/10">
          {emails.map((email) => (
            <li key={email} className="flex items-center justify-between gap-3 px-4 py-2.5">
              <div className="flex min-w-0 flex-col">
                <span className="truncate text-sm text-neutral-800 dark:text-neutral-200" title={email}>
                  {email}
                </span>
                {errors[email] ? (
                  <span className="truncate text-xs text-red-600 dark:text-red-500" title={errors[email]}>
                    {errors[email]}
                  </span>
                ) : null}
              </div>
              <button
                onClick={() => reconnect(email)}
                disabled={busy === email}
                className="shrink-0 rounded-lg bg-blue-600 px-3 py-1 text-sm font-medium text-white transition hover:bg-blue-700 disabled:opacity-50"
              >
                {busy === email ? 'Bezig…' : 'Verbind'}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}
