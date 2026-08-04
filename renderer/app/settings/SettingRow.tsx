'use client';

import type { ReactNode } from 'react';
import { HINT } from './tokens';

// One row in the settings panel: label on the left, control on the right, so every
// control in a section lines up. Passing `htmlFor` makes the label a real label, so
// clicking the name toggles the control; rows without a single target stay a div.

export function SettingRow({
  label,
  description,
  children,
  htmlFor,
}: {
  label: string;
  description?: ReactNode;
  children: ReactNode;
  htmlFor?: string;
}) {
  const shape = 'flex items-start justify-between gap-10 py-3';

  const text = (
    <span className="flex min-w-0 flex-col">
      <span className="text-[13.5px] font-medium leading-5">{label}</span>
      {description && <span className={`mt-1 ${HINT}`}>{description}</span>}
    </span>
  );

  const control = <span className="flex min-h-5 shrink-0 items-center gap-2">{children}</span>;

  if (htmlFor) {
    return (
      <label htmlFor={htmlFor} className={`${shape} cursor-pointer`}>
        {text}
        {control}
      </label>
    );
  }

  return (
    <div className={shape}>
      {text}
      {control}
    </div>
  );
}
