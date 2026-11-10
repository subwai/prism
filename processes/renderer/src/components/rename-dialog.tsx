import { Button, Dialog, DialogFooter, DialogTitle, TextField } from '@prism/design-system';
import type { PhotoEntry } from '@prism/shared';
import { useId } from 'react';
import { useFetcher } from 'react-router';

type RenameResult = { error: string } | { renamed: PhotoEntry; refreshed: boolean };

/** The part of a name before its extension, which renaming starts with selected, as Finder does. */
function stem(entry: PhotoEntry) {
  const dot = entry.name.lastIndexOf('.');
  return entry.kind === 'directory' || dot <= 0 ? entry.name.length : dot;
}

export function RenameDialog({ entry, onClose }: { entry: PhotoEntry; onClose: () => void }) {
  const fetcher = useFetcher<RenameResult>();
  const titleId = useId();
  // Set before the dialog focuses the field, which keeps the selection. Stable, so a failed
  // attempt leaves what was typed as it was.
  const selectStem = (input: HTMLInputElement | null) => input?.setSelectionRange(0, stem(entry));
  // Done once renamed; the parent opens a new dialog for the next rename.
  if (fetcher.data && 'renamed' in fetcher.data) {
    return null;
  }
  const error = fetcher.data?.error;
  const busy = fetcher.state !== 'idle';
  return (
    <Dialog labelledBy={titleId} onClose={onClose} size="small">
      {/* Passes its children through, for the dialog to lay out. */}
      <fetcher.Form method="post" action="/library" className="contents">
        <DialogTitle id={titleId}>Rename “{entry.name}”</DialogTitle>
        <input type="hidden" name="intent" value="rename" />
        <input type="hidden" name="entryId" value={entry.id} />
        <TextField
          label="Name"
          name="name"
          defaultValue={entry.name}
          required
          autoFocus
          error={error}
          ref={selectStem}
        />
        <DialogFooter>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={busy}>
            Rename
          </Button>
        </DialogFooter>
      </fetcher.Form>
    </Dialog>
  );
}
