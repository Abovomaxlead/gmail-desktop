// One mailbox the user waved away, in renderer/lib because main keeps the list and the
// accounts panel is the one place it is drawn -- a second copy of the shape is a second
// thing to forget when a kind is added.
//
// The kind is not decoration. It says how the mailbox comes back: a delegation can be
// asked for again on the spot, an own account is found by the probe at the next start.

export interface HiddenAccount {
  email: string;
  kind: 'authuser' | 'delegated';
}
