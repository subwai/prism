import { inside, type TreeRow } from '#components/folder-tree/tree-rows';
import type { Virtualizer } from '@tanstack/react-virtual';
import { type TransitionEvent, useState } from 'react';

/** How a row slides with the rows a folder opens or closes, in pixels. */
export interface Slide {
  /** How far it moves: as far as the rows below its block, so they stay together. */
  shift: number;
  /** Its block's height, which slides out from under the folder's bottom edge, or back. */
  height: number;
  /** How far below the folder's bottom edge it is while its block shows. */
  depth: number;
}

/** A row a closed folder hid, where it was, and how it slides away. */
interface HiddenRow {
  row: TreeRow;
  top: number;
  slide: Slide;
}

/**
 * How each of the `sliding` rows moves. A folder's rows follow it, so each run of them slides
 * as one block, clipped at the folder's bottom edge, and the rows below move as far. Blocks
 * further down also move as far as the ones above them.
 */
function slides(rows: TreeRow[], sliding: (row: TreeRow) => boolean, rowHeight: number) {
  const result = new Map<number, Slide>();
  let above = 0;
  let start = -1;
  function endBlock(end: number) {
    const count = end - start;
    for (let index = start; index < end; index += 1) {
      result.set(index, {
        depth: (index - start) * rowHeight,
        height: count * rowHeight,
        shift: (above + count) * rowHeight,
      });
    }
    above += count;
    start = -1;
  }
  for (const [index, row] of rows.entries()) {
    if (sliding(row)) {
      start = start === -1 ? index : start;
    } else if (start !== -1) {
      endBlock(index);
    }
  }
  if (start !== -1) {
    endBlock(rows.length);
  }
  return result;
}

/** What opening and closing folders sets moving, until the rows settle. */
interface TreeMotion {
  /** Folders whose children slide out from under them as they appear. */
  opening: Set<string>;
  /** Rows closed folders hid, kept to slide back under them. */
  leaving: Map<string, HiddenRow>;
}

const STILL: TreeMotion = { leaving: new Map(), opening: new Set() };

/**
 * Opened folders' rows slide out from under them as they appear, and the rows a closed folder
 * hides stay a moment to slide back under it, while the rows below follow. Call `reveal` or
 * `conceal` as folders open or close, with the `rows` from before; `entering` and `leaving`
 * say how rows slide, and `settle` goes on the rows' container to end the motion.
 */
export function useTreeMotion(
  rows: TreeRow[],
  rowHeight: number,
  virtualizer: Virtualizer<HTMLDivElement, Element>,
) {
  const [motion, setMotion] = useState(STILL);
  /** How the rows of folders opening slide, by index. */
  const entering =
    motion.opening.size === 0
      ? new Map<number, Slide>()
      : slides(rows, (row) => inside(row, (id) => motion.opening.has(id)), rowHeight);
  function move(update: (previous: TreeMotion) => TreeMotion) {
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setMotion(update);
    }
  }
  /** Slides out the rows inside `folders`, which are opening, once they appear. */
  function reveal(folders: string[]) {
    move((previous) => ({ ...previous, opening: new Set([...previous.opening, ...folders]) }));
  }
  /**
   * Slides the rows inside the folders `closing` picks back under them. Only those on screen
   * could be seen leaving, so only they stay.
   */
  function conceal(closing: (id: string) => boolean) {
    const hidden = slides(rows, (row) => inside(row, closing), rowHeight);
    const entries = virtualizer.getVirtualItems().flatMap((item) => {
      const row = rows[item.index];
      const slide = hidden.get(item.index);
      return row && slide ? [[row.entry.id, { row, slide, top: item.start }] as const] : [];
    });
    move((previous) => ({ ...previous, leaving: new Map([...previous.leaving, ...entries]) }));
  }
  // Every row slides for the same time, so the motion is over once none is still sliding.
  function settle(event: TransitionEvent<HTMLElement>) {
    const animations = event.currentTarget.getAnimations({ subtree: true });
    if (!animations.some((animation) => animation instanceof CSSTransition)) {
      setMotion(STILL);
    }
  }
  return {
    conceal,
    entering,
    leaving: [...motion.leaving.values()],
    moving: motion !== STILL,
    reveal,
    settle,
  };
}
