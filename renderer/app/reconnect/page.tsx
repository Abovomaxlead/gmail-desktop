'use client';

import { useEffect, useState } from 'react';
import { reconnectHeading } from '../reconnect-text';
import type { ReconnectAccount } from '../../lib/reconnect';

// Standing notice for accounts whose Gmail connection has to be made again. No close button
// on purpose: it goes once every account is connected, and it sits in its own bottom-right
// view so the rest of Gmail stays usable.
//
// The transparent background is set in the rendered html, or one opaque frame flashes Gmail
// away. The list is both fetched and listened for, since main may have sent it already.
export default function ReconnectPage() {
  const [accounts, setAccounts] = useState<ReconnectAccount[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    const bridge = window.desktop;
    if (!bridge) return;
    void bridge.getReconnectList().then(({ accounts: a }) => {
      if (a.length > 0) setAccounts(a);
    });
    bridge.onReconnectList(({ accounts: a }) => setAccounts(a));
  }, []);

  const reconnect = (email: string) => {
    setBusy(email);
    setErrors((cur) => ({ ...cur, [email]: '' }));
    void window.desktop?.reconnectOAuth(email).then((r) => {
      setBusy(null);
      if (!r.ok) setErrors((cur) => ({ ...cur, [email]: r.error ?? 'Mislukt' }));
    });
  };

  const transparent = <style>{'html,body{background:transparent}'}</style>;
  // Nothing to say until the first list lands: a card drawn over an empty list would have to
  // guess a heading, and main closes this view the moment the list is empty anyway.
  if (accounts.length === 0) return transparent;

  const { title, sub } = reconnectHeading(accounts);

  return (
    <>
      {transparent}
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
              {title}
            </span>
            <span className="text-xs text-neutral-500">{sub}</span>
          </div>
        </div>

        <ul className="flex-1 divide-y divide-black/5 overflow-y-auto dark:divide-white/10">
          {accounts.map(({ email }) => (
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
