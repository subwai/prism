import { serve } from '#worker';
import { expect, test } from 'vitest';

const api = {
  add: (left: number, right: number) => left + right,
  fail: () => {
    throw new Error('It broke.');
  },
  later: (value: string) => Promise.resolve(value),
};

test('answers a request with what its method returns, once settled', async () => {
  await expect(serve(api, { args: [2, 3], id: 1, method: 'add' })).resolves.toEqual({
    id: 1,
    value: 5,
  });
  await expect(serve(api, { args: ['soon'], id: 2, method: 'later' })).resolves.toEqual({
    id: 2,
    value: 'soon',
  });
});

test('answers with the message of what its method threw', async () => {
  await expect(serve(api, { args: [], id: 3, method: 'fail' })).resolves.toEqual({
    error: 'It broke.',
    id: 3,
  });
});

test('refuses methods it does not have, or that the caller may not use', async () => {
  await expect(
    serve(api, { args: [], id: 4, method: 'toString' }, new Set(['add'])),
  ).resolves.toMatchObject({ error: 'toString cannot be called here.' });
  await expect(serve(api, { args: [], id: 5, method: 'missing' })).resolves.toMatchObject({
    error: 'missing cannot be called here.',
  });
});
