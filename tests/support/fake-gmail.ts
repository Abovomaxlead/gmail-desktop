// An in-memory Gmail for the mail-drop controller: one store per mailbox, keyed by the access
// token the harness hands out, answering the gmail-api.ts calls the controller makes.
//
// The answers go through the real module's own parsers wherever one exists (parseLabels,
// userLabelMap, parseMessageListPage, walkThreadPages), so a shape the controller reads is the
// shape Gmail's JSON really turns into. The error classes are the real ones too, bound per
// test with bind(): after vi.resetModules every import of gmail-api is a new module, and a
// GmailHttpError from the wrong copy would fail every instanceof the controller makes.

import type * as GmailApi from '../../electron/gmail/gmail-api';


//===========================
// Types
//===========================

type Real = typeof GmailApi;

/** How one insert fails: 'quota' and 'timeout' and 'net' store nothing, 'timeout-landed' stores
 * the mail and then reports a timeout, which is the ambiguous case a retry must not repeat */
export type InsertFailure = 'quota' | 'timeout-landed' | 'timeout' | 'net';

export interface FakeMessage {
  id: string;
  threadId: string;
  raw: Buffer;
  /** The Message-ID header as it was written, brackets included */
  messageId: string;
  labelIds: string[];
  /** The clock reading when it was stored, which the duplicate lookup's lag is measured from */
  insertedAt: number;
  /** True for mail the scenario put there, false for mail the controller inserted */
  seeded: boolean;
}

export interface FakeLabel {
  id: string;
  name: string;
  type: 'user' | 'system';
  labelListVisibility: string;
}

export interface FakeMailbox {
  messages: FakeMessage[];
  labels: FakeLabel[];
}

export interface MailSpec {
  messageId: string;
  subject: string;
  from?: string;
  to?: string;
  date?: string;
  body?: string;
}

/** The Gmail calls the controller and its sweep reach, with the real signatures */
export type FakeApi = Pick<
  Real,
  | 'fetchLabels'
  | 'fetchUserLabelMap'
  | 'createHiddenLabel'
  | 'createVisibleLabel'
  | 'deleteLabel'
  | 'fetchMessageListPage'
  | 'batchModifyMessages'
  | 'fetchThreadMessages'
  | 'fetchThreadRaw'
  | 'listLabelThreadIds'
  | 'insertMessage'
  | 'mailboxCanary'
  | 'labelsHoldingMany'
>;


//===========================
// Constants
//===========================

const SYSTEM_LABELS = ['INBOX', 'STARRED', 'IMPORTANT', 'UNREAD', 'SENT', 'DRAFT', 'TRASH', 'SPAM'];

// Gmail's default search and listings leave these out unless asked for by name
const HIDDEN_FROM_SEARCH = ['TRASH', 'SPAM'];

const MESSAGE_PAGE_SIZE = 500;


//===========================
// Exported functions
//===========================

/**
 * Builds a small valid RFC 822 message
 *
 * @param spec
 * @returns the raw source with CRLF line endings
 */
export function rawMail(spec: MailSpec): Buffer {
  const lines = [
    `Message-ID: ${spec.messageId}`,
    `From: ${spec.from ?? 'Klant <klant@elders.nl>'}`,
    `To: ${spec.to ?? 'bron@abovomaxlead.nl'}`,
    `Subject: ${spec.subject}`,
    `Date: ${spec.date ?? 'Thu, 01 Oct 2026 09:00:00 +0200'}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    '',
    spec.body ?? `Body of ${spec.subject}`,
    '',
  ];
  return Buffer.from(lines.join('\r\n'), 'utf8');
}

/**
 * Strips the angle brackets off a Message-ID, the form Gmail's search matches on
 *
 * @param messageId
 * @returns the bare id
 */
export function bare(messageId: string): string {
  return messageId.trim().replace(/^<+|>+$/g, '');
}

export class FakeGmail {
  readonly mailboxes = new Map<string, FakeMailbox>();
  /** How many clock ticks an insert stays invisible to labelsHoldingMany. Every fake call is a tick */
  lag = 0;
  /** Threads per page of listLabelThreadIds, small in a scenario that wants to see paging */
  threadPageSize = 500;
  clock = 0;
  /** Every call made, by name, in order */
  readonly calls: Array<{ name: keyof FakeApi; email: string; args: unknown[] }> = [];

  private real: Real | null = null;
  private nextId = 1;
  private readonly insertFailures = new Map<string, InsertFailure[]>();
  private readonly fetchFailures = new Map<string, number>();
  private readonly insertAttempts = new Map<string, number>();
  private readonly fetchCounts = new Map<string, number>();

  constructor(emails: string[]) {
    for (const email of emails) this.addMailbox(email);
  }

  /**
   * Binds the real gmail-api module this test's controller imports, for its errors and parsers
   *
   * @param real
   */
  bind(real: Real): void {
    this.real = real;
  }

  tokenFor(email: string): string {
    return `token:${email}`;
  }

  addMailbox(email: string): FakeMailbox {
    const known = this.mailboxes.get(email);
    if (known) return known;
    const box: FakeMailbox = {
      messages: [],
      labels: SYSTEM_LABELS.map((id) => ({ id, name: id, type: 'system', labelListVisibility: 'labelShow' })),
    };
    this.mailboxes.set(email, box);
    return box;
  }

  /**
   * Adds a user label to a mailbox
   *
   * @param email
   * @param name
   * @returns the label's id
   */
  addLabel(email: string, name: string): string {
    return this.makeLabel(this.box(email), name, 'labelShow').id;
  }

  labelId(email: string, name: string): string | undefined {
    return this.box(email).labels.find((l) => l.name === name)?.id;
  }

  /**
   * Puts a conversation in a mailbox as if it had always been there
   *
   * @param email
   * @param threadId
   * @param mails oldest first
   * @param labelIds the labels every message of it carries
   * @returns the Message-IDs, in the same order
   */
  seedThread(email: string, threadId: string, mails: MailSpec[], labelIds: string[] = ['INBOX']): string[] {
    const box = this.box(email);
    for (const spec of mails) {
      box.messages.push({
        id: `seed-${this.nextId++}`,
        threadId,
        raw: rawMail(spec),
        messageId: spec.messageId,
        labelIds: [...labelIds],
        insertedAt: -Infinity,
        seeded: true,
      });
    }
    return mails.map((m) => m.messageId);
  }

  /**
   * Makes the next inserts of one mail into one mailbox fail
   *
   * @param email
   * @param messageId
   * @param kind
   * @param times how many attempts in a row fail this way
   */
  failInsert(email: string, messageId: string, kind: InsertFailure, times = 1): void {
    const key = this.key(email, messageId);
    const queue = this.insertFailures.get(key) ?? [];
    for (let i = 0; i < times; i++) queue.push(kind);
    this.insertFailures.set(key, queue);
  }

  /**
   * Makes the next fetches of a conversation fail, in whichever mailbox it is asked for
   *
   * @param threadId
   * @param times
   */
  failFetch(threadId: string, times = 1): void {
    this.fetchFailures.set(threadId, (this.fetchFailures.get(threadId) ?? 0) + times);
  }

  /** Copies of this mail the controller landed in this mailbox, a timed-out one that stored included */
  inserts(email: string, messageId: string): number {
    return this.stored(email, messageId).length;
  }

  /** Every insert call for this mail into this mailbox, failed ones included */
  attempts(email: string, messageId: string): number {
    return this.insertAttempts.get(this.key(email, messageId)) ?? 0;
  }

  /** How often a conversation's messages were asked for, failed attempts included */
  fetches(threadId: string): number {
    return this.fetchCounts.get(threadId) ?? 0;
  }

  /** The copies of this mail the controller inserted, never the seeded ones */
  stored(email: string, messageId: string): FakeMessage[] {
    const wanted = bare(messageId);
    return this.box(email).messages.filter((m) => !m.seeded && bare(m.messageId) === wanted);
  }

  /** The names of a message's labels, a missing label kept as its id */
  labelNames(email: string, message: FakeMessage): string[] {
    const box = this.box(email);
    return message.labelIds.map((id) => box.labels.find((l) => l.id === id)?.name ?? id);
  }

  /** Every Message-ID any mailbox holds or was asked to take */
  knownMessageIds(): string[] {
    const ids = new Set<string>();
    for (const box of this.mailboxes.values()) for (const m of box.messages) ids.add(bare(m.messageId));
    for (const key of this.insertAttempts.keys()) ids.add(key.slice(key.indexOf('|') + 1));
    return [...ids];
  }

  /**
   * The functions gmail-api.ts's mock exports in place of the real ones
   *
   * @returns {FakeApi}
   */
  api(): FakeApi {
    return {
      fetchLabels: async (token) => {
        const box = this.enter('fetchLabels', token, []);
        return this.gmail().parseLabels({ labels: box.labels });
      },
      fetchUserLabelMap: async (token) => {
        const box = this.enter('fetchUserLabelMap', token, []);
        const real = this.gmail();
        return real.userLabelMap(real.parseAllLabels({ labels: box.labels }));
      },
      createHiddenLabel: async (token, name) => {
        const box = this.enter('createHiddenLabel', token, [name]);
        const label = this.makeLabel(box, name, 'labelHide');
        return { id: label.id, name: label.name };
      },
      createVisibleLabel: async (token, name) => {
        const box = this.enter('createVisibleLabel', token, [name]);
        const label = this.makeLabel(box, name, 'labelShow');
        return { id: label.id, name: label.name };
      },
      deleteLabel: async (token, labelId) => {
        const box = this.enter('deleteLabel', token, [labelId]);
        // A label already gone answers 404, which the real deleteLabel treats as success
        box.labels = box.labels.filter((l) => l.id !== labelId || l.type === 'system');
        for (const m of box.messages) m.labelIds = m.labelIds.filter((id) => id !== labelId);
      },
      fetchMessageListPage: async (token, labelId, pageToken) => {
        const box = this.enter('fetchMessageListPage', token, [labelId, pageToken]);
        const ids = box.messages
          .filter((m) => m.labelIds.includes(labelId) && !this.hidden(m, labelId))
          .map((m) => m.id);
        const from = pageToken ? Number(pageToken) : 0;
        const page = ids.slice(from, from + MESSAGE_PAGE_SIZE);
        const next = from + MESSAGE_PAGE_SIZE < ids.length ? String(from + MESSAGE_PAGE_SIZE) : undefined;
        return this.gmail().parseMessageListPage({
          messages: page.map((id) => ({ id })),
          ...(next ? { nextPageToken: next } : {}),
        });
      },
      batchModifyMessages: async (token, ids, action) => {
        const box = this.enter('batchModifyMessages', token, [ids, action]);
        const real = this.gmail();
        if (ids.length > real.BATCH_MODIFY_LIMIT) {
          throw new real.GmailHttpError('Too many ids', 400, null, 'invalidArgument');
        }
        for (const m of box.messages) {
          if (!ids.includes(m.id)) continue;
          const removed = m.labelIds.filter((id) => !(action.removeLabelIds ?? []).includes(id));
          m.labelIds = [...new Set([...removed, ...(action.addLabelIds ?? [])])];
        }
      },
      fetchThreadMessages: async (token, threadId) => this.threadMessages(token, threadId, 'fetchThreadMessages'),
      fetchThreadRaw: async (token, threadId) => {
        const messages = await this.threadMessages(token, threadId, 'fetchThreadRaw');
        return messages.flatMap((m) => (m.raw ? [{ raw: m.raw, unread: m.unread }] : []));
      },
      listLabelThreadIds: async (token, labelId, max, onPage) => {
        const box = this.enter('listLabelThreadIds', token, [labelId, max]);
        const threadIds: string[] = [];
        // Newest first, the order threads.list answers in
        for (const m of [...box.messages].reverse()) {
          if (m.labelIds.includes(labelId) && !this.hidden(m, labelId) && !threadIds.includes(m.threadId)) {
            threadIds.push(m.threadId);
          }
        }
        const size = this.threadPageSize;
        return await this.gmail().walkThreadPages(
          max,
          async (pageToken) => {
            const from = pageToken ? Number(pageToken) : 0;
            const next = from + size < threadIds.length ? String(from + size) : undefined;
            return { threadIds: threadIds.slice(from, from + size), ...(next ? { nextPageToken: next } : {}) };
          },
          onPage,
        );
      },
      insertMessage: async (token, raw, labelIds, threadId, signal) => {
        const box = this.enter('insertMessage', token, [labelIds, threadId]);
        const real = this.gmail();
        const email = this.emailOf(token);
        const messageId = headerOf(raw, 'message-id');
        const key = this.key(email, messageId);
        this.insertAttempts.set(key, (this.insertAttempts.get(key) ?? 0) + 1);
        if (signal?.aborted) throw new real.GmailCancelledError('Upload afgebroken', false);
        for (const id of labelIds) {
          if (!box.labels.some((l) => l.id === id)) {
            throw new real.GmailHttpError(`Invalid label: ${id}`, 400, null, 'invalidArgument');
          }
        }
        const failure = this.insertFailures.get(key)?.shift();
        if (failure === 'quota') {
          throw new real.GmailHttpError('Quota exceeded for quota metric', 429, null, 'rateLimitExceeded');
        }
        if (failure === 'timeout') throw new real.GmailTimeoutError('Gmail gaf geen antwoord');
        if (failure === 'net') throw new Error('net::ERR_CONNECTION_RESET');
        const landedIn = threadId && box.messages.some((m) => m.threadId === threadId) ? threadId : `thread-${this.nextId++}`;
        const stored: FakeMessage = {
          id: `msg-${this.nextId++}`,
          threadId: landedIn,
          raw,
          messageId,
          labelIds: [...new Set(labelIds)],
          insertedAt: this.clock,
          seeded: false,
        };
        box.messages.push(stored);
        if (failure === 'timeout-landed') throw new real.GmailTimeoutError('Gmail gaf geen antwoord');
        return { id: stored.id, threadId: stored.threadId };
      },
      mailboxCanary: async (token) => {
        const box = this.enter('mailboxCanary', token, []);
        const inbox = box.messages.filter((m) => m.labelIds.includes('INBOX') && this.visible(m));
        return inbox[inbox.length - 1]?.messageId ?? '';
      },
      labelsHoldingMany: async (token, messageIds) => {
        const box = this.enter('labelsHoldingMany', token, [messageIds]);
        return messageIds.map((messageId) => {
          const wanted = bare(messageId);
          const labelIds: string[] = [];
          for (const m of box.messages) {
            if (bare(m.messageId) !== wanted || !this.visible(m) || this.hidden(m)) continue;
            for (const id of m.labelIds) if (!labelIds.includes(id)) labelIds.push(id);
          }
          return { messageId, labelIds };
        });
      },
    };
  }

  /**
   * Records a call, moves the clock on and finds the token's mailbox
   *
   * @param name
   * @param token
   * @param args
   * @returns the mailbox
   * @private
   */
  private enter(name: keyof FakeApi, token: string, args: unknown[]): FakeMailbox {
    this.clock += 1;
    const email = this.emailOf(token);
    this.calls.push({ name, email, args });
    return this.box(email);
  }

  /**
   * Answers a thread's messages the way fetchThreadMessages does
   *
   * @param token
   * @param threadId
   * @param name the call to record it as
   * @returns one entry per message, oldest first
   * @private
   */
  private async threadMessages(
    token: string,
    threadId: string,
    name: 'fetchThreadMessages' | 'fetchThreadRaw',
  ): Promise<GmailApi.ThreadMessage[]> {
    const box = this.enter(name, token, [threadId]);
    const real = this.gmail();
    this.fetchCounts.set(threadId, (this.fetchCounts.get(threadId) ?? 0) + 1);
    const failing = this.fetchFailures.get(threadId) ?? 0;
    if (failing > 0) {
      this.fetchFailures.set(threadId, failing - 1);
      throw new real.GmailHttpError('Backend Error', 503, null, 'backendError');
    }
    const messages = box.messages.filter((m) => m.threadId === threadId);
    if (messages.length === 0) throw new real.GmailHttpError('Requested entity was not found.', 404, null, 'notFound');
    return messages.map((m) => ({ id: m.id, unread: m.labelIds.includes('UNREAD'), raw: m.raw }));
  }

  /**
   * Creates a user label, or answers the one that already carries the name
   *
   * @param box
   * @param name
   * @param visibility
   * @returns the label
   * @private
   */
  private makeLabel(box: FakeMailbox, name: string, visibility: string): FakeLabel {
    const known = box.labels.find((l) => l.name === name);
    if (known) return known;
    const label: FakeLabel = { id: `Label_${this.nextId++}`, name, type: 'user', labelListVisibility: visibility };
    box.labels.push(label);
    return label;
  }

  /** Whether the duplicate lookup can see this message yet, given the index lag */
  private visible(m: FakeMessage): boolean {
    return this.clock - m.insertedAt > this.lag;
  }

  /** Whether a default listing leaves this message out, unless it lists that very label */
  private hidden(m: FakeMessage, listing?: string): boolean {
    return HIDDEN_FROM_SEARCH.some((id) => id !== listing && m.labelIds.includes(id));
  }

  private emailOf(token: string): string {
    if (!token.startsWith('token:')) throw new Error(`fake Gmail: not a token it handed out (${token})`);
    return token.slice('token:'.length);
  }

  private box(email: string): FakeMailbox {
    const box = this.mailboxes.get(email);
    if (!box) throw new Error(`fake Gmail: no mailbox ${email}`);
    return box;
  }

  private key(email: string, messageId: string): string {
    return `${email}|${bare(messageId)}`;
  }

  private gmail(): Real {
    if (!this.real) throw new Error('fake Gmail: bind() the real gmail-api module first');
    return this.real;
  }
}


//===========================
// Helper functions
//===========================

/**
 * Reads one header straight off a raw message
 *
 * @param raw
 * @param name lower case
 * @returns the value, empty when absent
 * @private
 */
function headerOf(raw: Buffer, name: string): string {
  const head = raw.toString('utf8').split(/\r?\n\r?\n/)[0];
  for (const line of head.split(/\r?\n/)) {
    const at = line.indexOf(':');
    if (at > 0 && line.slice(0, at).trim().toLowerCase() === name) return line.slice(at + 1).trim();
  }
  return '';
}
