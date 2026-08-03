// De tekst van de herverbind-melding, apart en puur zodat er een test op kan.
// Dat is nodig omdat deze melding niet weg te klikken is: staat er iets in dat
// niet waar is, dan kijkt de gebruiker daar tot de volgende versie naar.
//
// 'expired' = het token is weg of niet meer te verversen; dan werkt het
// verplaatsen van mail niet meer. 'push' = het token werkt prima, maar mist de
// scope die push nodig heeft of is door de relay geweigerd; dan werkt alles
// behalve de meldingen en de API-teller. Die twee dezelfde tekst geven betekent
// dat één van de twee een onwaarheid te lezen krijgt.

export type ReconnectReason = 'expired' | 'push';

export interface ReconnectAccount {
  email: string;
  reason: ReconnectReason;
}

export interface ReconnectHeading {
  title: string;
  sub: string;
}

export function reconnectHeading(accounts: ReconnectAccount[]): ReconnectHeading {
  const many = accounts.length > 1;
  if (accounts.every((a) => a.reason === 'push')) {
    return {
      title: many ? `${accounts.length} accounts opnieuw toestaan` : 'Meldingen staan stil',
      sub: 'Sta opnieuw toe om meldingen en de ongelezen-teller te krijgen.',
    };
  }
  if (accounts.every((a) => a.reason === 'expired')) {
    return {
      title: many ? `${accounts.length} accounts opnieuw verbinden` : 'Verbinding met Gmail verlopen',
      sub: many
        ? 'Zonder verbinding kan er geen mail verplaatst worden.'
        : 'Verbind opnieuw om mail te kunnen verplaatsen.',
    };
  }
  // Gemengd: alleen zeggen wat voor elk account in de lijst waar is.
  return {
    title: `${accounts.length} accounts opnieuw verbinden`,
    sub: 'Verbind opnieuw voor het verplaatsen van mail en voor meldingen.',
  };
}
