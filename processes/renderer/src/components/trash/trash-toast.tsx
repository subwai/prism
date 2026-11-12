import { type TrashRunShown, trashRunsOf } from '#data/trash-runs';
import { useLibrary } from '#hooks/use-library';
import { Button, Toast } from '@prism/design-system';
import { useSyncExternalStore } from 'react';
import { useFetcher } from 'react-router';

function counted(count: number, one: string, many = `${one}s`) {
  return `${count.toLocaleString()} ${count === 1 ? one : many}`;
}

/** What a run did, in a sentence. */
function ranText({ result, items }: TrashRunShown) {
  const { trashed, moved, skipped, error } = result;
  if (error) {
    return `${error} ${trashed.toLocaleString()} moved to the Trash before it stopped.`;
  }
  const parts = [
    skipped === 0
      ? `Moved ${counted(items, 'item')} to the Trash`
      : `Moved ${trashed.toLocaleString()} to the Trash`,
  ];
  if (moved > 0) {
    parts.push(`${moved.toLocaleString()} moved out`);
  }
  if (skipped > 0) {
    parts.push(`${skipped.toLocaleString()} ${skipped === 1 ? 'was' : 'were'} already gone`);
  }
  return parts.join(' · ');
}

/** What undoing a run put back, in a sentence. */
function undoneText({ undone }: TrashRunShown) {
  if (!undone || undone.restored === undefined) {
    return undone?.error ?? '';
  }
  const parts = [`Put back ${counted(undone.restored, 'item')}`];
  if (undone.renamed.length > 0) {
    parts.push(
      `${undone.renamed.length.toLocaleString()} under new names, as their places were taken`,
    );
  }
  return undone.error ? `${undone.error} ${parts.join(' · ')}.` : parts.join(' · ');
}

/**
 * What the last run to the Trash did, for a few seconds after, with Undo; then what Undo put
 * back. It stays while the pointer or focus rests on it.
 */
export function TrashToast() {
  const trashRuns = trashRunsOf(useLibrary());
  const { shown } = useSyncExternalStore(trashRuns.subscribe, trashRuns.getSnapshot);
  const undo = useFetcher({ key: 'undo-trash' });
  if (!shown) {
    return null;
  }
  const { runId, error } = shown.result;
  const failed = Boolean(error) || Boolean(shown.undone?.error);
  return (
    <div
      onPointerEnter={() => trashRuns.hold(true)}
      onPointerLeave={() => trashRuns.hold(false)}
      onFocus={() => trashRuns.hold(true)}
      onBlur={() => trashRuns.hold(false)}
    >
      <Toast tone={failed ? 'warning' : 'info'}>
        <span className="flex items-center gap-3">
          <span>{shown.undone ? undoneText(shown) : ranText(shown)}</span>
          {!shown.undone && runId && (
            <Button
              disabled={undo.state !== 'idle'}
              onClick={() => {
                undo
                  .submit({ intent: 'undo-trash', runId }, { action: '/library', method: 'post' })
                  .catch(() => null);
              }}
            >
              {undo.state === 'idle' ? 'Undo' : 'Putting back…'}
            </Button>
          )}
        </span>
      </Toast>
    </div>
  );
}
