// The payload of an overlay must reach the page even when the page starts listening after it
// finished loading. That is the order a busy machine produces: did-finish-load fires, React has
// not hydrated yet, and a message sent then is dropped -- leaving a transparent view over Gmail
// that swallows every click.
import { describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';


//===========================
// Fakes
//===========================

class FakeWebContents extends EventEmitter {
  ipc = new EventEmitter();
  sent: Array<{ channel: string; payload: unknown }> = [];
  send(channel: string, payload: unknown): void {
    this.sent.push({ channel, payload });
  }
  loadURL(): Promise<void> {
    return Promise.resolve();
  }
  focus(): void {}
  isDestroyed(): boolean {
    return false;
  }
}

class FakeWebContentsView {
  webContents = new FakeWebContents();
  static last: FakeWebContentsView | null = null;
  constructor() {
    FakeWebContentsView.last = this;
  }
  setBackgroundColor(): void {}
  setVisible(): void {}
  setBounds(): void {}
}

vi.mock('electron', () => ({ WebContentsView: FakeWebContentsView }));

const { OverlayView } = await import('../electron/windows/overlay-view');
const { IPC } = await import('../electron/core/ipc');

function fakeWin() {
  return {
    isDestroyed: () => false,
    on: () => {},
    webContents: { getZoomFactor: () => 1 },
    contentView: { addChildView: vi.fn(), removeChildView: vi.fn() },
    getContentSize: () => [1024, 768],
  };
}

function openOverlay() {
  const overlay = new OverlayView(fakeWin() as never, 'preload.js', 'app://bundle/x.html', 'x:ask');
  overlay.open({ n: 1 });
  return { overlay, wc: FakeWebContentsView.last!.webContents };
}


//===========================
// Tests
//===========================

describe('OverlayView delivery', () => {
  it('holds the payload until the page says it is listening, not until it loaded', () => {
    const { wc } = openOverlay();
    wc.emit('did-finish-load');
    expect(wc.sent).toEqual([]);

    wc.ipc.emit(IPC.OVERLAY_READY, {});
    expect(wc.sent).toEqual([{ channel: 'x:ask', payload: { n: 1 } }]);
  });

  it('sends straight away once the page is listening', () => {
    const { overlay, wc } = openOverlay();
    wc.ipc.emit(IPC.OVERLAY_READY, {});
    overlay.update({ n: 2 });
    expect(wc.sent.map((s) => s.payload)).toEqual([{ n: 1 }, { n: 2 }]);
  });

  it('waits for the page again after it navigates away and back', () => {
    const { overlay, wc } = openOverlay();
    wc.ipc.emit(IPC.OVERLAY_READY, {});
    wc.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false });
    overlay.update({ n: 2 });
    expect(wc.sent.map((s) => s.payload)).toEqual([{ n: 1 }]);

    wc.ipc.emit(IPC.OVERLAY_READY, {});
    expect(wc.sent.map((s) => s.payload)).toEqual([{ n: 1 }, { n: 2 }]);
  });
});
