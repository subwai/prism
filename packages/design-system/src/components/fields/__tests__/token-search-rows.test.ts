import { listItems, type TokenGroup } from '#components/fields/token-search-rows';
import { expect, test } from 'vitest';

const kind: TokenGroup = {
  field: 'kind',
  label: 'Kind',
  values: [
    { count: 3, value: 'photo' },
    { count: 1, value: 'video' },
  ],
};
const rating: TokenGroup = {
  field: 'rating',
  label: 'Rating',
  section: (value) => (value.startsWith('min') ? 'At least' : undefined),
  values: [
    { count: 2, value: 'min3' },
    { count: 1, value: 'min4' },
    { count: 5, value: 'none' },
  ],
};
const empty: TokenGroup = { field: 'camera', label: 'Camera', values: [] };

test('with nothing typed, the list offers the fields that have values', () => {
  expect(listItems({ groups: [kind, empty], openGroup: undefined, query: '' })).toEqual([
    { count: 2, field: 'kind', kind: 'field', label: 'Kind' },
  ]);
});

test('an open field lists the way back, then its values', () => {
  expect(listItems({ groups: [kind], openGroup: kind, query: '' })).toEqual([
    { field: 'kind', kind: 'back', label: 'Kind' },
    { count: 3, field: 'kind', kind: 'value', value: 'photo' },
    { count: 1, field: 'kind', kind: 'value', value: 'video' },
  ]);
});

test('an open field with sections keeps the way back in a section of its own', () => {
  expect(listItems({ groups: [rating], openGroup: rating, query: '' })).toEqual([
    { items: [{ field: 'rating', kind: 'back', label: 'Rating' }], kind: 'section', label: '' },
    {
      items: [
        { count: 2, field: 'rating', kind: 'value', value: 'min3' },
        { count: 1, field: 'rating', kind: 'value', value: 'min4' },
      ],
      kind: 'section',
      label: 'At least',
    },
    {
      items: [{ count: 5, field: 'rating', kind: 'value', value: 'none' }],
      kind: 'section',
      label: '',
    },
  ]);
});

test("typing lists every field's values under its field, leaving out empty fields", () => {
  const items = listItems({ groups: [kind, empty], openGroup: undefined, query: 'ph' });
  expect(items).toEqual([
    {
      items: [
        { count: 3, field: 'kind', kind: 'value', value: 'photo' },
        { count: 1, field: 'kind', kind: 'value', value: 'video' },
      ],
      kind: 'section',
      label: 'Kind',
    },
  ]);
});
