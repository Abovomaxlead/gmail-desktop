// The one drag's own state: which drag is current, what it saved, where it came from, what it
// turned out to be, and what the picker is showing. Read and written across the pull, the copy
// and the job driver, so it lives on its own rather than inside any one of them -- the same
// reason core/runtime.ts holds what main.ts grew out of. Live bindings with a setter each, which
// makes every write a named call one grep finds.

import type { MailDropPreviewItem, MailDropTree } from '../core/ipc';
import type { PullControl } from './pull/pull-control';


//===========================
// Types
//===========================

/** One message a pull saved to disk, carried from there through the duplicate check and the
 * copy. */
export interface SavedRef {
  file: string;
  messageId: string;
  subject: string;
  threadId: string;
  /** The labels of a dragged tree this message was found under, empty for every other drag.
   * What the copy turns into destination labels, one mailbox at a time. */
  sourceLabels: string[];
  /** Whether the source mailbox has this message unread, so the copy can land unread too */
  unread: boolean;
}


//===========================
// Module state
//===========================

/** Bumped at the start of every drag and every job batch, so a result can tell the drag it
 * answers for apart from whichever one is current by the time it lands. */
export let dropSerial = 0;

/** The drag whose files a copy has begun inserting. Set before the first insert and read by the
 * picker's Kopieer and the pull retry, which would otherwise send that whole drag again. */
export let copiedSerial = -1;

export let lastDropSaved: SavedRef[] = [];

export let lastDropSource = '';

/** The tree the last drag turned out to be, or null when it was not a label drag. Read by the
 * picker, which draws what would be created, and by the copy, which plans against it. Cleared
 * at the start of every drop, so a conversation drag can never inherit the previous label
 * drag's tree. */
export let lastDropTree: MailDropTree | null = null;

/** What the preview window is showing right now. Asked for by a reopened window, and updated by
 * every pull and every batch the job driver shows. */
export let lastDropPreview: MailDropPreviewItem[] = [];

/** The gate of the pull that holds the drop lock, or null when nothing is being pulled. One at
 * a time is not an assumption but a property of the lock: dropLock.take admits one holder, and
 * both the ordinary pull and the job driver's own walk create this where they take the lock and
 * clear it where they release it. Read by the collection primitives too, so a label listing or
 * a thread fetch can answer a cancel without the pull wrapper threading its gate through every
 * call. */
export let activePull: PullControl | null = null;

/** How many conversations the pull that holds the lock has fetched, so a cancel can say how far
 * it got. Reset where the gate is created. */
export let pullDone = 0;


//===========================
// Exported functions
//===========================

export function bumpDropSerial(): number {
  dropSerial += 1;
  return dropSerial;
}
export function setCopiedSerial(v: number): void {
  copiedSerial = v;
}
export function setLastDropSaved(v: SavedRef[]): void {
  lastDropSaved = v;
}
export function setLastDropSource(v: string): void {
  lastDropSource = v;
}
export function setLastDropTree(v: MailDropTree | null): void {
  lastDropTree = v;
}
export function setLastDropPreview(v: MailDropPreviewItem[]): void {
  lastDropPreview = v;
}
export function setActivePull(v: PullControl | null): void {
  activePull = v;
}
export function setPullDone(v: number): void {
  pullDone = v;
}
