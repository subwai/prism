import { RenameDialog } from '#components/rename-dialog';
import { useLibrary, usePendingEdits } from '#hooks/use-library';
import type { MenuPosition, PhotoEntry } from '@prism/shared';
import { createContext, type MouseEvent, type ReactNode, use, useState } from 'react';

/** Shows the menu for `entry` at the pointer, for a right-click on it. */
type ShowEntryMenu = (event: MouseEvent, entry: PhotoEntry) => void;

/**
 * Shows the menu for `entry` below its element on screen, which `locate` finds, as for a menu
 * opened from the keyboard. Callers scroll the element into view first.
 */
type ShowEntryMenuBelow = (entry: PhotoEntry, locate: () => Element | null | undefined) => void;

const EntryMenuContext = createContext<{
  show: ShowEntryMenu;
  showBelow: ShowEntryMenuBelow;
  rename: (entry: PhotoEntry) => void;
} | null>(null);

function useEntryActions() {
  const actions = use(EntryMenuContext);
  if (!actions) {
    throw new Error('An entry menu is required');
  }
  return actions;
}

/** Shows the system's right-click menu for an entry, such as to reveal it in Finder. */
export function useEntryMenu() {
  return useEntryActions().show;
}

/** Shows an entry's menu below it, for the `contextMenu` command. */
export function useEntryMenuBelow() {
  return useEntryActions().showBelow;
}

/** Starts renaming an entry, as choosing Rename… from its menu does. */
export function useRenameEntry() {
  return useEntryActions().rename;
}

/** Provides `useEntryMenu`, and carries out what the menu leaves to the window: renaming. */
export function EntryMenu({ children }: { children: ReactNode }) {
  const library = useLibrary();
  // Keyed per rename, so each one starts with a fresh form.
  const [renaming, setRenaming] = useState<{ entry: PhotoEntry; key: number } | null>(null);
  // The entries renames were sent for, by ID, to ask again for any that fails.
  const [sent, setSent] = useState<ReadonlyMap<string, PhotoEntry>>(new Map());
  const { failures } = usePendingEdits();
  const send = (entry: PhotoEntry) => {
    setSent((previous) => new Map([...previous, [entry.id, entry]]));
    setRenaming(null);
  };
  const rename = (entry: PhotoEntry) => {
    // The open folder itself is renamed from its parent instead, as its menu says.
    if (entry.id !== library.root.id) {
      setRenaming((previous) => ({ entry, key: (previous?.key ?? 0) + 1 }));
    }
  };
  const open = (entry: PhotoEntry, position?: MenuPosition) => {
    library.api
      .showEntryMenu(entry.id, position)
      .then((action) => {
        if (action === 'rename') {
          rename(entry);
        }
      })
      // A folder closed meanwhile has no menu to show.
      .catch(() => null);
  };
  const show: ShowEntryMenu = (event, entry) => {
    event.preventDefault();
    open(entry);
  };
  const showBelow: ShowEntryMenuBelow = (entry, locate) => {
    // Measured a frame later: a virtualized list that has just scrolled the entry into view
    // renders it there on the scroll event, which comes first. The virtualizer offers no
    // callback for that. An entry still missing gets its menu at the pointer.
    requestAnimationFrame(() => {
      const box = locate()?.getBoundingClientRect();
      open(entry, box && { left: box.left, top: box.bottom });
    });
  };
  const actions = { rename, show, showBelow };
  return (
    <EntryMenuContext value={actions}>
      {children}
      {renaming && (
        <RenameDialog
          key={renaming.key}
          entry={renaming.entry}
          onSent={() => send(renaming.entry)}
          onClose={() => setRenaming(null)}
        />
      )}
      {/* Each rename that failed says why, even if another was started meanwhile. */}
      {[...failures].map(([id, failure]) => {
        const entry = sent.get(id);
        const seen = () => library.edits.dismiss(id);
        return (
          entry && (
            <RenameDialog
              key={`failed:${id}`}
              entry={entry}
              failure={failure}
              onSent={seen}
              onClose={seen}
            />
          )
        );
      })}
    </EntryMenuContext>
  );
}
