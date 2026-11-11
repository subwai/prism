import { app } from 'electron';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

/** How many folders a file keeps, the most recently used; older ones open as new. */
const MAX_ROOTS = 32;

/**
 * Something remembered for each folder opened, by the folder's path, in `name` in the user data
 * folder. What it read is checked with `check`, as the file may hold anything; losing it only
 * opens the folder as new.
 */
export function perFolderFile<Value>(name: string, check: (value: unknown) => value is Value) {
  const file = () => path.join(app.getPath('userData'), name);

  /** Each folder's value, by the folder's path, the most recently remembered last. */
  async function readAll(): Promise<Record<string, unknown>> {
    try {
      const saved: unknown = JSON.parse(await readFile(file(), 'utf8'));
      return saved && typeof saved === 'object' && !Array.isArray(saved)
        ? (saved as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }

  // Writes go one at a time, so a later one is never overwritten by one that started before it.
  let writing = Promise.resolve();

  return {
    /** What was remembered when `root` was last open, if anything. */
    async read(root: string): Promise<Value | undefined> {
      await writing;
      const value = (await readAll())[root];
      return check(value) ? value : undefined;
    },
    /** Remembers `value` for the next time `root` opens. */
    write(root: string, value: Value): Promise<void> {
      writing = writing.then(async () => {
        const { [root]: _previous, ...others } = await readAll();
        const kept = Object.entries(others).slice(1 - MAX_ROOTS);
        const all = Object.fromEntries([...kept, [root, value]]);
        await writeFile(file(), JSON.stringify(all)).catch(() => null);
      });
      return writing;
    },
  };
}
