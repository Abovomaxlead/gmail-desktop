// Recreating a dragged label's nesting in another mailbox.
//
// Gmail's nesting is a naming convention and nothing more: `Klanten/Acme` is one flat label
// whose name contains a slash, not a child of `Klanten`. So a tree is a set of names, and
// every question about it -- what belongs to it, what it is called in the target, what has to
// be made there -- is string work. Kept pure and apart from the network for exactly that
// reason: it is the part that can be proved.

//===========================
// Types
//===========================

/** What one mailbox has to do to take a tree, worked out before anything is created */
export interface LabelTreePlan {
  /** Per source label the name it gets in the target mailbox */
  destinations: Map<string, string>;
  /** Per destination name the id of the label already carrying it */
  reuse: Map<string, string>;
  /** Destination names still to create, parents before their children */
  create: string[];
}


//===========================
// Constants
//===========================


//===========================
// Exported functions
//===========================

/**
 * The labels a dragged label takes with it
 *
 * A name that merely starts with the same letters is not a child -- `Klantenservice` is not
 * under `Klanten` -- so the separator is part of what is matched.
 *
 * @param all every label name in the source mailbox
 * @param dragged
 * @returns the dragged label and its descendants, parents before children
 */
export function labelTreeMembers(all: string[], dragged: string): string[] {
  const members = all.filter((n) => n === dragged || n.startsWith(`${dragged}/`));
  return sortParentsFirst(members);
}

/**
 * What one member of the tree is called in the target mailbox
 *
 * The dragged label's own leaf name is the top of what lands: dragging `Klanten/Acme` copies
 * a folder called `Acme`, because that is the folder the user picked up, not the one above it.
 *
 * @param dragged
 * @param member
 * @param parent the label the tree is put under, or null for the top of the list
 * @returns the destination name
 */
export function destinationName(dragged: string, member: string, parent: string | null): string {
  const base = dragged.split('/').pop() ?? dragged;
  const below = member.slice(dragged.length);
  const relative = `${base}${below}`;
  return parent ? `${parent}/${relative}` : relative;
}

/**
 * Works out what one mailbox has to do to take the tree
 *
 * A destination name the mailbox already has is reused and never recreated -- that is what
 * copying a tree into an existing label means, and it is what keeps a rollback from deleting
 * a label the user made themselves.
 *
 * @param members from labelTreeMembers
 * @param dragged
 * @param parent the label the tree is put under, or null
 * @param existing the target mailbox's own labels, name to id
 * @returns the plan
 */
export function planLabelTree(
  members: string[],
  dragged: string,
  parent: string | null,
  existing: Map<string, string>,
): LabelTreePlan {
  const destinations = new Map<string, string>();
  const reuse = new Map<string, string>();
  const wanted = new Set<string>();

  for (const member of members) {
    const name = destinationName(dragged, member, parent);
    destinations.set(member, name);
    for (const step of ancestryOf(name, parent)) wanted.add(step);
  }

  const create: string[] = [];
  for (const name of sortParentsFirst([...wanted])) {
    const already = existing.get(name);
    if (already) reuse.set(name, already);
    else create.push(name);
  }
  return { destinations, reuse, create };
}

/**
 * The label ids one saved message goes out with
 *
 * A member whose label is not in `ids` -- its creation failed -- is left out rather than
 * folded into its nearest ancestor: filing mail somewhere the user did not ask for is worse
 * than a gap the outcome names.
 *
 * @param sourceLabels the tree members this message was found under
 * @param destinations from the plan
 * @param ids every destination name that exists in the target now, name to id
 * @returns the ids, each at most once, in the order the members came in
 */
export function resolveMessageLabels(
  sourceLabels: string[],
  destinations: Map<string, string>,
  ids: Map<string, string>,
): string[] {
  const out: string[] = [];
  for (const member of sourceLabels) {
    const name = destinations.get(member);
    const id = name ? ids.get(name) : undefined;
    if (id && !out.includes(id)) out.push(id);
  }
  return out;
}


//===========================
// Helper functions
//===========================

/**
 * Orders names so a label always comes after the label it nests under
 *
 * Depth first, then the name, because creating `A/B` before `A` exists leaves Gmail showing a
 * parent nobody made.
 *
 * @param names
 * @returns a new array
 * @private
 */
function sortParentsFirst(names: string[]): string[] {
  return [...names].sort(
    (a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b, 'nl'),
  );
}

/**
 * A destination name and every step above it that the copy is responsible for
 *
 * Stops at the chosen parent: that label was picked from the mailbox's own list, so it exists
 * and is not this run's to make.
 *
 * @param name
 * @param parent
 * @returns the steps, shallowest first
 * @private
 */
function ancestryOf(name: string, parent: string | null): string[] {
  const parts = name.split('/');
  const skip = parent ? parent.split('/').length : 0;
  const out: string[] = [];
  for (let i = skip + 1; i <= parts.length; i++) out.push(parts.slice(0, i).join('/'));
  return out;
}
