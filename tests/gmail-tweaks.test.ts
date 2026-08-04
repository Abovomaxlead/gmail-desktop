import { describe, it, expect } from 'vitest';
import {
  GMAIL_TWEAK_RULES,
  gmailTweakCss,
  type GmailCssPrefs,
  type GmailHideFlag,
} from '../electron/gmail-tweaks';

// De vier voorkeuren die deze module kent, in de volgorde van de tabel. Staan hier
// letterlijk en niet afgeleid uit `GMAIL_TWEAK_RULES`: een test die zijn verwachting
// uit het onderwerp haalt kan niet zien dat er een regel verdwenen is.
const FLAGS: readonly GmailHideFlag[] = [
  'hideLogo',
  'hideOutOfOfficeBanner',
  'hideUpgradeButton',
  'hideInboxFooter',
];

const ALL_OFF: GmailCssPrefs = {
  hideLogo: false,
  hideOutOfOfficeBanner: false,
  hideUpgradeButton: false,
  hideInboxFooter: false,
};

function only(flag: GmailHideFlag): GmailCssPrefs {
  return { ...ALL_OFF, [flag]: true };
}

const ALL_ON: GmailCssPrefs = {
  hideLogo: true,
  hideOutOfOfficeBanner: true,
  hideUpgradeButton: true,
  hideInboxFooter: true,
};

describe('gmailTweakCss', () => {
  // De standaardstand van elke nieuwe installatie. De lege string is hier niet een
  // toevallig resultaat maar een afspraak met de aanroeper: die slaat de injectie
  // erop over. Zou hier ooit een blok met alleen commentaar uitkomen, dan injecteert
  // de app in een pagina van Google terwijl de gebruiker om niets heeft gevraagd —
  // en dat is precies de belofte die deze tab niet mag breken.
  it('geeft een lege tekst als geen enkele stand aan staat', () => {
    expect(gmailTweakCss(ALL_OFF)).toBe('');
  });

  // Per stand apart, want een tabel is stil: een regel die per ongeluk aan de
  // verkeerde voorkeur hangt (kopieerfout bij het toevoegen van de vierde) levert
  // nog steeds geldige CSS op die alleen het verkeerde verbergt. Dit is de enige
  // test die dat vangt.
  describe('elke stand levert precies zijn eigen regel', () => {
    for (const flag of FLAGS) {
      it(`${flag} verbergt alleen wat bij ${flag} hoort`, () => {
        const css = gmailTweakCss(only(flag));
        expect(css).toContain(`/* ${flag} */`);
        for (const other of FLAGS) {
          if (other !== flag) expect(css).not.toContain(`/* ${other} */`);
        }
        // Eén stand aan is één blok. Op de accolades tellen en niet op het
        // commentaar: het commentaar is een hulpje voor de ontwikkelaarstools, de
        // accolade is de CSS.
        expect(css.split('{')).toHaveLength(2);
      });
    }
  });

  it('levert alle vier de regels als alles aan staat', () => {
    const css = gmailTweakCss(ALL_ON);
    for (const flag of FLAGS) expect(css).toContain(`/* ${flag} */`);
    expect(css.split('{')).toHaveLength(FLAGS.length + 1);
  });

  // Deze tekst gaat rechtstreeks als stylesheet de pagina in. Er zit geen parser
  // tussen die klaagt, dus een blok dat halverwege afbreekt levert geen foutmelding
  // op maar een regel die stil niets doet — en dan is het zoeken in de verkeerde
  // hoek. Hier wordt niet de hele CSS-grammatica nagerekend, alleen datgene wat een
  // opbouwfout in deze functie zou opleveren: net zoveel openende als sluitende
  // accolades, en eindigen op een gesloten blok.
  it('levert opbouwkundig hele CSS', () => {
    const css = gmailTweakCss(ALL_ON);
    const open = css.split('{').length - 1;
    const close = css.split('}').length - 1;
    expect(open).toBe(close);
    expect(css.trimEnd().endsWith('}')).toBe(true);
    // Geen leeg blok: een selectorlijst die per ongeluk leeg blijft zou `{ … }`
    // zonder iets ervoor opleveren, en dat maakt de hele stylesheet ongeldig vanaf
    // dat punt.
    expect(css).not.toMatch(/(^|\n)\s*\{/);
  });

  // `!important` moet hier één keer per declaratie staan (Gmail zet zijn eigen
  // `display` met hoge specificiteit, soms inline). Twee keer in dezelfde declaratie
  // is geen fout die de browser meldt — hij negeert de tweede — maar wel het teken
  // dat er tekst is samengevoegd die niet samengevoegd had moeten worden.
  it('gebruikt !important hoogstens één keer per declaratie', () => {
    const css = gmailTweakCss(ALL_ON);
    for (const body of css.match(/\{[^}]*\}/g) ?? []) {
      for (const declaration of body.slice(1, -1).split(';')) {
        expect(declaration.split('!important')).toHaveLength(
          declaration.includes('!important') ? 2 : 1,
        );
      }
    }
  });
});

describe('GMAIL_TWEAK_RULES', () => {
  // De tabel is de reden dat deze module bestaat: één plek om bij te werken als
  // Google iets omgooit. Twee regels voor dezelfde voorkeur, of een voorkeur zonder
  // regel, maakt die belofte kapot — en een ontbrekende regel is een schakelaar in
  // de instellingen die niets doet.
  it('heeft precies één regel per voorkeur, in de volgorde van de tab', () => {
    expect(GMAIL_TWEAK_RULES.map((r) => r.pref)).toEqual(FLAGS);
  });

  it('heeft voor elke regel minstens één selector en een declaratie', () => {
    for (const rule of GMAIL_TWEAK_RULES) {
      expect(rule.selectors.length).toBeGreaterThan(0);
      for (const selector of rule.selectors) expect(selector.trim()).not.toBe('');
      expect(rule.declarations.trim().endsWith(';')).toBe(true);
    }
  });

  // De gevaarlijkste fout die in dit bestand te maken is. `div:has(a[href="…"])`
  // matcht élke voorouder van die link — tot en met de buitenste `div` van de
  // pagina — en `display: none` daarop maakt Gmail leeg. Met een directe-kind-eis
  // (`:has(> …)`) kan de match niet omhoog klimmen. Wie hier een selector toevoegt
  // en de `>` vergeet, verbergt niet een balkje maar iemands postvak.
  it('gebruikt geen :has() die naar boven kan klimmen', () => {
    for (const rule of GMAIL_TWEAK_RULES) {
      for (const selector of rule.selectors) {
        if (!selector.includes(':has(')) continue;
        for (const part of selector.split(':has(').slice(1)) {
          expect(part.trimStart().startsWith('>')).toBe(true);
        }
      }
    }
  });

  // Versleutelde Google-klassen (`.aeH`, `.gb_Rc`) mogen, maar nooit als enige haak:
  // ze houden het gemiddeld één ontwerpronde uit. Staat er een regel die alléén
  // daarop leunt, dan is de instelling vanaf de volgende Gmail-update stuk zonder dat
  // iemand het merkt.
  it('leunt voor geen enkele regel alleen op versleutelde klassenamen', () => {
    const obfuscated = /^\.[a-z]{2,3}[A-Z0-9_]/;
    for (const rule of GMAIL_TWEAK_RULES) {
      const stable = rule.selectors.filter((s) => !obfuscated.test(s.trim()));
      expect(stable.length).toBeGreaterThan(0);
    }
  });
});
