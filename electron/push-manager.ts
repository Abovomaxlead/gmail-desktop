import { wsTransport, type PushSocket, type PushTransport } from './push-transport';
import type { PushConfig } from './push-config';

// Eén verbinding per account naar de relay. Dat moet per account, want de relay
// authenticeert met één token per verbinding en routeert op het adres daaruit.
//
// Overgezet uit gmail-native (src/main/push/manager.ts). Wat er hier bij komt:
// dekkingsmeldingen (zodat de webview weet of hij moet zwijgen), het herkennen
// van sluitcodes waar opnieuw proberen zinloos is, en een hartslagtimer voor een
// socket die doodgaat zonder afscheid.

// Codes waar de relay mee zegt dat er iets structureel mis is: 4400 een kapot
// frame van ons, 4401 een token dat Google afkeurt, 4403 een adres dat niet in
// ALLOWED_EMAILS staat. Blijven proberen lost geen van de drie op.
export const FATAL_CLOSE_CODES = [4400, 4401, 4403];

export interface Timer {
  clear(): void;
}

export interface PushManagerDeps {
  config: PushConfig;
  accounts(): string[];
  accessToken(email: string): Promise<string | null>;
  // True als de watch staat. Zonder watch stuurt Gmail niets en is het account
  // dus niet gedekt, hoe goed de socket het ook doet.
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

const DAY_MS = 24 * 60 * 60 * 1000;
const STALE_MS = 90_000; // de relay klopt elke 30s aan; drie keer niets is dood
const GRACE_MS = 120_000; // zie de spec: kort genoeg om niet blind te zitten

interface ConnState {
  sock?: PushSocket;
  attempt: number;
  covered: boolean;
  reconnect?: Timer;
  renew?: Timer;
  stale?: Timer;
  grace?: Timer;
  dead: boolean; // definitief geweigerd: niet meer proberen
  // Nummer van de lopende poging. Traag werk (token ophalen, watch zetten,
  // vernieuwen) neemt dit nummer mee en checkt het na elke await: als het niet
  // meer overeenkomt is deze poging overtroffen door een nieuwe verbinding,
  // is het account verwijderd, of is de manager gestopt — en mag hij niets
  // meer aan de gedeelde toestand doen.
  generation: number;
}

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

  const setCovered = (email: string, state: ConnState, covered: boolean): void => {
    if (state.covered === covered) return;
    state.covered = covered;
    deps.onCoverage(email, covered);
  };

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

  // De ene vraag die "mag deze poging nog iets veranderen?" beantwoordt: niet
  // gestopt, niet definitief afgewezen, en dit account verwijst nog naar
  // precies déze toestand onder precies dit pogingnummer. Elke asynchrone
  // vervolgstap (na een await, of in een losse timer-callback) checkt dit
  // vóórdat hij de socket aanraakt of dekking meldt.
  const isLive = (email: string, state: ConnState, gen: number): boolean =>
    !stopped && !state.dead && conns.get(email) === state && state.generation === gen;

  // Elke vernieuwing plant de volgende zelf in, en hangt aan het account en niet
  // aan één socket: de watch is een gewone HTTPS-aanroep en kan dus ook slagen
  // terwijl de verbinding even weg is.
  const scheduleRenew = (email: string, state: ConnState, gen: number): void => {
    state.renew?.clear();
    state.renew = setTimer(() => {
      if (!isLive(email, state, gen)) return;
      void deps
        .armWatch(email)
        .then((ok) => {
          if (!isLive(email, state, gen)) return;
          if (!ok) setCovered(email, state, false);
        })
        .catch(() => {
          if (isLive(email, state, gen)) setCovered(email, state, false);
        })
        .finally(() => {
          if (isLive(email, state, gen)) scheduleRenew(email, state, gen);
        });
    }, renewMs);
  };

  // Een socket die stilvalt zonder close-event zou de manager voor altijd laten
  // denken dat hij verbonden is. Elke frame — ook een ping — schuift dit op.
  const armStale = (email: string, state: ConnState, gen: number): void => {
    state.stale?.clear();
    state.stale = setTimer(() => {
      if (!isLive(email, state, gen)) return;
      state.sock?.close(); // het close-event hierna regelt de herverbinding
    }, staleMs);
  };

  const connect = (email: string): void => {
    if (stopped) return;
    const state = conns.get(email) ?? { attempt: 0, covered: false, dead: false, generation: 0 };
    conns.set(email, state);
    if (state.dead) return;

    // Nieuw nummer voor deze poging. Zolang niemand anders het account opnieuw
    // verbindt, blijft dit hét geldende nummer voor alle timers en callbacks
    // die deze socket hieronder opzet.
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
          if (!isLive(email, state, myGen)) return;
          if (!token) {
            // Geen token: de relay zou ons toch weigeren. Socket dicht en de
            // gewone sluitpad regelt de herverbinding met backoff — geen tweede
            // "dood spoor" naast de bestaande reconnectlogica.
            console.warn(`[push] geen token voor ${email}`);
            sock.close();
            return;
          }
          sock.send(JSON.stringify({ type: 'auth', accessToken: token }));
          const armed = await deps.armWatch(email);
          if (!isLive(email, state, myGen)) return;
          if (!armed) {
            console.warn(`[push] watch mislukte voor ${email}; webview blijft melden`);
            sock.close(); // idem: laat de gewone sluitpad opnieuw proberen
            return;
          }
          state.attempt = 0;
          state.grace?.clear();
          state.grace = undefined;
          armStale(email, state, myGen);
          scheduleRenew(email, state, myGen);
          // Dekking vóór de catch-up: de meldingsregel meet vanaf dit moment, en
          // mail die daarvoor kwam heeft de webview al gemeld.
          setCovered(email, state, true);
          deps.onSync(email);
        } catch (e) {
          console.warn(`[push] handdruk mislukte voor ${email}:`, e);
          if (isLive(email, state, myGen)) sock.close();
        }
      })();
    });

    sock.onMessage((data) => {
      if (!isLive(email, state, myGen)) return;
      armStale(email, state, myGen);
      let msg: { type?: string };
      try {
        msg = JSON.parse(data) as { type?: string };
      } catch {
        return; // onleesbaar frame: negeren, niet omvallen
      }
      if (msg.type === 'sync') deps.onSync(email);
    });

    sock.onError((e) => console.warn(`[push] socketfout voor ${email}:`, e));

    sock.onClose((code) => {
      state.stale?.clear();
      state.stale = undefined;
      state.renew?.clear();
      state.renew = undefined;
      // Niet meer de geldende poging — overtroffen, verwijderd door refresh(),
      // of de manager is gestopt. Dan is dit sluitgebeuren oud nieuws en mag
      // het geen dekking of herverbinding meer in beweging zetten.
      if (!isLive(email, state, myGen)) return;

      if (FATAL_CLOSE_CODES.includes(code)) {
        // Hier lost opnieuw proberen niets op. Dekking terug naar de webview en
        // de aanroeper laten weten waarom, zodat die om hertoestemming kan vragen.
        state.dead = true;
        setCovered(email, state, false);
        deps.onFatal?.(email, code);
        return;
      }

      // Een blip mag niets omschakelen; een storing van minuten wel, anders zit
      // je zonder meldingen te wachten op iets dat te laat komt.
      if (state.covered && !state.grace) {
        state.grace = setTimer(() => setCovered(email, state, false), graceMs);
      }
      state.reconnect = setTimer(() => connect(email), backoffMs(state.attempt++));
    });
  };

  const refresh = (): void => {
    if (stopped) return;
    const wanted = new Set(deps.accounts());
    for (const [email, state] of conns) {
      if (wanted.has(email)) continue;
      // Eerst uit de kaart, dán pas sluiten: het sluiten vuurt zelf een
      // close-event (net als een echte ws-verbinding), en dat event moet dit
      // account niet meer "in leven" aantreffen — anders herrijst een
      // verwijderd account via de gewone herverbindingslogica (isLive() kijkt
      // immers of conns.get(email) nog naar déze state verwijst).
      conns.delete(email);
      clearTimers(state);
      setCovered(email, state, false);
      state.sock?.close();
    }
    for (const email of wanted) if (!conns.has(email)) connect(email);
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
