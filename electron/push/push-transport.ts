// The only module that knows the ws library.
//
// The relay's heartbeat is a protocol ping and never a 'message', so both feed onPing — or
// the manager drops a healthy connection after 90 quiet seconds. Close codes pass through,
// since 4400/4401/4403 separate "retry" from "this will never work".
import WebSocket from 'ws';



//===========================
// Types
//===========================

export interface PushSocket {
  send(data: string): void;
  close(): void;
  onOpen(cb: () => void): void;
  onMessage(cb: (data: string) => void): void;
  onPing(cb: () => void): void;
  onClose(cb: (code: number) => void): void;
  onError(cb: (e: unknown) => void): void;
}

export interface PushTransport {
  connect(url: string): PushSocket;
}

export interface WsLike {
  send(data: string): void;
  close(): void;
  on(event: 'open' | 'ping' | 'pong', listener: () => void): unknown;
  on(event: 'message', listener: (data: { toString(): string }) => void): unknown;
  on(event: 'close', listener: (code: number) => void): unknown;
  on(event: 'error', listener: (err: unknown) => void): unknown;
}


//===========================
// Exported functions
//===========================

/**
 * Maps a ws socket onto the interface the manager works against
 *
 * @param ws
 * @returns the adapted socket; ping and pong both feed onPing
 */
export function adaptSocket(ws: WsLike): PushSocket {
  return {
    send: (data) => ws.send(data),
    close: () => ws.close(),
    onOpen: (cb) => void ws.on('open', cb),
    onMessage: (cb) => void ws.on('message', (d) => cb(d.toString())),
    onPing: (cb) => {
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
