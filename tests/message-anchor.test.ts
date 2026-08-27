// A notification is about one mail; a conversation holds several. Clicking the card opened
// the conversation and let Gmail pick which message to unfold, and Gmail picked an older
// one — the id a thread is opened by belongs to its first message, and Gmail's own rule
// prefers the oldest unread reply. This is the script that ends the guessing.
//
// The script is run here rather than matched as text: it is executed inside Google's page,
// so what matters is what it does to a DOM, not what it reads like. The shapes it is run
// against are the ones Gmail's own stylesheet describes — a 34-40px folded header, a body
// under .a3s, and the bundle in the middle of a long thread whose messages are all
// display:none until its row is opened.

import { describe, expect, it } from 'vitest';
import {
  ANCHOR_INTERVAL_MS,
  ANCHOR_TRIES,
  anchorMessage,
  isLegacyMessageId,
  messageAnchorScript,
  parseAnchorProbe,
} from '../electron/gmail/message-anchor';


//===========================
// The page
//===========================

class FakeEl {
  clicks = 0;
  scrolls = 0;
  parentElement: FakeEl | null = null;
  constructor(
    readonly attrs: Record<string, string | undefined>,
    public offsetHeight: number,
    private body: { offsetParent: unknown; offsetHeight: number } | null = null,
    children: FakeEl[] = [],
  ) {
    for (const c of children) c.parentElement = this;
  }
  getAttribute(name: string): string | null {
    return this.attrs[name] ?? null;
  }
  querySelector(sel: string): unknown {
    return sel === '.a3s, .ii' ? this.body : null;
  }
  click(): void {
    this.clicks++;
  }
  scrollIntoView(): void {
    this.scrolls++;
  }
}

const shownBody = { offsetParent: {}, offsetHeight: 300 };

/** A message of an open conversation: the block Gmail hangs the id on. */
function block(id: string, opts: { height?: number; open?: boolean } = {}): FakeEl {
  return new FakeEl(
    { 'data-legacy-message-id': id },
    opts.height ?? (opts.open ? 520 : 40),
    opts.open ? shownBody : null,
  );
}

/** The attachment chip Gmail draws in an inbox row, naming the mail it belongs to. It
 * carries the same id as the message and is not the message. */
function chipInRow(id: string): FakeEl {
  const chip = block(id, { height: 24 });
  const row = new FakeEl({ role: 'row' }, 56, null, [chip]);
  void row;
  return chip;
}

/** The bundle Gmail folds the middle of a long conversation into: every message inside it
 * is display:none, so it measures nothing, and only the bundle's own row can be clicked. */
function bundled(id: string, rowHeight = 40): { message: FakeEl; row: FakeEl } {
  const message = block(id, { height: 0 });
  const row = new FakeEl({}, rowHeight, null, [message]);
  return { message, row };
}

function doc(...els: FakeEl[]) {
  return {
    querySelectorAll(sel: string): FakeEl[] {
      const m = /^\[data-legacy-message-id="([^"]+)"\]$/.exec(sel);
      if (!m) return [];
      return els.filter((el) => el.getAttribute('data-legacy-message-id') === m[1]);
    },
  };
}

function run(script: string, document: unknown): unknown {
  return new Function('document', `return ${script}`)(document);
}

const REPLY = '1a01f14e87dea294';
const FIRST = '1a01f12d2ec28372';
const look = (id: string, may = {}) => messageAnchorScript(id, may)!;


//===========================
// Tests
//===========================

describe('messageAnchorScript finds the message', () => {
  it('unfolds the one the notification was about', () => {
    const older = block(FIRST, { open: true });
    const target = block(REPLY);

    expect(run(look(REPLY), doc(older, target))).toBe('clicked');
    expect(target.clicks).toBe(1);
    expect(target.scrolls).toBe(1);
    // The mail on screen is not touched, and above all not folded shut.
    expect(older.clicks).toBe(0);
  });

  it('scrolls to a message that is already open, and leaves it open', () => {
    const target = block(REPLY, { open: true });

    expect(run(look(REPLY), doc(target))).toBe('shown');
    expect(target.clicks).toBe(0);
    expect(target.scrolls).toBe(1);
  });

  it('says missing while the conversation is not on screen yet', () => {
    expect(run(look(REPLY), doc())).toBe('missing');
  });
});

// Gmail hangs the id of the mail an attachment belongs to on the chip drawn in the inbox
// row, so the list holds a match for the very message being looked for. Clicking it opens
// the attachment and, worse, counts as done — the conversation then never gets anchored at
// all and the reader is back on the older mail. mail/dropzone.ts narrowed the same way.
describe('messageAnchorScript refuses a list row', () => {
  it('passes over the attachment chip and takes the message', () => {
    const chip = chipInRow(REPLY);
    const target = block(REPLY);

    expect(run(look(REPLY), doc(chip, target))).toBe('clicked');
    expect(chip.clicks).toBe(0);
    expect(target.clicks).toBe(1);
  });

  it('answers missing when the chip is all there is', () => {
    const chip = chipInRow(REPLY);

    expect(run(look(REPLY), doc(chip))).toBe('missing');
    expect(chip.clicks).toBe(0);
  });

  it('refuses a row that names its last message rather than saying it is a row', () => {
    const inside = block(REPLY, { height: 24 });
    new FakeEl({ 'data-legacy-last-message-id': REPLY }, 56, null, [inside]);

    expect(run(look(REPLY), doc(inside))).toBe('missing');
  });
});

// The middle of a long conversation is exactly where "it opened an older mail" hurts most,
// and it is the one place the message is in the page while measuring nothing at all.
describe('messageAnchorScript opens the bundle first', () => {
  it('clicks the bundle row, and not the message it cannot see', () => {
    const { message, row } = bundled(REPLY);

    expect(run(look(REPLY), doc(message))).toBe('revealed');
    expect(row.clicks).toBe(1);
    expect(message.clicks).toBe(0);
  });

  it('leaves a hidden message alone once the bundle has had its click', () => {
    const { message, row } = bundled(REPLY);

    expect(run(look(REPLY, { reveal: false }), doc(message))).toBe('hidden');
    expect(row.clicks).toBe(0);
  });

  it('does not reach for a row that is not a folded one', () => {
    const { message, row } = bundled(REPLY, 900);

    expect(run(look(REPLY), doc(message))).toBe('hidden');
    expect(row.clicks).toBe(0);
  });
});

// Folding a mail the reader already has open is a worse answer than the bug: the click
// needs the block to say it is a header row, and a shape that says nothing gets nothing.
describe('messageAnchorScript leaves what it cannot read', () => {
  it('leaves a block too tall to be folded, whatever became of the body', () => {
    const target = block(REPLY, { height: 800 });

    expect(run(look(REPLY), doc(target))).toBe('unsure');
    expect(target.clicks).toBe(0);
    // Still scrolled to: the right message beats wherever Gmail left the view.
    expect(target.scrolls).toBe(1);
  });

  it('reports a folded message without clicking, once the click is spent', () => {
    const target = block(REPLY);

    expect(run(look(REPLY, { click: false }), doc(target))).toBe('folded');
    expect(target.clicks).toBe(0);
  });

  it('refuses an id Gmail did not write, rather than putting it in the page', () => {
    expect(messageAnchorScript('"] ,* {}; alert(1); //')).toBeNull();
    expect(messageAnchorScript('msg-f:1874044239552094868')).toBeNull();
    expect(messageAnchorScript('')).toBeNull();
    expect(messageAnchorScript('a'.repeat(33))).toBeNull();
    expect(isLegacyMessageId(REPLY)).toBe(true);
    expect(isLegacyMessageId(`${REPLY} `)).toBe(false);
  });
});

describe('parseAnchorProbe', () => {
  it('takes every answer the script can give', () => {
    for (const a of ['shown', 'folded', 'clicked', 'revealed', 'hidden', 'unsure']) {
      expect(parseAnchorProbe(a)).toBe(a);
    }
  });

  it('treats anything else as not found, including a page that could not be asked', () => {
    expect(parseAnchorProbe(null)).toBe('missing');
    expect(parseAnchorProbe(undefined)).toBe('missing');
    expect(parseAnchorProbe({ shown: true })).toBe('missing');
  });
});

describe('anchorMessage', () => {
  const now = { wait: async () => {} };

  it('keeps asking while Gmail is still navigating, then unfolds the message', async () => {
    const target = block(REPLY);
    let tries = 0;
    const waits: number[] = [];

    const answer = await anchorMessage(
      async (s) => {
        tries++;
        // The conversation is not on screen for the first two tries; the third is the
        // click, and the fourth sees the body it produced.
        if (tries < 3) return run(s, doc());
        if (tries > 3) return run(s, doc(block(REPLY, { open: true })));
        return run(s, doc(target));
      },
      REPLY,
      { wait: async (ms) => void waits.push(ms) },
    );

    expect(answer).toBe('opened');
    expect(target.clicks).toBe(1);
    expect(waits).toEqual(Array(3).fill(ANCHOR_INTERVAL_MS));
  });

  // Whether a synthetic click reaches Gmail's own handler cannot be settled away from a
  // real mailbox. So the click is spent once and the tries after it are what report —
  // never a second click, which would fold the message the first one opened.
  it('spends one click and says so when the message never opens', async () => {
    const target = block(REPLY);
    let tries = 0;

    const answer = await anchorMessage(
      async (s) => {
        tries++;
        return run(s, doc(target));
      },
      REPLY,
      now,
    );

    expect(answer).toBe('stuck');
    expect(target.clicks).toBe(1);
    expect(tries).toBe(ANCHOR_TRIES);
  });

  it('takes a block that grew past the fold as opened, body class or no body class', async () => {
    const folded = block(REPLY);
    let tries = 0;

    const answer = await anchorMessage(
      async (s) => {
        tries++;
        // Gmail unfolded it, and the class the body is read by is not one this knows.
        return run(s, doc(tries === 1 ? folded : block(REPLY, { height: 700 })));
      },
      REPLY,
      now,
    );

    expect(answer).toBe('opened');
    expect(folded.clicks).toBe(1);
  });

  it('opens the bundle, then the message inside it, and clicks each once', async () => {
    const { message, row } = bundled(REPLY);
    const opened = block(REPLY);
    let tries = 0;

    const answer = await anchorMessage(
      async (s) => {
        tries++;
        if (tries === 1) return run(s, doc(message));
        if (tries === 2) return run(s, doc(opened));
        return run(s, doc(block(REPLY, { open: true })));
      },
      REPLY,
      now,
    );

    expect(answer).toBe('opened');
    expect(row.clicks).toBe(1);
    expect(opened.clicks).toBe(1);
    expect(message.clicks).toBe(0);
  });

  it('gives up rather than clicking into a conversation that never arrived', async () => {
    let tries = 0;

    const answer = await anchorMessage(
      async (s) => {
        tries++;
        return run(s, doc());
      },
      REPLY,
      now,
    );

    expect(answer).toBe('missing');
    expect(tries).toBe(ANCHOR_TRIES);
  });

  it('treats a page that cannot be asked as not showing it, and asks again', async () => {
    let tries = 0;

    const answer = await anchorMessage(
      async (s) => {
        tries++;
        if (tries === 1) throw new Error('view destroyed mid-navigation');
        return run(s, doc(block(REPLY, { open: true })));
      },
      REPLY,
      now,
    );

    expect(answer).toBe('shown');
    expect(tries).toBe(2);
  });

  it('never reaches the page with an id Gmail did not write', async () => {
    let tries = 0;

    const answer = await anchorMessage(
      async () => {
        tries++;
        return 'shown';
      },
      'msg-f:1874044239552094868',
      now,
    );

    expect(answer).toBe('missing');
    expect(tries).toBe(0);
  });
});

// Two cards for one conversation, clicked one after the other. Both anchors go looking in
// the same page, and the first one finding its message would unfold the older reply and
// scroll to it — the very thing being fixed, arriving by the back door.
describe('anchorMessage gives way to a later click', () => {
  it('stops looking the moment another card owns the view', async () => {
    const target = block(FIRST);
    let tries = 0;
    let superseded = false;

    const answer = await anchorMessage(
      async (s) => {
        tries++;
        superseded = true;
        return run(s, doc());
      },
      FIRST,
      { superseded: () => superseded, wait: async () => {} },
    );

    expect(tries).toBe(1);
    expect(answer).toBe('missing');
    expect(target.clicks).toBe(0);
  });

  it('never touches the page at all when the later click came first', async () => {
    let tries = 0;

    await anchorMessage(
      async () => {
        tries++;
        return 'opened';
      },
      FIRST,
      { superseded: () => true, wait: async () => {} },
    );

    expect(tries).toBe(0);
  });
});
