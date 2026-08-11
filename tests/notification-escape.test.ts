// Everything that could still put a notification on the Windows shelf instead of in the
// app's own stack.
//
// There are two such escapes, and they are unrelated to each other. The first is
// Chromium's: the app's own window.Notification shim only exists in the page, so a
// notification raised from inside Gmail's service worker never passes through it and is
// drawn by the OS — which also makes it dead on click, because the click goes back to a
// handler that does nothing in this wrapper. Refusing the notifications permission for the
// Google session is what closes it. The second is the shim itself: a page that asks
// permission before it notifies must be told yes, or refusing the real permission would
// take Gmail's notifications with it and nothing would arrive at all.

import { describe, expect, it, vi } from 'vitest';
import { sessionPermissionAllowed } from '../electron/notification-policy';
import { createNotificationShim, patchNotificationPermissionQuery } from '../electron/preload';

describe('sessionPermissionAllowed', () => {
  it('refuses notifications, so nothing reaches the Windows shelf', () => {
    expect(sessionPermissionAllowed('notifications')).toBe(false);
  });

  it('leaves every other permission the app depends on alone', () => {
    for (const p of ['media', 'clipboard-read', 'clipboard-sanitized-write', 'fullscreen', 'geolocation']) {
      expect(sessionPermissionAllowed(p)).toBe(true);
    }
  });
});

describe('createNotificationShim', () => {
  function setup(allowed = true) {
    const shown: Array<{ title: string; options?: NotificationOptions }> = [];
    const closed: string[] = [];
    const Shim = createNotificationShim({
      allowed: () => allowed,
      show: (title, options) => {
        shown.push({ title, options });
        return () => closed.push(title);
      },
    });
    return { Shim, shown, closed };
  }

  it('answers "granted" whatever the browser thinks, so Gmail keeps notifying', () => {
    const { Shim } = setup();
    expect(Shim.permission).toBe('granted');
  });

  it('resolves requestPermission with granted without asking the browser', async () => {
    const { Shim } = setup();
    await expect(Shim.requestPermission()).resolves.toBe('granted');
  });

  it('relays a notification instead of raising one', () => {
    const { Shim, shown } = setup();
    new Shim('Luca Manuel', { body: 'sdfsdfsdfsdf' });
    expect(shown).toEqual([{ title: 'Luca Manuel', options: { body: 'sdfsdfsdfsdf' } }]);
  });

  it('relays nothing while the account is not allowed to notify', () => {
    const { Shim, shown } = setup(false);
    const n = new Shim('Luca Manuel', { body: 'x' });
    expect(shown).toEqual([]);
    // Gmail goes on using the object it was handed, so it must still answer.
    expect(() => {
      n.close();
      n.addEventListener('click', () => {});
      n.onclick = null;
    }).not.toThrow();
  });

  it('releases what the raise pinned when the page closes the notification', () => {
    const { Shim, closed } = setup();
    const n = new Shim('Luca Manuel', { body: 'x' });
    n.close();
    expect(closed).toEqual(['Luca Manuel']);
  });

  it('survives a page that closes the same notification twice', () => {
    const { Shim, closed } = setup();
    const n = new Shim('t');
    n.close();
    n.close();
    expect(closed).toEqual(['t']);
  });

  it('hands back an object with the members Gmail uses', () => {
    const { Shim } = setup();
    const n = new Shim('t');
    expect(n.onclick).toBeNull();
    expect(typeof n.close).toBe('function');
    expect(typeof n.addEventListener).toBe('function');
    expect(() => n.addEventListener('click', vi.fn())).not.toThrow();
  });
});

describe('patchNotificationPermissionQuery', () => {
  function permissions(state: PermissionState = 'denied') {
    const asked: string[] = [];
    return {
      asked,
      api: {
        query: async (d: { name: string }) => {
          asked.push(d.name);
          return { name: d.name, state, onchange: null };
        },
      },
    };
  }

  it('answers granted for notifications without asking the browser', async () => {
    const { api, asked } = permissions('denied');
    patchNotificationPermissionQuery(api);
    const status = (await api.query({ name: 'notifications' })) as PermissionStatus;
    expect(status.state).toBe('granted');
    expect(asked).toEqual([]);
  });

  it('gives a page that subscribes to changes something to subscribe to', async () => {
    const { api } = permissions();
    patchNotificationPermissionQuery(api);
    const status = (await api.query({ name: 'notifications' })) as PermissionStatus;
    expect(() => status.addEventListener('change', () => {})).not.toThrow();
    expect(status.onchange).toBeNull();
  });

  it('leaves every other permission to the browser', async () => {
    const { api, asked } = permissions('prompt');
    patchNotificationPermissionQuery(api);
    const status = (await api.query({ name: 'geolocation' })) as PermissionStatus;
    expect(status.state).toBe('prompt');
    expect(asked).toEqual(['geolocation']);
  });

  it('is a no-op where there is no permissions API', () => {
    expect(() => patchNotificationPermissionQuery(undefined)).not.toThrow();
    expect(() => patchNotificationPermissionQuery({})).not.toThrow();
  });
});

describe('the shim object Gmail is handed', () => {
  function setup(allowed = true) {
    const Shim = createNotificationShim({ allowed: () => allowed, show: () => undefined });
    return { Shim };
  }

  it('answers to what Gmail uses', () => {
    const { Shim } = setup();
    const n = new Shim('t');
    expect(n.onclick).toBeNull();
    expect(typeof n.close).toBe('function');
    expect(typeof n.addEventListener).toBe('function');
    expect(() => n.addEventListener('click', vi.fn())).not.toThrow();
  });
});
