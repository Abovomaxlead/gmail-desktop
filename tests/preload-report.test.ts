// Computing the unread count in the page and reporting it to main.

import { describe, it, expect, vi } from 'vitest';
import { computeAndReport } from '../electron/preload';
import { IPC } from '../electron/core/ipc';

describe('computeAndReport', () => {
  it('sends the parsed unread count on the UNREAD_UPDATE channel', () => {
    const send = vi.fn();
    computeAndReport({ title: 'Inbox (7) - a@b.com - Gmail', hash: '#inbox' }, send);
    expect(send).toHaveBeenCalledWith(IPC.UNREAD_UPDATE, 7);
  });
  it('sends 0 when there is no count', () => {
    const send = vi.fn();
    computeAndReport({ title: 'Inbox - a@b.com - Gmail', hash: '#inbox' }, send);
    expect(send).toHaveBeenCalledWith(IPC.UNREAD_UPDATE, 0);
  });
  it('reads the hash Gmail starts on as the inbox', () => {
    const send = vi.fn();
    computeAndReport({ title: 'Inbox (7) - a@b.com - Gmail', hash: '' }, send);
    expect(send).toHaveBeenCalledWith(IPC.UNREAD_UPDATE, 7);
  });

  // The count in the title belongs to the view on screen, and only the inbox's is the one
  // the badge stands for. Saying nothing leaves the last inbox count in place.
  it('says nothing while a label is open, so its count cannot become the badge', () => {
    const send = vi.fn();
    computeAndReport({ title: 'Facturen (40) - a@b.com - Gmail', hash: '#label/Facturen' }, send);
    expect(send).not.toHaveBeenCalled();
  });
  it('says nothing while a conversation is open, which would otherwise report 0', () => {
    const send = vi.fn();
    computeAndReport({ title: 'Offerte - a@b.com - Gmail', hash: '#inbox/18ff4d23f6' }, send);
    expect(send).not.toHaveBeenCalled();
  });
  it('says nothing for sent or search, which count nothing the badge is about', () => {
    const send = vi.fn();
    computeAndReport({ title: 'Verzonden - a@b.com - Gmail', hash: '#sent' }, send);
    computeAndReport({ title: 'Zoeken (3) - a@b.com - Gmail', hash: '#search/factuur' }, send);
    expect(send).not.toHaveBeenCalled();
  });
});
