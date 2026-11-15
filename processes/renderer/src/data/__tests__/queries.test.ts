import { createQueryClient, fetchLatest } from '#data/queries';
import { queryOptions } from '@tanstack/react-query';
import { expect, test, vi } from 'vitest';

test('a read that a newer one cancels, as a change invalidates it meanwhile, waits for that one', async () => {
  const client = createQueryClient();
  const reads: PromiseWithResolvers<string>[] = [];
  const listing = queryOptions({
    queryFn: () => {
      const read = Promise.withResolvers<string>();
      reads.push(read);
      return read.promise;
    },
    queryKey: ['directory', '.'],
  });
  // A listing on screen, which a refresh reads again.
  const shown = client.fetchQuery(listing);
  reads[0]?.resolve('before');
  await shown;
  client.invalidateQueries({ queryKey: listing.queryKey, refetchType: 'all' }).catch(() => null);
  await vi.waitFor(() => expect(reads).toHaveLength(2));
  // A loader that waits for the listing joins that read.
  const read = fetchLatest(client, listing);
  // The worker tells of a change to it, which reads it again in place of the read under way.
  client.invalidateQueries({ queryKey: listing.queryKey, refetchType: 'all' }).catch(() => null);
  await vi.waitFor(() => expect(reads).toHaveLength(3));
  reads[1]?.resolve('cancelled');
  reads[2]?.resolve('after');
  await expect(read).resolves.toBe('after');
});

test('a read cancelled with no newer one, as the session closes, fails rather than reading again', async () => {
  const client = createQueryClient();
  const reads: PromiseWithResolvers<string>[] = [];
  const listing = queryOptions({
    queryFn: () => {
      const read = Promise.withResolvers<string>();
      reads.push(read);
      return read.promise;
    },
    queryKey: ['directory', '.'],
  });
  const shown = client.fetchQuery(listing);
  reads[0]?.resolve('before');
  await shown;
  client.invalidateQueries({ queryKey: listing.queryKey, refetchType: 'all' }).catch(() => null);
  await vi.waitFor(() => expect(reads).toHaveLength(2));
  const read = fetchLatest(client, listing);
  client.clear();
  await expect(read).rejects.toThrow('CancelledError');
  expect(reads).toHaveLength(2);
});
