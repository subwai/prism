import type { FolderLocation, TrashDestination, TrashLocation } from '@prism/shared';

/** Where a folder's runs to the Trash go until its worker says: Prism's own on a network share. */
export function defaultTrashLocation(location: FolderLocation): TrashLocation {
  return { destination: location === 'network' ? 'prism' : 'system' };
}

/** The Trash `destination` is, as a sentence names it. */
export function trashName(destination: TrashDestination) {
  return destination === 'prism' ? 'Prism’s Trash' : 'the Trash';
}

/** What the toolbar's button does, as its tooltip says. */
export function trashButtonLabel({ destination, share }: TrashLocation) {
  switch (destination) {
    case 'delete': {
      return 'Delete matches permanently';
    }
    case 'prism': {
      return share ? `Move matches to Prism’s Trash on ${share}` : 'Move matches to Prism’s Trash';
    }
    default: {
      return 'Move matches to Trash';
    }
  }
}

/** What a run does, as the sheet's title begins. */
export function trashAction({ destination }: TrashLocation) {
  switch (destination) {
    case 'delete': {
      return 'Delete permanently';
    }
    case 'prism': {
      return 'Move to Prism’s Trash';
    }
    default: {
      return 'Move to Trash';
    }
  }
}

/** Where a run goes, as the line under the sheet's title says. */
export function destinationLine({ destination, share = 'This share', blocked }: TrashLocation) {
  switch (destination) {
    case 'delete': {
      return `Deletes permanently. ${share} has no Trash, and Prism can’t keep one there${blocked ? ` (${blocked})` : ''}.`;
    }
    case 'prism': {
      return `Moves to Prism’s Trash on ${share}, as it has no Trash of its own.`;
    }
    default: {
      return 'Moves to the Trash.';
    }
  }
}

/** The button that runs the plan, with how many entries it moves or deletes. */
export function confirmLabel({ destination }: TrashLocation, entries: number) {
  const count = entries.toLocaleString();
  switch (destination) {
    case 'delete': {
      return `Delete ${count} permanently`;
    }
    case 'prism': {
      return `Move ${count} to Prism’s Trash`;
    }
    default: {
      return `Move ${count} to Trash`;
    }
  }
}
