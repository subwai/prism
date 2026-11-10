import { ResizeHandle } from '#components/resize-handle';
import { useState } from 'react';
import { expect, test } from 'vitest';
import { render } from 'vitest-browser-react';
import { page, userEvent } from 'vitest/browser';

/**
 * A strip along the bottom, 100px tall until its top edge moves, with a mark as tall as the edge
 * 60px above it. This suite has no Tailwind, so a rule of its own lays out the edge as its
 * classes would.
 */
function Strip() {
  const [height, setHeight] = useState(100);
  return (
    <div style={{ height: 400, position: 'relative' }}>
      <style>{'[role="separator"] { position: absolute; inset: 0 0 auto; height: 6px; }'}</style>
      <div
        data-testid="mark"
        style={{ height: 6, position: 'absolute', top: 240, width: '100%' }}
      />
      <div id="strip" style={{ bottom: 0, height, position: 'absolute', width: '100%' }}>
        <ResizeHandle
          edge="top"
          label="Resize strip"
          controls="strip"
          value={height}
          min={50}
          max={200}
          onResize={(next) => setHeight(Math.min(Math.max(next, 50), 200))}
          onReset={() => setHeight(100)}
        />
      </div>
    </div>
  );
}

test('grows the pane as its top edge is dragged up', async () => {
  await render(<Strip />);
  const handle = page.getByRole('separator', { name: 'Resize strip' });
  await expect.element(handle).toHaveAttribute('aria-valuenow', '100');
  await userEvent.dragAndDrop(handle, page.getByTestId('mark'));
  // Dragged from the strip's top, 300px down, to the mark 60px above it.
  await expect.element(handle).toHaveAttribute('aria-valuenow', '160');
});

test('moves with the arrow keys, and goes back to its size on a double-click', async () => {
  await render(<Strip />);
  const handle = page.getByRole('separator', { name: 'Resize strip' });
  await expect.element(handle).toHaveAttribute('aria-orientation', 'horizontal');
  // Pressing it starts a drag rather than focusing it, so it is reached with Tab.
  await userEvent.keyboard('{Tab}');
  await expect.element(handle).toHaveFocus();
  await userEvent.keyboard('{ArrowUp}{ArrowUp}');
  await expect.element(handle).toHaveAttribute('aria-valuenow', '132');
  await userEvent.keyboard('{ArrowDown}');
  await expect.element(handle).toHaveAttribute('aria-valuenow', '116');
  await userEvent.dblClick(handle);
  await expect.element(handle).toHaveAttribute('aria-valuenow', '100');
});
