import { cn, tv } from '#cn';
import { describe, expect, test } from 'vitest';

describe('cn', () => {
  test('skips falsy entries', () => {
    expect(cn('flex', false, null, undefined, '', 'gap-1')).toBe('flex gap-1');
  });

  test('keeps a size and a colour, which share the text- prefix', () => {
    expect(cn('text-sm text-label-secondary')).toBe('text-sm text-label-secondary');
    expect(cn('text-base text-label')).toBe('text-base text-label');
  });

  test.each([
    ['text-sm', 'text-base'],
    ['text-label', 'text-label-secondary'],
    ['rounded-control', 'rounded-full'],
    ['rounded-s-pill-end', 'rounded-s-control'],
    ['shadow-button', 'shadow-none'],
    ['h-titlebar', 'h-7'],
    ['tracking-eyebrow', 'tracking-normal'],
    ['icon-md', 'icon-lg'],
    ['drag', 'no-drag'],
    ['sheet-large', 'sheet-medium'],
    ['ease-jelly', 'ease-out'],
    ['text-shadow-overlay', 'text-shadow-none'],
  ])('lets %s be replaced by %s', (base, override) => {
    expect(cn(base, override)).toBe(override);
  });
});

describe('tv', () => {
  test('merges a class name over its variants', () => {
    const box = tv({
      base: 'rounded-card p-4',
      variants: { tone: { quiet: 'text-label-tertiary' } },
    });
    expect(box({ className: 'rounded-window p-0', tone: 'quiet' })).toBe(
      'text-label-tertiary rounded-window p-0',
    );
  });
});
