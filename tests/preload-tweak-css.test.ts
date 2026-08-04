// Applying the Gmail tweak stylesheet to a document.

import { describe, it, expect } from 'vitest';
import { applyTweakCss, TWEAK_STYLE_ID, type TweakStyleHost } from '../electron/preload';

function fakeDoc(opts?: { noHead?: boolean }) {
  const nodes = new Map<string, { id: string; textContent: string | null; remove(): void }>();
  const appended: unknown[] = [];
  const doc: TweakStyleHost & { nodes: typeof nodes; appended: unknown[] } = {
    nodes,
    appended,
    getElementById: (id) => nodes.get(id) ?? null,
    createElement: () => {
      const el = {
        id: '',
        textContent: null as string | null,
        remove() {
          nodes.delete(el.id);
        },
      };
      return el;
    },
    head: opts?.noHead
      ? null
      : {
          appendChild: (el: unknown) => {
            appended.push(el);
            const e = el as { id: string; textContent: string | null; remove(): void };
            nodes.set(e.id, e);
          },
        },
  };
  return doc;
}

describe('applyTweakCss', () => {
  it('puts the css in a style element with a recognisable id', () => {
    const doc = fakeDoc();
    applyTweakCss(doc, 'a{display:none}');
    const el = doc.getElementById(TWEAK_STYLE_ID);
    expect(el?.textContent).toBe('a{display:none}');
    expect(doc.appended).toHaveLength(1);
  });

  it('updates the same element instead of adding another one', () => {
    const doc = fakeDoc();
    applyTweakCss(doc, 'a{display:none}');
    applyTweakCss(doc, 'b{display:none}');
    expect(doc.appended).toHaveLength(1);
    expect(doc.getElementById(TWEAK_STYLE_ID)?.textContent).toBe('b{display:none}');
  });

  it('removes the element when the css is empty', () => {
    const doc = fakeDoc();
    applyTweakCss(doc, 'a{display:none}');
    applyTweakCss(doc, '');
    expect(doc.getElementById(TWEAK_STYLE_ID)).toBeNull();
  });

  it('does nothing at all when there was never anything to remove', () => {
    const doc = fakeDoc();
    expect(() => applyTweakCss(doc, '')).not.toThrow();
    expect(doc.appended).toHaveLength(0);
  });

  it('waits instead of throwing when there is no head yet', () => {
    const doc = fakeDoc({ noHead: true });
    expect(() => applyTweakCss(doc, 'a{display:none}')).not.toThrow();
    expect(doc.getElementById(TWEAK_STYLE_ID)).toBeNull();
  });
});
