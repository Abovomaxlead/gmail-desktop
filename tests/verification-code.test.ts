// Finding a verification code in a mail. This is the net under the app's only
// irreversible setting - delete the mail once the code is copied - so every case here
// is a mail that would otherwise be binned or a code that would be missed.

import { describe, it, expect } from 'vitest';
import { findVerificationCode, subjectSuggestsCode } from '../electron/gmail/verification-code';

const high = (subject: string, body = ''): string | null =>
  findVerificationCode({ subject, body }, 'high');
const medium = (subject: string, body = ''): string | null =>
  findVerificationCode({ subject, body }, 'medium');

const both = (subject: string, body = ''): [string | null, string | null] => [
  high(subject, body),
  medium(subject, body),
];
const NOTHING: [null, null] = [null, null];

describe('findVerificationCode — mail as it actually arrives', () => {
  it("finds Google's code, with the keyword in the subject", () => {
    expect(high('Uw Google-verificatiecode', 'Gebruik 483920 om je aan te melden.')).toBe('483920');
  });

  it('finds the code with the dash that Google inserts itself', () => {
    expect(high('Google', 'Your verification code is G-728916.')).toBe('728916');
  });

  it("finds GitHub's code, with the keyword in the body", () => {
    expect(high('[GitHub] Please verify your device', 'Verification code: 654321')).toBe('654321');
  });

  it('finds a four-digit code, like banks send', () => {
    expect(high('Beveiligingscode', 'Uw beveiligingscode is 5837.')).toBe('5837');
  });

  it('finds an eight-digit code', () => {
    expect(high('Bevestigingscode', 'Uw bevestigingscode is 40182937.')).toBe('40182937');
  });

  it('reads the Dutch keywords', () => {
    expect(high('Actie nodig', 'Uw eenmalige code is 748291.')).toBe('748291');
    expect(high('Actie nodig', 'Uw inlogcode is 33914.')).toBe('33914');
    expect(high('Actie nodig', 'Je verificatie code is 512907.')).toBe('512907');
  });

  it('reads the English keywords', () => {
    expect(high('Sign in', 'Your one-time password is 90210.')).toBe('90210');
    expect(high('Sign in', 'Your security code is 771044.')).toBe('771044');
    expect(high('Sign in', 'Your passcode is 8812.')).toBe('8812');
    expect(high('Sign in', 'Your OTP is 55219.')).toBe('55219');
    expect(high('Sign in', 'Two-factor code: 118822')).toBe('118822');
  });

  it('finds the code when it comes before the keyword', () => {
    expect(high('Aanmelden', '483920 is je verificatiecode voor Gmail Desktop.')).toBe('483920');
  });

  it('finds the code when it only appears in the subject', () => {
    expect(high('Je verificatiecode: 194837', 'Meld je aan om verder te gaan.')).toBe('194837');
  });

  it('finds the code in the subject while the keyword is far away in the body', () => {
    expect(
      high(
        'Actie vereist: 194837',
        'Er is iets aan de hand met je account en je moet even iets doen voordat je verder kan werken. Vul de verificatiecode in.',
      ),
    ).toBe('194837');
  });

  it('finds a code containing letters, but only in strict mode', () => {
    expect(high('Actie nodig', 'Your verification code is A3F9K2.')).toBe('A3F9K2');
    expect(medium('Actie nodig', 'Your verification code is A3F9K2.')).toBeNull();
  });

  it('lets the code in the mail win over a number in a link', () => {
    expect(high('Uw verificatiecode', 'Zie https://x.io/a?code=111222 of code 483920.')).toBe(
      '483920',
    );
  });
});

describe('what may never be read as a code', () => {
  it('a year', () => {
    expect(both('Nieuwsbrief', 'Copyright 2026 Onze Winkel')).toEqual(NOTHING);
    expect(both('Terugblik', '1999 was een goed jaar voor ons.')).toEqual(NOTHING);
  });

  it('a year, but only when the keyword sits right next to it', () => {
    expect(high('Aanmelden', 'Uw verificatiecode is 2024.')).toBe('2024');
  });

  it('an amount', () => {
    expect(both('Uw bestelling', 'Wij schrijven $1234 van uw kaart af.')).toEqual(NOTHING);
    expect(both('Uw bestelling', 'Dat is € 1234,50 samen.')).toEqual(NOTHING);
    expect(both('Uw bestelling', 'Dat is 1234 EUR samen.')).toEqual(NOTHING);
  });

  it('a phone number', () => {
    expect(both('Contact', 'Bel ons op +31 6 12345678 voor vragen.')).toEqual(NOTHING);
    expect(both('Contact', 'Ons nummer is 010-123 4567.')).toEqual(NOTHING);
    expect(both('Contact', 'Of bel (020) 1234567 tijdens kantooruren.')).toEqual(NOTHING);
  });

  it('a date', () => {
    expect(both('Afspraak', 'Op 12-03-2022 komen wij langs.')).toEqual(NOTHING);
    expect(both('Afspraak', 'Op 03/12/2022 komen wij langs.')).toEqual(NOTHING);
    expect(both('Afspraak', 'Gepland op 2022-03-12 in de ochtend.')).toEqual(NOTHING);
  });

  it('a time', () => {
    expect(both('Bezorging', 'De trein vertrekt om 14:30 vanaf spoor twee.')).toEqual(NOTHING);
    expect(both('Bezorging', 'Wij komen om 14:30:00 langs.')).toEqual(NOTHING);
  });

  it('a long digit sequence: an order, invoice, or customer number', () => {
    expect(both('Uw bestelling', 'Het nummer is 100238476512.')).toEqual(NOTHING);
  });

  it('a tracking number, including the letters attached to it', () => {
    expect(both('Uw verificatiecode volgt', 'Uw pakje 3SABCD1234567890 is onderweg.')).toEqual(
      NOTHING,
    );
    expect(both('Uw verificatiecode volgt', 'Overmaken naar NL91ABNA0417164300 graag.')).toEqual(
      NOTHING,
    );
  });

  it('a number in a link', () => {
    expect(
      both('Bevestig je account', 'Klik op https://example.com/verify?code=483920 om verder te gaan.'),
    ).toEqual(NOTHING);
  });

  it('a number in an email address', () => {
    expect(both('Contact', 'Mail naar info483920@example.com voor vragen.')).toEqual(NOTHING);
  });

  it('a color code or a hash-prefixed number', () => {
    expect(both('Huisstijl', 'De kleuren zijn #a3f9c2 en #123456.')).toEqual(NOTHING);
    expect(both('Uw bestelling', 'Order #483920 is verzonden.')).toEqual(NOTHING);
  });

  it('a number with separators in it', () => {
    expect(both('Voorraad', 'Er liggen nog 1.234 stuks en 1,234 kilo.')).toEqual(NOTHING);
    expect(both('Voorraad', 'Wij verstuurden 1 234 567 pakjes dit jaar.')).toEqual(NOTHING);
  });

  it('a percentage', () => {
    expect(both('Sneller', 'Tot 1234% sneller dan gisteren.')).toEqual(NOTHING);
  });

  it('a version number', () => {
    expect(both('Update', 'Versie 1.2.3 staat voor u klaar.')).toEqual(NOTHING);
  });

  it('a number attached to a filename or key', () => {
    expect(both('Bijlage', 'Zie bestand_483920_v2 in de map.')).toEqual(NOTHING);
  });

  it('a code in lowercase letters', () => {
    expect(both('Uw verificatiecode', 'De code is a3f9k2.')).toEqual(NOTHING);
  });

  it('a word without digits', () => {
    expect(both('Uw verificatiecode', 'De code is HALLOOO.')).toEqual(NOTHING);
  });

  it('a number followed by a unit', () => {
    expect(both('Uw verificatiecode', 'De bijlage is 1200MB groot.')).toEqual(NOTHING);
  });

  it('too short and too long', () => {
    expect(both('Uw verificatiecode', 'De code is 123.')).toEqual(NOTHING);
    expect(both('Uw verificatiecode', 'De code is 123456789.')).toEqual(NOTHING);
  });

  it('a number preceded by a disqualifying label, even with a keyword nearby', () => {
    expect(both('Uw verificatiecode', 'Trackingnummer 483920 hoort bij uw zending.')).toEqual(
      NOTHING,
    );
    expect(both('Uw verificatiecode', 'Factuurnummer 483920 is voldaan.')).toEqual(NOTHING);
    expect(both('Uw verificatiecode', 'Klantnummer 483920 hoort bij dit bericht.')).toEqual(NOTHING);
  });

  it('"one-time" without the word that belongs after it', () => {
    expect(high('One-time offer', 'Bestel nu en krijg 1234 punten cadeau.')).toBeNull();
  });
});

describe('medium versus high', () => {
  it('medium accepts an isolated digit group without a keyword, high does not', () => {
    expect(high('Aanmelden', 'Voer dit in om door te gaan: 483920')).toBeNull();
    expect(medium('Aanmelden', 'Voer dit in om door te gaan: 483920')).toBe('483920');
  });

  it('medium accepts a code on its own line, high does not', () => {
    const body = 'Beste Jan,\n\n583920\n\nMet vriendelijke groet';
    expect(high('Hallo', body)).toBeNull();
    expect(medium('Hallo', body)).toBe('583920');
  });

  it('medium accepts a code too far from the keyword, high does not', () => {
    const body =
      'Hallo, hier is een lange begroeting die verder niets zegt en alleen ruimte inneemt. 483920';
    expect(high('Uw verificatiecode', body)).toBeNull();
    expect(medium('Uw verificatiecode', body)).toBe('483920');
  });

  it('high accepts a code with letters, medium does not', () => {
    expect(high('Aanmelden', 'Uw verificatiecode is B7K2M9.')).toBe('B7K2M9');
    expect(medium('Aanmelden', 'Uw verificatiecode is B7K2M9.')).toBeNull();
  });
});

describe('HTML messages', () => {
  it('finds the code amid the markup', () => {
    const body =
      '<html><body><table width="1200" bgcolor="#f5f5f5"><tr>' +
      '<td style="font-size:12px;padding:1024px">Uw verificatiecode is <b>483920</b></td>' +
      '</tr></table></body></html>';
    expect(high('Uw code', body)).toBe('483920');
    expect(medium('Uw code', body)).toBe('483920');
  });

  it('reads nothing from a style or script block', () => {
    const body =
      '<html><head><style>.x{color:#a3f9c2;padding:483920px}</style>' +
      '<script>var t=147258;</script></head><body>Hallo daar</body></html>';
    expect(both('Hallo', body)).toEqual(NOTHING);
  });

  it('stitches back together a code split into pieces by markup', () => {
    expect(high('Uw code', '<p>Uw verificatiecode is <b>48</b><b>3920</b>.</p>')).toBe('483920');
  });

  it('decodes entities back', () => {
    expect(high('Uw code', 'Uw verificatiecode is&nbsp;483920.')).toBe('483920');
    expect(high('Uw code', '<p>Code &amp; wachtwoord: verificatiecode 483920</p>')).toBe('483920');
  });

  it('finds the code in a full mail with header, footer, and unsubscribe link', () => {
    const body =
      '<html><head><style>body{font-size:14px;color:#333333}</style></head><body>' +
      '<table width="1200" cellpadding="1024"><tr><td>' +
      '<h1>Bevestig je aanmelding</h1>' +
      '<p>Uw verificatiecode is <b>4839</b><b>20</b></p>' +
      '<p>De code is 10 minuten geldig.</p>' +
      '</td></tr><tr><td>' +
      '<p>Vragen? Bel 010-123 4567 of mail naar hulp2026@example.com.</p>' +
      '<p><a href="https://example.com/unsubscribe?id=998877665544">Afmelden</a></p>' +
      '<p>&copy; 2026 Onze Dienst B.V. &mdash; Postbus 1234, 1234 AB Amsterdam</p>' +
      '</td></tr></table></body></html>';
    expect(high('Bevestig je aanmelding', body)).toBe('483920');
  });

  it('finds nothing in a message that is only markup', () => {
    expect(both('Hallo', '<div><span></span></div><br><table><tr><td></td></tr></table>')).toEqual(
      NOTHING,
    );
  });
});

describe('emptiness and garbage', () => {
  it('returns null for an empty message', () => {
    expect(both('', '')).toEqual(NOTHING);
  });

  it('returns null for whitespace only', () => {
    expect(both('   ', '\n\n\t  \n')).toEqual(NOTHING);
  });

  it('returns null for garbage without digits', () => {
    expect(both('#### !!!! ????', '===== ***** -----')).toEqual(NOTHING);
  });

  it('returns null for a message without a subject', () => {
    expect(high('', 'Zomaar een berichtje zonder iets erin.')).toBeNull();
  });
});

describe('the same message gives the same answer', () => {
  it('returns the same code ten times for ten identical inputs', () => {
    const input = { subject: 'Uw verificatiecode', body: 'De code is 483920.' };
    const answers = new Set(Array.from({ length: 10 }, () => findVerificationCode(input, 'high')));
    expect([...answers]).toEqual(['483920']);
  });

  it('picks the strongest evidence, not the first number', () => {
    const body =
      '999888 stond in de mail van gisteren en die is niet meer geldig want hij is verlopen. ' +
      'Uw verificatiecode is 483920.';
    expect(medium('Aanmelden', body)).toBe('483920');
    expect(high('Aanmelden', body)).toBe('483920');
  });

  it('picks the first candidate when two are equally strong', () => {
    expect(high('Aanmelden', 'Uw verificatiecode is 483920, niet 111222.')).toBe('483920');
  });
});

describe('subjectSuggestsCode', () => {
  it('returns true for a subject with a keyword', () => {
    expect(subjectSuggestsCode('Uw verificatiecode')).toBe(true);
    expect(subjectSuggestsCode('Your security code')).toBe(true);
    expect(subjectSuggestsCode('Two-factor authentication')).toBe(true);
  });

  it('returns true for a weak hint', () => {
    expect(subjectSuggestsCode('[GitHub] Please verify your device')).toBe(true);
    expect(subjectSuggestsCode('Aanmelden bij je account')).toBe(true);
    expect(subjectSuggestsCode('Je code staat klaar')).toBe(true);
  });

  it('returns true for a code-shaped number in the subject', () => {
    expect(subjectSuggestsCode('483920')).toBe(true);
    expect(subjectSuggestsCode('Actie vereist: 194837')).toBe(true);
  });

  it('returns false for ordinary mail', () => {
    expect(subjectSuggestsCode('Uw factuur van maart')).toBe(false);
    expect(subjectSuggestsCode('Nieuwsbrief maart')).toBe(false);
    expect(subjectSuggestsCode('Bezorging vandaag tussen 14:00 en 16:00')).toBe(false);
    expect(subjectSuggestsCode('')).toBe(false);
    expect(subjectSuggestsCode('   ')).toBe(false);
  });

  it('returns false for a year as the only number', () => {
    expect(subjectSuggestsCode('Nieuwsbrief 2026')).toBe(false);
  });
});
