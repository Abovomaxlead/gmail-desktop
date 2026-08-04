import { describe, it, expect } from 'vitest';
import { applyTweakCss, TWEAK_STYLE_ID, type TweakStyleHost } from '../electron/preload';

// Een nagemaakt document met precies wat `applyTweakCss` aanraakt. De echte preload
// draait in Gmail's pagina; deze tests draaien in Node, en daarom neemt de functie
// het document als argument in plaats van naar het globale te grijpen.
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

  // Dit is de bug die de functie voorkomt: Gmail is één pagina die nooit herlaadt,
  // dus bij elke omgezette schakelaar zou er anders een `<style>` bijkomen en zouden
  // de oude regels blijven gelden. Wie zijn logo weer zichtbaar maakte, zou het niet
  // terugzien.
  it('updates the same element instead of adding another one', () => {
    const doc = fakeDoc();
    applyTweakCss(doc, 'a{display:none}');
    applyTweakCss(doc, 'b{display:none}');
    expect(doc.appended).toHaveLength(1);
    expect(doc.getElementById(TWEAK_STYLE_ID)?.textContent).toBe('b{display:none}');
  });

  // "Niets aangepast" hoort ook in de DOM niets te zijn: een leeg omhulsel maakt bij
  // het opsporen van een probleem onduidelijk of de app iets deed.
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

  // Komt de opmaak binnen voordat `<head>` bestaat, dan mag dat geen fout geven: de
  // preload zet hem bij DOMContentLoaded alsnog.
  it('waits instead of throwing when there is no head yet', () => {
    const doc = fakeDoc({ noHead: true });
    expect(() => applyTweakCss(doc, 'a{display:none}')).not.toThrow();
    expect(doc.getElementById(TWEAK_STYLE_ID)).toBeNull();
  });
});
