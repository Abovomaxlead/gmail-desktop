'use client';

import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';
import {
  SETTINGS_GROUPS,
  SETTINGS_SECTIONS,
  needsAttention,
  type AttentionInput,
  type SettingsSection,
} from './nav';
import { HAIRLINE, SURFACE, SURFACE_FOCUS_RING } from './tokens';

// The frame around every settings section: a nav column on the grey surface and one
// white surface next to it holding the active section. Arrow keys, Home and End move
// through the column, Escape closes the panel, and closing first blurs the focused
// field so a pending account name is written away. Every word on screen arrives as a
// prop, so this file contains no user-facing text of its own.


//===========================
// Constants
//===========================

const PANEL_ID = 'settings-section-panel';
const tabId = (section: SettingsSection) => `settings-tab-${section}`;


//===========================
// Component
//===========================

export function SettingsShell({
  sectionLabel,
  active,
  onSelect,
  attention,
  attentionLabel,
  onClose,
  closeLabel,
  escLabel,
  banner,
  children,
}: {
  sectionLabel(s: SettingsSection): string;
  active: SettingsSection;
  onSelect(s: SettingsSection): void;
  attention: AttentionInput;
  attentionLabel: string;
  onClose(): void;
  closeLabel: string;
  escLabel: string;
  banner?: ReactNode;
  children: ReactNode;
}) {
  const items = useRef<(HTMLButtonElement | null)[]>([]);

  const scroller = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (scroller.current) scroller.current.scrollTop = 0;
  }, [active]);

  const close = () => {
    (document.activeElement as HTMLElement | null)?.blur?.();
    onClose();
  };

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onClose]);

  const step = (delta: number) => {
    const from = SETTINGS_SECTIONS.indexOf(active);
    if (from < 0) return;
    const to = (from + delta + SETTINGS_SECTIONS.length) % SETTINGS_SECTIONS.length;
    onSelect(SETTINGS_SECTIONS[to]);
    items.current[to]?.focus();
  };

  const jump = (to: number) => {
    onSelect(SETTINGS_SECTIONS[to]);
    items.current[to]?.focus();
  };

  const onNavKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      step(1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      step(-1);
    } else if (e.key === 'Home') {
      e.preventDefault();
      jump(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      jump(SETTINGS_SECTIONS.length - 1);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden bg-neutral-100 text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
      <nav
        role="tablist"
        aria-orientation="vertical"
        onKeyDown={onNavKeyDown}
        className="flex w-60 shrink-0 flex-col overflow-y-auto px-4 py-4"
      >
        {SETTINGS_GROUPS.map((group, gi) => (
          <div
            key={gi}
            className={`flex flex-col gap-0.5 ${gi > 0 ? `mt-2 border-t pt-2 ${HAIRLINE}` : ''}`}
          >
            {group.map((section) => {
              const isActive = section === active;
              const i = SETTINGS_SECTIONS.indexOf(section);
              return (
                <button
                  key={section}
                  ref={(el) => {
                    items.current[i] = el;
                  }}
                  id={tabId(section)}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  aria-controls={PANEL_ID}
                  tabIndex={isActive ? 0 : -1}
                  onClick={() => onSelect(section)}
                  className={`flex min-h-[32px] items-center gap-2 rounded-md px-3 py-1.5 text-left text-[13px] transition motion-reduce:transition-none ${SURFACE_FOCUS_RING} ${
                    isActive
                      ? 'bg-black/[0.06] font-medium text-neutral-900 dark:bg-white/10 dark:text-neutral-100'
                      : 'font-normal text-neutral-500 dark:text-neutral-400 hover:bg-black/[0.04] hover:text-neutral-900 dark:hover:bg-white/5 dark:hover:text-neutral-100'
                  }`}
                >
                  <span className="min-w-0 flex-1 truncate">{sectionLabel(section)}</span>
                  {needsAttention(section, attention) && (
                    <>
                      <span className="sr-only">{attentionLabel}</span>
                      <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-blue-600" />
                    </>
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="min-h-0 flex-1 pb-4 pr-4 pt-4">
        <div className={`relative flex h-full min-h-0 flex-col overflow-hidden ${SURFACE}`}>
          <div className="absolute right-5 top-5 z-10 flex flex-col items-center gap-1">
            <button
              type="button"
              onClick={close}
              aria-label={closeLabel}
              title={closeLabel}
              className={`flex h-8 w-8 items-center justify-center rounded-full bg-neutral-100 text-neutral-600 transition hover:bg-neutral-200 hover:text-neutral-900 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700 dark:hover:text-neutral-100 motion-reduce:transition-none ${SURFACE_FOCUS_RING} focus-visible:ring-offset-white dark:focus-visible:ring-offset-neutral-900`}
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                aria-hidden
                className="h-3.5 w-3.5"
              >
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
            <span aria-hidden className="text-[10px] font-medium uppercase tracking-wide text-neutral-400">
              {escLabel}
            </span>
          </div>

          <div
            ref={scroller}
            id={PANEL_ID}
            role="tabpanel"
            aria-labelledby={tabId(active)}
            tabIndex={0}
            className="min-h-0 flex-1 overflow-y-auto rounded-2xl outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-blue-600"
          >
            <div className="mx-auto w-full max-w-[560px] px-8 py-10">
              {banner && <div className="mb-8">{banner}</div>}
              {children}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
