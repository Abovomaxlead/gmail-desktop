// Splits a list into fixed-size slices, the one loop this area needed three copies of before:
// label-job.ts cutting a plan into pull batches, label-purge.ts cutting an id list into trash
// calls, copy-marker-sweep.ts cutting a sweep's listing into modify calls. All three want the
// same thing -- consecutive runs of at most `size`, the last one short rather than padded -- so
// it lives once, here, generic over what is being cut.


//===========================
// Types
//===========================


//===========================
// Constants
//===========================


//===========================
// Exported functions
//===========================

/**
 * Cuts a list into consecutive slices of at most `size`
 *
 * @param items
 * @param size
 * @returns one slice per chunk, the last one short rather than padded, and nothing at all for
 *   an empty list
 */
export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let at = 0; at < items.length; at += size) out.push(items.slice(at, at + size));
  return out;
}


//===========================
// Helper functions
//===========================
