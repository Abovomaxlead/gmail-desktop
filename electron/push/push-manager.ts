// One relay connection per account, since the relay authenticates a single token per
// connection and routes on the address inside it.
//
// Concurrency is the difficulty: every attempt carries a generation number and each slow
// step rechecks isLive after its await, so a superseded attempt cannot re-enable coverage
// or reset the backoff. FATAL_CLOSE_CODES cannot be fixed by retrying; 4401 gets one retry
// with a fresh token. The heartbeat is a protocol ping and on a quiet mailbox the only
// traffic there is, so it feeds the staleness timer. refresh() drops an account from the
// map before closing its socket, or the close event revives it.
import { wsTransport, type PushSocket, type PushTransport } from './push-transport';
import type { PushConfig } from './push-config';



//===========================
// Constants
//===========================

// Closes that retrying cannot fix. 4401 is the exception handled separately: it gets one
// retry with a genuinely fresh token.
export const FATAL_CLOSE_CODES = [4400, 4401, 4403];

const DAY_MS = 24 * 60 * 60 * 1000;
const STALE_MS = 90_000;
const GRACE_MS = 120_000;


//===========================
// Types
//===========================

export interface Timer {
  clear(): void;
}

export interface PushManagerDeps {
  config: PushConfig;
  accounts(): string[];
  accessToken(email: string): Promise<string | null>;
  refreshToken?(email: string): Promise<string | null>;
  armWatch(email: string): Promise<boolean>;
  onSync(email: string): void;
  onCoverage(email: string, covered: boolean): void;
  onFatal?(email: string, code: number): void;
  transport?: PushTransport;
  backoffMs?(attempt: number): number;
  setTimer?(fn: () => void, ms: number): Timer;
  renewMs?: number;
  staleMs?: number;
  graceMs?: number;
}

interface ConnState {
  sock?: PushSocket;
  attempt: number;
  covered: boolean;
  reconnect?: Timer;
  renew?: Timer;
  stale?: Timer;
  grace?: Timer;
  dead: boolean;
  retriedAuth: boolean;
  generation: number;
}


//===========================
// Exported functions
//===========================

/**
 * Opens and keeps one relay connection per account
 *
 * @param deps
 * @returns stop() to tear everything down, refresh() to follow the account list
 */
export function startPushManager(deps: PushManagerDeps): { stop(): void; refresh(): void } {
  const transport = deps.transport ?? wsTransport;
  const backoffMs = deps.backoffMs ?? ((attempt) => Math.min(30_000, 1000 * 2 ** attempt));
  const renewMs = deps.renewMs ?? DAY_MS;
  const staleMs = deps.staleMs ?? STALE_MS;
  const graceMs = deps.graceMs ?? GRACE_MS;
  const setTimer =
    deps.setTimer ??
    ((fn, ms) => {
      const t = setTimeout(fn, ms);
      return { clear: () => clearTimeout(t) };
    });

  let stopped = false;
  const conns = new Map<string, ConnState>();

  /**
   * Reports a coverage change, and only a change
   *
   * @param email
   * @param state
   * @param covered
   * @private
   */
  const setCovered = (email: string, state: ConnState, covered: boolean): void => {
    if (state.covered === covered) return;
    state.covered = covered;
    deps.onCoverage(email, covered);
  };

  /**
   * Cancels every timer an account holds
   *
   * @param state
   * @private
   */
  const clearTimers = (state: ConnState): void => {
    state.reconnect?.clear();
    state.renew?.clear();
    state.stale?.clear();
    state.grace?.clear();
    state.reconnect = undefined;
    state.renew = undefined;
    state.stale = undefined;
    state.grace = undefined;
  };

  /**
   * Whether this attempt is still the one that owns the account
   *
   * @param email
   * @param state
   * @param gen the generation the attempt started on
   * @param sock when given, also requires the socket to still be the current one
   * @returns true while the attempt is current
   * @private
   */
  const isLive = (email: string, state: ConnState, gen: number, sock?: PushSocket): boolean =>
    !stopped &&
    !state.dead &&
    conns.get(email) === state &&
    state.generation === gen &&
    (sock === undefined || state.sock === sock);

  /**
   * Re-arms Gmail's watch before it lapses, closing the socket when it cannot
   *
   * @param email
   * @param state
   * @param gen
   * @private
   */
  const scheduleRenew = (email: string, state: ConnState, gen: number): void => {
    state.renew?.clear();
    state.renew = setTimer(() => {
      if (!isLive(email, state, gen)) return;
      void deps
        .armWatch(email)
        .then((ok) => {
          if (!isLive(email, state, gen)) return;
          if (ok) {
            scheduleRenew(email, state, gen);
            return;
          }
          setCovered(email, state, false);
          state.sock?.close();
        })
        .catch(() => {
          if (!isLive(email, state, gen)) return;
          setCovered(email, state, false);
          state.sock?.close();
        });
    }, renewMs);
  };

  /**
   * Restarts the staleness timer that closes a silent connection
   *
   * @param email
   * @param state
   * @param gen
   * @private
   */
  const armStale = (email: string, state: ConnState, gen: number): void => {
    state.stale?.clear();
    state.stale = setTimer(() => {
      if (!isLive(email, state, gen)) return;
      state.sock?.close();
    }, staleMs);
  };

  /**
   * Stops trying for an account, for a reason retrying cannot fix
   *
   * @param email
   * @param state
   * @param code the relay's close code
   * @private
   */
  const giveUp = (email: string, state: ConnState, code: number): void => {
    state.dead = true;
    setCovered(email, state, false);
    clearTimers(state);
    deps.onFatal?.(email, code);
  };

  /**
   * Opens a connection for one account and wires its whole lifecycle
   *
   * @param email
   * @private
   */
  const connect = (email: string): void => {
    if (stopped) return;
    const state =
      conns.get(email) ??
      { attempt: 0, covered: false, dead: false, retriedAuth: false, generation: 0 };
    conns.set(email, state);
    if (state.dead) return;

    const myGen = ++state.generation;

    let sock: PushSocket;
    try {
      sock = transport.connect(deps.config.relayUrl);
    } catch (e) {
      console.warn(`[push] verbinden mislukte meteen voor ${email}:`, e);
      state.reconnect = setTimer(() => connect(email), backoffMs(state.attempt++));
      return;
    }
    state.sock = sock;

    sock.onOpen(() => {
      void (async () => {
        try {
          const token = await deps.accessToken(email);
          if (!isLive(email, state, myGen, sock)) return;
          if (!token) {
            console.warn(`[push] geen token voor ${email}`);
            sock.close();
            return;
          }
          sock.send(JSON.stringify({ type: 'auth', accessToken: token }));
          const armed = await deps.armWatch(email);
          if (!isLive(email, state, myGen, sock)) return;
          if (!armed) {
            console.warn(`[push] watch mislukte voor ${email}; webview blijft melden`);
            sock.close();
            return;
          }
          state.attempt = 0;
          state.grace?.clear();
          state.grace = undefined;
          armStale(email, state, myGen);
          scheduleRenew(email, state, myGen);
          setCovered(email, state, true);
          deps.onSync(email);
        } catch (e) {
          console.warn(`[push] handdruk mislukte voor ${email}:`, e);
          if (isLive(email, state, myGen, sock)) sock.close();
        }
      })();
    });

    sock.onMessage((data) => {
      if (!isLive(email, state, myGen, sock)) return;
      armStale(email, state, myGen);
      let msg: { type?: string };
      try {
        msg = JSON.parse(data) as { type?: string };
      } catch {
        return;
      }
      if (msg.type === 'ready') state.retriedAuth = false;
      if (msg.type === 'sync') deps.onSync(email);
    });

    sock.onPing(() => {
      if (!isLive(email, state, myGen, sock)) return;
      armStale(email, state, myGen);
    });

    sock.onError((e) => console.warn(`[push] socketfout voor ${email}:`, e));

    sock.onClose((code) => {
      state.stale?.clear();
      state.stale = undefined;
      state.renew?.clear();
      state.renew = undefined;
      if (!isLive(email, state, myGen, sock)) return;

      state.sock = undefined;

      if (code === 4401 && !state.retriedAuth && deps.refreshToken) {
        state.retriedAuth = true;
        setCovered(email, state, false);
        state.grace?.clear();
        state.grace = undefined;
        void deps
          .refreshToken(email)
          .then((fresh) => {
            if (!isLive(email, state, myGen)) return;
            if (fresh) {
              connect(email);
              return;
            }
            giveUp(email, state, code);
          })
          .catch(() => {
            if (isLive(email, state, myGen)) giveUp(email, state, code);
          });
        return;
      }

      if (FATAL_CLOSE_CODES.includes(code)) {
        giveUp(email, state, code);
        return;
      }

      if (state.covered && !state.grace) {
        state.grace = setTimer(() => setCovered(email, state, false), graceMs);
      }
      state.reconnect = setTimer(() => connect(email), backoffMs(state.attempt++));
    });
  };

  /**
   * Brings the connections in line with the current account list
   *
   * @private
   */
  const refresh = (): void => {
    if (stopped) return;
    const wanted = new Set(deps.accounts());
    for (const [email, state] of conns) {
      if (wanted.has(email)) continue;

      conns.delete(email);
      clearTimers(state);
      setCovered(email, state, false);
      state.sock?.close();
    }
    for (const email of wanted) {
      const state = conns.get(email);
      if (!state) {
        connect(email);
      } else if (state.dead) {
        state.dead = false;
        state.attempt = 0;
        state.retriedAuth = false;
        connect(email);
      }
    }
  };

  refresh();

  return {
    stop(): void {
      stopped = true;
      for (const state of conns.values()) {
        clearTimers(state);
        state.sock?.close();
      }
      conns.clear();
    },
    refresh,
  };
}
