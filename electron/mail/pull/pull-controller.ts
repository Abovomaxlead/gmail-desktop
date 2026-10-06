// Pulling what was dragged into local files, with every Gmail view locked while it runs, and
// showing the picker on what that saved.
//
// Two routes reach the same list and do not find the same messages. The API lists every
// message in a thread; the page route can only save what Gmail's "show original" page links
// to, and a long conversation arrives there collapsed. The API goes first for that reason,
// and the page is what is left when a mailbox has no token.
//
// A big label's job drives this same pull one batch at a time, from mail-drop-controller.ts --
// walking a job never touches anything below, only the pull and the picker it opens. What the
// pull needs from the job in the other direction (whether it may run at all, where a stale job
// goes, what a batch's own loss is folded into) comes back through JobDriverHooks, wired once at
// that file's module scope, so this file never imports the driver and a cycle never opens.

import { app } from 'electron';
import { randomUUID } from 'node:crypto';
import { IPC } from '../../core/ipc';
import type {
  MailDropCopyProgress,
  MailDropFolderStatus,
  MailDropPayload,
  MailDropPreview,
  MailDropPreviewItem,
} from '../../core/ipc';
import { DEV_URL, SIDEBAR_PRELOAD_PATH } from '../../core/paths';
import { currentLocale, currentlyDark, dropOverlay, keyOf, mainWindow, manager, prefs, profiles, setDropOverlay } from '../../core/runtime';
import type { JobPanel } from '../../../renderer/lib/maildrop-copy';
import { mapLimit } from '../../core/concurrency';
import { OverlayView } from '../../windows/overlay-view';
import { bringToFront } from '../../windows/window-focus';
import type { Profile } from '../../windows/profile-view-manager';
import { notifyLog } from '../../notify/notify-log';
import { appendLog } from './mail-archive';
import { attemptWrite } from '../copy/copy-journal';
import { type TreeThread } from '../drag/label-drop';
import { JOB_BATCH_THREADS, needsJob, readLabelJob, startLabelJob, type LabelJob } from '../job/label-job';
import { pullRefusal, type JobEndInfo } from '../job/job-guard';
import { BUSY_TEXT, SLOW_TEXT, cancelledText, dropOutcome } from '../drag/dropzone';
import { createPullControl } from './pull-control';
import { DROP_LOCK_MS, createDropLock } from '../drag/drop-lock';
import { chunk } from '../shared/chunk';
import { defaultMailFolder, looksRemoteFolder } from './mail-folder';
import { failedRowIndexes } from '../../../renderer/lib/failure-list';
import {
  activePull,
  bumpDropSerial,
  dropSerial,
  lastDropPreview,
  lastDropSaved,
  lastDropTree,
  pullDone,
  setActivePull,
  setBatchPullFailedThreads,
  setLastDropPreview,
  setLastDropSaved,
  setLastDropSource,
  setLastDropTree,
  setPullDone,
  type SavedRef,
} from '../drop-state';
import {
  listLabelTree,
  saveLabel,
  saveOneThread,
  withLogTrouble,
  type LabelTreeListing,
  type SaveProgress,
  type ThreadReadCache,
} from './pull-collect';
import { startExistingScan } from '../copy/duplicate-scan';


//===========================
// Types
//===========================

/** What a pull could not fetch, held for the panel's retry button */
export interface PullFailureHeld {
  retryId: string;
  serial: number;
  acctKey: string;
  account: string;
  authuser: string;
  ik: string;
  /** Rows of the preview that are conversations, which the strip counts */
  rowCount: number;
  at: number[];
  from: { kind: 'drag'; rows: MailDropPayload['items'] } | { kind: 'label'; label: string; threads: TreeThread[] };
}

/** What the job driver in mail-drop-controller.ts answers for while it still owns every batch
 * and the copy that runs between them. Read-only questions plus the handful of writes a pull
 * makes into job state -- a stale job let go for a new drag, a job just planned, a batch's own
 * loss, a cancel that reaches a driving job -- each named for the one moment it is called, so a
 * reader here never has to open the driver to know what a call does. */
export interface JobDriverHooks {
  /** Whether the driver is walking a job's own batch right now, refusing a fresh drag */
  isDriving(): boolean;
  /** Whether a job is held at all, driving or waiting between batches */
  isActive(): boolean;
  /** Whether a copy outside a job is running, which also refuses a pull retry */
  copyBusy(): boolean;
  /** Ends whatever job a new drag replaces, telling the panel it was let go */
  endStaleJob(): void;
  /** Holds the job a listing just turned into a plan for, and starts gathering its losses */
  beginJob(job: LabelJob, root: string): void;
  /** Sets the job-wide stop the driver honours before its next batch, when a cancel reaches a
   * job that is driving its own copy */
  cancelIfDriving(): void;
  /** Folds one batch's unfetched conversations into what the walked job has lost so far, when
   * this pull belongs to the job currently being gathered for */
  recordBatchPullLoss(batchThreadIds: string[], threads: TreeThread[]): void;
  /** Forgets a held job offer and the card that announced it */
  clearJobOffer(): void;
  /** Forgets the last copy's own failures, held for its own retry button */
  clearCopyFailures(): void;
  /** What a reopened or driven preview adds about a job: its finished report when one is held,
   * or its running panel and progress line otherwise */
  previewExtra(): { jobEnd: JobEndInfo | null; panel?: JobPanel; job?: MailDropCopyProgress['job'] };
}


//===========================
// Constants
//===========================

// How many dragged conversations are fetched at once. The messages inside each of them are
// fetched alongside each other too, under MESSAGE_FETCH_LIMIT (gmail-api.ts), so one drag has
// up to six times that many requests in flight. What keeps the rate inside Gmail's allowance is
// the budget in quota.ts rather than this number; this one bounds how much of a drag is in
// memory at once.
export const DRAG_THREAD_LIMIT = 6;


//===========================
// Module state
//===========================

/** One pull at a time, and this is what says which one. */
export const dropLock = createDropLock();

/** What the last pull could not fetch, held for the panel's retry button */
export let lastPullFailures: PullFailureHeld | null = null;

let hooks: JobDriverHooks = {
  isDriving: () => false,
  isActive: () => false,
  copyBusy: () => false,
  endStaleJob: () => {},
  beginJob: () => {},
  cancelIfDriving: () => {},
  recordBatchPullLoss: () => {},
  clearJobOffer: () => {},
  clearCopyFailures: () => {},
  previewExtra: () => ({ jobEnd: null }),
};


//===========================
// Exported functions
//===========================

export function setJobDriverHooks(h: JobDriverHooks): void {
  hooks = h;
}

/**
 * Where dragged mail is kept
 *
 * The user's own choice if one was made, Downloads/Gmail-afgeleverd otherwise -- see
 * mail-folder.ts for how that default is picked per platform.
 *
 * @returns the folder, created on first use by whoever writes into it
 */
export function mailDropFolder(): string {
  return (
    prefs?.getAll().mailDrop.folder ||
    defaultMailFolder({
      platform: process.platform,
      env: process.env,
      appData: app.getPath('appData'),
      home: app.getPath('home'),
    })
  );
}

/**
 * The folder, and whether it hands the mail to something other than this machine
 *
 * Answered here rather than in the settings page: what counts as a folder that leaves the PC
 * is knowledge about paths, and the page only draws what it is told.
 *
 * @returns the path and the warning flag
 */
export function mailDropStatus(): MailDropFolderStatus {
  const folder = mailDropFolder();
  return { folder, remote: looksRemoteFolder(folder) };
}

/**
 * Pulls what was dragged into local files, with every Gmail view locked while it runs
 *
 * The lock is the point of this wrapper. One pull is one module-level job -- it empties
 * lastDropSaved and bumps the drag serial before it has written a file -- so a second drop
 * landing mid-pull threw the first drag's results away. Refusing the second drop is what
 * keeps that from happening; the veil over the views is so nobody tries.
 *
 * @param acctKey the view the drag came from
 * @param payload what the page read off the drag
 */
export async function handleMailDrop(acctKey: string, payload: MailDropPayload): Promise<void> {
  const profile = profiles.find((p) => keyOf(p) === acctKey);
  const items = payload?.items ?? [];
  if (items.length === 0 && !payload?.label) return;
  // Both of these come before the lock: a drag that changes nothing must not put a veil over
  // every Gmail view. The label case is the older bug of the two -- it used to bump the serial
  // and the source and then return without opening a preview, which left the previous drag's
  // picker on screen with the previous drag's mailboxes.
  if (payload.label && !profile) return;

  // Before the lock, because the driver does not hold it while it copies -- only while it pulls.
  // A drag landing in that gap used to displace the walking plan: see pullRefusal for why this is
  // refused rather than carried. Answered the same way a drag during another pull is, so the view
  // it came from hears something either way.
  const busy = pullRefusal(hooks.isDriving());
  if (busy) {
    manager?.sendDropResult(acctKey, { ok: false, count: 0, total: 0, error: busy });
    notifyLog('[maildrop] drag refused: a job is already copying mail itself');
    return;
  }

  await withPullLock(acctKey, () => pullMailDrop(acctKey, payload, profile));
}

/**
 * Runs a pull with every Gmail view veiled, and refuses when one is already running
 *
 * @param acctKey the view the strip answers in
 * @param run the pull itself
 * @returns false when the lock was taken
 */
export async function withPullLock(acctKey: string, run: () => Promise<void>): Promise<boolean> {
  const token = dropLock.take(Date.now());
  if (token === null) {
    // The views are locked already; this answers the drag that got in just before the lock
    // reached its page.
    manager?.sendDropResult(acctKey, { ok: false, count: 0, total: 0, error: BUSY_TEXT });
    notifyLog('[maildrop] second drag refused, mail is already being fetched');
    return false;
  }
  manager?.sendDropLock({ locked: true });
  // The gate lives exactly as long as the lock does, which is what makes activePull mean "the
  // pull that is running" everywhere else in this file.
  const pull = createPullControl();
  setActivePull(pull);
  setPullDone(0);
  // The lock lifts itself as well. The pull is the one thing here that waits on Gmail without
  // a timeout of its own, and a request that never answers would otherwise leave every Gmail
  // view under the veil until the app is restarted.
  const lifts = setTimeout(
    () => manager?.sendDropLock({ locked: false, note: SLOW_TEXT }),
    DROP_LOCK_MS,
  );
  try {
    await run();
  } finally {
    clearTimeout(lifts);
    if (activePull === pull) setActivePull(null);
    // Only if this pull still holds it: one that answers after its hold went stale must not
    // unlock the pull that replaced it. A cancelled pull rides the same note the self-lifting
    // lock uses, so the strip says how far it got without a second channel for it.
    if (dropLock.release(token)) {
      manager?.sendDropLock(
        pull.stopped() ? { locked: false, note: cancelledText(pullDone) } : { locked: false },
      );
    }
  }
  return true;
}

/**
 * Stops the pull that is running, if there is one
 *
 * Asked for by the strip's Annuleren button and by Escape, over IPC. What has already been
 * fetched stays on disk untouched: the drop folder's own three-day sweep takes it, which is why
 * nothing is deleted here. The picker is not opened for a cancelled pull either -- half a label
 * is not a set anybody asked to copy.
 *
 * A cancel inside a job's batch also ends the job, keeping every batch that was already copied:
 * the driver is told through cancelIfDriving, which sets the same stop the stop dialog sets
 * between two batches and honours it before it starts the batch it just pulled.
 */
export function cancelMailDropPull(): void {
  if (!activePull || activePull.stopped()) return;
  activePull.stop();
  notifyLog(`[maildrop] fetch cancelled after ${pullDone} conversation(s)`);
  hooks.cancelIfDriving();
}

/**
 * Shows the picker on a set of saved mail
 *
 * @param items what the pull saved, as the strip and the list draw it
 * @param driven true when a job's driver is showing a batch it is about to copy itself. The
 *   picker reads this and updates its list without returning to its picking phase: a driven
 *   batch must be visible without being offered, since offering it is what landed 717 mails
 *   twice on 2026-08-26.
 * @param drivenInfo the job panel and progress line to show alongside a driven batch, supplied
 *   by the driver itself -- it has both already, mid-walk, and is the one place this answers
 *   for a job no ordinary drag has
 */
export function openDropPreview(
  items: MailDropPreviewItem[],
  driven = false,
  drivenInfo?: { panel?: JobPanel; job?: MailDropCopyProgress['job'] },
): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  // The three the page cannot ask for itself, the same way delegated-picker.ts completes its own
  // payload: the panel draws its text from the first two, and its own window knows nothing of the
  // theme the sidebar page applies to itself.
  const forThePage = {
    locale: currentLocale(),
    reneMode: prefs?.getAll().reneMode === true,
    dark: currentlyDark(),
  };
  if (driven) {
    // Sent, never opened. open() re-attaches the view on top of everything attached since, so a
    // batch finishing threw the panel back in front of whatever the user was doing -- three times
    // over in a four-batch job. One job is one panel: it updates where it stands, and a panel the
    // user closed stays closed.
    setLastDropPreview(items);
    dropOverlay?.send(IPC.MAIL_DROP_PREVIEW, {
      items,
      tree: lastDropTree,
      driven: true,
      panel: drivenInfo?.panel,
      job: drivenInfo?.job,
      ...forThePage,
    });
    return;
  }
  const overlay = dropPanel(mainWindow);
  setLastDropPreview(items);
  overlay.open({ items, tree: lastDropTree, driven, pullRetryId: lastPullFailures?.retryId, ...forThePage });
}

/** What the preview window should draw. It asks once it is listening rather than being
 * pushed to, because the overlay loads after the drop that filled this.
 *
 * The job carried alongside it is what a window reopened halfway through a walk needs: without it
 * that window would come back in its picking phase and offer Kopieer for mail the driver already
 * has in flight. */
export function dropPreviewItems(): MailDropPreview {
  // A held job offer is what the panel lands on, with no list it could offer Kopieer for
  const extra = hooks.previewExtra();
  if (extra.jobEnd) return jobReportPayload(extra.jobEnd);
  return {
    items: lastDropPreview,
    tree: lastDropTree,
    pullRetryId: lastPullFailures?.retryId,
    locale: currentLocale(),
    reneMode: prefs?.getAll().reneMode === true,
    dark: currentlyDark(),
    ...(extra.panel && extra.job ? { panel: extra.panel, job: extra.job } : {}),
  };
}

export function closeDropPreview(): void {
  dropOverlay?.close();
}

/**
 * Opens the panel on a finished job's report, or only the window when no offer is held
 */
export function showJobReport(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  bringToFront(mainWindow);
  const extra = hooks.previewExtra();
  if (!extra.jobEnd) return;
  dropPanel(mainWindow).open(jobReportPayload(extra.jobEnd));
}

/**
 * The progress callback every pull path hands down, which also remembers how far it got
 *
 * @returns the callback saveOneThread/saveLabel/fetchThreadSlice report their running count
 *   through
 */
export function pullReporter(): SaveProgress {
  // The gate of the pull this reporter belongs to, taken now rather than read per call: both
  // callers set activePull before they ask for one, and a report arriving late must answer for
  // its own pull and not for whichever one is running by then.
  const mine = activePull;
  return (done, total) => {
    setPullDone(done);
    // Kept counting, but no longer shown. The requests already on the wire go on landing for as
    // long as they take -- mapLimit only refuses to claim the next item, and nothing severs a
    // fetch in flight -- and every one of them used to push the strip's count one higher after
    // Annuleren was pressed. A line that goes on climbing is exactly what a swallowed click looks
    // like, which is why the button was pressed again. The count itself is still kept, because
    // the line the lock closes with reports how far the pull actually got.
    if (mine?.stopped()) return;
    manager?.sendDropProgress({ done, total });
  };
}

/**
 * Holds the failed rows of a pull for a retry, and adds them to what a walked job lost
 *
 * @param items the preview rows
 * @param ctx everything a second fetch of those rows needs
 * @param batchThreadIds a job batch's whole slice, whose earlier attempts' losses this pull replaces
 * @returns the id the panel is given, or undefined when nothing failed
 */
export function rememberPullFailures(
  items: MailDropPreviewItem[],
  ctx: Omit<PullFailureHeld, 'retryId' | 'serial' | 'at' | 'from'> & {
    from: (at: number[]) => PullFailureHeld['from'];
  },
  batchThreadIds?: string[],
): string | undefined {
  const at = failedRowIndexes(items);
  setBatchPullFailedThreads(at.map((i) => items[i].threadId));
  if (batchThreadIds && hooks.isActive()) {
    const lost = at.length > 0 ? ctx.from(at) : null;
    const threads = lost?.kind === 'label' ? lost.threads.filter((t): t is TreeThread => t !== undefined) : [];
    hooks.recordBatchPullLoss(batchThreadIds, threads);
  }
  if (at.length === 0 || hooks.isActive()) {
    lastPullFailures = null;
    return undefined;
  }
  const { from, ...rest } = ctx;
  lastPullFailures = { ...rest, retryId: randomUUID(), serial: dropSerial, at, from: from(at) };
  return lastPullFailures.retryId;
}


//===========================
// Helper functions
//===========================

/**
 * Returns the mail-drop panel, creating it the first time
 *
 * @param win the main window the panel sits in
 * @returns the panel, registered as the app's drop overlay
 */
function dropPanel(win: NonNullable<typeof mainWindow>): OverlayView {
  const overlay =
    dropOverlay ??
    new OverlayView(
      win,
      SIDEBAR_PRELOAD_PATH,
      DEV_URL ? `${DEV_URL}/maildrop` : 'app://bundle/maildrop.html',
      IPC.MAIL_DROP_PREVIEW,
      undefined,
      // Takes the keyboard: the panel opens on a search box, and without this the caret sits
      // in a view that receives nothing while what you type goes to the Gmail view behind it.
      true,
    );
  setDropOverlay(overlay);
  return overlay;
}

/**
 * Builds the panel payload for a finished job's report, never driven and with nothing to pick
 *
 * @param jobEnd the job end the panel was sent
 * @returns the payload for the preview channel and for dropPreviewItems
 */
function jobReportPayload(jobEnd: JobEndInfo): MailDropPreview {
  return {
    items: [],
    tree: null,
    jobEnd,
    locale: currentLocale(),
    reneMode: prefs?.getAll().reneMode === true,
    dark: currentlyDark(),
  };
}

/**
 * Decides whether this label needs a plan, and writes one if it does
 *
 * @param root the drop folder
 * @param account
 * @param label
 * @param listed what listLabelTree answered, or null when it could not list at all
 * @returns the slice to pull now -- batch zero for a job, or null for a label that fits, which
 *   is what makes saveLabel list and fetch everything the way it always has
 */
async function planJob(
  root: string,
  account: string,
  label: string,
  listed: LabelTreeListing | null,
): Promise<TreeThread[] | null> {
  // A new drag replaces whatever job was held here, and the driver only holds the drop lock
  // while it pulls -- so this can land while a batch of the previous job is copying. Letting the
  // driver end it properly rather than clearing it outright is what keeps that walk from being
  // left with nothing to report and the panel behind a phase it could not leave. Its copy is not
  // touched: activeRun answers for that, and what has landed stays landed.
  hooks.endStaleJob();
  if (!listed || !needsJob(listed.threads, JOB_BATCH_THREADS)) return null;

  const batches = chunk(listed.threads, JOB_BATCH_THREADS);
  const jobId = randomUUID();
  const header = {
    jobId,
    startedAt: Date.now(),
    account,
    label,
    members: listed.members,
    batchSize: JOB_BATCH_THREADS,
    total: listed.threads.length,
  };
  // Written before a single mail is fetched: the plan is what a crash halfway through the first
  // batch is resumed from, and a plan written afterwards would not exist yet at the one moment
  // it is needed.
  try {
    startLabelJob(root, header, batches);
  } catch (e) {
    // A plan that cannot be written is not a reason to refuse the drag -- it is a reason to make
    // it an ordinary one. The label is then capped at a batch, and the truncation is reported
    // the way every other cap already is.
    notifyLog(`[maildrop] could not write the plan for "${label}": ${(e as Error).message}`);
    return batches[0];
  }
  // Read back rather than assembled in memory, so what the driver walks is what is on disk. A
  // read that fails right after a successful write is not a state to invent a job for -- fall
  // back to the same ordinary drag a failed write gets, since a job whose plan cannot be read
  // cannot be advanced or resumed either.
  const planned = readLabelJob(root, jobId);
  if (!planned) {
    notifyLog(`[maildrop] plan for "${label}" could not be read back; treated as an ordinary drag`);
    return batches[0];
  }
  hooks.beginJob(planned, root);
  notifyLog(
    `[maildrop] label "${label}": ${listed.threads.length} conversations, ${batches.length} batches of ${JOB_BATCH_THREADS}`,
  );
  return batches[0];
}

/**
 * Saves the dragged mail and opens the picker on what it saved
 *
 * @param acctKey the view the drag came from
 * @param payload
 * @param profile the account behind that view
 */
async function pullMailDrop(
  acctKey: string,
  payload: MailDropPayload,
  profile: Profile | undefined,
): Promise<void> {
  const ts = new Date().toISOString();
  const account = profile?.email ?? '';
  const root = mailDropFolder();
  const items = payload.items ?? [];
  // Counted in conversations, and sent to every Gmail view: they are all locked by this pull,
  // so they all say how far it has got.
  const report = pullReporter();
  setLastDropSaved([]);
  lastPullFailures = null;
  hooks.clearCopyFailures();
  hooks.clearJobOffer();
  bumpDropSerial();
  setLastDropSource(account);
  setLastDropTree(null);
  if (!payload.ik) {
    const error = 'Kon Gmail-token niet lezen';
    const logError = attemptWrite(() =>
      appendLog(root, items.map(({ threadId }) => ({ ts, account, threadId, error }))),
    );
    if (logError) notifyLog(`[maildrop] archive log not appended: ${logError}`);
    const shown = withLogTrouble(error, logError);
    manager?.sendDropResult(acctKey, { ok: false, count: 0, total: 0, error: shown });
    openDropPreview(
      items.length > 0
        ? items.map((i) => ({ ...i, saved: 0, error: shown }))
        : [{ threadId: '', subject: payload.label ?? '', saved: 0, error: shown }],
    );
    return;
  }

  if (payload.label) {
    report(0, 0);
    // Listed before anything is fetched, so the size is known while it is still cheap to know:
    // a tree of ten thousand costs two hundred units to list and minutes to pull. A listing that
    // fails answers null and the scrape inside saveLabel carries the drag, as it always has --
    // which also means no job, since nothing scraped can exceed one batch.
    const listed = await listLabelTree(account, payload.label, listReporter());
    // The walk itself now leaves off between two pages when the gate closes, so this is what a
    // cancel during the listing arrives at, rather than the place it was first noticed. Nothing
    // has been fetched at this point, so nothing is thrown away, and no plan is written for a
    // pull nobody wants any more.
    if (activePull?.stopped()) {
      setLastDropSaved([]);
      notifyLog('[maildrop] fetch cancelled while the label was being listed');
      return;
    }
    const slice = await planJob(root, account, payload.label, listed);
    const { items: done, saved: refs, rows, threads } = await saveLabel(
      ts,
      account,
      root,
      payload.label,
      payload.authuser,
      payload.ik,
      report,
      listed,
      slice,
    );
    // Nothing is offered for copying out of a cancelled pull: half a label is not a set anybody
    // asked to copy, and what was fetched stays on disk for the three-day sweep to take. The
    // strip's line comes off the lock's note where the lock is released.
    if (activePull?.stopped()) {
      setLastDropSaved([]);
      return;
    }
    setLastDropSaved(refs);
    rememberPullFailures(done, {
      acctKey,
      account,
      authuser: payload.authuser,
      ik: payload.ik,
      rowCount: rows.length,
      from: (at) => ({ kind: 'label', label: payload.label!, threads: at.map((i) => threads[i]) }),
    }, slice?.map((t) => t.threadId));
    // rows rather than the display items: those carry the truncation notice too, which is
    // not a conversation that failed to save.
    manager?.sendDropResult(acctKey, dropOutcome(rows, done.find((i) => i.error)?.error));
    openDropPreview(done);
    startExistingScan();
    return;
  }

  // Side by side rather than one after the other: ten dragged mails were ten conversations
  // waiting on each other, which is minutes on a normal mailbox. mapLimit answers in the
  // order the rows were dragged, so the preview strip, the numbering and log.jsonl read the
  // same as when this was a loop.
  // One cache for this drag: rows of the same conversation share the fetch and the parse.
  const cache: ThreadReadCache = new Map();
  let pulled = 0;
  report(0, items.length);
  const results = await mapLimit(
    items,
    DRAG_THREAD_LIMIT,
    async (item) => {
      const one = await saveOneThread(
        ts,
        account,
        root,
        item.threadId,
        payload.authuser,
        payload.ik,
        item.message ?? null,
        item.messageUnknown ?? false,
        cache,
      );
      // After the row is saved rather than as it starts, and counted here rather than off the
      // results array: they come back in drag order but they do not finish in it.
      pulled += 1;
      report(pulled, items.length);
      return one;
    },
    activePull?.wait,
  );

  if (activePull?.stopped()) {
    setLastDropSaved([]);
    return;
  }

  const done: MailDropPreviewItem[] = [];
  const saved: number[] = [];
  let lastError: string | undefined;
  for (const [i, item] of items.entries()) {
    // A row a stop kept from starting leaves mapLimit's slot untouched. Reached only by a cancel
    // that lands between the loop ending and the check above it, and read as a row that saved
    // nothing rather than crashed on.
    const r = results[i] ?? { count: 0, saved: [] as SavedRef[], error: undefined };
    saved.push(r.count);
    if (r.error) lastError = r.error;
    lastDropSaved.push(...r.saved);
    done.push({ ...item, saved: r.count, error: r.error });
  }
  rememberPullFailures(done, {
    acctKey,
    account,
    authuser: payload.authuser,
    ik: payload.ik,
    rowCount: items.length,
    from: (at) => ({ kind: 'drag', rows: at.map((i) => items[i]) }),
  });
  manager?.sendDropResult(acctKey, dropOutcome(saved, lastError));
  openDropPreview(done);
  startExistingScan();
}

/**
 * The listing's own reporter, which moves the strip while a label is being paged
 *
 * Apart from pullReporter and deliberately so: that one keeps pullDone, which counts
 * conversations fetched and is the number the cancel line reports. A listing that fed it would
 * have the strip claim thousands of conversations were pulled when not one had been.
 *
 * @returns the callback listLabelTree reports its running count through
 */
function listReporter(): (found: number) => void {
  const mine = activePull;
  return (found) => {
    if (mine?.stopped()) return;
    // Total zero for as long as the walk runs: it is not known until its last page, and the
    // strip draws the count as found rather than as fetched on exactly that signal.
    manager?.sendDropProgress({ done: found, total: 0 });
  };
}
