import { describe, it, expect } from 'vitest';
import { labelKind } from '../renderer/app/label-kind';

describe('labelKind', () => {
  it('recognises the system destinations by their fixed id', () => {
    expect(labelKind('INBOX')).toBe('inbox');
    expect(labelKind('STARRED')).toBe('starred');
    expect(labelKind('IMPORTANT')).toBe('important');
  });

  it('treats anything else as your own label', () => {
    // Gmail's eigen labels heten Label_<n>; de naam doet er niet toe.
    expect(labelKind('Label_12')).toBe('user');
    expect(labelKind('')).toBe('user');
  });

  // Op het id en niet op de naam, want die is vertaald: een Nederlandse inbox
  // heet "Postvak IN" maar houdt id INBOX.
  it('does not go by the visible name', () => {
    expect(labelKind('Postvak IN')).toBe('user');
  });
});
