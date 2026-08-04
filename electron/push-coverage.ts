// Which accounts push covers, and from what moment. That moment decides whether an
// arriving message still deserves a notification, whether Gmail's own notification
// in the webview is muted, and whether the API or the page title owns the unread
// count. cover() must leave an existing moment alone: if it moved on a second
// successful watch, mail that arrived in between would fall outside the window and
// stay silent.
export class PushCoverage {
  private since_ = new Map<string, number>();

  constructor(private readonly now: () => number = Date.now) {}

  private key(email: string): string {
    return email.toLowerCase();
  }

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
