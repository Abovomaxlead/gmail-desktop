// A handful of requests at a time instead of one by one: a label drag is hundreds of
// identical requests, which takes minutes in sequence and hits Gmail's quota all at
// once. Results come back in input order even though they finish out of order,
// because a label drag's filenames are numbered.
//
// And asking the same question once instead of once per caller, which is what memoise is for.
// And, for uploads, handing out room by size rather than by count: see createUploadBudget.

/** Room to upload, handed out by size. */
export interface UploadBudget {
  /** Waits until `bytes` fit, runs fn, and gives the room back whatever fn does */
  run<T>(bytes: number, fn: () => Promise<T>): Promise<T>;
}

/**
 * A budget that hands out room by size rather than by count
 *
 * A count is the wrong unit for uploading mail. "Eight at a time" has to be set low enough for
 * the one mail of eleven megabytes, and then it throttles the ninety-nine of fifty kilobytes
 * that come with it -- measured at 28% of the quota Gmail allows, purely because of that
 * setting. Reserving bytes instead lets the small ones go wide and narrows itself the moment a
 * big one arrives, and it bounds peak memory for real: it is the budget, not eight times
 * whatever the largest mail turns out to be.
 *
 * Only the head of the queue is ever considered, so a stream of small uploads cannot keep
 * jumping over a big one that is waiting for room.
 *
 * @param maxBytes how much may be in flight at once
 * @param maxInFlight a ceiling on the count as well, to keep the number of open connections
 *   sane when the mails are tiny
 * @returns the budget
 */
export function createUploadBudget(maxBytes: number, maxInFlight: number): UploadBudget {
  let bytesUsed = 0;
  let inFlight = 0;
  const waiting: Array<{ bytes: number; go: () => void }> = [];

  // The `inFlight === 0` is what keeps a mail bigger than the whole budget from waiting for
  // room that can never come: it goes on its own instead.
  const fits = (bytes: number) =>
    inFlight < maxInFlight && (bytesUsed + bytes <= maxBytes || inFlight === 0);

  const pump = () => {
    while (waiting.length > 0 && fits(waiting[0].bytes)) {
      const next = waiting.shift()!;
      bytesUsed += next.bytes;
      inFlight += 1;
      next.go();
    }
  };

  return {
    async run<T>(bytes: number, fn: () => Promise<T>): Promise<T> {
      const size = Math.max(0, bytes);
      if (waiting.length === 0 && fits(size)) {
        bytesUsed += size;
        inFlight += 1;
      } else {
        await new Promise<void>((go) => {
          waiting.push({ bytes: size, go });
        });
      }
      try {
        return await fn();
      } finally {
        // In a finally because an upload that failed still has to give its room back, or one
        // error would seize up the rest of the copy.
        bytesUsed -= size;
        inFlight -= 1;
        pump();
      }
    },
  };
}

/**
 * Runs make once per key and hands every caller the same answer
 *
 * The promise is cached rather than the value, which is the point: the callers all ask before
 * any of them has an answer, so caching the value would come too late to help.
 *
 * A rejection is not kept. Handing a stored failure to everyone who asks later would turn one
 * bad moment into a permanent one, so the key is forgotten and the next caller may try again.
 *
 * @param cache lives as long as the work it belongs to — one drag, not the whole session
 * @param key
 * @param make does the work, called only when this key is new
 * @returns what make answered
 */
export function memoise<T>(
  cache: Map<string, Promise<T>>,
  key: string,
  make: () => Promise<T>,
): Promise<T> {
  const known = cache.get(key);
  if (known) return known;
  const started = make().catch((e) => {
    cache.delete(key);
    throw e;
  });
  cache.set(key, started);
  return started;
}

/**
 * Runs fn over items, at most limit at a time
 *
 * @param items
 * @param limit maximum number of calls in flight at once
 * @param fn receives each item and its index
 * @returns results in input order
 */
export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return out;
}
