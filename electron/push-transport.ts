import WebSocket from 'ws';

// De enige plek die `ws` kent. De manager erboven praat alleen met deze
// interface, en krijgt in tests een nep-transport — daarom staat hier niets meer
// dan het doorgeven van gebeurtenissen, en daarom heeft dit bestand geen test.
export interface PushSocket {
  send(data: string): void;
  close(): void;
  onOpen(cb: () => void): void;
  onMessage(cb: (data: string) => void): void;
  // De sluitcode is het verschil tussen "probeer opnieuw" en "dit gaat nooit
  // lukken": de relay gebruikt 4401/4403/4400 om te zeggen wat er mis was.
  onClose(cb: (code: number) => void): void;
  onError(cb: (e: unknown) => void): void;
}

export interface PushTransport {
  connect(url: string): PushSocket;
}

export const wsTransport: PushTransport = {
  connect(url) {
    const ws = new WebSocket(url);
    return {
      send: (data) => ws.send(data),
      close: () => ws.close(),
      onOpen: (cb) => ws.on('open', cb),
      onMessage: (cb) => ws.on('message', (d: WebSocket.RawData) => cb(d.toString())),
      onClose: (cb) => ws.on('close', (code: number) => cb(code)),
      onError: (cb) => ws.on('error', cb),
    };
  },
};
