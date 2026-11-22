import { stat } from 'node:fs/promises';

// What a share answers as it drops or stalls, which says nothing of the file asked for.
const UNREACHABLE_CODES = new Set(['EHOSTDOWN', 'EIO', 'ENOTCONN', 'ETIMEDOUT']);

/**
 * Of `failures` to read photos of the library at `root`, those that are the files' own, which
 * the catalog may keep as unreadable: none while the library's folder cannot be looked at, as
 * when its share is offline, and none that failed as a share does when it goes. A photo of an
 * offline share is not unreadable, so the rest are left unread for a later session.
 *
 * A small stand-in until the worker knows of offline libraries itself, which replaces it.
 */
export async function filesOwnFailures<Failure extends { error: unknown }>(
  root: string,
  failures: Failure[],
): Promise<Failure[]> {
  if (failures.length === 0) {
    return [];
  }
  const reachable = await stat(root).then(
    () => true,
    () => false,
  );
  return reachable ? failures.filter(({ error }) => !UNREACHABLE_CODES.has(codeOf(error))) : [];
}

function codeOf(error: unknown) {
  return error instanceof Error && 'code' in error ? String(error.code) : '';
}
