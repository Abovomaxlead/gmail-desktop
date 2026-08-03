import type { HistoryPage, MessageMeta } from './gmail-api';
import { notifiableIds, shouldNotify } from './history-sync';

// Eén sync: van "er is iets veranderd" naar "dit moet gemeld worden en de teller
// staat op dit getal". Alles wat het netwerk raakt komt binnen als dependency,
// zodat dit bestand zonder Electron te testen is.

export interface SyncClient {
  profileHistoryId(): Promise<string | null>;
  historyPage(startHistoryId: string, pageToken?: string): Promise<HistoryPage>;
  messageMeta(id: string): Promise<MessageMeta | null>;
  inboxUnread(): Promise<number | null>;
}

export interface SyncCursor {
  get(): string | undefined;
  set(historyId: string): void;
}

export interface SyncOutcome {
  notify: MessageMeta[];
  unread: number | null;
  // Gezet als de cursor opnieuw geijkt is in plaats van doorgelopen. Dan is er
  // per definitie niets te melden: we weten niet wat we gemist hebben.
  rebaselined: boolean;
}

export interface SyncDeps {
  client: SyncClient;
  cursor: SyncCursor;
  coveredSince: () => number | null;
  // Of deze fout betekent dat de cursor te oud is. Gmail antwoordt dan met 404.
  // Als parameter, want het herkennen van een GmailHttpError hoort bij de
  // aanroeper en niet in deze module.
  isExpiredCursor: (e: unknown) => boolean;
  onOutcome: (outcome: SyncOutcome) => void;
  onError?: (e: unknown) => void;
}

export function createSyncRunner(deps: SyncDeps): { run(): Promise<void> } {
  let running: Promise<void> | null = null;
  let again = false;

  // De teller mag nooit een sync laten mislukken: het getal is bijzaak
  // vergeleken met de melding.
  const unread = async (): Promise<number | null> => {
    try {
      return await deps.client.inboxUnread();
    } catch {
      return null;
    }
  };

  // Opnieuw ijken: we weten wél waar we nu staan, maar niet wat we gemist
  // hebben. Dus cursor zetten en niets melden.
  const baseline = async (): Promise<void> => {
    const historyId = await deps.client.profileHistoryId();
    if (historyId) deps.cursor.set(historyId);
    deps.onOutcome({ notify: [], unread: await unread(), rebaselined: true });
  };

  const once = async (): Promise<void> => {
    const start = deps.cursor.get();
    if (!start) return baseline();

    // Alle pagina's eerst binnenhalen. De cursor gaat pas ná de laatste pagina
    // vooruit: zou hij halverwege opschuiven en dan een pagina mislukken, dan is
    // die mail voorgoed weg — geen melding, en niets dat het merkt.
    const added: HistoryPage['added'] = [];
    let latest = start;
    let pageToken: string | undefined;
    try {
      do {
        const page = await deps.client.historyPage(start, pageToken);
        added.push(...page.added);
        if (page.historyId) latest = page.historyId;
        pageToken = page.nextPageToken;
      } while (pageToken);
    } catch (e) {
      if (deps.isExpiredCursor(e)) return baseline();
      // Netwerk weg, quotum vol, Google hikt: deze sync overslaan. De cursor
      // staat nog waar hij stond, dus de volgende haalt hetzelfde opnieuw op.
      deps.onError?.(e);
      return;
    }

    const since = deps.coveredSince();
    const notify: MessageMeta[] = [];
    for (const id of notifiableIds(added)) {
      let meta: MessageMeta | null;
      try {
        meta = await deps.client.messageMeta(id);
      } catch (e) {
        // Eén onleesbaar bericht: geen melding, want er is niets om te tonen.
        // De teller hieronder blijft wel kloppen.
        deps.onError?.(e);
        continue;
      }
      if (meta && shouldNotify(meta.internalDate, since)) notify.push(meta);
    }

    deps.cursor.set(latest);
    deps.onOutcome({ notify, unread: await unread(), rebaselined: false });
  };

  // Komt er een sync binnen terwijl er één loopt, dan wordt die niet parallel
  // gestart maar onthouden: twee doorlopen op dezelfde cursor melden alles
  // dubbel. Meerdere die tegelijk aankloppen leveren samen één extra doorloop op.
  //
  // De buitenste try/catch is het opvangnet voor alles wat once() zelf niet al
  // afvangt — een profielaanvraag die faalt, een cursor.set die gooit, een
  // onOutcome die zelf een fout opwerpt. Zonder dat net verlaat de fout pump(),
  // bereikt `running = null` nooit, en blijft `running` voorgoed een verworpen
  // belofte: elke latere run() krijgt die dezelfde oude fout terug en er wordt
  // nooit meer gesynchroniseerd. De finally garandeert dat de vlag altijd
  // vrijkomt, en de catch binnen de lus zorgt dat een intussen binnengekomen
  // run()-aanvraag (again) toch nog zijn doorloop krijgt.
  const pump = async (): Promise<void> => {
    try {
      do {
        again = false;
        try {
          await once();
        } catch (e) {
          deps.onError?.(e);
        }
      } while (again);
    } finally {
      running = null;
    }
  };

  return {
    run(): Promise<void> {
      if (running) {
        again = true;
        return running;
      }
      running = pump();
      return running;
    },
  };
}
