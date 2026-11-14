import type { RenameFailure } from '#data/pending-edits';
import { Button, Dialog, DialogFooter, DialogTitle, TextField } from '@prism/design-system';
import type { PhotoEntry } from '@prism/shared';
import { useId } from 'react';
import { useFetcher } from 'react-router';

/**
 * How much of `name` renaming starts with selected, as Finder does: the part before its
 * extension, or all of a folder's.
 */
function stem(name: string, kind: PhotoEntry['kind']) {
  const dot = name.lastIndexOf('.');
  return kind === 'directory' || dot <= 0 ? name.length : dot;
}

/**
 * Asks for an entry's new name, or after a `failure` for another, saying why. The new name
 * shows wherever the entry is as soon as it is sent, so the dialog goes then (`onSent`); a
 * rename that fails comes back as a dialog of its own, from the library's pending edits.
 */
export function RenameDialog({
  entry,
  failure,
  onSent,
  onClose,
}: {
  entry: PhotoEntry;
  failure?: RenameFailure;
  onSent: () => void;
  onClose: () => void;
}) {
  // Kept after the dialog goes, until the rename is done, as React Router keeps fetchers.
  const fetcher = useFetcher();
  const titleId = useId();
  const typed = failure?.name ?? entry.name;
  // Set before the dialog focuses the field, which keeps the selection.
  const selectStem = (input: HTMLInputElement | null) =>
    input?.setSelectionRange(0, stem(typed, entry.kind));
  return (
    <Dialog labelledBy={titleId} onClose={onClose} size="small">
      {/* Passes its children through, for the dialog to lay out. */}
      <fetcher.Form method="post" action="/library" className="contents" onSubmit={onSent}>
        <DialogTitle id={titleId}>Rename “{entry.name}”</DialogTitle>
        <input type="hidden" name="intent" value="rename" />
        <input type="hidden" name="entryId" value={entry.id} />
        <TextField
          label="Name"
          name="name"
          defaultValue={typed}
          required
          autoFocus
          error={failure?.error}
          ref={selectStem}
        />
        <DialogFooter>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary">
            Rename
          </Button>
        </DialogFooter>
      </fetcher.Form>
    </Dialog>
  );
}
