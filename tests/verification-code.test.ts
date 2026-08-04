import { describe, it, expect } from 'vitest';
import { findVerificationCode, subjectSuggestsCode } from '../electron/verification-code';

// Dit bestand is het vangnet onder de enige onomkeerbare instelling van de app:
// "gooi de mail weg nadat de code is gekopieerd". Elke test hieronder staat er
// omdat hij een mail beschrijft die anders in de prullenbak zou belanden of een
// code die anders gemist zou worden — in die volgorde van belang.
//
// De afwijzingen zijn daarom de kern en niet het bijwerk: bij elke afwijzing staat
// welke mail er weg zou zijn als hij zou slagen.

const high = (subject: string, body = ''): string | null =>
  findVerificationCode({ subject, body }, 'high');
const medium = (subject: string, body = ''): string | null =>
  findVerificationCode({ subject, body }, 'medium');

// Een afwijzing moet in beide standen een afwijzing zijn. Als er ergens verschil
// zit hoort dat in de "medium tegenover high"-groep te staan en niet stil hier.
const both = (subject: string, body = ''): [string | null, string | null] => [
  high(subject, body),
  medium(subject, body),
];
const NOTHING: [null, null] = [null, null];

describe('findVerificationCode — mails zoals ze echt binnenkomen', () => {
  it('vindt de code van Google, met het trefwoord in het onderwerp', () => {
    // De meest voorkomende vorm: het onderwerp zegt waar het over gaat en de
    // eerste regel van het bericht bevat het getal.
    expect(high('Uw Google-verificatiecode', 'Gebruik 483920 om je aan te melden.')).toBe('483920');
  });

  it('vindt de code met het streepje dat Google er zelf voor zet', () => {
    // Google schrijft "G-728916". De letter ervoor mag de code niet bederven.
    expect(high('Google', 'Your verification code is G-728916.')).toBe('728916');
  });

  it('vindt de code van GitHub, met het trefwoord in de tekst', () => {
    expect(high('[GitHub] Please verify your device', 'Verification code: 654321')).toBe('654321');
  });

  it('vindt een code van vier cijfers, zoals banken die sturen', () => {
    // Vier cijfers is de ondergrens. Zonder deze test zou een strengere
    // ondergrens (vijf) ongemerkt de halve bankwereld uitsluiten.
    expect(high('Beveiligingscode', 'Uw beveiligingscode is 5837.')).toBe('5837');
  });

  it('vindt een code van acht cijfers', () => {
    expect(high('Bevestigingscode', 'Uw bevestigingscode is 40182937.')).toBe('40182937');
  });

  it('leest de Nederlandse trefwoorden', () => {
    expect(high('Actie nodig', 'Uw eenmalige code is 748291.')).toBe('748291');
    expect(high('Actie nodig', 'Uw inlogcode is 33914.')).toBe('33914');
    expect(high('Actie nodig', 'Je verificatie code is 512907.')).toBe('512907');
  });

  it('leest de Engelse trefwoorden', () => {
    expect(high('Sign in', 'Your one-time password is 90210.')).toBe('90210');
    expect(high('Sign in', 'Your security code is 771044.')).toBe('771044');
    expect(high('Sign in', 'Your passcode is 8812.')).toBe('8812');
    expect(high('Sign in', 'Your OTP is 55219.')).toBe('55219');
    expect(high('Sign in', 'Two-factor code: 118822')).toBe('118822');
  });

  it('vindt de code als hij vóór het trefwoord staat', () => {
    // "483920 is je verificatiecode" komt net zo vaak voor als het omgekeerde, dus
    // het venster kijkt naar beide kanten.
    expect(high('Aanmelden', '483920 is je verificatiecode voor Gmail Desktop.')).toBe('483920');
  });

  it('vindt de code als hij alleen in het onderwerp staat', () => {
    expect(high('Je verificatiecode: 194837', 'Meld je aan om verder te gaan.')).toBe('194837');
  });

  it('vindt de code in het onderwerp terwijl het trefwoord ver weg in de tekst staat', () => {
    // De code staat in het onderwerp en het trefwoord pas onderaan het bericht.
    // Buiten het venster van 60 tekens, maar het onderwerp is de plek waar een
    // dienst een code neerzet; dan is "er staat érgens een trefwoord" genoeg.
    expect(
      high(
        'Actie vereist: 194837',
        'Er is iets aan de hand met je account en je moet even iets doen voordat je verder kan werken. Vul de verificatiecode in.',
      ),
    ).toBe('194837');
  });

  it('vindt een code met letters erin, maar alleen in de strenge stand', () => {
    // Een code als A3F9K2 bestaat, maar heeft dezelfde vorm als een productcode of
    // een kortingscode. Daarom alleen met een trefwoord ernaast, en daarom niet in
    // de losse stand — die eist al geen trefwoord, dus daar zou elke productcode
    // meekomen.
    expect(high('Actie nodig', 'Your verification code is A3F9K2.')).toBe('A3F9K2');
    expect(medium('Actie nodig', 'Your verification code is A3F9K2.')).toBeNull();
  });

  it('laat de code van de mail winnen van een getal in een link', () => {
    // De link bevat "?code=111222" — precies de vorm die we zoeken, en precies de
    // plek waar hij niets betekent.
    expect(high('Uw verificatiecode', 'Zie https://x.io/a?code=111222 of code 483920.')).toBe(
      '483920',
    );
  });

  it('kijkt niet in het afzenderadres', () => {
    // Een adres bestaat uit een naam en een domein; cijfers daarin zijn nooit een
    // code. Zou het adres wel meegelezen worden, dan had elke mail van
    // "noreply483920@" een code.
    expect(
      findVerificationCode(
        { subject: 'Hallo', body: 'Niets bijzonders hier.', from: 'noreply483920@example.com' },
        'medium',
      ),
    ).toBeNull();
  });
});

describe('wat er nooit een code mag zijn', () => {
  it('een jaartal', () => {
    // Zou dit slagen, dan wordt elke nieuwsbrief met een voettekst weggegooid.
    expect(both('Nieuwsbrief', 'Copyright 2026 Onze Winkel')).toEqual(NOTHING);
    expect(both('Terugblik', '1999 was een goed jaar voor ons.')).toEqual(NOTHING);
  });

  it('een jaartal wél, als het trefwoord er pal naast staat', () => {
    // De keerzijde van de regel hierboven: een code die per ongeluk op een jaar
    // lijkt is nog steeds een code als de mail hem zo noemt.
    expect(high('Aanmelden', 'Uw verificatiecode is 2024.')).toBe('2024');
  });

  it('een bedrag', () => {
    // Zou dit slagen, dan verdwijnt de factuur of de bestelbevestiging.
    expect(both('Uw bestelling', 'Wij schrijven $1234 van uw kaart af.')).toEqual(NOTHING);
    expect(both('Uw bestelling', 'Dat is € 1234,50 samen.')).toEqual(NOTHING);
    expect(both('Uw bestelling', 'Dat is 1234 EUR samen.')).toEqual(NOTHING);
  });

  it('een telefoonnummer', () => {
    // Zou dit slagen, dan verdwijnt elke mail met een ondertekening eronder.
    expect(both('Contact', 'Bel ons op +31 6 12345678 voor vragen.')).toEqual(NOTHING);
    expect(both('Contact', 'Ons nummer is 010-123 4567.')).toEqual(NOTHING);
    expect(both('Contact', 'Of bel (020) 1234567 tijdens kantooruren.')).toEqual(NOTHING);
  });

  it('een datum', () => {
    // Zou dit slagen, dan verdwijnt elke uitnodiging en elke bezorgmelding.
    expect(both('Afspraak', 'Op 12-03-2022 komen wij langs.')).toEqual(NOTHING);
    expect(both('Afspraak', 'Op 03/12/2022 komen wij langs.')).toEqual(NOTHING);
    expect(both('Afspraak', 'Gepland op 2022-03-12 in de ochtend.')).toEqual(NOTHING);
  });

  it('een tijd', () => {
    expect(both('Bezorging', 'De trein vertrekt om 14:30 vanaf spoor twee.')).toEqual(NOTHING);
    expect(both('Bezorging', 'Wij komen om 14:30:00 langs.')).toEqual(NOTHING);
  });

  it('een lange reeks cijfers: een order-, factuur- of klantnummer', () => {
    // Negen cijfers of meer is geen code meer. Zou dit slagen, dan verdwijnt de
    // bestelbevestiging waar het nummer in staat dat je nodig hebt om te klagen.
    expect(both('Uw bestelling', 'Het nummer is 100238476512.')).toEqual(NOTHING);
  });

  it('een trackingnummer, inclusief de letters die eraan vastzitten', () => {
    // 3SABCD1234567890 wordt in zijn geheel weggestreept en niet alleen zijn
    // cijfers: bleef "3SABCD" staan, dan is dát een kandidaat met de vorm van een
    // lettercode — en hier staat een trefwoord in het onderwerp dat hem zou dekken.
    expect(both('Uw verificatiecode volgt', 'Uw pakje 3SABCD1234567890 is onderweg.')).toEqual(
      NOTHING,
    );
    expect(both('Uw verificatiecode volgt', 'Overmaken naar NL91ABNA0417164300 graag.')).toEqual(
      NOTHING,
    );
  });

  it('een getal in een link', () => {
    // Zou dit slagen, dan gooit de app de mail weg en kopieert iets dat de
    // gebruiker nergens kan invullen.
    expect(
      both('Bevestig je account', 'Klik op https://example.com/verify?code=483920 om verder te gaan.'),
    ).toEqual(NOTHING);
  });

  it('een getal in een mailadres', () => {
    expect(both('Contact', 'Mail naar info483920@example.com voor vragen.')).toEqual(NOTHING);
  });

  it('een kleurcode of een nummerteken', () => {
    // #123456 is een kleur, en "#123456" achter "Order" is een nummerteken. Geen
    // van beide is ooit een verificatiecode.
    expect(both('Huisstijl', 'De kleuren zijn #a3f9c2 en #123456.')).toEqual(NOTHING);
    expect(both('Uw bestelling', 'Order #483920 is verzonden.')).toEqual(NOTHING);
  });

  it('een getal met scheidingstekens erin', () => {
    expect(both('Voorraad', 'Er liggen nog 1.234 stuks en 1,234 kilo.')).toEqual(NOTHING);
    expect(both('Voorraad', 'Wij verstuurden 1 234 567 pakjes dit jaar.')).toEqual(NOTHING);
  });

  it('een percentage', () => {
    expect(both('Sneller', 'Tot 1234% sneller dan gisteren.')).toEqual(NOTHING);
  });

  it('een versienummer', () => {
    expect(both('Update', 'Versie 1.2.3 staat voor u klaar.')).toEqual(NOTHING);
  });

  it('een getal dat aan een bestandsnaam of sleutel vastzit', () => {
    // De liggende streep maakt van een getal een naam en geen code.
    expect(both('Bijlage', 'Zie bestand_483920_v2 in de map.')).toEqual(NOTHING);
  });

  it('een code met kleine letters', () => {
    // Codes worden in hoofdletters gestuurd. Kleine letters horen bij gewone tekst,
    // en "a3f9k2" in een zin is eerder een verwijzing dan een code.
    expect(both('Uw verificatiecode', 'De code is a3f9k2.')).toEqual(NOTHING);
  });

  it('een woord zonder cijfers', () => {
    expect(both('Uw verificatiecode', 'De code is HALLOOO.')).toEqual(NOTHING);
  });

  it('een getal met een eenheid erachter', () => {
    expect(both('Uw verificatiecode', 'De bijlage is 1200MB groot.')).toEqual(NOTHING);
  });

  it('te kort en te lang', () => {
    expect(both('Uw verificatiecode', 'De code is 123.')).toEqual(NOTHING);
    expect(both('Uw verificatiecode', 'De code is 123456789.')).toEqual(NOTHING);
  });

  it('een getal met een tegenwoord ervoor, ook als er een trefwoord in de buurt staat', () => {
    // Dit is het vangnet onder al het bovenstaande: een trackingnummer van zes
    // cijfers heeft exact de vorm van een code, dus alleen zijn label verraadt hem.
    // Zonder deze regel zou een mail met "uw verificatiecode volgt" bovenaan en een
    // zendingnummer eronder het verkeerde getal kopiëren en de mail weggooien.
    expect(both('Uw verificatiecode', 'Trackingnummer 483920 hoort bij uw zending.')).toEqual(
      NOTHING,
    );
    expect(both('Uw verificatiecode', 'Factuurnummer 483920 is voldaan.')).toEqual(NOTHING);
    expect(both('Uw verificatiecode', 'Klantnummer 483920 hoort bij dit bericht.')).toEqual(NOTHING);
  });

  it('"one-time" zonder het woord dat erachter hoort', () => {
    // "One-time offer" is een reclamemail. Zou het losse woord als trefwoord gelden,
    // dan promoveert elk getal in die mail tot code.
    expect(high('One-time offer', 'Bestel nu en krijg 1234 punten cadeau.')).toBeNull();
  });
});

describe('medium tegenover high', () => {
  it('medium neemt een losstaande groep cijfers zonder trefwoord, high niet', () => {
    expect(high('Aanmelden', 'Voer dit in om door te gaan: 483920')).toBeNull();
    expect(medium('Aanmelden', 'Voer dit in om door te gaan: 483920')).toBe('483920');
  });

  it('medium neemt een code op zijn eigen regel, high niet', () => {
    const body = 'Beste Jan,\n\n583920\n\nMet vriendelijke groet';
    expect(high('Hallo', body)).toBeNull();
    expect(medium('Hallo', body)).toBe('583920');
  });

  it('medium neemt een code die te ver van het trefwoord staat, high niet', () => {
    // Het venster van 60 tekens is precies het verschil tussen "de mail zegt dat
    // dit een code is" en "er staat ergens in deze mail een getal".
    const body =
      'Hallo, hier is een lange begroeting die verder niets zegt en alleen ruimte inneemt. 483920';
    expect(high('Uw verificatiecode', body)).toBeNull();
    expect(medium('Uw verificatiecode', body)).toBe('483920');
  });

  it('high neemt een code met letters, medium niet', () => {
    // De enige richting waarin high méér toelaat dan medium, en dat is met opzet:
    // letters mogen alleen als een trefwoord ze dekt.
    expect(high('Aanmelden', 'Uw verificatiecode is B7K2M9.')).toBe('B7K2M9');
    expect(medium('Aanmelden', 'Uw verificatiecode is B7K2M9.')).toBeNull();
  });
});

describe('HTML-berichten', () => {
  it('vindt de code tussen de opmaak', () => {
    // Zonder strippen zoekt de detector in de vormgeving van de mail in plaats van
    // in zijn inhoud, en de vormgeving staat bovenaan.
    const body =
      '<html><body><table width="1200" bgcolor="#f5f5f5"><tr>' +
      '<td style="font-size:12px;padding:1024px">Uw verificatiecode is <b>483920</b></td>' +
      '</tr></table></body></html>';
    expect(high('Uw code', body)).toBe('483920');
    // En in de losse stand mag geen enkel getal uit een attribuut winnen van het
    // getal dat de lezer ziet.
    expect(medium('Uw code', body)).toBe('483920');
  });

  it('leest niets uit een style- of scriptblok', () => {
    // Daar staat per definitie geen tekst voor de lezer, maar wel cijfers.
    const body =
      '<html><head><style>.x{color:#a3f9c2;padding:483920px}</style>' +
      '<script>var t=147258;</script></head><body>Hallo daar</body></html>';
    expect(both('Hallo', body)).toEqual(NOTHING);
  });

  it('plakt een code die door opmaak in stukken is geknipt weer aan elkaar', () => {
    // Een HTML-mail zet een code soms per teken of per helft in een eigen tag.
    // Staat er zo'n tag tússen twee cijfers, dan hoort daar geen woordgrens.
    expect(high('Uw code', '<p>Uw verificatiecode is <b>48</b><b>3920</b>.</p>')).toBe('483920');
  });

  it('vertaalt entiteiten terug', () => {
    expect(high('Uw code', 'Uw verificatiecode is&nbsp;483920.')).toBe('483920');
    expect(high('Uw code', '<p>Code &amp; wachtwoord: verificatiecode 483920</p>')).toBe('483920');
  });

  it('vindt de code in een volledige mail met kop, voettekst en afmeldlink', () => {
    // Alles bij elkaar: opmaak met maten erin, een jaartal in de voettekst, een
    // afmeldlink met cijfers, een telefoonnummer in de ondertekening. Precies één
    // getal in dit bericht is een code, en dat is het getal dat de lezer ziet.
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

  it('vindt niets in een bericht dat alleen uit opmaak bestaat', () => {
    expect(both('Hallo', '<div><span></span></div><br><table><tr><td></td></tr></table>')).toEqual(
      NOTHING,
    );
  });
});

describe('leegte en rommel', () => {
  it('geeft null bij een leeg bericht', () => {
    expect(both('', '')).toEqual(NOTHING);
  });

  it('geeft null bij alleen witruimte', () => {
    expect(both('   ', '\n\n\t  \n')).toEqual(NOTHING);
  });

  it('geeft null bij rommel zonder cijfers', () => {
    expect(both('#### !!!! ????', '===== ***** -----')).toEqual(NOTHING);
  });

  it('geeft null bij een bericht zonder onderwerp', () => {
    expect(high('', 'Zomaar een berichtje zonder iets erin.')).toBeNull();
  });
});

describe('hetzelfde bericht geeft hetzelfde antwoord', () => {
  it('levert bij tien keer dezelfde invoer tien keer dezelfde code', () => {
    // Er zit geen klok en geen willekeur in de module, en dat moet zo blijven: een
    // vergissing die je niet kan naspelen kan je ook niet repareren.
    const input = { subject: 'Uw verificatiecode', body: 'De code is 483920.' };
    const answers = new Set(Array.from({ length: 10 }, () => findVerificationCode(input, 'high')));
    expect([...answers]).toEqual(['483920']);
  });

  it('kiest het hardste bewijs en niet het eerste getal', () => {
    // Het getal van de vorige mail staat bovenaan en ver van elk trefwoord; de
    // echte code staat eronder met het trefwoord ernaast. In de losse stand zijn
    // beide kandidaat, en dan moet de mail zelf de doorslag geven.
    const body =
      '999888 stond in de mail van gisteren en die is niet meer geldig want hij is verlopen. ' +
      'Uw verificatiecode is 483920.';
    expect(medium('Aanmelden', body)).toBe('483920');
    expect(high('Aanmelden', body)).toBe('483920');
  });

  it('kiest bij twee even harde kandidaten de eerste', () => {
    expect(high('Aanmelden', 'Uw verificatiecode is 483920, niet 111222.')).toBe('483920');
  });
});

describe('subjectSuggestsCode', () => {
  it('zegt ja bij een onderwerp met een trefwoord', () => {
    expect(subjectSuggestsCode('Uw verificatiecode')).toBe(true);
    expect(subjectSuggestsCode('Your security code')).toBe(true);
    expect(subjectSuggestsCode('Two-factor authentication')).toBe(true);
  });

  it('zegt ja bij een zwakke aanwijzing', () => {
    // Het poortje mag ruimer zijn dan de detector: te streng gooit post weg die de
    // detector nog had willen bekijken, en dat is niet meer te herstellen. Een
    // onnodige aanvraag kost een halve seconde.
    expect(subjectSuggestsCode('[GitHub] Please verify your device')).toBe(true);
    expect(subjectSuggestsCode('Aanmelden bij je account')).toBe(true);
    expect(subjectSuggestsCode('Je code staat klaar')).toBe(true);
  });

  it('zegt ja bij een code-vormig getal in het onderwerp', () => {
    expect(subjectSuggestsCode('483920')).toBe(true);
    expect(subjectSuggestsCode('Actie vereist: 194837')).toBe(true);
  });

  it('zegt nee bij gewone post', () => {
    expect(subjectSuggestsCode('Uw factuur van maart')).toBe(false);
    expect(subjectSuggestsCode('Nieuwsbrief maart')).toBe(false);
    expect(subjectSuggestsCode('Bezorging vandaag tussen 14:00 en 16:00')).toBe(false);
    expect(subjectSuggestsCode('')).toBe(false);
    expect(subjectSuggestsCode('   ')).toBe(false);
  });

  it('zegt nee bij een jaartal als enige getal', () => {
    // Anders haalt de app het bericht van elke nieuwsbrief met een jaar in de kop op.
    expect(subjectSuggestsCode('Nieuwsbrief 2026')).toBe(false);
  });
});
