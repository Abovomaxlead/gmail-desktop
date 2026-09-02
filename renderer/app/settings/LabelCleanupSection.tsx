'use client';

import { useEffect, useState } from 'react';
import type { UiStrings } from '../strings';
import type { LabelPurgeCount } from '../../lib/label-purge';
import { Section, SettingsGroup } from './Section';
import { ACCENT_BUTTON, CHECKBOX, FIELD, HINT, WARN_HINT } from './tokens';

interface Mailbox {
  email: string;
  labels: { id: string; name: string }[];
}

/**
 * Empties a label in one mailbox, in two deliberate steps
 *
 * Count first, then purge what was counted. The second step sends only the handle the count
 * answered, so what goes away is what was on screen rather than whatever is under the label by
 * the time the button is pressed.
 */
export function LabelCleanupSection({ S }: { S: UiStrings }) {
  const [boxes, setBoxes] = useState<Mailbox[]>([]);
  const [email, setEmail] = useState('');
  const [label, setLabel] = useState('');
  const [counted, setCounted] = useState<LabelPurgeCount | null>(null);
  const [ticked, setTicked] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<'' | 'counting' | 'purging'>('');
  const [said, setSaid] = useState('');

  // getLabels is the picker the mail drop already uses: the mailboxes this app can reach, with
  // their own labels and none of its markers. A second channel for the same answer would be a
  // second thing to keep true.
  useEffect(() => {
    const bridge = window.desktop;
    if (!bridge) return;
    void bridge
      .getLabels()
      .then((r) => setBoxes(r?.accounts ?? []))
      .catch(() => setBoxes([]));
  }, []);

  // Any change of mailbox or label makes the count stale, and a stale count must not be
  // purgeable: dropping it here is what keeps the button honest about what it would remove.
  const forget = () => {
    setCounted(null);
    setSaid('');
  };

  const count = async () => {
    const bridge = window.desktop;
    if (!bridge) return;
    setBusy('counting');
    setSaid('');
    try {
      const answer = await bridge.countLabelPurge(email, label);
      if ('error' in answer) {
        setSaid(answer.error);
        return;
      }
      setCounted(answer);
      setTicked(Object.fromEntries(answer.labels.map((l) => [l.name, true])));
    } finally {
      setBusy('');
    }
  };

  const purge = async () => {
    const bridge = window.desktop;
    if (!bridge || !counted) return;
    setBusy('purging');
    const names = counted.labels.filter((l) => ticked[l.name]).map((l) => l.name);
    try {
      const outcome = await bridge.runLabelPurge(counted.handle, names);
      setCounted(null);
      setSaid(
        outcome.error
          ? S.labelCleanupPartial(outcome.trashed, outcome.failed, outcome.error)
          : S.labelCleanupMoved(outcome.trashed),
      );
    } finally {
      setBusy('');
    }
  };

  const chosen = counted?.labels.filter((l) => ticked[l.name]) ?? [];
  const total = chosen.reduce((sum, l) => sum + l.messages, 0);

  return (
    <Section title={S.navLabelCleanup}>
      <SettingsGroup>
        <p className={`max-w-[60ch] ${HINT}`}>{S.labelCleanupIntro}</p>

        <label className="mt-3 block text-[13px]">
          {S.labelCleanupMailbox}
          <select
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setLabel('');
              forget();
            }}
            className={`mt-1 block w-full ${FIELD}`}
          >
            <option value="">—</option>
            {boxes.map((b) => (
              <option key={b.email} value={b.email}>
                {b.email}
              </option>
            ))}
          </select>
        </label>

        <label className="mt-3 block text-[13px]">
          {S.labelCleanupLabel}
          <select
            value={label}
            onChange={(e) => {
              setLabel(e.target.value);
              forget();
            }}
            disabled={!email}
            className={`mt-1 block w-full disabled:opacity-50 ${FIELD}`}
          >
            <option value="">—</option>
            {(boxes.find((b) => b.email === email)?.labels ?? []).map((l) => (
              <option key={l.id} value={l.name}>
                {l.name}
              </option>
            ))}
          </select>
        </label>

        <button
          onClick={() => void count()}
          disabled={!email || !label || busy !== ''}
          className={`mt-4 self-start ${ACCENT_BUTTON}`}
        >
          {busy === 'counting' ? S.labelCleanupCounting : S.labelCleanupCount}
        </button>
      </SettingsGroup>

      {counted && (
        <SettingsGroup>
          {counted.total === 0 ? (
            <p className={HINT}>{S.labelCleanupNothing}</p>
          ) : (
            <>
              {/* One line per label of the tree, because Gmail's nesting is naming and not
                  containment: lumping them would remove more than the heading says, and
                  dropping them would leave mail behind and call the label empty. */}
              <ul className="flex flex-col gap-1">
                {counted.labels.map((l) => (
                  <li key={l.name} className="text-[13px]">
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={ticked[l.name] ?? false}
                        onChange={(e) => setTicked({ ...ticked, [l.name]: e.target.checked })}
                        className={CHECKBOX}
                      />
                      <span className="font-medium">{l.name}</span>
                      <span className={HINT}>
                        {S.labelCleanupPerLabel(l.messages.toLocaleString(S.numberLocale))}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
              {counted.capped && <p className={`mt-2 ${WARN_HINT}`}>{S.labelCleanupCapped}</p>}
              {/* The number rides on the control itself rather than on a line above it: it is
                  the guard, and a button that says how much it removes cannot be misread. */}
              <button
                onClick={() => void purge()}
                disabled={total === 0 || busy !== ''}
                className="mt-4 self-start rounded-lg px-3 py-1.5 text-[13px] font-medium text-amber-600 transition hover:bg-amber-500/10 disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none dark:text-amber-500"
              >
                {S.labelCleanupTrashButton(total.toLocaleString(S.numberLocale))}
              </button>
              <p className={`mt-2 ${HINT}`}>{S.labelCleanupTrashNote}</p>
            </>
          )}
        </SettingsGroup>
      )}

      {said && (
        <SettingsGroup>
          <p className="text-[13px]">{said}</p>
        </SettingsGroup>
      )}
    </Section>
  );
}
