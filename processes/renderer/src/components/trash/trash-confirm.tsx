import type { GalleryView } from '#data/gallery-view';
import { confirmLabel } from '#data/trash';
import { trashRunsOf } from '#data/trash-runs';
import { useLibrary } from '#hooks/use-library';
import { Button } from '@prism/design-system';
import type { TrashChoices, TrashPlace, TrashResult } from '@prism/shared';
import { useState, useSyncExternalStore } from 'react';
import { useFetcher } from 'react-router';

/**
 * Moves what the plan shows to the Trash, or deletes it for good where `place` says so, through
 * the library's action, showing how far it has got. Once it has run, the sheet closes and the
 * toast says what it did; if it could not start, as when the folder changed since, it says why
 * here. It waits for a plan of every rating, made of the choices as they are, which `ready`
 * says, and to delete for good, for the person to tick that they understand.
 */
export function ConfirmTrash({
  view,
  version,
  choices,
  place,
  items,
  ready,
  onDone,
}: {
  view: GalleryView;
  version: number;
  choices: TrashChoices;
  place: TrashPlace;
  /** How many items the plan moves to the Trash. */
  items: number;
  ready: boolean;
  onDone: () => void;
}) {
  const library = useLibrary();
  const trashRuns = trashRunsOf(library);
  const { progress } = useSyncExternalStore(trashRuns.subscribe, trashRuns.getSnapshot);
  const fetcher = useFetcher<TrashResult>();
  const [understood, setUnderstood] = useState(false);
  const deletes = place.destination === 'delete';
  const pending = deletes ? 'Deleting…' : 'Moving…';
  const running = fetcher.state !== 'idle';
  const refused = !running && fetcher.data?.runId === undefined ? fetcher.data?.error : undefined;
  async function confirm() {
    await fetcher.submit(
      {
        choices: JSON.stringify(choices),
        destination: place.destination,
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
          aria-label={deletes ? 'Deleting' : 'Moving to the Trash'}
          className="w-24"
          value={progress.done}
          max={progress.total}
        />
      )}
      {deletes && (
        <label className="flex items-center gap-1.5 text-sm">
          <input
            type="checkbox"
            checked={understood}
            disabled={running}
            onChange={(event) => setUnderstood(event.target.checked)}
            className="accent-danger"
          />
          I understand these can’t be recovered
        </label>
      )}
      <Button
        variant={deletes ? 'danger' : 'primary'}
        disabled={!ready || items === 0 || running || (deletes && !understood)}
        onClick={() => {
          confirm().catch(() => null);
        }}
      >
        {running ? pending : confirmLabel(place, items)}
      </Button>
    </>
  );
}
