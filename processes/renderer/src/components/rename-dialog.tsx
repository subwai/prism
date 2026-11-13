import { Button, Dialog, DialogFooter, DialogTitle, TextField } from '@prism/design-system';
import type { PhotoEntry } from '@prism/shared';
import { useId, useState } from 'react';
import { useFetcher } from 'react-router';

type RenameResult = { error: string } | { renamed: PhotoEntry; refreshed: boolean };

/**
 * How much of `name` renaming starts with selected, as Finder does: the part before its
 * extension, or all of a folder's.
 */
function stem(name: string, kind: PhotoEntry['kind']) {
  const dot = name.lastIndexOf('.');
  return kind === 'directory' || dot <= 0 ? name.length : dot;
}

/**
 * Asks for an entry's new name. The new name shows wherever the entry is as soon as it is sent,
 * so the dialog goes then, and comes back with what was typed to say why if the rename fails.
 */
export function RenameDialog({ entry, onClose }: { entry: PhotoEntry; onClose: () => void }) {
  const fetcher = useFetcher<RenameResult>();
  const titleId = useId();
  const [typed, setTyped] = useState(entry.name);
  // Set before the dialog focuses the field, which keeps the selection.
  const selectStem = (input: HTMLInputElement | null) =>
    input?.setSelectionRange(0, stem(typed, entry.kind));
  // Hidden while it renames, and done once renamed; the parent opens a new dialog for the next.
  if (fetcher.state !== 'idle' || (fetcher.data && 'renamed' in fetcher.data)) {
    return null;
  }
  const error = fetcher.data?.error;
  return (
    <Dialog labelledBy={titleId} onClose={onClose} size="small">
      {/* Passes its children through, for the dialog to lay out. */}
      <fetcher.Form
        method="post"
        action="/library"
        className="contents"
        onSubmit={(event) => setTyped(String(new FormData(event.currentTarget).get('name')))}
      >
        <DialogTitle id={titleId}>Rename “{entry.name}”</DialogTitle>
        <input type="hidden" name="intent" value="rename" />
        <input type="hidden" name="entryId" value={entry.id} />
        <TextField
          label="Name"
          name="name"
          defaultValue={typed}
          required
          autoFocus
          error={error}
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
