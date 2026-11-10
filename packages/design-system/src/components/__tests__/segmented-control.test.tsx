import { SegmentedControl } from '#components/segmented-control';
import { useState } from 'react';
import { expect, test } from 'vitest';
import { render } from 'vitest-browser-react';
import { page, userEvent } from 'vitest/browser';

function Views({ changes }: { changes: string[] }) {
  const [value, setValue] = useState<'grid' | 'list'>('grid');
  return (
    <>
      <button type="button">Before</button>
      <SegmentedControl
        label="View"
        value={value}
        onChange={(next) => {
          changes.push(next);
          setValue(next);
        }}
        segments={[
          { icon: null, label: 'Grid', value: 'grid' },
          { icon: null, label: 'List', value: 'list' },
        ]}
      />
      <button type="button">After</button>
    </>
  );
}

test('is one Tab stop, with the arrow keys moving between segments', async () => {
  await render(<Views changes={[]} />);
  await userEvent.click(page.getByRole('button', { name: 'Before' }));
  await userEvent.keyboard('{Tab}');
  await expect.element(page.getByRole('button', { name: 'Grid' })).toHaveFocus();
  // Its tooltip is still tied to it.
  await expect
    .element(page.getByRole('button', { name: 'Grid' }))
    .toHaveAttribute('interestfor', expect.stringContaining('grid'));
  await userEvent.keyboard('{ArrowRight}');
  await expect.element(page.getByRole('button', { name: 'List' })).toHaveFocus();
  await userEvent.keyboard('{Tab}');
  await expect.element(page.getByRole('button', { name: 'After' })).toHaveFocus();
});

test('chooses a segment, and pressing the chosen one keeps it chosen', async () => {
  const changes: string[] = [];
  await render(<Views changes={changes} />);
  const list = page.getByRole('button', { name: 'List' });
  await userEvent.click(list);
  await expect.element(list).toHaveAttribute('aria-pressed', 'true');
  await expect
    .element(page.getByRole('button', { name: 'Grid' }))
    .toHaveAttribute('aria-pressed', 'false');
  await userEvent.click(list);
  await expect.element(list).toHaveAttribute('aria-pressed', 'true');
  expect(changes).toEqual(['list']);
});
