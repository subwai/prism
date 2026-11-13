import { followRenames, type Renames, withRename } from '#data/renames';
import type { PhotoEntry, Rating } from '@prism/shared';

/** A value an edit shows, and which edit of its entry it is, so only the latest settles it. */
interface Edit<Value> {
  value: Value;
  edit: number;
}

/** What the window shows of an entry ahead of the catalog: its edits under way. */
export interface EntryEdits {
  /** Stars, or `null` for none. */
  rating?: Edit<Rating | null>;
  name?: Edit<string>;
}

type Field = keyof EntryEdits;
type ValueOf<Name extends Field> = NonNullable<EntryEdits[Name]>['value'];

/**
 * The window's edits, laid over every row it shows of their entries: those under way, by the
 * ID they were made to, and the renames done in this window, which rows read before them
 * still name by their old IDs.
 */
export interface PendingEdits {
  readonly edits: ReadonlyMap<string, EntryEdits>;
  /** Entries renamed in this window, old IDs to new ones, so views holding old IDs find them. */
  readonly renames: Renames;
  /** The names entries renamed in this window took, by their new IDs. */
  readonly names: ReadonlyMap<string, string>;
}

/** `entry` rated `stars`, or with `null` unrated. */
function rated(entry: PhotoEntry, stars: Rating | null): PhotoEntry {
  const { rating: _old, ...rest } = entry;
  return stars === null ? rest : { ...rest, rating: stars };
}

function editsOf(pending: PendingEdits, entry: PhotoEntry) {
  if (pending.edits.size === 0 && pending.renames.size === 0) {
    return null;
  }
  const id = followRenames(pending.renames, entry.id);
  const name = id === entry.id ? undefined : pending.names.get(id);
  const edits = pending.edits.get(entry.id) ?? pending.edits.get(id);
  return name === undefined && !edits ? null : { edits, name };
}

/** The entries shown for each snapshot, so an edited entry stays the same object while it shows. */
const shown = new WeakMap<PendingEdits, WeakMap<PhotoEntry, PhotoEntry>>();

/**
 * `entry` as the window shows it, with the edits `pending` holds of it: a row read before a
 * rename, under its old ID, shows the new name, and an edit under way shows its value.
 */
export function shownEntry(pending: PendingEdits, entry: PhotoEntry): PhotoEntry {
  const found = editsOf(pending, entry);
  if (!found) {
    return entry;
  }
  const entries = shown.get(pending) ?? new WeakMap<PhotoEntry, PhotoEntry>();
  shown.set(pending, entries);
  const known = entries.get(entry);
  if (known) {
    return known;
  }
  const { edits, name } = found;
  let result = entry;
  const named = edits?.name?.value ?? name;
  if (named !== undefined) {
    result = { ...result, name: named };
  }
  if (edits?.rating) {
    result = rated(result, edits.rating.value);
  }
  entries.set(entry, result);
  return result;
}

const NO_EDITS: PendingEdits = { edits: new Map(), names: new Map(), renames: new Map() };

/**
 * The window's store of pending edits, which components read with `useSyncExternalStore`. An
 * edit shows the moment it starts, wherever its entry is; its answer then takes its place
 * (`settle`), or a failure drops it, and once the rows show what it did it goes. Each edit of
 * an entry's field replaces the one before, and only the latest settles or drops it, so quick
 * edits end on the last whatever order their answers come in.
 */
export function createPendingEdits() {
  let snapshot = NO_EDITS;
  let edits = 0;
  const listeners = new Set<() => void>();

  function publish(next: PendingEdits) {
    snapshot = next;
    for (const listener of listeners) {
      listener();
    }
  }

  /** `id`'s edits with `field` changed by `change`; nothing changes if it returns it as it was. */
  function update<Name extends Field>(
    id: string,
    field: Name,
    change: (edit: EntryEdits[Name]) => EntryEdits[Name],
  ) {
    const { [field]: current, ...others } = snapshot.edits.get(id) ?? {};
    const next = change(current);
    if (next === current) {
      return;
    }
    const changed: EntryEdits = next ? { ...others, [field]: next } : others;
    const all = new Map(snapshot.edits);
    if (changed.name || changed.rating) {
      all.set(id, changed);
    } else {
      all.delete(id);
    }
    publish({ ...snapshot, edits: all });
  }

  /** Drops `edit`, once the rows show what it did or it failed, if it is still the latest. */
  function drop(id: string, field: Field, edit: number) {
    update(id, field, (current) => (current?.edit === edit ? undefined : current));
  }

  return {
    /** Where `id` is now, following each rename that moved it. */
    follow: (id: string) => followRenames(snapshot.renames, id),

    /** Notes entries found at `ids`, which renames from them no longer lead away from. */
    found(ids: Iterable<string>) {
      const renames = new Map(snapshot.renames);
      for (const id of ids) {
        renames.delete(id);
      }
      if (renames.size !== snapshot.renames.size) {
        publish({ ...snapshot, renames });
      }
    },

    getSnapshot: (): PendingEdits => snapshot,

    /**
     * Notes that `edit` renamed `from` to `entry`. Rows read before it still name it `from`, and
     * show its new name for the rest of the session, until something takes that ID again.
     */
    renamed(from: string, edit: number, entry: PhotoEntry) {
      if (entry.id !== from) {
        publish({
          ...snapshot,
          names: new Map([...snapshot.names, [entry.id, entry.name]]),
          renames: withRename(snapshot.renames, from, entry.id),
        });
      }
      drop(from, 'name', edit);
    },

    /**
     * Shows `value` as `id`'s `field` while `write` writes it, which is given the edit to
     * settle; the edit goes once `write` is done, whether it wrote or failed.
     */
    async run<Name extends Field, Result>(
      id: string,
      field: Name,
      value: ValueOf<Name>,
      write: (edit: number) => Promise<Result>,
    ): Promise<Result> {
      edits += 1;
      const edit = edits;
      update(id, field, () => ({ edit, value }) as EntryEdits[Name]);
      try {
        return await write(edit);
      } finally {
        drop(id, field, edit);
      }
    },

    /** Shows `value`, what `edit` answered, in its place, if it is still the latest. */
    settle<Name extends Field>(id: string, field: Name, edit: number, value: ValueOf<Name>) {
      update(id, field, (current) =>
        current?.edit === edit ? ({ edit, value } as EntryEdits[Name]) : current,
      );
    },

    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
