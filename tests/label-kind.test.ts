// Classifying a label id as inbox, starred, important or a user label.

import { describe, it, expect } from 'vitest';
import { labelKind } from '../renderer/app/label-kind';

describe('labelKind', () => {
  it('recognises the system destinations by their fixed id', () => {
    expect(labelKind('INBOX')).toBe('inbox');
    expect(labelKind('STARRED')).toBe('starred');
    expect(labelKind('IMPORTANT')).toBe('important');
  });

  it('treats anything else as your own label', () => {
    expect(labelKind('Label_12')).toBe('user');
    expect(labelKind('')).toBe('user');
  });

  it('does not go by the visible name', () => {
    expect(labelKind('Postvak IN')).toBe('user');
  });
});
