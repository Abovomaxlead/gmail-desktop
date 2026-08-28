'use client';

import { useEffect, useRef, useState } from 'react';
import type { HiddenAccount } from '../../lib/hidden-accounts';
import type { Profile } from '../page';
import type { UiStrings } from '../strings';
import { Avatar } from '../Avatar';
import { AccountOAuthRow, OAuthNotConfiguredNotice, useOAuthStatuses } from './AccountOAuthRow';
import { Section, SettingsGroup } from './Section';
import { SettingRow } from './SettingRow';
import {
  BUTTON,
  DANGER_BUTTON,
  DANGER_PANEL,
  FOCUS_RING,
  HINT,
  PANEL,
  SURFACE_FOCUS_RING,
} from './tokens';


//===========================
// Constants
//===========================

const SWATCHES = ['#4285F4', '#EA4335', '#34A853', '#FBBC05', '#A142F4', '#00ACC1'];

const CARD = 'rounded-xl bg-neutral-100 dark:bg-neutral-950';

const CARD_FOCUS_RING = SURFACE_FOCUS_RING;


//===========================
// Hook
//===========================

const hiddenListeners = new Set<(list: HiddenAccount[]) => void>();
let hiddenSubscribed = false;
let hiddenKnown: HiddenAccount[] = [];

/**
 * The mailboxes main is keeping off the screen, live
 *
 * One ipcRenderer listener for the life of the window: the preload has no way to take one off
 * again, and this panel is mounted afresh every time settings opens.
 *
 * @returns {HiddenAccount[]}
 * @private
 */
function useHiddenAccounts(): HiddenAccount[] {
  const [list, setList] = useState<HiddenAccount[]>(hiddenKnown);

  useEffect(() => {
    hiddenListeners.add(setList);
    if (!hiddenSubscribed) {
      hiddenSubscribed = true;
      window.desktop?.onHiddenAccounts(tell);
    }
    const pending = window.desktop?.getHiddenAccounts();
    if (pending) void pending.then(tell);
    return () => {
      hiddenListeners.delete(setList);
    };
  }, []);

  return list;
}

function tell(list: HiddenAccount[]): void {
  hiddenKnown = list;
  for (const fn of hiddenListeners) fn(list);
}


//===========================
// Component
//===========================

export function AccountsSection({
  S,
  profiles,
  onRedetect,
}: {
  S: UiStrings;
  profiles: Profile[];
  onRedetect: () => void;
}) {
  const [confirmEmail, setConfirmEmail] = useState<string | null>(null);
  const [dragEmail, setDragEmail] = useState<string | null>(null);
  const [overEmail, setOverEmail] = useState<string | null>(null);
  const oauth = useOAuthStatuses();
  const hidden = useHiddenAccounts();

  const nameFields = useRef<Record<string, HTMLInputElement | null>>({});

  function reorder(fromEmail: string, toEmail: string) {
    if (fromEmail === toEmail) return;
    const emails = profiles.map((p) => p.email);
    const from = emails.indexOf(fromEmail);
    const to = emails.indexOf(toEmail);
    if (from < 0 || to < 0) return;
    emails.splice(to, 0, emails.splice(from, 1)[0]);
    window.desktop?.setAccountOrder(emails);
  }

  function endDrag() {
    setDragEmail(null);
    setOverEmail(null);
  }

  return (
    <Section title={S.navAccounts}>
      <SettingsGroup>
        {/* Above the Add button, because on a machine with no link there is nothing useful
            to add: an account put in from here would never reach a consent screen. */}
        {oauth.configured ? null : <OAuthNotConfiguredNotice S={S} />}

        <div className="mb-3 flex items-center justify-end">
          <button
            type="button"
            onClick={() => window.desktop?.addAccount()}
            aria-label={S.addAccountLabel}
            title={S.addAccountLabel}
            className={`shrink-0 rounded-full bg-neutral-900 px-3 py-1 text-[13px] font-medium text-white transition hover:bg-neutral-700 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300 motion-reduce:transition-none ${FOCUS_RING}`}
          >
            {S.addShort}
          </button>
        </div>

        <div className="flex flex-col gap-2">
          {profiles.length === 0 && (
            <p className={`${PANEL} px-4 py-3.5 text-[13.5px] text-neutral-500 dark:text-neutral-400`}>{S.noAccounts}</p>
          )}

          {profiles.map((p) => {
            const delegated = p.kind === 'delegated';
            // Only own accounts have a link of their own; a delegated mailbox is reached through
            // the account that delegates it. An account with no entry has no status line either —
            // that covers OAuth not being configured at all, and the moment before the first
            // health check has run.
            const link = delegated ? undefined : oauth.accounts.find((s) => s.email === p.email);
            const dragging = dragEmail === p.email;
            const target = overEmail === p.email && dragEmail !== null && !dragging;

            return (
              <div
                key={p.email}
                onDragOver={(e) => {
                  if (!dragEmail) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'move';
                  if (overEmail !== p.email) setOverEmail(p.email);
                }}
                onDragLeave={() => setOverEmail((cur) => (cur === p.email ? null : cur))}
                onDrop={(e) => {
                  e.preventDefault();
                  if (dragEmail) reorder(dragEmail, p.email);
                  endDrag();
                }}
                className={`${CARD} px-3 py-3 transition motion-reduce:transition-none ${
                  dragging ? 'opacity-50' : ''
                } ${target ? 'ring-2 ring-inset ring-neutral-300 dark:ring-neutral-700' : ''}`}
              >
                <div className="flex items-start gap-2.5">
                  <span
                    aria-hidden
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.effectAllowed = 'move';
                      setDragEmail(p.email);
                    }}
                    onDragEnd={endDrag}
                    className="mt-1 flex h-5 w-4 shrink-0 cursor-grab select-none items-center justify-center text-neutral-400 transition hover:text-neutral-600 active:cursor-grabbing dark:text-neutral-600 dark:hover:text-neutral-400 motion-reduce:transition-none"
                  >
                    <GripIcon className="h-4 w-2.5" />
                  </span>

                  <Avatar
                    url={p.avatarUrl}
                    color={p.color}
                    name={p.name || p.email}
                    size="sm"
                    className="mt-0.5"
                  />

                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <input
                      ref={(el) => {
                        nameFields.current[p.email] = el;
                      }}
                      aria-label={S.accountLabelField}
                      defaultValue={p.label ?? p.name ?? ''}
                      placeholder={p.name || p.email}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') e.currentTarget.blur();
                      }}
                      onBlur={(e) => {
                        const v = e.target.value.trim();
                        if (v !== (p.label ?? p.name ?? ''))
                          window.desktop?.setAccountPref({ email: p.email, label: v });
                      }}
                      className={`-ml-1.5 w-full truncate rounded-md bg-transparent px-1.5 py-0.5 text-[13.5px] leading-tight transition hover:bg-black/[0.04] focus:bg-white dark:hover:bg-white/[0.06] dark:focus:bg-neutral-900 motion-reduce:transition-none ${CARD_FOCUS_RING}`}
                    />
                    <span className="flex min-w-0 items-center gap-1.5 text-xs text-neutral-500 dark:text-neutral-400">
                      <span className="truncate">{p.email}</span>
                      {delegated && (
                        <>
                          <DelegatedIcon className="h-3 w-3 shrink-0" />
                          <span className="truncate">{S.delegatedTooltipSuffix}</span>
                        </>
                      )}
                    </span>
                    {link ? <AccountOAuthRow S={S} email={p.email} status={link.status} /> : null}

                    <span
                      role="group"
                      aria-label={S.accountColor}
                      className="mt-1 flex flex-wrap items-center gap-1.5"
                    >
                      {SWATCHES.map((c) => {
                        const on = p.color.toLowerCase() === c.toLowerCase();
                        return (
                          <button
                            key={c}
                            type="button"
                            onClick={() => window.desktop?.setColor(p.email, c)}
                            aria-label={S.colorName(c)}
                            aria-pressed={on}
                            title={S.colorName(c)}
                            className={`h-4 w-4 rounded-full transition hover:scale-110 motion-reduce:transition-none motion-reduce:hover:scale-100 ${CARD_FOCUS_RING} ${
                              on
                                ? 'ring-2 ring-neutral-900 ring-offset-2 ring-offset-neutral-100 dark:ring-neutral-100 dark:ring-offset-neutral-950'
                                : ''
                            }`}
                            style={{ backgroundColor: c }}
                          />
                        );
                      })}
                    </span>
                  </div>

                  <span className="flex shrink-0 items-center gap-0.5">
                    <button
                      type="button"
                      onClick={() => {
                        const el = nameFields.current[p.email];
                        el?.focus();
                        el?.select();
                      }}
                      aria-label={S.renameAccount}
                      title={S.renameAccount}
                      className={`flex h-7 w-7 items-center justify-center rounded-md text-neutral-500 dark:text-neutral-400 transition hover:bg-black/5 hover:text-neutral-900 dark:hover:bg-white/10 dark:hover:text-neutral-100 motion-reduce:transition-none ${CARD_FOCUS_RING}`}
                    >
                      <PencilIcon className="h-4 w-4" />
                    </button>

                    <button
                      type="button"
                      onClick={() => setConfirmEmail(p.email)}
                      aria-label={S.removeAccount}
                      title={S.removeAccount}
                      className={`flex h-7 w-7 items-center justify-center rounded-md text-neutral-500 dark:text-neutral-400 transition hover:bg-black/5 hover:text-neutral-900 dark:hover:bg-white/10 dark:hover:text-neutral-100 motion-reduce:transition-none ${CARD_FOCUS_RING}`}
                    >
                      <TrashIcon className="h-4 w-4" />
                    </button>
                  </span>
                </div>

                {confirmEmail === p.email && (
                  <div
                    className={`${DANGER_PANEL} mt-3 flex items-center justify-between gap-3 px-3 py-2`}
                  >
                    <span className="text-xs">
                      {S.removeConfirmBefore}
                      <span className="font-semibold">+</span>
                      {S.removeConfirmAfter}
                    </span>
                    <div className="flex shrink-0 gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          window.desktop?.removeAccount(p.email);
                          setConfirmEmail(null);
                        }}
                        className={DANGER_BUTTON}
                      >
                        {S.remove}
                      </button>
                      <button type="button" onClick={() => setConfirmEmail(null)} className={BUTTON}>
                        {S.cancel}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </SettingsGroup>

      {hidden.length > 0 && (
        <SettingsGroup title={S.hiddenTitle}>
          <p className={`mb-3 max-w-[46ch] ${HINT}`}>{S.hiddenDescription}</p>

          <div className="flex flex-col gap-2">
            {hidden.map((h) => (
              <div
                key={h.email}
                className={`${CARD} flex items-center justify-between gap-3 px-3 py-2.5`}
              >
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-[13.5px]">{h.email}</span>
                  {/* Only an own account has to wait: a delegation is asked for again on the
                      spot, while the probe that finds own accounts only walks at startup. */}
                  {h.kind === 'authuser' && (
                    <span className={`mt-0.5 ${HINT}`}>{S.hiddenReturnsOnRestart}</span>
                  )}
                </span>
                <button
                  type="button"
                  onClick={() => window.desktop?.unhideAccount(h.email)}
                  className={BUTTON}
                >
                  {S.hiddenRestore}
                </button>
              </div>
            ))}
          </div>
        </SettingsGroup>
      )}

      <SettingsGroup>
        <SettingRow label={S.redetectLabel} description={S.redetectDescription}>
          <button type="button" onClick={onRedetect} className={BUTTON}>
            {S.redetect}
          </button>
        </SettingRow>

        <p className={`mt-1 max-w-[46ch] leading-relaxed ${HINT}`}>
          {S.accountsFootnoteBefore}
          <span className="font-medium text-neutral-900 dark:text-neutral-100">+</span>
          {S.accountsFootnoteAfter}
        </p>
      </SettingsGroup>
    </Section>
  );
}


//===========================
// Icons
//===========================

function TrashIcon({ className = '' }: { className?: string }) {
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
      <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6M10 11v6M14 11v6" />
    </svg>
  );
}

function PencilIcon({ className = '' }: { className?: string }) {
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
      <path d="M4 20h4L19.5 8.5a2.12 2.12 0 0 0-3-3L5 17v3z" />
    </svg>
  );
}

function GripIcon({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 10 16" fill="currentColor" className={className} aria-hidden>
      <circle cx="3" cy="4" r="1.3" />
      <circle cx="7" cy="4" r="1.3" />
      <circle cx="3" cy="8" r="1.3" />
      <circle cx="7" cy="8" r="1.3" />
      <circle cx="3" cy="12" r="1.3" />
      <circle cx="7" cy="12" r="1.3" />
    </svg>
  );
}

function DelegatedIcon({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5s-3 1.34-3 3 1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z" />
    </svg>
  );
}
