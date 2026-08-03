import { describe, it, expect } from 'vitest';
import { startPushManager, FATAL_CLOSE_CODES } from '../electron/push-manager';
import type { PushSocket } from '../electron/push-transport';

// Nep-socket: we sturen de gebeurtenissen zelf, zodat de test over de
// toestandsmachine gaat en niet over ws.
class FakeSocket implements PushSocket {
  sent: string[] = [];
  closed = false;
  private open?: () => void;
  private message?: (d: string) => void;
  private close_?: (code: number) => void;
  private error?: (e: unknown) => void;

  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {
    // Echte ws vuurt ook een close-event als je zelf close() aanroept — dat
    // is precies wat Critical 1 blootlegde: de manager moet zo'n zelf
    // veroorzaakte sluiting net zo goed herkennen als een sluiting door de
    // server. Eenmalig, zoals een echte socket ook maar één keer sluit.
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
  fireClose(code = 1006): void {
    this.close_?.(code);
  }
  fireError(e: unknown): void {
    this.error?.(e);
  }
}

// Nep-klok: we onthouden de geplande callbacks en vuren ze met de hand.
function fakeTimers() {
  const pending: Array<{ ms: number; fn: () => void; cleared: boolean }> = [];
  const setTimer = (fn: () => void, ms: number) => {
    const entry = { ms, fn, cleared: false };
    pending.push(entry);
    return { clear: () => (entry.cleared = true) };
  };
  // Vuurt de eerste nog niet afgezegde timer met deze wachttijd.
  const fire = (ms: number): boolean => {
    const entry = pending.find((p) => p.ms === ms && !p.cleared);
    if (!entry) return false;
    entry.cleared = true;
    entry.fn();
    return true;
  };
  const live = () => pending.filter((p) => !p.cleared).map((p) => p.ms);
  return { setTimer, fire, live };
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
    // Volgorde telt: pas als de watch staat is het account gedekt, en pas dan
    // mag de catch-up melden.
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
    expect(h.timers.live()).toContain(100); // weer vanaf het begin
    h.manager.stop();
  });

  it('hands coverage back once push has been away too long', async () => {
    const h = harness({ graceMs: 120_000 });
    h.sockets[0].fireOpen();
    await settle();
    h.sockets[0].fireClose(1006);
    // Nog niet: een blip mag niets omschakelen.
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
    // Niet alleen geen omschakeling: de nog lopende afvaltimer moet ook echt
    // afgezegd zijn. Zonder die annulering zou deze test ook slagen als de
    // `state.grace?.clear()`-regel werd weggehaald — pas deze assertie merkt
    // dat de timer nog steeds klaarstaat om dekking alsnog terug te trekken.
    expect(h.timers.live()).not.toContain(120_000);
    h.manager.stop();
  });

  it('gives up and hands coverage back on a refusal it cannot fix', async () => {
    const h = harness();
    h.sockets[0].fireOpen();
    await settle();
    h.sockets[0].fireClose(4403); // adres niet in ALLOWED_EMAILS van de relay
    expect(h.events).toContain('cover:a@x.nl:false');
    expect(h.events).toContain('fatal:a@x.nl:4403');
    expect(h.timers.live()).toEqual([]); // geen herverbinding meer
    h.manager.stop();
  });

  it('names the codes that are not worth retrying', () => {
    expect(FATAL_CLOSE_CODES).toEqual([4400, 4401, 4403]);
  });

  it('renews the watch on its own clock', async () => {
    const h = harness({ renewMs: 86_400_000 });
    h.sockets[0].fireOpen();
    await settle();
    expect(h.timers.fire(86_400_000)).toBe(true);
    await settle();
    expect(h.events.filter((e) => e === 'watch:a@x.nl')).toHaveLength(2);
    // En hij plant zichzelf opnieuw in.
    expect(h.timers.live()).toContain(86_400_000);
    h.manager.stop();
  });

  it('reconnects when the socket goes silent', async () => {
    const h = harness({ staleMs: 90_000 });
    h.sockets[0].fireOpen();
    await settle();
    h.timers.fire(90_000);
    expect(h.sockets[0].closed).toBe(true);
    h.manager.stop();
  });

  it('pushes the silence deadline back on every frame', async () => {
    const h = harness({ staleMs: 90_000 });
    h.sockets[0].fireOpen();
    await settle();
    h.sockets[0].fireMessage(JSON.stringify({ type: 'ready' }));
    // De oude timer is afgezegd en er staat een nieuwe.
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
    expect(h.sockets).toHaveLength(1); // geen herverbinding na stop
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
    // Het lokaal sluiten van de socket vuurt zelf een close-event (zoals een
    // echte ws-verbinding ook doet). Dat mag het verwijderde account niet via
    // de normale herverbindingslogica laten herleven: geen nieuwe socket, geen
    // reconnect-timer.
    expect(h.sockets).toHaveLength(2);
    expect(h.timers.live()).toEqual([]);
    h.manager.stop();
  });

  it('ignores a stale handshake once stop() has already run', async () => {
    // Simuleert de race uit Critical 2: de open-handler hangt nog op een
    // token terwijl de manager al gestopt is. Zonder de leefbaarheidscheck zou
    // hij na het alsnog binnenkomen van het token nog een auth-frame sturen.
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
    // Zelfde race, maar dan met een 4403 die tussentijds binnenkomt terwijl de
    // watch-aanroep nog hangt. Zonder de leefbaarheidscheck zou de trage watch
    // de permanente afwijzing ongedaan maken: dekking weer aan en een catch-up
    // melden voor een account dat net geweigerd is.
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
        return watchPromise; // blijft hangen tot de test hem lost
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
    sockets[0].fireClose(4403); // adres niet in ALLOWED_EMAILS van de relay
    expect(events).toContain('fatal:a@x.nl:4403');
    resolveWatch(true); // de trage aanroep komt alsnog terug, te laat om nog te tellen
    await settle();
    expect(events).not.toContain('cover:a@x.nl:true');
    expect(events.filter((e) => e === 'sync:a@x.nl')).toHaveLength(0);
    manager.stop();
  });
});
