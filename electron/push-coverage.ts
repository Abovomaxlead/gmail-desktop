// Welke accounts door push gedekt worden, en vanaf welk moment. Drie dingen
// hangen hieraan:
//
//   1. Of Gmail's eigen meldingen in die webview gedempt worden.
//   2. Wie de ongelezen-teller mag zetten — de API of de paginatitel.
//   3. Of een binnengekomen bericht nog een melding waard is (zie shouldNotify).
//
// Het moment is het punt: dat is wat voorkomt dat de catch-up na een storing mail
// nog eens meldt die de webview toen al gemeld heeft.
export class PushCoverage {
  private since_ = new Map<string, number>();

  constructor(private readonly now: () => number = Date.now) {}

  private key(email: string): string {
    return email.toLowerCase();
  }

  // True als er echt iets veranderde. Een tweede geslaagde watch laat het moment
  // staan: zou het meeschuiven, dan viel mail die er tussenin kwam buiten het
  // venster en zou die stil blijven.
  cover(email: string): boolean {
    const key = this.key(email);
    if (this.since_.has(key)) return false;
    this.since_.set(key, this.now());
    return true;
  }

  drop(email: string): boolean {
    return this.since_.delete(this.key(email));
  }

  has(email: string): boolean {
    return this.since_.has(this.key(email));
  }

  since(email: string): number | null {
    return this.since_.get(this.key(email)) ?? null;
  }

  forget(email: string): void {
    this.since_.delete(this.key(email));
  }
}
