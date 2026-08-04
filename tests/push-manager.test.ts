// The push connection's state machine: watches, backoff, token refresh and the relay's
// close codes (4401 unauthorised, 4403 not in its allow-list). The sockets are faked.

import { describe, it, expect } from 'vitest';
import { startPushManager, FATAL_CLOSE_CODES } from '../electron/push-manager';
import type { PushSocket } from '../electron/push-transport';

class FakeSocket implements PushSocket {
  sent: string[] = [];
  closed = false;
  private open?: () => void;
  private message?: (d: string) => void;
  private ping?: () => void;
  private close_?: (code: number) => void;
  private error?: (e: unknown) => void;

  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.close_?.(1000);
  }
  onOpen(cb: () => void): void {
    this.open = cb;
  }
  onMessage(cb: (d: string) => void): void {
    this.message = cb;
  }
  onPing(cb: () => void): void {
    this.ping = cb;
  }
  onClose(cb: (code: number) => void): void {
    this.close_ = cb;
  }
  onError(cb: (e: unknown) => void): void {
    this.error = cb;
  }

  fireOpen(): void {
    this.open?.();
  }
  fireMessage(d: string): void {
    this.message?.(d);
  }
  firePing(): void {
    this.ping?.();
  }
  fireClose(code = 1006): void {
    this.close_?.(code);
  }
  fireError(e: unknown): void {
    this.error?.(e);
  }
}

function fakeTimers() {
  let now = 0;
  const pending: Array<{ ms: number; due: number; fn: () => void; cleared: boolean }> = [];
  const setTimer = (fn: () => void, ms: number) => {
    const entry = { ms, due: now + ms, fn, cleared: false };
    pending.push(entry);
    return { clear: () => (entry.cleared = true) };
  };
  const fire = (ms: number): boolean => {
    const entry = pending.find((p) => p.ms === ms && !p.cleared);
    if (!entry) return false;
    entry.cleared = true;
    entry.fn();
    return true;
  };
  const advance = (ms: number): void => {
    const target = now + ms;
    for (;;) {
      const due = pending
        .filter((p) => !p.cleared && p.due <= target)
        .sort((a, b) => a.due - b.due)[0];
      if (!due) break;
      due.cleared = true;
      now = due.due;
      due.fn();
    }
    now = target;
  };
  const live = () => pending.filter((p) => !p.cleared).map((p) => p.ms);
  const armed = (ms: number) => pending.filter((p) => p.ms === ms).length;
  return { setTimer, fire, advance, live, armed };
}

function harness(over: Partial<Parameters<typeof startPushManager>[0]> = {}) {
  const sockets: FakeSocket[] = [];
  const timers = fakeTimers();
  const events: string[] = [];
  let watchOk = true;
  const manager = startPushManager({
    config: { relayUrl: 'ws://localhost:8099', pushTopic: 'projects/p/topics/gmail-push' },
    accounts: () => ['a@x.nl'],
    accessToken: async () => 'token-1',
    armWatch: async (email) => {
      events.push(`watch:${email}`);
      return watchOk;
    },
    onSync: (email) => events.push(`sync:${email}`),
    onCoverage: (email, covered) => events.push(`cover:${email}:${covered}`),
    onFatal: (email, code) => events.push(`fatal:${email}:${code}`),
    transport: {
      connect: () => {
        const s = new FakeSocket();
        sockets.push(s);
        return s;
      },
    },
    setTimer: timers.setTimer,
    ...over,
  });
  return { manager, sockets, timers, events, setWatchOk: (v: boolean) => (watchOk = v) };
}

const settle = () => new Promise((r) => setTimeout(r, 0));

describe('startPushManager', () => {
  it('authenticates, arms the watch, then catches up', async () => {
    const h = harness();
    h.sockets[0].fireOpen();
    await settle();
    expect(JSON.parse(h.sockets[0].sent[0])).toEqual({ type: 'auth', accessToken: 'token-1' });
    expect(h.events).toEqual(['watch:a@x.nl', 'cover:a@x.nl:true', 'sync:a@x.nl']);
    h.manager.stop();
  });

  it('syncs on every sync frame', async () => {
    const h = harness();
    h.sockets[0].fireOpen();
    await settle();
    h.sockets[0].fireMessage(JSON.stringify({ type: 'sync', historyId: '5000' }));
    expect(h.events.filter((e) => e === 'sync:a@x.nl')).toHaveLength(2);
    h.manager.stop();
  });

  it('ignores a frame it does not understand instead of throwing', async () => {
    const h = harness();
    h.sockets[0].fireOpen();
    await settle();
    h.sockets[0].fireMessage('dit is geen json');
    h.sockets[0].fireMessage(JSON.stringify({ type: 'ready' }));
    expect(h.events.filter((e) => e === 'sync:a@x.nl')).toHaveLength(1);
    h.manager.stop();
  });

  it('does not cover the account when the watch fails', async () => {
    const h = harness();
    h.setWatchOk(false);
    h.sockets[0].fireOpen();
    await settle();
    expect(h.events).toEqual(['watch:a@x.nl']);
    expect(h.events).not.toContain('cover:a@x.nl:true');
    h.manager.stop();
  });

  it('does not send an auth frame without a token', async () => {
    const h = harness({ accessToken: async () => null });
    h.sockets[0].fireOpen();
    await settle();
    expect(h.sockets[0].sent).toEqual([]);
    expect(h.events).toEqual([]);
    h.manager.stop();
  });

  it('reconnects with a growing wait after an unexpected close', async () => {
    const h = harness({ backoffMs: (attempt) => 100 * 2 ** attempt });
    h.sockets[0].fireOpen();
    await settle();
    h.sockets[0].fireClose(1006);
    expect(h.timers.live()).toContain(100);
    h.timers.fire(100);
    expect(h.sockets).toHaveLength(2);
    h.sockets[1].fireClose(1006);
    expect(h.timers.live()).toContain(200);
    h.manager.stop();
  });

  it('resets the wait once a connection sticks', async () => {
    const h = harness({ backoffMs: (attempt) => 100 * 2 ** attempt });
    h.sockets[0].fireOpen();
    await settle();
    h.sockets[0].fireClose(1006);
    h.timers.fire(100);
    h.sockets[1].fireOpen();
    await settle();
    h.sockets[1].fireClose(1006);
    expect(h.timers.live()).toContain(100);
    h.manager.stop();
  });

  it('hands coverage back once push has been away too long', async () => {
    const h = harness({ graceMs: 120_000 });
    h.sockets[0].fireOpen();
    await settle();
    h.sockets[0].fireClose(1006);
    expect(h.events).not.toContain('cover:a@x.nl:false');
    h.timers.fire(120_000);
    expect(h.events).toContain('cover:a@x.nl:false');
    h.manager.stop();
  });

  it('keeps coverage when it reconnects inside the grace window', async () => {
    const h = harness({ graceMs: 120_000, backoffMs: () => 100 });
    h.sockets[0].fireOpen();
    await settle();
    h.sockets[0].fireClose(1006);
    h.timers.fire(100);
    h.sockets[1].fireOpen();
    await settle();
    expect(h.events).not.toContain('cover:a@x.nl:false');
    expect(h.timers.live()).not.toContain(120_000);
    h.manager.stop();
  });

  it('gives up and hands coverage back on a refusal it cannot fix', async () => {
    const h = harness();
    h.sockets[0].fireOpen();
    await settle();
    h.sockets[0].fireClose(4403);
    expect(h.events).toContain('cover:a@x.nl:false');
    expect(h.events).toContain('fatal:a@x.nl:4403');
    expect(h.timers.live()).toEqual([]);
    h.manager.stop();
  });

  it('names the codes that are not worth retrying', () => {
    expect(FATAL_CLOSE_CODES).toEqual([4400, 4401, 4403]);
  });

  it('gives a first 4401 one more try with a genuinely fresh token', async () => {
    const refreshed: string[] = [];
    const h = harness({
      refreshToken: async (email) => {
        refreshed.push(email);
        return 'token-2';
      },
    });
    h.sockets[0].fireOpen();
    await settle();
    h.sockets[0].fireClose(4401);
    await settle();
    expect(refreshed).toEqual(['a@x.nl']);
    expect(h.sockets).toHaveLength(2);
    expect(h.events).not.toContain('fatal:a@x.nl:4401');
    h.sockets[1].fireOpen();
    await settle();
    expect(h.events).toContain('cover:a@x.nl:true');
    h.manager.stop();
  });

  it('gives up after the second 4401 and says so', async () => {
    let n = 0;
    const h = harness({ refreshToken: async () => `token-${++n}` });
    h.sockets[0].fireOpen();
    await settle();
    h.sockets[0].fireClose(4401);
    await settle();
    h.sockets[1].fireClose(4401);
    await settle();
    expect(n).toBe(1);
    expect(h.sockets).toHaveLength(2);
    expect(h.events).toContain('fatal:a@x.nl:4401');
    expect(h.events).toContain('cover:a@x.nl:false');
    expect(h.timers.live()).toEqual([]);
    h.manager.stop();
  });

  it('is final right away when there is no fresh token to be had', async () => {
    const h = harness({ refreshToken: async () => null });
    h.sockets[0].fireOpen();
    await settle();
    h.sockets[0].fireClose(4401);
    await settle();
    expect(h.sockets).toHaveLength(1);
    expect(h.events).toContain('fatal:a@x.nl:4401');
    h.manager.stop();
  });

  it('earns a new retry once the relay has actually accepted the token', async () => {
    let n = 0;
    const h = harness({ refreshToken: async () => `token-${++n}` });
    h.sockets[0].fireOpen();
    await settle();
    h.sockets[0].fireClose(4401);
    await settle();
    h.sockets[1].fireOpen();
    await settle();
    h.sockets[1].fireMessage(JSON.stringify({ type: 'ready' }));
    h.sockets[1].fireClose(4401);
    await settle();
    expect(n).toBe(2);
    expect(h.events).not.toContain('fatal:a@x.nl:4401');
    expect(h.sockets).toHaveLength(3);
    h.manager.stop();
  });

  it('does not hand out a new retry just because our own handshake succeeded', async () => {
    let n = 0;
    const h = harness({ refreshToken: async () => `token-${++n}` });
    h.sockets[0].fireOpen();
    await settle();
    h.sockets[0].fireClose(4401);
    await settle();
    h.sockets[1].fireOpen();
    await settle();
    h.sockets[1].fireClose(4401);
    await settle();
    expect(n).toBe(1);
    expect(h.events).toContain('fatal:a@x.nl:4401');
    expect(h.sockets).toHaveLength(2);
    h.manager.stop();
  });

  it('still refuses a 4403 on the spot: a fresh token changes nothing there', async () => {
    const refreshed: string[] = [];
    const h = harness({
      refreshToken: async (email) => {
        refreshed.push(email);
        return 'token-2';
      },
    });
    h.sockets[0].fireOpen();
    await settle();
    h.sockets[0].fireClose(4403);
    await settle();
    expect(refreshed).toEqual([]);
    expect(h.events).toContain('fatal:a@x.nl:4403');
    h.manager.stop();
  });

  it('renews the watch on its own clock', async () => {
    const h = harness({ renewMs: 86_400_000 });
    h.sockets[0].fireOpen();
    await settle();
    expect(h.timers.fire(86_400_000)).toBe(true);
    await settle();
    expect(h.events.filter((e) => e === 'watch:a@x.nl')).toHaveLength(2);
    expect(h.timers.live()).toContain(86_400_000);
    h.manager.stop();
  });

  it('reconnects when the socket goes silent', async () => {
    const h = harness({ staleMs: 90_000 });
    h.sockets[0].fireOpen();
    await settle();
    h.timers.advance(90_000);
    expect(h.sockets[0].closed).toBe(true);
    h.manager.stop();
  });

  it('takes the relay heartbeat ping as a sign of life', async () => {
    const h = harness({ staleMs: 90_000 });
    h.sockets[0].fireOpen();
    await settle();
    expect(h.timers.armed(90_000)).toBe(1);
    h.sockets[0].firePing();
    expect(h.timers.armed(90_000)).toBe(2);
    expect(h.timers.live().filter((ms) => ms === 90_000)).toHaveLength(1);
    h.manager.stop();
  });

  it('keeps a quiet mailbox connected on nothing but pings', async () => {
    const h = harness({ staleMs: 90_000, renewMs: 86_400_000 });
    h.sockets[0].fireOpen();
    await settle();
    for (let i = 0; i < 120; i++) {
      h.timers.advance(30_000);
      h.sockets[0].firePing();
    }
    expect(h.sockets[0].closed).toBe(false);
    expect(h.sockets).toHaveLength(1);
    expect(h.events.filter((e) => e === 'watch:a@x.nl')).toHaveLength(1);
    expect(h.events.filter((e) => e === 'sync:a@x.nl')).toHaveLength(1);
    expect(h.events).not.toContain('cover:a@x.nl:false');
    h.manager.stop();
  });

  it('pushes the silence deadline back on an application frame too', async () => {
    const h = harness({ staleMs: 90_000 });
    h.sockets[0].fireOpen();
    await settle();
    h.sockets[0].fireMessage(JSON.stringify({ type: 'ready' }));
    expect(h.timers.armed(90_000)).toBe(2);
    expect(h.timers.live().filter((ms) => ms === 90_000)).toHaveLength(1);
    h.manager.stop();
  });

  it('cleans everything up on stop', async () => {
    const h = harness();
    h.sockets[0].fireOpen();
    await settle();
    h.manager.stop();
    expect(h.sockets[0].closed).toBe(true);
    expect(h.timers.live()).toEqual([]);
    h.sockets[0].fireClose(1006);
    expect(h.sockets).toHaveLength(1);
  });

  it('connects an account that appears later and drops one that goes away', async () => {
    let list = ['a@x.nl'];
    const h = harness({ accounts: () => list });
    h.sockets[0].fireOpen();
    await settle();
    list = ['a@x.nl', 'b@x.nl'];
    h.manager.refresh();
    expect(h.sockets).toHaveLength(2);
    list = ['b@x.nl'];
    h.manager.refresh();
    expect(h.sockets[0].closed).toBe(true);
    expect(h.events).toContain('cover:a@x.nl:false');
    expect(h.sockets).toHaveLength(2);
    expect(h.timers.live()).toEqual([]);
    h.manager.stop();
  });

  it('ignores a stale handshake once stop() has already run', async () => {
    let resolveToken: (t: string | null) => void = () => {};
    const tokenPromise = new Promise<string | null>((res) => {
      resolveToken = res;
    });
    const h = harness({ accessToken: async () => tokenPromise });
    h.sockets[0].fireOpen();
    h.manager.stop();
    resolveToken('token-1');
    await settle();
    expect(h.sockets[0].sent).toEqual([]);
    expect(h.events).toEqual([]);
  });

  it('ignores a stale handshake once a fatal refusal already handled the close', async () => {
    const sockets: FakeSocket[] = [];
    const events: string[] = [];
    let resolveWatch: (ok: boolean) => void = () => {};
    const watchPromise = new Promise<boolean>((res) => {
      resolveWatch = res;
    });
    const manager = startPushManager({
      config: { relayUrl: 'ws://localhost:8099', pushTopic: 'projects/p/topics/gmail-push' },
      accounts: () => ['a@x.nl'],
      accessToken: async () => 'token-1',
      armWatch: async (email) => {
        events.push(`watch:${email}`);
        return watchPromise;
      },
      onSync: (email) => events.push(`sync:${email}`),
      onCoverage: (email, covered) => events.push(`cover:${email}:${covered}`),
      onFatal: (email, code) => events.push(`fatal:${email}:${code}`),
      transport: {
        connect: () => {
          const s = new FakeSocket();
          sockets.push(s);
          return s;
        },
      },
      setTimer: fakeTimers().setTimer,
    });
    sockets[0].fireOpen();
    await settle();
    sockets[0].fireClose(4403);
    expect(events).toContain('fatal:a@x.nl:4403');
    resolveWatch(true);
    await settle();
    expect(events).not.toContain('cover:a@x.nl:true');
    expect(events.filter((e) => e === 'sync:a@x.nl')).toHaveLength(0);
    manager.stop();
  });

  it('ignores a non-fatal close that lands while the watch is still pending', async () => {
    let resolveWatch: (ok: boolean) => void = () => {};
    const watchPromise = new Promise<boolean>((res) => {
      resolveWatch = res;
    });
    const h = harness({
      armWatch: async () => watchPromise,
      backoffMs: (attempt) => 100 * 2 ** attempt,
      staleMs: 90_000,
      renewMs: 86_400_000,
    });
    h.sockets[0].fireOpen();
    await settle();
    h.sockets[0].fireClose(1006);
    expect(h.timers.live()).toContain(100);
    resolveWatch(true);
    await settle();
    expect(h.events).not.toContain('cover:a@x.nl:true');
    expect(h.timers.live()).not.toContain(90_000);
    expect(h.timers.live()).not.toContain(86_400_000);
    h.timers.fire(100);
    expect(h.sockets).toHaveLength(2);
    h.sockets[1].fireClose(1006);
    expect(h.timers.live()).toContain(200);
    h.manager.stop();
  });

  it('reconnects after a failed watch renewal instead of waiting a full day', async () => {
    const h = harness({ renewMs: 86_400_000, backoffMs: () => 50 });
    h.sockets[0].fireOpen();
    await settle();
    h.setWatchOk(false);
    h.timers.fire(86_400_000);
    await settle();
    expect(h.events).toContain('cover:a@x.nl:false');
    expect(h.sockets[0].closed).toBe(true);
    expect(h.timers.live()).toContain(50);
    expect(h.timers.live()).not.toContain(86_400_000);
    h.manager.stop();
  });

  it('revives a permanently refused account once refresh() runs again', async () => {
    const h = harness();
    h.sockets[0].fireOpen();
    await settle();
    h.sockets[0].fireClose(4403);
    expect(h.events).toContain('fatal:a@x.nl:4403');
    h.manager.refresh();
    expect(h.sockets).toHaveLength(2);
    h.sockets[1].fireOpen();
    await settle();
    expect(h.events).toContain('cover:a@x.nl:true');
    h.manager.stop();
  });
});
