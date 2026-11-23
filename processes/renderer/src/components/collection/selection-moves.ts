/** Where the selection is in a list laid out in rows, and the key that moves it. */
interface SelectionMove {
  /** The key pressed, as `KeyboardEvent.key` names it. */
  key: string;
  /** The selected entry's index, or -1 with nothing selected. */
  selectedIndex: number;
  /** How many entries each row holds. */
  columns: number;
  /** How many entries the list holds. */
  count: number;
}

/**
 * The index the selection moves to for an arrow key, Home or End, or null for any other key or
 * an empty list. Up and Down move a row, and the selection stops at either end of the list.
 * With nothing selected, any of these keys selects the first entry.
 */
export function indexAfterKey({ key, selectedIndex, columns, count }: SelectionMove) {
  const moves: Record<string, number> = {
    ArrowDown: columns,
    ArrowLeft: -1,
    ArrowRight: 1,
    ArrowUp: -columns,
    End: count,
    Home: -count,
  };
  const move = moves[key];
  if (move === undefined || count === 0) {
    return null;
  }
  if (selectedIndex === -1) {
    return 0;
  }
  return Math.max(0, Math.min(count - 1, selectedIndex + move));
}
