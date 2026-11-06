import { readAhead, readInOrder } from '#photos/read-ahead';
import { setTimeout as wait } from 'node:timers/promises';
import { expect, test } from 'vitest';

async function* slowly(items: string[], log: string[], failAfter = Infinity) {
  for (const [index, item] of items.entries()) {
    if (index >= failAfter) {
      throw new Error(`failed after ${item}`);
    }
    await wait(5);
    log.push(item);
    yield item;
  }
}

async function collect(source: AsyncIterable<string>) {
  const items = [];
  for await (const item of source) {
    items.push(item);
  }
  return items;
}

test('sources read at once and are consumed in order', async () => {
  const log: string[] = [];
  const first = readAhead(slowly(['a1', 'a2', 'a3'], log));
  const second = readAhead(slowly(['b1', 'b2', 'b3'], log));
  expect(await collect(first)).toEqual(['a1', 'a2', 'a3']);
  // The second source kept reading while the first was consumed.
  expect(log.slice(0, 4).toSorted()).toEqual(['a1', 'a2', 'b1', 'b2']);
  expect(await collect(second)).toEqual(['b1', 'b2', 'b3']);
});

test('an error ends the iteration where it happened', async () => {
  const source = readAhead(slowly(['a', 'b', 'c'], [], 2));
  const items: string[] = [];
  await expect(
    (async () => {
      for await (const item of source) {
        items.push(item);
      }
    })(),
  ).rejects.toThrow(/failed after c/u);
  expect(items).toEqual(['a', 'b']);
});

test('an error nobody iterates to is dropped', async () => {
  readAhead(slowly(['a'], [], 0));
  await wait(20);
});

test('reading in order reads sources ahead, takes ones added meanwhile, and stops at the limit', async () => {
  const sources = ['a', 'b'];
  const started: string[] = [];
  const read = async function* read(source: string) {
    started.push(source);
    await wait(5);
    yield `${source}1`;
    yield `${source}2`;
  };
  const items = [];
  for await (const [source, item] of readInOrder(sources, read, {
    ahead: 2,
    limit: 3,
    signal: new AbortController().signal,
  })) {
    items.push(item);
    if (item === 'a1') {
      sources.push('c', 'd');
      // Two sources at once: c waits until a is done.
      expect(started).toEqual(['a', 'b']);
    }
    expect(source).toBe(item[0]);
  }
  expect(items).toEqual(['a1', 'a2', 'b1', 'b2', 'c1', 'c2']);
  expect(started).toEqual(['a', 'b', 'c']);
});

test('reading in order stops the reads ahead when it ends early', async () => {
  const signals: AbortSignal[] = [];
  const read = async function* read(source: string, signal: AbortSignal) {
    signals.push(signal);
    await wait(5);
    yield source;
  };
  const reading = readInOrder(['a', 'b', 'c'], read, {
    ahead: 3,
    signal: new AbortController().signal,
  });
  await reading.next();
  await reading.return();
  expect(signals).toHaveLength(3);
  expect(signals.every((signal) => signal.aborted)).toBe(true);
});
