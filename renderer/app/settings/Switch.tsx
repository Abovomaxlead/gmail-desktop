// The switch for a standalone setting. It is a real checkbox rather than a
// `<button role="switch">` so the label in SettingRow can drive it through
// `htmlFor`, and it sits invisibly on top of the pill so the pill itself is
// clickable. The pill and the knob are decoration and are aria-hidden.

'use client';

export function Switch({
  id,
  checked,
  onChange,
  disabled,
  label,
  title,
}: {
  id?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  label?: string;
  title?: string;
}) {
  return (
    <span className="relative inline-flex h-5 w-9 shrink-0">
      <input
        id={id}
        type="checkbox"
        role="switch"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        aria-label={label}
        title={title}
        className="peer absolute inset-0 z-10 m-0 h-full w-full cursor-pointer appearance-none rounded-full bg-transparent outline-none disabled:cursor-not-allowed"
      />
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded-full bg-neutral-200 transition-colors peer-checked:bg-neutral-900 peer-focus-visible:ring-2 peer-focus-visible:ring-blue-600 peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-white peer-disabled:opacity-50 dark:bg-neutral-700 dark:peer-checked:bg-neutral-100 dark:peer-focus-visible:ring-offset-neutral-900 motion-reduce:transition-none"
      />
      <span
        aria-hidden
        className="pointer-events-none absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform peer-checked:translate-x-4 peer-disabled:opacity-50 dark:bg-neutral-300 dark:peer-checked:bg-neutral-900 motion-reduce:transition-none"
      />
    </span>
  );
}
