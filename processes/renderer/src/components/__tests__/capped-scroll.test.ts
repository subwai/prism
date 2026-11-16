import { cappedScroll, MAX_SCROLL_SIZE } from '#components/capped-scroll';
import { describe, expect, test } from 'vitest';

/** Cards of the filmstrip's default size, with the gap after each. */
const CARD = 88;
const VIEWPORT = 1200;

/** The entry whose card starts at or before the whole list's `offset`. */
const entryAt = (offset: number) => Math.floor(offset / CARD);

describe('a list that fits', () => {
  const count = 20_000;
  const scroll = cappedScroll(count * CARD, VIEWPORT);

  test('keeps its size and offsets', () => {
    expect(scroll.size).toBe(count * CARD);
    for (const offset of [0, 1, 12_345.5, count * CARD - VIEWPORT]) {
      expect(scroll.toFull(offset)).toBe(offset);
      expect(scroll.toShown(offset)).toBe(offset);
    }
  });
});

describe('a list over the cap', () => {
  // Adam's whole-library filmstrip.
  const count = 1_832_035;
  const total = count * CARD;
  const scroll = cappedScroll(total, VIEWPORT);
  const shownEnd = scroll.size - VIEWPORT;

  test('takes no more than the cap', () => {
    expect(scroll.size).toBe(MAX_SCROLL_SIZE);
  });

  test('meets the whole list at both ends', () => {
    expect(scroll.toFull(0)).toBe(0);
    expect(scroll.toShown(0)).toBe(0);
    expect(scroll.toFull(shownEnd)).toBe(total - VIEWPORT);
    expect(scroll.toShown(total - VIEWPORT)).toBe(shownEnd);
    // Scrolled all the way, the last entry's card ends at the viewport's end.
    expect(entryAt(scroll.toFull(shownEnd) + VIEWPORT - 1)).toBe(count - 1);
  });

  test('finds each entry where it put it', () => {
    // The last whose card can start the viewport is 14 from the end.
    for (const entry of [0, 1, 190_653, 1_000_000, count - 14]) {
      const shown = scroll.toShown(entry * CARD);
      expect(shown).toBeLessThan(shownEnd);
      expect(entryAt(scroll.toFull(shown) + 0.5)).toBe(entry);
    }
    // Entries too near the end to start the viewport end it instead.
    const last = scroll.toShown(count * CARD - VIEWPORT);
    expect(entryAt(scroll.toFull(last) + VIEWPORT - 1)).toBe(count - 1);
  });

  test('moves in proportion between the ends', () => {
    const ratio = (total - VIEWPORT) / shownEnd;
    expect(scroll.toFull(shownEnd / 2)).toBeCloseTo((total - VIEWPORT) / 2, 3);
    expect(scroll.toFull(1001) - scroll.toFull(1000)).toBeCloseTo(ratio, 6);
  });

  test('stays within the list past either end', () => {
    expect(scroll.toFull(-10)).toBe(0);
    expect(scroll.toFull(shownEnd + 10)).toBe(total - VIEWPORT);
    expect(scroll.toShown(total)).toBe(shownEnd);
  });
});

test('a list just over a smaller cap maps the same way', () => {
  const scroll = cappedScroll(10_000, 100, 1000);
  expect(scroll.size).toBe(1000);
  expect(scroll.toFull(450)).toBe(4950);
  expect(scroll.toShown(4950)).toBe(450);
  expect(scroll.toFull(900)).toBe(9900);
});
