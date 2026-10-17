import type { ResourceCache } from '#photos/data/resource-cache';

/* Old results stay on screen while fresh ones load, after a refresh or a change on disk. */

export interface Cached<Value> {
  /** False for a value read before a refresh or change, shown until the fresh one arrives. */
  fresh: boolean;
  value: Value;
}

export function peek<Value>(
  cache: ResourceCache<Value>,
  stale: Map<string, Value>,
  key: string
): Cached<Value> | null {
  const settled = cache.peek(key);
  if (settled) {
    return { fresh: true, value: settled.value };
  }
  const previous = stale.get(key);
  return previous === undefined ? null : { fresh: false, value: previous };
}

/** Keeps `settled`, if there was one, to show until its fresh value arrives. */
export function keep<Value>(
  stale: Map<string, Value>,
  key: string,
  settled: { value: Value } | null
) {
  if (settled) {
    stale.delete(key);
    stale.set(key, settled.value);
  }
}

/** Newest results win; repeated refreshes keep at most `limit` stale entries. */
export function carryOver<Value>(
  stale: Map<string, Value>,
  fresh: Map<string, Value>,
  limit: number
) {
  return new Map([...stale, ...fresh].slice(-limit));
}
