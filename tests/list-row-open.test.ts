// Which row a notification click opens, run against a fake Gmail page the way the browser
// would run it: the script the app hands to the page is executed, not read.
//
// The row is clicked so the mail opens the way the reader set Gmail up — in the reading pane
// when there is one. Clicking the wrong row opens the wrong mail, so the cases that matter are
// the ones with more than one candidate on the page.

import { describe, expect, it } from 'vitest';
import { listOpenedScript, listRowClickScript, openFromList } from '../electron/gmail/list-row-open';

const THREAD = '1a01f12d2ec28372';
const FIRST = '1a01f12d2ec28372';
const REPLY = '1a01f14e87dea294';

/** Just enough of an element for the scripts: attributes, a parent, layout and events. */
class El {
  parentElement: El | null = null;
  children: El[] = [];
  events: string[] = [];
  constructor(
    private attrs: Record<string, string>,
    public laidOut = true,
  ) {}
  getAttribute(name: string): string | null {
    return this.attrs[name] ?? null;
  }
  append(...kids: El[]): this {
    for (const k of kids) {
      k.parentElement = this;
      this.children.push(k);
    }
    return this;
  }
  getClientRects(): unknown[] {
    for (let cur: El | null = this; cur; cur = cur.parentElement) if (!cur.laidOut) return [];
    return [{}];
  }
  dispatchEvent(e: { type: string }): boolean {
    this.events.push(e.type);
    return true;
  }
  querySelectorAll(sel: string): El[] {
    const m = /^\[([a-z-]+)(?:="([^"]+)")?\]$/.exec(sel)!;
    const out: El[] = [];
    const walk = (el: El) => {
      for (const k of el.children) {
        const v = k.getAttribute(m[1]);
        if (v !== null && (m[2] === undefined || v === m[2])) out.push(k);
        walk(k);
      }
    };
    walk(this);
    return out;
  }
}

/** A list row as Gmail draws it: role="row" around the subject span that names the thread. */
function row(threadId: string, messageId: string | null): { row: El; subject: El } {
  const subject = new El({ 'data-legacy-thread-id': threadId });
  const attrs: Record<string, string> = { role: 'row' };
  const cell = new El(messageId ? { 'data-legacy-last-message-id': messageId } : {});
  return { row: new El(attrs).append(cell.append(subject)), subject };
}

function run(doc: El, script: string, location = { hash: '#inbox' }): unknown {
  class MouseEvent {
    constructor(readonly type: string) {}
  }
  return new Function('document', 'location', 'MouseEvent', `return ${script}`)(
    doc,
    location,
    MouseEvent,
  );
}

describe('listRowClickScript', () => {
  it('clicks the row of the mail the card named, not the older one of its thread', () => {
    // Conversation view off: two rows under the same thread id, one per mail.
    const older = row(THREAD, FIRST);
    const reply = row(THREAD, REPLY);
    const doc = new El({}).append(reply.row, older.row);

    expect(run(doc, listRowClickScript(THREAD, FIRST)!)).toBe('#inbox');

    expect(older.subject.events).toEqual(['mousedown', 'mouseup', 'click']);
    expect(reply.subject.events).toEqual([]);
  });

  it('skips a row of a list Gmail keeps hidden', () => {
    const hidden = row(THREAD, REPLY);
    const list = new El({}, false).append(hidden.row);
    const shown = row(THREAD, REPLY);
    const doc = new El({}).append(list, shown.row);

    run(doc, listRowClickScript(THREAD, REPLY)!);

    expect(hidden.subject.events).toEqual([]);
    expect(shown.subject.events).toHaveLength(3);
  });

  it('never clicks the subject line of the conversation already open', () => {
    const heading = new El({ 'data-legacy-thread-id': THREAD });
    const doc = new El({}).append(heading);

    expect(run(doc, listRowClickScript(THREAD, REPLY)!)).toBeNull();
    expect(heading.events).toEqual([]);
  });

  it('leaves a row alone that holds a different mail of the thread', () => {
    const older = row(THREAD, FIRST);
    const doc = new El({}).append(older.row);

    expect(run(doc, listRowClickScript(THREAD, REPLY)!)).toBeNull();
    expect(older.subject.events).toEqual([]);
  });

  it('takes the newest row of the thread when no mail is known', () => {
    const newest = row(THREAD, REPLY);
    const older = row(THREAD, FIRST);
    const doc = new El({}).append(newest.row, older.row);

    run(doc, listRowClickScript(THREAD)!);

    expect(newest.subject.events).toHaveLength(3);
    expect(older.subject.events).toEqual([]);
  });

  it('never builds a script around an id Gmail did not write', () => {
    expect(listRowClickScript('thread-f:1"])')).toBeNull();
    expect(listRowClickScript(THREAD, 'msg-f:187404')).not.toContain('msg-f');
  });
});

describe('listOpenedScript', () => {
  it('counts the hash moving on as opened', () => {
    const doc = new El({});
    expect(run(doc, listOpenedScript(THREAD, '#inbox')!, { hash: '#inbox/FMfcgz' })).toBe(true);
    expect(run(doc, listOpenedScript(THREAD, '#inbox')!, { hash: '#inbox' })).toBe(false);
  });

  it('counts the conversation on screen as opened, though the hash had nowhere to go', () => {
    // The row clicked was the one already open in the pane.
    const open = row(THREAD, REPLY);
    const heading = new El({ 'data-legacy-thread-id': THREAD });
    const doc = new El({}).append(open.row, heading);
    expect(run(doc, listOpenedScript(THREAD, '#inbox/FMfcgz')!, { hash: '#inbox/FMfcgz' })).toBe(
      true,
    );
  });
});

describe('openFromList', () => {
  const noWait = () => Promise.resolve();

  it('sends the view to the inbox once, when the list on screen lacks the row', async () => {
    let shows = 0;
    let asks = 0;
    const how = await openFromList(
      (script) => {
        if (script.includes('dispatchEvent')) return Promise.resolve(++asks < 3 ? null : '#inbox');
        return Promise.resolve(true);
      },
      THREAD,
      REPLY,
      { showList: () => shows++, wait: noWait },
    );
    expect(how).toBe('clicked');
    expect(shows).toBe(1);
  });

  it('reports a click Gmail never acted on, so the caller navigates', async () => {
    const how = await openFromList(
      (script) => Promise.resolve(script.includes('dispatchEvent') ? '#inbox' : false),
      THREAD,
      REPLY,
      { showList: () => {}, wait: noWait },
    );
    expect(how).toBe('ignored');
  });
});
