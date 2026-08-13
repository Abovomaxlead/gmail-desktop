// Covers the account picker's resolver bookkeeping and its window arithmetic. Two of
// these would have caught the Criticals from the previous round: the promise that never
// settled once the window was hidden rather than closed, and the second mailto: that was
// dropped instead of parked, which left the user composing to the first recipient.

import { describe, it, expect, vi } from 'vitest';
import {
  ComposePicker,
  pickerWindowSize,
  PICKER_WIDTH,
  PICKER_HEADER_HEIGHT,
  PICKER_ROW_HEIGHT,
  PICKER_FOOTER_HEIGHT,
  PICKER_MAX_VISIBLE_ROWS,
} from '../electron/compose/compose-picker';

function harness() {
  const open = vi.fn();
  const close = vi.fn();
  const redispatch = vi.fn();
  const picker = new ComposePicker<string, string>({ open, close, redispatch });
  return { picker, open, close, redispatch };
}

const flush = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

describe('ComposePicker.ask', () => {
  it('opens the picker for the first ask', () => {
    const { picker, open } = harness();
    void picker.ask('ask-a', 'mailto:a@example.com');
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith('ask-a');
    expect(picker.isPending()).toBe(true);
  });

  it('does not open a second picker while one is pending', async () => {
    const { picker, open } = harness();
    void picker.ask('ask-a', 'mailto:a@example.com');
    await expect(picker.ask('ask-b', 'mailto:b@example.com')).resolves.toBeNull();
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('parks the second request rather than losing it, and drains it on settle', async () => {
    const { picker, open, redispatch } = harness();
    void picker.ask('ask-a', 'mailto:a@example.com');
    void picker.ask('ask-b', 'mailto:b@example.com');
    expect(picker.hasParked()).toBe(true);

    picker.settle(0);
    await flush();

    expect(redispatch).toHaveBeenCalledTimes(1);
    expect(redispatch).toHaveBeenCalledWith('mailto:b@example.com');
    expect(picker.hasParked()).toBe(false);
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('parks only the most recent request when several arrive', async () => {
    const { picker, redispatch } = harness();
    void picker.ask('ask-a', 'mailto:a@example.com');
    void picker.ask('ask-b', 'mailto:b@example.com');
    void picker.ask('ask-c', 'mailto:c@example.com');
    picker.settle(null);
    await flush();
    expect(redispatch).toHaveBeenCalledTimes(1);
    expect(redispatch).toHaveBeenCalledWith('mailto:c@example.com');
  });

  it('drains nothing when no second request arrived', async () => {
    const { picker, redispatch } = harness();
    void picker.ask('ask-a', 'mailto:a@example.com');
    picker.settle(1);
    await flush();
    expect(redispatch).not.toHaveBeenCalled();
  });
});

describe('ComposePicker.settle', () => {
  it('resolves the promise with the chosen index', async () => {
    const { picker } = harness();
    const answer = picker.ask('ask-a', 'mailto:a@example.com');
    picker.settle(2);
    await expect(answer).resolves.toBe(2);
  });

  it('closes the window before resolving', async () => {
    const { picker, close } = harness();
    const order: string[] = [];
    const answer = picker.ask('ask-a', 'mailto:a@example.com').then(() => order.push('resolved'));
    close.mockImplementation(() => order.push('closed'));
    picker.settle(0);
    await answer;
    expect(order).toEqual(['closed', 'resolved']);
  });

  it('resolves once when settled twice, and the second call is a no-op', async () => {
    const { picker, close } = harness();
    const seen: (number | null)[] = [];
    void picker.ask('ask-a', 'mailto:a@example.com').then((v) => seen.push(v));
    picker.settle(3);
    picker.settle(null);
    await flush();
    expect(seen).toEqual([3]);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('is a no-op when nothing is pending', () => {
    const { picker, close } = harness();
    picker.settle(0);
    expect(close).not.toHaveBeenCalled();
  });

  it('resolves when the window closes after a hide, so the promise cannot hang', async () => {
    const { picker } = harness();
    const answer = picker.ask('ask-a', 'mailto:a@example.com');
    // The main window hides rather than closes, and the picker settles from that hide.
    picker.settle(null);
    await expect(answer).resolves.toBeNull();
  });

  it('clears the resolver, so the next ask opens a fresh picker', async () => {
    const { picker, open } = harness();
    void picker.ask('ask-a', 'mailto:a@example.com');
    picker.settle(0);
    await flush();
    expect(picker.isPending()).toBe(false);

    const second = picker.ask('ask-b', 'mailto:b@example.com');
    expect(open).toHaveBeenCalledTimes(2);
    expect(open).toHaveBeenLastCalledWith('ask-b');
    picker.settle(1);
    await expect(second).resolves.toBe(1);
  });
});

describe('pickerWindowSize', () => {
  it('derives the height from the row count', () => {
    expect(pickerWindowSize(3)).toEqual({
      width: PICKER_WIDTH,
      height: PICKER_HEADER_HEIGHT + 3 * PICKER_ROW_HEIGHT + PICKER_FOOTER_HEIGHT,
    });
  });

  it('scales both dimensions with the zoom factor', () => {
    const plain = pickerWindowSize(2);
    const zoomed = pickerWindowSize(2, 2);
    expect(zoomed.width).toBe(plain.width * 2);
    expect(zoomed.height).toBe(plain.height * 2);
  });

  it('stops growing past the last row that has a digit shortcut', () => {
    const nine = pickerWindowSize(PICKER_MAX_VISIBLE_ROWS);
    expect(pickerWindowSize(PICKER_MAX_VISIBLE_ROWS + 5)).toEqual(nine);
  });

  it('never exceeds the height the display can hold', () => {
    expect(pickerWindowSize(9, 2, 900).height).toBe(900);
  });

  it('opens tall enough for a two-account card, which the first constants were not', () => {
    // The card measures ~272 CSS px for two accounts without a subject; the original
    // 92/56/44 constants asked for 248 and clipped half a row before the measurement
    // could correct it.
    expect(pickerWindowSize(2).height).toBeGreaterThanOrEqual(270);
  });

  it('keeps room for one row even when asked for none', () => {
    expect(pickerWindowSize(0).height).toBe(
      PICKER_HEADER_HEIGHT + PICKER_ROW_HEIGHT + PICKER_FOOTER_HEIGHT,
    );
  });
});
