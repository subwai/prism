import type { FolderTrail } from '#data/tree/trails';
import { useState } from 'react';

/**
 * The row the keyboard is on, by index. It starts at, and follows navigation to, the current
 * folder at the end of `trail`; one hidden inside a collapsed folder starts from its nearest
 * visible ancestor. `select` moves it to another folder's row.
 */
export function useTreeCursor(trail: FolderTrail, indexOf: (id: string | undefined) => number) {
  const current = trail.at(-1)?.id;
  // The row chosen, and the current folder it was chosen in. Once the current folder changes,
  // the cursor goes back to it.
  const [cursor, setCursor] = useState({ chosenIn: current, id: current });
  const id = cursor.chosenIn === current ? cursor.id : current;
  const fallback = trail.findLast((folder) => indexOf(folder.id) !== -1);
  const active = Math.max(0, indexOf(id) === -1 ? indexOf(fallback?.id) : indexOf(id));
  return { active, select: (row: string) => setCursor({ chosenIn: current, id: row }) };
}
