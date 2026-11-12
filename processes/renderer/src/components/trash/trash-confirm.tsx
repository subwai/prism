import type { GalleryView } from '#data/gallery-view';
import { trashRunsOf } from '#data/trash-runs';
import { useLibrary } from '#hooks/use-library';
import { Button } from '@prism/design-system';
import type { TrashChoices, TrashResult } from '@prism/shared';
import { useSyncExternalStore } from 'react';
import { useFetcher } from 'react-router';

/**
 * Moves what the plan shows to the Trash, through the library's action, showing how far it has
 * got. Once it has run, the sheet closes and the toast says what it did; if it could not start,
 * as when the folder changed since, it says why here. It waits for a plan of every rating, made
 * of the choices as they are, which `ready` says.
 */
export function ConfirmTrash({
  view,
  version,
  choices,
  items,
  ready,
  onDone,
}: {
  view: GalleryView;
  version: number;
  choices: TrashChoices;
  /** How many items the plan moves to the Trash. */
  items: number;
  ready: boolean;
  onDone: () => void;
}) {
  const trashRuns = trashRunsOf(useLibrary());
  const { progress } = useSyncExternalStore(trashRuns.subscribe, trashRuns.getSnapshot);
  const fetcher = useFetcher<TrashResult>();
  const running = fetcher.state !== 'idle';
  const refused = !running && fetcher.data?.runId === undefined ? fetcher.data?.error : undefined;
  async function confirm() {
    await fetcher.submit(
      {
        choices: JSON.stringify(choices),
        intent: 'trash',
        items,
        version,
        viewId: view.viewId,
      },
      { action: '/library', method: 'post' },
    );
    if (trashRuns.getSnapshot().shown) {
      onDone();
    }
  }
  return (
    <>
      {refused && (
        <span role="alert" className="text-warning text-sm">
          {refused}
        </span>
      )}
      {running && progress && (
        <progress
          aria-label="Moving to the Trash"
          className="w-24"
          value={progress.done}
          max={progress.total}
        />
      )}
      <Button
        variant="primary"
        disabled={!ready || items === 0 || running}
        onClick={() => {
          confirm().catch(() => null);
        }}
      >
        {running ? 'Moving…' : `Move ${items.toLocaleString()} to Trash`}
      </Button>
    </>
  );
}
