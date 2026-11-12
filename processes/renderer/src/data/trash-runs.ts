import type { LibrarySession } from '#data/library';
import type {
  TrashAPI,
  TrashChoices,
  TrashProgress,
  TrashRunResult,
  UndoTrashResult,
} from '@prism/shared';

/** How long what a run did shows, with Undo, unless the pointer or focus rests on it. */
const SHOWN_FOR = 10_000;

/** What a run did, as the window tells of it, and what undoing it put back, once asked. */
export interface TrashRunShown {
  result: TrashRunResult;
  /** How many items the plan moved to the Trash, as the sheet counted them. */
  items: number;
  undone: UndoTrashResult | null;
}

export interface TrashRunsState {
  /** How far the run under way has got, once the worker says. */
  progress: TrashProgress | null;
  shown: TrashRunShown | null;
}

/**
 * Runs to the Trash of a folder's session: how far one under way has got, and for a few seconds
 * after, what it did, which Undo puts back. It holds still while the pointer or focus rests on
 * it, so Undo stays in reach.
 */
export class TrashRuns {
  private state: TrashRunsState = { progress: null, shown: null };
  private readonly listeners = new Set<() => void>();
  private hiding: ReturnType<typeof setTimeout> | undefined;
  private held = false;

  constructor(private readonly api: TrashAPI) {}

  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  readonly getSnapshot = () => this.state;

  private set(state: TrashRunsState) {
    this.state = state;
    for (const listener of this.listeners) {
      listener();
    }
  }

  /** Shows `shown` for a while, as long as nothing holds it. */
  private show(shown: TrashRunShown | null) {
    clearTimeout(this.hiding);
    this.set({ progress: null, shown });
    if (shown && !this.held) {
      this.hiding = setTimeout(() => this.dismiss(), SHOWN_FOR);
    }
  }

  /**
   * Runs the plan of `viewId` as of `version`. What it did shows, unless it could not start, as
   * when the folder changed since, which the sheet says instead.
   */
  async run(viewId: string, version: number, choices: TrashChoices, items: number) {
    clearTimeout(this.hiding);
    this.set({ progress: null, shown: null });
    const stopHearing = this.api.onTrashProgress((progress) =>
      this.set({ ...this.state, progress }),
    );
    const result = await this.api.trashView(viewId, version, choices).finally(stopHearing);
    if (result.runId === undefined) {
      this.set({ ...this.state, progress: null });
    } else {
      this.show({ items, result, undone: null });
    }
    return result;
  }

  /** Puts back what the run shown moved, then shows what came back. */
  async undo(runId: string) {
    const undone = await this.api.undoTrash(runId);
    const { shown } = this.state;
    if (shown?.result.runId === runId) {
      this.show({ ...shown, undone });
    }
    return undone;
  }

  /** Keeps what shows from going while `held`, and lets it go a while after. */
  hold(held: boolean) {
    this.held = held;
    if (held) {
      clearTimeout(this.hiding);
    } else if (this.state.shown) {
      this.show(this.state.shown);
    }
  }

  dismiss() {
    clearTimeout(this.hiding);
    this.set({ ...this.state, shown: null });
  }
}

const runsOf = new WeakMap<LibrarySession, TrashRuns>();

/** The runs to the Trash of a folder's session, which end with it. */
export function trashRunsOf(library: LibrarySession): TrashRuns {
  let runs = runsOf.get(library);
  if (!runs) {
    runs = new TrashRuns(library.trash);
    runsOf.set(library, runs);
  }
  return runs;
}
