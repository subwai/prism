import { RenameDialog } from '#photos/components/rename-dialog';
import { useLibrary } from '#photos/hooks/use-library';
import type { PhotoEntry } from '@app/shared';
import { createContext, type MouseEvent, type ReactNode, use, useCallback, useState } from 'react';

type ShowEntryMenu = (event: MouseEvent, entry: PhotoEntry) => void;

const EntryMenuContext = createContext<ShowEntryMenu | null>(null);

/** Shows the system's right-click menu for an entry, such as to reveal it in Finder. */
export function useEntryMenu() {
  const show = use(EntryMenuContext);
  if (!show) {
    throw new Error('An entry menu is required');
  }
  return show;
}

/** Provides `useEntryMenu`, and carries out what the menu leaves to the window: renaming. */
export function EntryMenu({ children }: { children: ReactNode }) {
  const library = useLibrary();
  // Keyed per rename, so each one starts with a fresh form.
  const [renaming, setRenaming] = useState<{ entry: PhotoEntry; key: number } | null>(null);
  const show = useCallback(
    (event: MouseEvent, entry: PhotoEntry) => {
      event.preventDefault();
      library.api
        .showEntryMenu(entry.id)
        .then((action) => {
          if (action === 'rename') {
            setRenaming((previous) => ({ entry, key: (previous?.key ?? 0) + 1 }));
          }
        })
        // A folder closed meanwhile has no menu to show.
        .catch(() => null);
    },
    [library]
  );
  return (
    <EntryMenuContext value={show}>
      {children}
      {renaming && (
        <RenameDialog key={renaming.key} entry={renaming.entry} onClose={() => setRenaming(null)} />
      )}
    </EntryMenuContext>
  );
}
