'use client';

import { useEffect, useState } from 'react';
import type { AccountOAuthStatus, OAuthStatus } from '../../lib/oauth-status';
import type { UiStrings } from '../strings';
import { BUTTON, DANGER_TEXT } from './tokens';

// Whether an account's Gmail link actually works, in the account's own card. Until this
// existed the only place that said so was a banner in the bottom-right corner, and only
// once something was already broken — so "is this account linked?" was a question you
// answered by noticing that notifications had stopped.
//
// Its own file rather than more lines in AccountsSection, which already owns naming,
// drag-ordering, colour and removal. This is the one concern here with async state and an
// error to display, and it is the one a reader can skip entirely if they came for the
// drag-and-drop.
//
// The button is only drawn for a state that needs it, so it reads as a signal rather than
// as furniture — four identical buttons down the list would say nothing about which
// account is the problem. Nothing is updated optimistically after a click: main re-runs
// the health check as part of reconnecting, so the new status arrives over
// onOAuthStatus by itself, and a row that guessed would only be able to guess wrong.

// One IPC listener per page load, no matter how many times the accounts section is
// mounted. The section unmounts every time the user visits another settings section, and
// the bridge's `on` has no removal, so subscribing per mount would stack listeners for as
// long as the panel is open. This is the same shape DownloadHistorySection uses.
const listeners = new Set<(accounts: AccountOAuthStatus[]) => void>();
let subscribed = false;
// The last list seen, so re-opening the section shows what is known instead of flashing
// blank until the next check — which can be five minutes away.
let known: AccountOAuthStatus[] = [];

function subscribeToStatus(cb: (accounts: AccountOAuthStatus[]) => void): () => void {
  listeners.add(cb);
  if (!subscribed) {
    subscribed = true;
    window.desktop?.onOAuthStatus(({ accounts }) => {
      known = accounts;
      for (const l of listeners) l(accounts);
    });
  }
  return () => {
    listeners.delete(cb);
  };
}

/** The statuses main has computed, live. Empty until the first health check has run, which
 *  is the honest answer: no entry means no status line, which is also what a delegated
 *  mailbox and a machine without OAuth configured get. */
export function useOAuthStatuses(): AccountOAuthStatus[] {
  const [accounts, setAccounts] = useState<AccountOAuthStatus[]>(known);

  useEffect(() => {
    const unsubscribe = subscribeToStatus(setAccounts);
    const pending = window.desktop?.getOAuthStatus();
    if (pending) {
      void pending.then(({ accounts: fetched }) => {
        // Only if nothing has arrived by push in the meantime: this answer was true when
        // it was asked for, and a push that landed first is newer.
        if (known.length === 0) {
          known = fetched;
          setAccounts(fetched);
        }
      });
    }
    return unsubscribe;
  }, []);

  return accounts;
}

function statusLabel(status: OAuthStatus, S: UiStrings): string {
  switch (status) {
    case 'linked':
      return S.oauthLinked;
    case 'unlinked':
      return S.oauthUnlinked;
    case 'expired':
      return S.oauthExpired;
    case 'push-only':
      return S.oauthPushOnly;
  }
}

/** Null for a link that works — there is nothing to ask for. */
function actionLabel(status: OAuthStatus, S: UiStrings): string | null {
  switch (status) {
    case 'linked':
      return null;
    case 'unlinked':
      return S.oauthConnect;
    case 'expired':
      return S.oauthReconnect;
    case 'push-only':
      return S.oauthReallow;
  }
}

function CheckIcon({ className = '' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

// The same triangle the reconnect banner uses, so the two places that report this problem
// look like they are reporting the same problem.
function WarningIcon({ className = '' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0zM12 9v4M12 17h.01" />
    </svg>
  );
}

export function AccountOAuthRow({
  S,
  email,
  status,
}: {
  S: UiStrings;
  email: string;
  status: OAuthStatus;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // A failure belongs to the attempt that produced it. When the status changes underneath —
  // main re-checked, or the account was linked from somewhere else — the message describes a
  // state that no longer exists.
  useEffect(() => {
    setError('');
  }, [status]);

  const action = actionLabel(status, S);
  const broken = status !== 'linked';

  function connect(): void {
    setBusy(true);
    setError('');
    const pending = window.desktop?.reconnectOAuth(email);
    // No bridge means no consent screen will ever open, so the row must not sit on "busy"
    // waiting for an answer that cannot come.
    if (!pending) {
      setBusy(false);
      return;
    }
    void pending.then((r) => {
      setBusy(false);
      if (!r.ok) setError(r.error || S.oauthFailed);
    });
  }

  return (
    <span className="flex min-w-0 flex-col gap-1">
      <span
        className={`flex min-w-0 items-center gap-1.5 text-xs ${
          broken ? 'text-amber-600 dark:text-amber-500' : 'text-neutral-500'
        }`}
      >
        {broken ? (
          <WarningIcon className="h-3 w-3 shrink-0" />
        ) : (
          <CheckIcon className="h-3 w-3 shrink-0" />
        )}
        <span className="truncate">{statusLabel(status, S)}</span>
      </span>

      {action ? (
        <span className="flex min-w-0 flex-col gap-1">
          <button type="button" onClick={connect} disabled={busy} className={`${BUTTON} self-start`}>
            {busy ? S.oauthBusy : action}
          </button>
          {error ? (
            <span className={`truncate text-xs ${DANGER_TEXT}`} title={error}>
              {error}
            </span>
          ) : null}
        </span>
      ) : null}
    </span>
  );
}
