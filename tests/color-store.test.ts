// The per-account colour store on disk.

import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ColorStore } from '../electron/accounts/color-store';

function newStore() {
  const dir = mkdtempSync(join(tmpdir(), 'colors-'));
  return new ColorStore(join(dir, 'colors.json'));
}

describe('ColorStore', () => {
  let store: ColorStore;
  beforeEach(() => {
    store = newStore();
  });
  it('returns undefined for an unknown email', () => {
    expect(store.get('a@x.com')).toBeUndefined();
  });
  it('persists a color across instances', () => {
    store.set('a@x.com', '#EA4335');
    const reopened = new ColorStore((store as unknown as { filePath: string }).filePath);
    expect(reopened.get('a@x.com')).toBe('#EA4335');
  });
  // The address arrives from a profile, from an IPC message and a settings row, and those
  // do not agree on case or surrounding spaces.
  it('recognises an address whatever case and spacing it is asked in', () => {
    store.set('Ana@Example.com ', '#EA4335');
    expect(store.get('ana@example.com')).toBe('#EA4335');
  });
  it('finds a colour saved under a mixed-case key before normalisation existed', () => {
    const dir = mkdtempSync(join(tmpdir(), 'colors-'));
    const fp = join(dir, 'colors.json');
    writeFileSync(fp, JSON.stringify({ 'Ana@Example.com': '#4285F4' }), 'utf8');
    const s = new ColorStore(fp);
    expect(s.get('ana@example.com')).toBe('#4285F4');
  });
  it('tolerates a corrupt or non-object file (returns undefined, then can still write)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'colors-'));
    const fp = join(dir, 'colors.json');
    writeFileSync(fp, '[1,2,3]', 'utf8');
    const s = new ColorStore(fp);
    expect(s.get('a@x.com')).toBeUndefined();
    s.set('a@x.com', '#000');
    expect(new ColorStore(fp).get('a@x.com')).toBe('#000');
  });
});
