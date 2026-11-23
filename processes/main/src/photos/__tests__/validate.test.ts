import {
  requireFolderIds,
  requireScreenContents,
  requireString,
  requireViewRange,
  requireViewSpec,
} from '#photos/validate';
import { emptyFilter, type ViewSpec } from '@prism/shared';
import { expect, test } from 'vitest';

const SPEC: ViewSpec = {
  descending: false,
  directoryId: '.',
  filter: emptyFilter(),
  recursive: false,
  search: '',
  show: 'all',
  sort: 'name',
  suggesting: false,
};

test('takes a view the window may open', () => {
  expect(() => requireViewSpec(SPEC)).not.toThrow();
  expect(() =>
    requireViewSpec({ ...SPEC, filter: { ...emptyFilter(), camera: ['Canon EOS R5'] } }),
  ).not.toThrow();
});

test.each([
  ['nothing', null],
  ['a sort it does not know', { ...SPEC, sort: 'colour' }],
  ['a missing filter field', { ...SPEC, filter: { camera: [], format: [], lens: [] } }],
  ['a search past its length', { ...SPEC, search: 'x'.repeat(1025) }],
  ['a flag that is not one', { ...SPEC, recursive: 'yes' }],
])('refuses a view with %s', (_problem, spec) => {
  expect(() => requireViewSpec(spec)).toThrow('Invalid view.');
});

test('refuses too many values of one field to filter by', () => {
  const camera = Array.from({ length: 257 }, (_value, index) => `Camera ${index}`);
  expect(() => requireViewSpec({ ...SPEC, filter: { ...emptyFilter(), camera } })).toThrow(
    'Choose at most 256 values to filter by.',
  );
});

test('takes ranges of rows up to the most a call returns', () => {
  expect(() => requireViewRange(3, 0, 1024)).not.toThrow();
  expect(() => requireViewRange(3, 0, 1025)).toThrow('Ask for at most 1024 rows at a time.');
  expect(() => requireViewRange(3, -1, 10)).toThrow('Invalid view.');
  expect(() => requireViewRange(3, 0.5, 10)).toThrow('Invalid view.');
});

test('takes only a nonempty string as an ID', () => {
  expect(() => requireString('Trips/beach.jpg')).not.toThrow();
  for (const value of ['', 5, null, 'x'.repeat(32_769)]) {
    expect(() => requireString(value)).toThrow('Expected a nonempty string.');
  }
});

test('the folders the tree asks about are IDs', () => {
  // Every folder is another call.
  expect(() => Reflect.apply(requireFolderIds, null, [])).toThrow();
  expect(() => requireFolderIds(['.', 'Trips'])).not.toThrow();
  expect(() => requireFolderIds([''])).toThrow('Expected a nonempty string.');
  expect(() => requireFolderIds('Trips')).toThrow();
});

test('what the window has on show is IDs and the rows of its views', () => {
  expect(() =>
    requireScreenContents({
      foldersToRead: ['Trips'],
      shown: ['a.jpg'],
      views: [{ end: 9, start: 0, viewId: 'v' }],
    }),
  ).not.toThrow();
  expect(() => requireScreenContents({ foldersToRead: [], shown: [''], views: [] })).toThrow();
  expect(() =>
    requireScreenContents({
      foldersToRead: [],
      shown: [],
      views: [{ end: 1, start: -1, viewId: 'v' }],
    }),
  ).toThrow('Invalid view.');
  expect(() => requireScreenContents({ shown: [], views: [] })).toThrow('Invalid screen contents.');
});
