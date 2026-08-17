'use client';

// The round account avatar: the account's own colour, its picture when there is one, and the
// first letter of its name when there is not.
//
// Google's picture URL can start failing long after it was handed to us, so a broken load
// falls back to the letter. That flag is per avatar rather than per list, which is what lets
// a list of accounts keep no bookkeeping of its own.

import { useState, type ReactNode } from 'react';


//===========================
// Constants
//===========================

// Both sizes carry their own text size: the letter has to shrink with the circle.
const SIZES = {
  sm: 'h-6 w-6 text-[10px]',
  md: 'h-8 w-8 text-xs',
} as const;


//===========================
// Exported components
//===========================

/**
 * Draws an account's avatar
 *
 * @param url the picture, when the account has one
 * @param color the account's own colour, behind a missing or broken picture
 * @param name the name the letter is taken from; each caller decides which name that is
 * @param size
 * @param className extra classes on the circle, for the caller's own layout
 * @param fallback drawn instead of the letter, for a card that stands for no account
 */
export function Avatar({
  url,
  color,
  name,
  size = 'md',
  className = '',
  fallback,
}: {
  url?: string | null;
  color: string;
  name?: string | null;
  size?: keyof typeof SIZES;
  className?: string;
  fallback?: ReactNode;
}) {
  const [broken, setBroken] = useState(false);
  return (
    <span
      aria-hidden
      className={`flex shrink-0 items-center justify-center overflow-hidden rounded-full font-semibold text-white ${SIZES[size]} ${className}`}
      style={{ backgroundColor: color }}
    >
      {url && !broken ? (
        <img
          src={url}
          alt=""
          referrerPolicy="no-referrer"
          draggable={false}
          onError={() => setBroken(true)}
          className="h-full w-full object-cover"
        />
      ) : (
        fallback ?? initial(name)
      )}
    </span>
  );
}


//===========================
// Helper functions
//===========================

function initial(name?: string | null): string {
  return (name || '?').trim().charAt(0).toUpperCase() || '?';
}
