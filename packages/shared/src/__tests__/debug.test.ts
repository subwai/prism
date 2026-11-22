import { fillPlaceholders } from '#debug';
import { expect, test } from 'vitest';

test("the window's log lines fill in their arguments, with binary data as its size", () => {
  const image = new Uint8Array(4096);
  expect(
    fillPlaceholders('%s %o %dms', ['storeThumbnail', [{ entryId: 'clip.webm', image }], 12]),
  ).toBe('storeThumbnail [{"entryId":"clip.webm","image":"<4096 bytes>"}] 12ms');
  expect(fillPlaceholders('%o', [new ArrayBuffer(8)])).toBe('"<8 bytes>"');
});
