// One sync: from "something changed" to "notify these and the count is this".
// Everything touching the network arrives as a dependency, so this runs without
// Electron. The cursor only advances past the last history page — moving it halfway
// and then failing would lose that mail for good. Syncs never overlap: one arriving
// during a run is remembered and replayed once afterwards, since two passes over the
// same cursor would notify everything twice, and pump() must always release the
// running flag or every later run() returns that same rejected promise forever.
import type { HistoryPage, MessageMeta } from './gmail-api';
import { notifiableIds, shouldNotify } from './history-sync';

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

export function createSyncRunner(deps: SyncDeps): { run(): Promise<void> } {
  let running: Promise<void> | null = null;
  let again = false;

  const unread = async (): Promise<number | null> => {
    try {
      return await deps.client.inboxUnread();
    } catch {
      return null;
    }
  };

  const baseline = async (): Promise<void> => {
    const historyId = await deps.client.profileHistoryId();
    if (historyId) deps.cursor.set(historyId);
    deps.onOutcome({ notify: [], unread: await unread(), rebaselined: true });
  };

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
    for (const id of notifiableIds(added)) {
      let meta: MessageMeta | null;
      try {
        meta = await deps.client.messageMeta(id);
      } catch (e) {
        deps.onError?.(e);
        continue;
      }
      if (meta && shouldNotify(meta.internalDate, since)) notify.push(meta);
    }

    deps.cursor.set(latest);
    deps.onOutcome({ notify, unread: await unread(), rebaselined: false });
  };

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
