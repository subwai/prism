import { pageToTurnTo } from '#components/gallery/reader/page-turns';
import { expect, test } from 'vitest';

const atTopOfPage3 = { count: 10, pageAtTop: { index: 3, start: 3000 }, scrollOffset: 3000 };

test('a turn goes to the page after or before the one at the top', () => {
  expect(pageToTurnTo({ ...atTopOfPage3, direction: 1, turningTo: null })).toBe(4);
  expect(pageToTurnTo({ ...atTopOfPage3, direction: -1, turningTo: null })).toBe(2);
});

test('a turn pressed while the last one scrolls goes one further', () => {
  expect(pageToTurnTo({ ...atTopOfPage3, direction: 1, turningTo: 5 })).toBe(6);
});

test('turning back from partway down a page goes to its top', () => {
  const partway = { ...atTopOfPage3, scrollOffset: 3400 };
  expect(pageToTurnTo({ ...partway, direction: -1, turningTo: null })).toBe(3);
});

test('a turn stops at the first and last pages', () => {
  const first = { count: 10, pageAtTop: { index: 0, start: 0 }, scrollOffset: 0 };
  expect(pageToTurnTo({ ...first, direction: -1, turningTo: null })).toBe(0);
  expect(pageToTurnTo({ ...atTopOfPage3, direction: 1, turningTo: 9 })).toBe(9);
});
