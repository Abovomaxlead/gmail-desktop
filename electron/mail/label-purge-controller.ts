// The two halves of emptying a label: count what is there, then trash exactly that.
//
// Split in two because the destructive half must not be reachable without the other. The count
// puts its ids in the store (label-purge.ts) and hands back only numbers; the purge takes the
// handle. Nothing here asks Gmail what is under a label at purge time, which is what keeps mail
// that arrived in the meantime out of it.
//
// Trash and never delete: batchModify adding TRASH is reversible from Gmail for thirty days.
// messages.batchDelete is not used here and must not be added -- there is no flag, no setting and
// no caller that should be able to reach a permanent removal through this file.

import { randomUUID } from 'node:crypto';
import { withMailboxToken } from '../auth/mailbox-token';
import {
  BATCH_MODIFY_LIMIT,
  batchModifyMessages,
  fetchMessageListPage,
  fetchUserLabelMap,
} from '../gmail/gmail-api';
import { notifyLog } from '../notify/notify-log';
import { labelTreeMembers } from './label-tree';
import {
  PURGE_LIST_MAX,
  chunkIds,
  createPurgeStore,
  type CountedLabel,
  type PurgeCount,
  type PurgeOutcome,
} from './label-purge';


//===========================
// Constants
//===========================

const store = createPurgeStore(() => randomUUID());


//===========================
// Exported functions
//===========================

/**
 * Counts what emptying a label would remove, and remembers it
 *
 * The label and every label nested under it, each with its own count, so the tree is visible
 * rather than implied -- Gmail's nesting is naming and not containment, so a tool that lumped
 * them would delete more than its heading said and one that dropped them would leave mail behind
 * and call the label empty.
 *
 * @param email the mailbox, which must be one this app can already reach
 * @param label the label the user picked, by name
 * @returns the counts and a handle, or the reason it could not count
 */
export async function countLabelForPurge(
  email: string,
  label: string,
): Promise<PurgeCount | { error: string }> {
  const withToken = await withMailboxToken(email);
  if (!withToken) return { error: `Geen toegang tot ${email}` };

  try {
    // fetchUserLabelMap and not a raw label listing: it keeps only the mailbox's own labels and
    // drops this app's markers, which is what makes a system label unofferable rather than
    // merely declined.
    const all = await withToken((token) => fetchUserLabelMap(token));
    const members = labelTreeMembers([...all.keys()], label);
    if (members.length === 0) return { error: `Label "${label}" bestaat niet in ${email}` };

    const byLabel: CountedLabel[] = [];
    let seen = 0;
    let capped = false;
    for (const name of members) {
      const labelId = all.get(name);
      if (!labelId) continue;
      const ids: string[] = [];
      let pageToken: string | undefined;
      do {
        const page = await withToken((token) => fetchMessageListPage(token, labelId, pageToken));
        for (const id of page.ids) {
          if (seen >= PURGE_LIST_MAX) {
            capped = true;
            break;
          }
          ids.push(id);
          seen += 1;
        }
        pageToken = capped ? undefined : page.nextPageToken;
      } while (pageToken);
      byLabel.push({ name, labelId, ids });
      if (capped) break;
    }

    const count = store.put({ email, label, byLabel, capped });
    notifyLog(
      `[opruimen] ${email} label "${label}": ${count.total} bericht(en) over ${count.labels.length} label(s)${capped ? ', afgekapt' : ''}`,
    );
    return count;
  } catch (e) {
    return { error: `Tellen mislukt: ${(e as Error).message}` };
  }
}

/**
 * Moves the counted messages of the named labels to the trash
 *
 * Chunk after chunk rather than alongside each other: three calls are three calls, and serial is
 * what lets the answer say how far it got when one is refused.
 *
 * @param handle from the count this purge belongs to
 * @param labels the labels the user left ticked, by name
 * @returns how many were trashed and how many were not
 */
export async function purgeCountedLabel(handle: string, labels: string[]): Promise<PurgeOutcome> {
  const taken = store.take(handle, labels);
  if (!taken) {
    return { trashed: 0, failed: 0, error: 'Deze telling is verlopen. Tel opnieuw voordat je opruimt.' };
  }
  const { email, ids } = taken;
  if (ids.length === 0) return { trashed: 0, failed: 0 };

  const withToken = await withMailboxToken(email);
  if (!withToken) return { trashed: 0, failed: ids.length, error: `Geen toegang tot ${email}` };

  let trashed = 0;
  const chunks = chunkIds(ids, BATCH_MODIFY_LIMIT);
  for (const [at, chunk] of chunks.entries()) {
    try {
      await withToken((token) => batchModifyMessages(token, chunk, { addLabelIds: ['TRASH'] }));
      trashed += chunk.length;
    } catch (e) {
      const failed = ids.length - trashed;
      notifyLog(
        `[opruimen] ${email}: blok ${at + 1} van ${chunks.length} geweigerd, ${trashed} weg, ${failed} niet: ${(e as Error).message}`,
      );
      return { trashed, failed, error: (e as Error).message };
    }
  }
  notifyLog(`[opruimen] ${email}: ${trashed} bericht(en) naar de prullenbak`);
  return { trashed, failed: 0 };
}
