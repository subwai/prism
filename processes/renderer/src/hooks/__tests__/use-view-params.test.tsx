import { renderInLibrary } from '#components/__tests__/render';
import { useViewParams } from '#hooks/use-view-params';
import { expect, test } from 'vitest';

/** Opens a preview and searches in one task, as choosing something can, then closes it. */
function Controls() {
  const view = useViewParams();
  return (
    <>
      <button
        type="button"
        onClick={() => {
          view.openPreview('beach.jpg');
          view.setSearch('beach');
        }}
      >
        Open
      </button>
      <button type="button" onClick={() => view.closePreview()}>
        Close
      </button>
      <output data-testid="params">{view.params.toString()}</output>
    </>
  );
}

test('a preview opened together with another change still closes by going back', async () => {
  const { screen } = await renderInLibrary(<Controls />);
  const params = screen.getByTestId('params');
  await screen.getByRole('button', { name: 'Open' }).click();
  await expect.element(params).toHaveTextContent('preview=beach.jpg&q=beach');
  await screen.getByRole('button', { name: 'Close' }).click();
  // Back to before the preview opened, rather than the preview cleared from a step of its own.
  await expect.element(params).toBeEmptyDOMElement();
});
