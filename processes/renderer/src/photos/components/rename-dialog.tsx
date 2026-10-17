import { Button, Dialog, TextField } from '@app/design-system';
import type { PhotoEntry } from '@app/shared';
import { useCallback } from 'react';
import { useFetcher } from 'react-router';

type RenameResult = { error: string } | { renamed: PhotoEntry; refreshed: boolean };

/** The part of a name before its extension, which renaming starts with selected, as Finder does. */
function stem(entry: PhotoEntry) {
  const dot = entry.name.lastIndexOf('.');
  return entry.kind === 'directory' || dot <= 0 ? entry.name.length : dot;
}

export function RenameDialog({ entry, onClose }: { entry: PhotoEntry; onClose: () => void }) {
  const fetcher = useFetcher<RenameResult>();
  // Set before the dialog focuses the field, which keeps the selection. Stable, so a failed
  // attempt leaves what was typed as it was.
  const selectStem = useCallback(
    (input: HTMLInputElement | null) => input?.setSelectionRange(0, stem(entry)),
    [entry]
  );
  // Done once renamed; the parent opens a new dialog for the next rename.
  if (fetcher.data && 'renamed' in fetcher.data) {
    return null;
  }
  const error = fetcher.data?.error;
  const busy = fetcher.state !== 'idle';
  return (
    <Dialog label={`Rename ${entry.name}`} onClose={onClose} size="small">
      <fetcher.Form method="post" action="/library" className="flex flex-col gap-4 p-4">
        <h2 className="text-headline truncate font-semibold">Rename “{entry.name}”</h2>
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
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={busy}>
            Rename
          </Button>
        </div>
      </fetcher.Form>
    </Dialog>
  );
}
