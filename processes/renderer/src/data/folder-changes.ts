import { isWithin } from '#data/trails';
import type { Query } from '@tanstack/react-query';

/**
 * Which folder summaries to read again once the folders `relisted` list something different.
 * Covers can come from deep inside a folder, so it is those of the folders holding each, up to
 * the root at `rootId`, and no others.
 */
export function coversChangedBy(rootId: string, relisted: ReadonlySet<string>) {
  return ({ queryKey: [kind, folderId] }: Query) =>
    kind === 'summary' &&
    [...relisted].some((parentId) => isWithin(rootId, String(folderId), parentId));
}
