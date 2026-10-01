// One sync: from "something changed" to "notify these and the count is this". Everything
// touching the network arrives as a dependency, so this runs without Electron.
//
// The cursor only advances past the last history page, and syncs never overlap — one
// arriving mid-run is replayed once afterwards, since two passes over the same cursor
// would notify everything twice.
import type { HistoryPage, MessageMeta } from '../gmail/gmail-api';
import { notifiableIds, shouldNotify } from '../gmail/history-sync';



//===========================
// Types
//===========================

export interface SyncClient {
  profileHistoryId(): Promise<string | null>;
  historyPage(startHistoryId: string, pageToken?: string): Promise<HistoryPage>;
  messageMeta(id: string): Promise<MessageMeta | null>;
  inboxUnread(): Promise<number | null>;
}

export interface SyncCursor {
  get(): string | undefined;
  set(historyId: string): void;
}

export interface SyncOutcome {
  notify: MessageMeta[];
  unread: number | null;
  rebaselined: boolean;
}

export interface SyncDeps {
  client: SyncClient;
  cursor: SyncCursor;
  coveredSince: () => number | null;
  isExpiredCursor: (e: unknown) => boolean;
  onOutcome: (outcome: SyncOutcome) => void;
  onError?: (e: unknown) => void;
}


//===========================
// Exported functions
//===========================

/**
 * Builds the runner that turns "something changed" into an outcome
 *
 * @param deps everything touching the network, so this stays Electron-free
 * @returns run(), which never overlaps itself and replays a sync that arrived mid-run
 */
export function createSyncRunner(deps: SyncDeps): { run(): Promise<void> } {
  let running: Promise<void> | null = null;
  let again = false;

  /**
   * Reads the inbox unread count, treating a failure as "unknown"
   *
   * @returns the count, or null
   * @private
   */
  const unread = async (): Promise<number | null> => {
    try {
      return await deps.client.inboxUnread();
    } catch {
      return null;
    }
  };

  /**
   * Restarts from Gmail's current historyId without notifying anything
   *
   * @private
   */
  const baseline = async (): Promise<void> => {
    const historyId = await deps.client.profileHistoryId();
    if (historyId) deps.cursor.set(historyId);
    deps.onOutcome({ notify: [], unread: await unread(), rebaselined: true });
  };

  /**
   * Walks every history page and reports what deserves a notification
   *
   * The cursor only advances when the whole pass succeeded: moving it past a page or a
   * message that failed would lose that mail for good, because no later sync would ever
   * look before the cursor again.
   *
   * @private
   */
  const once = async (): Promise<void> => {
    const start = deps.cursor.get();
    if (!start) return baseline();

    const added: HistoryPage['added'] = [];
    let latest = start;
    let pageToken: string | undefined;
    try {
      do {
        const page = await deps.client.historyPage(start, pageToken);
        added.push(...page.added);
        if (page.historyId) latest = page.historyId;
        pageToken = page.nextPageToken;
      } while (pageToken);
    } catch (e) {
      if (deps.isExpiredCursor(e)) return baseline();
      deps.onError?.(e);
      return;
    }

    const since = deps.coveredSince();
    const notify: MessageMeta[] = [];
    let incomplete = false;
    for (const id of notifiableIds(added)) {
      let meta: MessageMeta | null;
      try {
        meta = await deps.client.messageMeta(id);
      } catch (e) {
        incomplete = true;
        deps.onError?.(e);
        continue;
      }
      if (meta && shouldNotify(meta.internalDate, since)) notify.push(meta);
    }

    if (!incomplete) deps.cursor.set(latest);
    deps.onOutcome({ notify, unread: await unread(), rebaselined: false });
  };

  /**
   * Drains the pending syncs, always releasing the running flag
   *
   * Without the finally, every later run() would return that same rejected promise
   * forever.
   *
   * @private
   */
  const pump = async (): Promise<void> => {
    try {
      do {
        again = false;
        try {
          await once();
        } catch (e) {
          deps.onError?.(e);
        }
      } while (again);
    } finally {
      running = null;
    }
  };

  return {
    run(): Promise<void> {
      if (running) {
        again = true;
        return running;
      }
      running = pump();
      return running;
    },
  };
}
