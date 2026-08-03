import WebSocket from 'ws';

// De enige plek die `ws` kent. De manager erboven praat alleen met deze
// interface en krijgt in tests een nep-transport.
//
// Wat hier gebeurt is méér dan doorgeven: dit bestand beslist welke
// ws-gebeurtenis "de verbinding leeft nog" betekent. Die beslissing is één keer
// fout gegaan — de hartslag van de relay is een protocol-ping (`ws.ping()`) en
// die komt bij `ws` binnen als een `'ping'`-gebeurtenis, nooit als
// `'message'`. Zonder die draad zag de manager op een stil postvak 90 seconden
// niets en brak hij een gezonde verbinding elke minuut-en-een-half af. Daarom is
// het afbeelden van gebeurtenissen losgetrokken in `adaptSocket` en wél getest.
export interface PushSocket {
  send(data: string): void;
  close(): void;
  onOpen(cb: () => void): void;
  onMessage(cb: (data: string) => void): void;
  // De hartslag. De relay stuurt elke 30 seconden een ping en verwacht daar
  // alleen een pong op (die stuurt `ws` zelf). Er zit geen inhoud in, het enige
  // dat hij zegt is "ik ben er nog" — en dat is precies wat de staleness-timer
  // van de manager moet weten. Een pong telt net zo goed: zelfde signaal.
  onPing(cb: () => void): void;
  // De sluitcode is het verschil tussen "probeer opnieuw" en "dit gaat nooit
  // lukken": de relay gebruikt 4401/4403/4400 om te zeggen wat er mis was.
  onClose(cb: (code: number) => void): void;
  onError(cb: (e: unknown) => void): void;
}

export interface PushTransport {
  connect(url: string): PushSocket;
}

// Het stukje `ws` dat we gebruiken, apart benoemd zodat `adaptSocket` met een
// gewone EventEmitter te testen is zonder een echte server of socket.
export interface WsLike {
  send(data: string): void;
  close(): void;
  on(event: 'open' | 'ping' | 'pong', listener: () => void): unknown;
  on(event: 'message', listener: (data: { toString(): string }) => void): unknown;
  on(event: 'close', listener: (code: number) => void): unknown;
  on(event: 'error', listener: (err: unknown) => void): unknown;
}

export function adaptSocket(ws: WsLike): PushSocket {
  return {
    send: (data) => ws.send(data),
    close: () => ws.close(),
    onOpen: (cb) => void ws.on('open', cb),
    onMessage: (cb) => void ws.on('message', (d) => cb(d.toString())),
    onPing: (cb) => {
      // Beide: `ws` levert de ping van de relay af als 'ping' en antwoordt zelf
      // met een pong. Zou de relay het ooit omdraaien, dan is dat hetzelfde
      // signaal en hoeft hier niets te veranderen.
      ws.on('ping', () => cb());
      ws.on('pong', () => cb());
    },
    onClose: (cb) => void ws.on('close', (code) => cb(code)),
    onError: (cb) => void ws.on('error', (e) => cb(e)),
  };
}

export const wsTransport: PushTransport = {
  connect(url) {
    return adaptSocket(new WebSocket(url));
  },
};
