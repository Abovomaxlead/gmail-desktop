'use client';

import { useRef, useState } from 'react';
import type { Profile } from '../page';
import type { UiStrings } from '../strings';
import { AccountOAuthRow, useOAuthStatuses } from './AccountOAuthRow';
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

// Accounts: who takes part, in which order the tabs sit, which colour each account
// has, and removing one. The card is grey rather than white because it is a thing
// you can drag, and it reuses SURFACE_FOCUS_RING since its two tints match the nav
// column's. Which notifications an account may give is not settable here: that
// belongs to the per-account grid in Notifications, and having it in both places
// meant two controls for one setting.

const SWATCHES = ['#4285F4', '#EA4335', '#34A853', '#FBBC05', '#A142F4', '#00ACC1'];

const CARD = 'rounded-xl bg-neutral-100 dark:bg-neutral-950';

const CARD_FOCUS_RING = SURFACE_FOCUS_RING;

function initial(p: Profile): string {
  return (p.name || p.email || '?').trim().charAt(0).toUpperCase() || '?';
}

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

export function AccountsSection({
  S,
  profiles,
  onRedetect,
}: {
  S: UiStrings;
  profiles: Profile[];
  onRedetect: () => void;
}) {
  const [brokenAvatars, setBrokenAvatars] = useState<Record<string, boolean>>({});
  const [confirmEmail, setConfirmEmail] = useState<string | null>(null);
  const [dragEmail, setDragEmail] = useState<string | null>(null);
  const [overEmail, setOverEmail] = useState<string | null>(null);
  const oauthStatuses = useOAuthStatuses();

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
            <p className={`${PANEL} px-4 py-3.5 text-[13.5px] text-neutral-500`}>{S.noAccounts}</p>
          )}

          {profiles.map((p) => {
            const showImg = p.avatarUrl && !brokenAvatars[p.avatarUrl];
            const delegated = p.kind === 'delegated';
            // Only own accounts have a link of their own; a delegated mailbox is reached through
            // the account that delegates it. An account with no entry has no status line either —
            // that covers OAuth not being configured at all, and the moment before the first
            // health check has run.
            const oauth = delegated ? undefined : oauthStatuses.find((s) => s.email === p.email);
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

                  <span
                    aria-hidden
                    className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded-full text-[10px] font-semibold text-white"
                    style={{ backgroundColor: p.color }}
                  >
                    {showImg ? (
                      <img
                        src={p.avatarUrl}
                        alt=""
                        referrerPolicy="no-referrer"
                        draggable={false}
                        onError={() => setBrokenAvatars((b) => ({ ...b, [p.avatarUrl]: true }))}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      initial(p)
                    )}
                  </span>

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
                    <span className="flex min-w-0 items-center gap-1.5 text-xs text-neutral-500">
                      <span className="truncate">{p.email}</span>
                      {delegated && (
                        <>
                          <DelegatedIcon className="h-3 w-3 shrink-0" />
                          <span className="truncate">{S.delegatedTooltipSuffix}</span>
                        </>
                      )}
                    </span>
                    {oauth ? <AccountOAuthRow S={S} email={p.email} status={oauth.status} /> : null}

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
                      className={`flex h-7 w-7 items-center justify-center rounded-md text-neutral-500 transition hover:bg-black/5 hover:text-neutral-900 dark:hover:bg-white/10 dark:hover:text-neutral-100 motion-reduce:transition-none ${CARD_FOCUS_RING}`}
                    >
                      <PencilIcon className="h-4 w-4" />
                    </button>

                    <button
                      type="button"
                      onClick={() => setConfirmEmail(p.email)}
                      aria-label={S.removeAccount}
                      title={S.removeAccount}
                      className={`flex h-7 w-7 items-center justify-center rounded-md text-neutral-500 transition hover:bg-black/5 hover:text-neutral-900 dark:hover:bg-white/10 dark:hover:text-neutral-100 motion-reduce:transition-none ${CARD_FOCUS_RING}`}
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
