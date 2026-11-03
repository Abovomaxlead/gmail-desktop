// Working out per mailbox what a dragged label's structure would mean there, before anything
// is created.
//
// Deliberately before the duplicate scan and before the run exists: the scan can only ask
// about labels that are already there, and a 'check' pass the user then cancels must not leave
// new labels behind in their mailbox.

import type { MailDropCopyTarget, MailDropTree } from '../../core/ipc';
import { mailboxToken } from '../../auth/mailbox-token';
import { mapLimit } from '../../core/concurrency';
import { createVisibleLabel, fetchUserLabelMap, isSystemLabelId } from '../../gmail/gmail-api';
import {
  parentInsideTree,
  planLabelTree,
  resolveMessageLabels,
  type LabelTreePlan,
} from './label-tree';
import { recordCopyJournalLabel } from './copy-journal';
import type { CopyRunId, CreatedLabel } from './copy-run-types';
import type { ResolvedTreeLabels } from './mail-copy';
import type { SavedRef } from '../drop-state';


//===========================
// Types
//===========================

/** What every mailbox taking a dragged tree has to do, worked out before anything is created */
export interface TreePlanning {
  /** Per mailbox its own plan; a mailbox not taking the tree is absent */
  plans: Map<string, LabelTreePlan>;
  /** Per mailbox the labels resolved so far. Until the missing labels have been created this
   * only names the ones that were already there, which is exactly what the duplicate scan may
   * ask about: a label yet to be made holds nothing. */
  resolved: ResolvedTreeLabels;
  /** Per mailbox why it could not be planned at all */
  errors: Map<string, string>;
}


//===========================
// Constants
//===========================

// How many mailboxes are worked at once, whether planning a tree or copying into one. Each is a
// different Gmail user with a quota of its own.
export const MAILBOX_LIMIT = 3;


//===========================
// Exported functions
//===========================

/**
 * Works out per mailbox what taking the dragged tree would mean, creating nothing
 *
 * @param targets
 * @param files the drag's saved messages
 * @param tree what the drag turned out to carry, or null when it was not a label drag
 * @returns the plans, what already resolves, and per mailbox whatever went wrong
 */
export async function planTrees(
  targets: MailDropCopyTarget[],
  files: SavedRef[],
  tree: MailDropTree | null,
): Promise<TreePlanning> {
  const plans = new Map<string, LabelTreePlan>();
  const resolved: ResolvedTreeLabels = new Map();
  const errors = new Map<string, string>();
  const taking = targets.filter((t) => t.tree);
  if (!tree || taking.length === 0) return { plans, resolved, errors };

  const members = tree.members.map((m) => m.name);
  await mapLimit(taking, MAILBOX_LIMIT, async (target) => {
    const got = await mailboxToken(target.email);
    if (!got.ok) {
      errors.set(target.email, got.error);
      return;
    }
    try {
      const existing = await fetchUserLabelMap(got.token);
      const chosen = target.tree?.parentLabelId ?? null;
      const parent = chosen ? nameForLabelId(existing, chosen) : null;
      // Refused rather than quietly put at the top of the list: the user picked a label, and
      // landing somewhere else is not a smaller version of that. Gmail's own places are not in
      // `existing` at all -- it lists user labels -- so they come out here too, and say why:
      // nesting is naming, and only a user label can carry a name with a slash in it.
      if (chosen && !parent) {
        errors.set(
          target.email,
          isSystemLabelId(chosen)
            ? 'een structuur kan alleen onder een eigen label, niet onder Postvak IN, Met sterren of Belangrijk'
            : 'het gekozen label bestaat niet meer in dit postvak',
        );
        return;
      }
      // A parent of the tree's own kind puts the whole tree in a copy of itself -- nothing is
      // reused, every name is new, and the mail lands one level deeper. Refused rather than
      // silently stripped: whoever wants the sublabel under the label that is already there
      // means the top of the list, which reuses it and gives exactly that.
      if (parent && parentInsideTree(tree.dragged, parent)) {
        errors.set(
          target.email,
          `"${parent}" hoort bij dezelfde structuur als "${tree.dragged}" — kies Bovenin, dan wordt het bestaande label hergebruikt`,
        );
        return;
      }
      const plan = planLabelTree(members, parent, existing);
      plans.set(target.email, plan);
      resolved.set(target.email, perMessageLabels(files, plan, new Map(plan.reuse)));
    } catch (e) {
      errors.set(target.email, (e as Error).message);
    }
  });
  return { plans, resolved, errors };
}

/**
 * Creates the labels a mailbox is still missing, recording each one as it lands
 *
 * Parents before children, which is `plan.create`'s own order -- creating `A/B` first leaves
 * Gmail drawing a parent nobody made. A name Gmail refuses takes only itself out of the copy:
 * the messages that would have gone there are skipped and the name is reported, since filing
 * them under a nearer ancestor would put mail where nobody asked for it.
 *
 * @param root the drop folder, for the journal
 * @param runId
 * @param email
 * @param plan
 * @returns every destination name that exists now, and per failed label its own reason
 */
export async function createTreeLabels(
  root: string,
  runId: CopyRunId,
  email: string,
  plan: LabelTreePlan,
): Promise<{ ids: Map<string, string>; created: CreatedLabel[]; failed: string[]; warnings: string[] }> {
  const ids = new Map(plan.reuse);
  const created: CreatedLabel[] = [];
  const failed: string[] = [];
  const warnings: string[] = [];
  if (plan.create.length === 0) return { ids, created, failed, warnings };

  const got = await mailboxToken(email);
  if (!got.ok) {
    for (const name of plan.create) failed.push(`${name}: ${got.error}`);
    return { ids, created, failed, warnings };
  }
  for (const name of plan.create) {
    try {
      const made = await createVisibleLabel(got.token, name);
      ids.set(name, made.id);
      const record: CreatedLabel = { email, labelId: made.id, name };
      created.push(record);
      const warn = recordCopyJournalLabel(root, runId, record);
      if (warn) warnings.push(`kon label "${name}" niet in het journaal zetten: ${warn}`);
    } catch (e) {
      failed.push(`${name}: ${(e as Error).message}`);
    }
  }
  return { ids, created, failed, warnings };
}

/**
 * Per saved message the labels it goes out with in one mailbox
 *
 * @param files the drag's saved messages
 * @param plan
 * @param ids every destination name that exists in the mailbox now
 * @returns Message-ID to label ids
 */
export function perMessageLabels(
  files: SavedRef[],
  plan: LabelTreePlan,
  ids: Map<string, string>,
): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const file of files) {
    if (!file.messageId.trim()) continue;
    out.set(file.messageId, resolveMessageLabels(file.sourceLabels, plan.destinations, ids));
  }
  return out;
}


//===========================
// Helper functions
//===========================

/**
 * The label a chosen id belongs to
 *
 * @param existing name to id, as the mailbox answered it
 * @param labelId
 * @returns the name, or null when the mailbox no longer has that label
 * @private
 */
function nameForLabelId(existing: Map<string, string>, labelId: string): string | null {
  for (const [name, id] of existing) if (id === labelId) return name;
  return null;
}
