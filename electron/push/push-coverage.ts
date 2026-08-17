// Which accounts push covers, and from what moment. That moment decides whether an arriving
// message deserves a notification, whether the webview's own notification is muted, and
// whether the API or the page title owns the unread count.
export class PushCoverage {
  private since_ = new Map<string, number>();

  constructor(private readonly now: () => number = Date.now) {}

  /**
   * The map key for an address
   *
   * @param email
   * @returns the address, lowercased
   * @private
   */
  private key(email: string): string {
    return email.toLowerCase();
  }

  /**
   * Marks an account as covered from now on
   *
   * An existing moment is left alone: if it moved on a second successful watch, mail
   * that arrived in between would fall outside the window and stay silent.
   *
   * @param email
   * @returns true only when this call started the coverage
   */
  cover(email: string): boolean {
    const key = this.key(email);
    if (this.since_.has(key)) return false;
    this.since_.set(key, this.now());
    return true;
  }

  /**
   * Ends coverage for an account
   *
   * @param email
   * @returns true when the account was covered
   */
  drop(email: string): boolean {
    return this.since_.delete(this.key(email));
  }

  /**
   * Whether push currently covers an account
   *
   * @param email
   * @returns true while covered
   */
  has(email: string): boolean {
    return this.since_.has(this.key(email));
  }

  /**
   * From what moment push covers an account
   *
   * @param email
   * @returns epoch ms, or null when not covered
   */
  since(email: string): number | null {
    return this.since_.get(this.key(email)) ?? null;
  }

  /**
   * Forgets an account entirely, as on removal
   *
   * @param email
   */
  forget(email: string): void {
    this.since_.delete(this.key(email));
  }
}
