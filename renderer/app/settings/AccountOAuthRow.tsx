'use client';

import { useEffect, useState } from 'react';
import type { OAuthStatus, OAuthStatusReport } from '../../lib/oauth-status';
import type { UiStrings } from '../strings';
import { BUTTON, DANGER_TEXT, PANEL } from './tokens';

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
const listeners = new Set<(report: OAuthStatusReport) => void>();
let subscribed = false;
// The last report seen, so re-opening the section shows what is known instead of flashing
// blank until the next check — which can be five minutes away. `configured: true` is the
// safe thing to assume before anything has arrived: it draws nothing, where a hasty `false`
// would accuse a working machine of having no link at all.
let known: OAuthStatusReport = { configured: true, accounts: [] };
let seenAnything = false;

function subscribeToStatus(cb: (report: OAuthStatusReport) => void): () => void {
  listeners.add(cb);
  if (!subscribed) {
    subscribed = true;
    window.desktop?.onOAuthStatus((report) => {
      known = report;
      seenAnything = true;
      for (const l of listeners) l(report);
    });
  }
  return () => {
    listeners.delete(cb);
  };
}

/** What main reports about linking on this machine, live. Two separate facts: whether this
 *  machine can link at all, and the per-account statuses. An account with no entry gets no
 *  status line — a delegated mailbox has no link of its own, and nothing has been computed
 *  yet before the first health check. */
export function useOAuthStatuses(): OAuthStatusReport {
  const [report, setReport] = useState<OAuthStatusReport>(known);

  useEffect(() => {
    const unsubscribe = subscribeToStatus(setReport);
    const pending = window.desktop?.getOAuthStatus();
    if (pending) {
      void pending.then((fetched) => {
        // Only if nothing has arrived by push in the meantime: this answer was true when
        // it was asked for, and a push that landed first is newer.
        if (!seenAnything) {
          known = fetched;
          seenAnything = true;
          setReport(fetched);
        }
      });
    }
    return unsubscribe;
  }, []);

  return report;
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

// Shown instead of the per-account rows when this machine has no OAuth config at all.
//
// It exists because its absence was a support call. The config is a file in userData
// holding a client secret, so the installer cannot carry it; a fresh machine therefore has
// nothing to link with, and every path that needs it gives up quietly — no consent screen
// when an account is added, no statuses, no banner. The panel showed nothing, which looks
// exactly like nothing being wrong, and the person had to ask someone else why their mail
// app did not work.
//
// One notice rather than a line per account: not being set up is a property of the
// computer, not of any mailbox, and repeating it under four names would say the same thing
// four times while still not offering a way out. The button is the way out — it takes the
// same file someone would otherwise copy into AppData by hand.
export function OAuthNotConfiguredNotice({ S }: { S: UiStrings }) {
  const [busy, setBusy] = useState(false);
  const [invalid, setInvalid] = useState(false);

  function importConfig(): void {
    setBusy(true);
    setInvalid(false);
    const pending = window.desktop?.importOAuthConfig();
    if (!pending) {
      setBusy(false);
      return;
    }
    void pending.then((r) => {
      setBusy(false);
      // Only a file that was picked and rejected is worth a message. A cancelled picker
      // comes back not-ok with nothing wrong, and saying so would scold the user for
      // changing their mind.
      setInvalid(r.invalid === true);
    });
  }

  return (
    <div className={`${PANEL} mb-3 flex items-start gap-2.5 px-4 py-3`}>
      <WarningIcon className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-500" />
      <div className="flex min-w-0 flex-col gap-2">
        <div className="flex flex-col gap-0.5">
          <span className="text-[13.5px] font-medium text-neutral-900 dark:text-neutral-100">
            {S.oauthNotSetUpTitle}
          </span>
          <span className="text-xs text-neutral-500 dark:text-neutral-400">
            {S.oauthNotSetUpBody}
          </span>
        </div>
        <button
          type="button"
          onClick={importConfig}
          disabled={busy}
          className={`${BUTTON} self-start`}
        >
          {busy ? S.oauthBusy : S.oauthImport}
        </button>
        {invalid ? (
          <span className={`text-xs ${DANGER_TEXT}`}>{S.oauthImportInvalid}</span>
        ) : null}
      </div>
    </div>
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
          broken ? 'text-amber-600 dark:text-amber-500' : 'text-neutral-500 dark:text-neutral-400'
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
