'use client';

import type { ReactNode } from 'react';
import { BLOCK_TITLE, HAIRLINE, HINT, SECTION_TITLE } from './tokens';

// The shape every settings section shares: a title with groups of rows below it.
// A group draws a hairline above itself unless it is the first one, which is why
// groups have to stay direct children of Section - a wrapper in between would make
// every group the first.

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col">
      <h2 className={`pr-14 ${SECTION_TITLE}`}>{title}</h2>
      <div className="mt-6 flex flex-col">{children}</div>
    </section>
  );
}

export function SettingsGroup({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <div
      className={`flex flex-col border-t pt-5 first:border-t-0 first:pt-0 ${HAIRLINE} mt-4 first:mt-0`}
    >
      {title && <h3 className={BLOCK_TITLE}>{title}</h3>}
      {children}
    </div>
  );
}

export function EmptyNote({ children }: { children: ReactNode }) {
  return <p className={`max-w-[46ch] ${HINT}`}>{children}</p>;
}
