import { Listeners } from '#mechanisms/listeners';
import { expect, test, vi } from 'vitest';

test('every listener is called with each value', () => {
  const listeners = new Listeners<number>();
  const first = vi.fn();
  const second = vi.fn();
  listeners.add(first);
  listeners.add(second);
  listeners.tell(1);
  listeners.tell(2);
  expect(first.mock.calls).toEqual([[1], [2]]);
  expect(second.mock.calls).toEqual([[1], [2]]);
});

test('a removed listener is not called again, and the others still are', () => {
  const listeners = new Listeners<string>();
  const removed = vi.fn();
  const kept = vi.fn();
  const remove = listeners.add(removed);
  listeners.add(kept);
  remove();
  listeners.tell('after');
  expect(removed).not.toHaveBeenCalled();
  expect(kept).toHaveBeenCalledWith('after');
});

test('a listener can remove itself while it is being called', () => {
  const listeners = new Listeners();
  const calls: string[] = [];
  const remove = listeners.add(() => {
    calls.push('once');
    remove();
  });
  listeners.add(() => calls.push('always'));
  listeners.tell();
  listeners.tell();
  expect(calls).toEqual(['once', 'always', 'always']);
});
