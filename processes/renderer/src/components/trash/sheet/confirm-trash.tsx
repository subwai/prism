import { confirmLabel } from '#data/trash/location-labels';
import { trashRunsOf } from '#data/trash/runs';
import type { GalleryView } from '#data/views/gallery-view';
import { useLibrary } from '#hooks/use-library';
import { Button } from '@prism/design-system';
import type { TrashChoices, TrashLocation, TrashRunResult } from '@prism/shared';
import { useState, useSyncExternalStore } from 'react';
import { useFetcher } from 'react-router';

/**
 * Moves what the plan shows to the Trash, or deletes it for good where `trashLocation` says so, through
 * the library's action, showing how far it has got. Once it has run, the sheet closes and the
 * toast says what it did; if it could not start, as when the folder changed since, it says why
 * here. It waits for a plan of every rating, made of the choices as they are, which `ready`
 * says, and to delete for good, for the person to tick that they understand.
 */
export function ConfirmTrash({
  view,
  version,
  choices,
  trashLocation,
  entries,
  ready,
  onDone,
}: {
  view: GalleryView;
  version: number;
  choices: TrashChoices;
  trashLocation: TrashLocation;
  /** How many entries the plan moves to the Trash. */
  entries: number;
  ready: boolean;
  onDone: () => void;
}) {
  const library = useLibrary();
  const trashRuns = trashRunsOf(library);
  const { progress } = useSyncExternalStore(trashRuns.subscribe, trashRuns.getSnapshot);
  const fetcher = useFetcher<TrashRunResult>();
  const [understood, setUnderstood] = useState(false);
  const deletes = trashLocation.destination === 'delete';
  const pending = deletes ? 'Deleting…' : 'Moving…';
  const running = fetcher.state !== 'idle';
  const refused = !running && fetcher.data?.kind === 'failed' ? fetcher.data.error : undefined;
  async function confirm() {
    await fetcher.submit(
      {
        choices: JSON.stringify(choices),
        destination: trashLocation.destination,
        entries,
        intent: 'trash',
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
        disabled={!ready || entries === 0 || running || (deletes && !understood)}
        onClick={() => {
          confirm().catch(() => null);
        }}
      >
        {running ? pending : confirmLabel(trashLocation, entries)}
      </Button>
    </>
  );
}
