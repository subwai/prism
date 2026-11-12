import { theTrash } from '#data/trash';
import { type TrashRunShown, trashRunsOf } from '#data/trash-runs';
import { useLibrary } from '#hooks/use-library';
import { useGlobalCommands } from '#keyboard/commands';
import { Button, Toast } from '@prism/design-system';
import { useSyncExternalStore } from 'react';
import { useFetcher } from 'react-router';

function counted(count: number, one: string, many = `${one}s`) {
  return `${count.toLocaleString()} ${count === 1 ? one : many}`;
}

/** What a run did, in a sentence. */
function ranText({ result, items }: TrashRunShown) {
  const { trashed, moved, skipped, error, destination } = result;
  const to = theTrash(destination);
  if (error) {
    return `${error} ${trashed.toLocaleString()} moved to ${to} before it stopped.`;
  }
  const parts = [
    skipped === 0
      ? `Moved ${counted(items, 'item')} to ${to}`
      : `Moved ${trashed.toLocaleString()} to ${to}`,
  ];
  if (moved > 0) {
    parts.push(`${moved.toLocaleString()} moved out`);
  }
  if (skipped > 0) {
    parts.push(`${skipped.toLocaleString()} ${skipped === 1 ? 'was' : 'were'} already gone`);
  }
  return parts.join(' · ');
}

/** What undoing a run put back, in a sentence: as many items as went, if all came back. */
function undoneText({ undone, items, result }: TrashRunShown) {
  if (!undone || undone.restored === undefined) {
    return undone?.error ?? '';
  }
  const from = theTrash(result.destination);
  const all = result.trashed + result.moved;
  const parts = [
    undone.restored === all && !undone.error
      ? `Put back ${counted(items, 'item')} from ${from}`
      : `Put back ${undone.restored.toLocaleString()} of ${all.toLocaleString()} from ${from}`,
  ];
  if (undone.renamed.length > 0) {
    parts.push(
      `${undone.renamed.length.toLocaleString()} under new names, as their places were taken`,
    );
  }
  return undone.error ? `${undone.error} ${parts.join(' · ')}.` : parts.join(' · ');
}

/**
 * What the last run to the Trash did, for a few seconds after, with Undo; then what Undo put
 * back, as a toast of its own. It stays while the pointer or focus rests on it. ⌘Z undoes the
 * last run too, after its toast has gone.
 */
export function TrashToast() {
  const trashRuns = trashRunsOf(useLibrary());
  const { shown, undoable } = useSyncExternalStore(trashRuns.subscribe, trashRuns.getSnapshot);
  const undo = useFetcher({ key: 'undo-trash' });
  const runId = undoable?.result.runId;
  function undoLast() {
    if (runId && undo.state === 'idle') {
      undo
        .submit({ intent: 'undo-trash', runId }, { action: '/library', method: 'post' })
        .catch(() => null);
    }
  }
  // ⌘Z, while there is a run to put back; otherwise it undoes typing, as the Edit menu does.
  useGlobalCommands(runId ? { undo: undoLast } : {});
  if (!shown) {
    return null;
  }
  const failed = Boolean(shown.result.error) || Boolean(shown.undone?.error);
  return (
    <div
      // What Undo put back shows as a toast of its own.
      key={shown.undone ? 'undone' : 'ran'}
      onPointerEnter={() => trashRuns.hold(true)}
      onPointerLeave={() => trashRuns.hold(false)}
      onFocus={() => trashRuns.hold(true)}
      onBlur={() => trashRuns.hold(false)}
    >
      <Toast tone={failed ? 'warning' : 'info'}>
        <span className="flex items-center gap-3">
          <span>{shown.undone ? undoneText(shown) : ranText(shown)}</span>
          {!shown.undone && shown.result.runId === runId && runId && (
            <Button disabled={undo.state !== 'idle'} onClick={undoLast}>
              {undo.state === 'idle' ? 'Undo' : 'Putting back…'}
            </Button>
          )}
        </span>
      </Toast>
    </div>
  );
}
