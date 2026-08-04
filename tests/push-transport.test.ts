// adaptSocket decides which ws event means the connection is still alive; the relay's
// heartbeat is a protocol ping, which once arrived nowhere.

import { describe, it, expect } from 'vitest';
import { EventEmitter } from 'node:events';
import { adaptSocket } from '../electron/push-transport';

class FakeWs extends EventEmitter {
  sent: string[] = [];
  closed = 0;
  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {
    this.closed++;
  }
}

describe('adaptSocket', () => {
  it('reports a protocol ping as a sign of life', () => {
    const ws = new FakeWs();
    let pings = 0;
    adaptSocket(ws).onPing(() => pings++);
    ws.emit('ping', Buffer.alloc(0));
    expect(pings).toBe(1);
  });

  it('reports a pong the same way: same signal, and it costs nothing', () => {
    const ws = new FakeWs();
    let pings = 0;
    adaptSocket(ws).onPing(() => pings++);
    ws.emit('pong', Buffer.alloc(0));
    expect(pings).toBe(1);
  });

  it('does not pass a ping off as a message', () => {
    const ws = new FakeWs();
    const messages: string[] = [];
    const sock = adaptSocket(ws);
    sock.onMessage((d) => messages.push(d));
    sock.onPing(() => undefined);
    ws.emit('ping', Buffer.alloc(0));
    expect(messages).toEqual([]);
  });

  it('hands a message over as text, whatever ws delivered it as', () => {
    const ws = new FakeWs();
    const messages: string[] = [];
    adaptSocket(ws).onMessage((d) => messages.push(d));
    ws.emit('message', Buffer.from('{"type":"sync"}'));
    expect(messages).toEqual(['{"type":"sync"}']);
  });

  it('passes the close code through, since that decides retry or give up', () => {
    const ws = new FakeWs();
    const codes: number[] = [];
    adaptSocket(ws).onClose((c) => codes.push(c));
    ws.emit('close', 4401, Buffer.alloc(0));
    expect(codes).toEqual([4401]);
  });

  it('forwards open and error', () => {
    const ws = new FakeWs();
    let opened = 0;
    const errors: unknown[] = [];
    const sock = adaptSocket(ws);
    sock.onOpen(() => opened++);
    sock.onError((e) => errors.push(e));
    ws.emit('open');
    ws.emit('error', new Error('boem'));
    expect(opened).toBe(1);
    expect(errors).toHaveLength(1);
  });

  it('sends and closes on the socket it was given', () => {
    const ws = new FakeWs();
    const sock = adaptSocket(ws);
    sock.send('hallo');
    sock.close();
    expect(ws.sent).toEqual(['hallo']);
    expect(ws.closed).toBe(1);
  });
});
