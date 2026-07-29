import { describe, it, expect } from 'vitest';
import {
  planContextMenu,
  searchMenuLabel,
  googleSearchUrl,
  LABELS_NORMAL,
  LABELS_RENE,
  type ContextMenuInput,
  type PlannedItem,
} from '../electron/context-menu';

const ALL_FLAGS = {
  canUndo: true,
  canRedo: true,
  canCut: true,
  canCopy: true,
  canPaste: true,
  canSelectAll: true,
};

function input(over: Partial<ContextMenuInput> = {}): ContextMenuInput {
  return {
    isEditable: false,
    selectionText: '',
    linkURL: '',
    mediaType: 'none',
    srcURL: '',
    editFlags: { ...ALL_FLAGS },
    ...over,
  };
}

const ids = (plan: PlannedItem[]): string[] =>
  plan.map((i) => (i.kind === 'separator' ? '-' : i.id));

const enabledOf = (plan: PlannedItem[], id: string): boolean | undefined =>
  plan.find((i): i is Extract<PlannedItem, { kind: 'action' }> => i.kind === 'action' && i.id === id)
    ?.enabled;

describe('planContextMenu', () => {
  it('offers nothing when nothing actionable was clicked', () => {
    expect(planContextMenu(input())).toEqual([]);
  });

  it('offers copy, google search and select all for a selection', () => {
    const plan = planContextMenu(input({ selectionText: 'een' }));
    expect(ids(plan)).toEqual(['copy', 'searchGoogle', '-', 'selectAll']);
  });

  it('ignores a whitespace-only selection', () => {
    expect(planContextMenu(input({ selectionText: '  \n ' }))).toEqual([]);
  });

  it('greys out copy when Chromium says it is unavailable', () => {
    const plan = planContextMenu(
      input({ selectionText: 'een', editFlags: { ...ALL_FLAGS, canCopy: false } }),
    );
    expect(enabledOf(plan, 'copy')).toBe(false);
  });

  it('gives an editable field the full edit menu', () => {
    const plan = planContextMenu(input({ isEditable: true }));
    expect(ids(plan)).toEqual([
      'undo',
      'redo',
      '-',
      'cut',
      'copy',
      'paste',
      'pasteMatchStyle',
      '-',
      'selectAll',
    ]);
  });

  it('greys out edit items the field cannot do', () => {
    const plan = planContextMenu(
      input({
        isEditable: true,
        editFlags: { ...ALL_FLAGS, canUndo: false, canRedo: false, canPaste: false },
      }),
    );
    expect(enabledOf(plan, 'undo')).toBe(false);
    expect(enabledOf(plan, 'redo')).toBe(false);
    expect(enabledOf(plan, 'paste')).toBe(false);
    expect(enabledOf(plan, 'pasteMatchStyle')).toBe(false);
    expect(enabledOf(plan, 'cut')).toBe(true);
  });

  it('keeps the edit menu for an editable field even when a link is under the cursor', () => {
    const plan = planContextMenu(input({ isEditable: true, linkURL: 'https://example.com' }));
    expect(ids(plan)).not.toContain('copyLink');
  });

  it('offers link actions for a link', () => {
    const plan = planContextMenu(input({ linkURL: 'https://example.com' }));
    expect(ids(plan)).toEqual(['copyLink', 'openLink', '-', 'selectAll']);
  });

  it('separates selection actions from link actions', () => {
    const plan = planContextMenu(input({ selectionText: 'een', linkURL: 'https://example.com' }));
    expect(ids(plan)).toEqual([
      'copy',
      'searchGoogle',
      '-',
      'copyLink',
      'openLink',
      '-',
      'selectAll',
    ]);
  });

  it('offers image actions for an image', () => {
    const plan = planContextMenu(input({ mediaType: 'image', srcURL: 'https://x/y.png' }));
    expect(ids(plan)).toEqual(['copyImage', 'copyImageAddress', '-', 'selectAll']);
  });

  it('skips image actions when the image has no source url', () => {
    expect(planContextMenu(input({ mediaType: 'image', srcURL: '' }))).toEqual([]);
  });

  it('never ends a plan on a separator', () => {
    const cases = [
      input({ selectionText: 'een' }),
      input({ isEditable: true }),
      input({ linkURL: 'https://example.com' }),
      input({ mediaType: 'image', srcURL: 'https://x/y.png' }),
    ];
    for (const c of cases) {
      const plan = planContextMenu(c);
      expect(plan[plan.length - 1]!.kind).toBe('action');
    }
  });
});

describe('searchMenuLabel', () => {
  it('inserts the selection into the template', () => {
    expect(searchMenuLabel('een', LABELS_NORMAL.searchGoogle)).toBe('Search Google for “een”');
  });

  it('collapses whitespace to keep the label on one line', () => {
    expect(searchMenuLabel('  een\n  twee ', LABELS_NORMAL.searchGoogle)).toBe(
      'Search Google for “een twee”',
    );
  });

  it('truncates a long selection', () => {
    const label = searchMenuLabel('a'.repeat(80), LABELS_NORMAL.searchGoogle);
    expect(label).toBe(`Search Google for “${'a'.repeat(25)}…”`);
  });

  it('works with the Rene template', () => {
    expect(searchMenuLabel('een', LABELS_RENE.searchGoogle)).toBe('Zoek “een” op Google');
  });
});

describe('googleSearchUrl', () => {
  it('percent-encodes the trimmed selection', () => {
    expect(googleSearchUrl('  een & twee ')).toBe('https://www.google.com/search?q=een%20%26%20twee');
  });
});

describe('label sets', () => {
  it('cover the same action ids', () => {
    expect(Object.keys(LABELS_RENE).sort()).toEqual(Object.keys(LABELS_NORMAL).sort());
  });
});
