'use client';

import { useEffect, useState } from 'react';
import type { OAuthStatus, OAuthStatusReport } from '../../lib/oauth-status';
import type { UiStrings } from '../strings';
import { BUTTON, DANGER_TEXT, PANEL } from './tokens';

const listeners = new Set<(report: OAuthStatusReport) => void>();
let subscribed = false;
let known: OAuthStatusReport = { configured: true, accounts: [] };
let seenAnything = false;


//===========================
// Hook
//===========================

/**
 * What main reports about linking on this machine, live
 *
 * @returns {OAuthStatusReport} two separate facts: whether this machine can link at all,
 *   and the per-account statuses. An account with no entry gets no status line — a
 *   delegated mailbox has no link of its own, and nothing has been computed yet before the
 *   first health check.
 */
export function useOAuthStatuses(): OAuthStatusReport {
  const [report, setReport] = useState<OAuthStatusReport>(known);

  useEffect(() => {
    const unsubscribe = subscribeToStatus(setReport);
    const pending = window.desktop?.getOAuthStatus();
    if (pending) {
      void pending.then((fetched) => {
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



//===========================
// Components
//===========================

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

  useEffect(() => {
    setError('');
  }, [status]);

  const action = actionLabel(status, S);
  const broken = status !== 'linked';

  function connect(): void {
    setBusy(true);
    setError('');
    const pending = window.desktop?.reconnectOAuth(email);

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


//===========================
// Icons
//===========================

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


//===========================
// Helper functions
//===========================

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

function statusLabel(status: OAuthStatus, S: UiStrings): string {
  switch (status) {
    case 'linked':
      return S.oauthLinked;
    case 'unlinked':
      return S.oauthUnlinked;
    case 'expired':
      return S.oauthExpired;
  }
}

function actionLabel(status: OAuthStatus, S: UiStrings): string | null {
  switch (status) {
    case 'linked':
      return null;
    case 'unlinked':
      return S.oauthConnect;
    case 'expired':
      return S.oauthReconnect;
  }
}
