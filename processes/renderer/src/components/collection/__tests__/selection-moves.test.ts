import { indexAfterKey } from '#components/collection/selection-moves';
import { expect, test } from 'vitest';

const grid = { columns: 4, count: 10 };

test('the arrow keys move one entry across or one row down', () => {
  expect(indexAfterKey({ ...grid, key: 'ArrowRight', selectedIndex: 5 })).toBe(6);
  expect(indexAfterKey({ ...grid, key: 'ArrowLeft', selectedIndex: 5 })).toBe(4);
  expect(indexAfterKey({ ...grid, key: 'ArrowDown', selectedIndex: 1 })).toBe(5);
  expect(indexAfterKey({ ...grid, key: 'ArrowUp', selectedIndex: 5 })).toBe(1);
});

test('the selection stops at either end of the list', () => {
  expect(indexAfterKey({ ...grid, key: 'ArrowDown', selectedIndex: 8 })).toBe(9);
  expect(indexAfterKey({ ...grid, key: 'ArrowUp', selectedIndex: 2 })).toBe(0);
  expect(indexAfterKey({ ...grid, key: 'End', selectedIndex: 2 })).toBe(9);
  expect(indexAfterKey({ ...grid, key: 'Home', selectedIndex: 7 })).toBe(0);
});

test('with nothing selected, a move selects the first entry', () => {
  expect(indexAfterKey({ ...grid, key: 'End', selectedIndex: -1 })).toBe(0);
});

test('other keys, and an empty list, move nothing', () => {
  expect(indexAfterKey({ ...grid, key: 'Enter', selectedIndex: 3 })).toBeNull();
  expect(indexAfterKey({ columns: 4, count: 0, key: 'ArrowDown', selectedIndex: -1 })).toBeNull();
});
