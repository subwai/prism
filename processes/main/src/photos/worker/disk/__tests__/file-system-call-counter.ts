import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import path from 'node:path';

// Counts calls to Node's file system that touch paths inside a folder, for tests that check how
// often a flow looks at the disk. It swaps each function on `node:fs` and `node:fs/promises` for
// one that counts, then has Node copy the swap into the modules' named exports
// (`syncBuiltinESMExports`), so `import { stat } from 'node:fs/promises'` counts too, in our code
// and in libraries such as exifr. Work done outside Node's `fs`, such as SQLite's or ExifTool's
// own reads, is not seen.

/** The calls that touch the disk, by their name in `node:fs/promises`. */
const CALLS = [
  'access',
  'copyFile',
  'lstat',
  'mkdir',
  'open',
  'opendir',
  'readFile',
  'readdir',
  'realpath',
  'rename',
  'rm',
  'rmdir',
  'stat',
  'statfs',
  'unlink',
  'writeFile',
] as const;

/** Calls only the callback and synchronous `node:fs` have. */
const CALLBACK_ONLY_CALLS = ['createReadStream', 'existsSync', 'watch'] as const;

/** The count of each call made inside the counted folder, by name, such as `stat: 3`. */
export type CallCounts = Partial<Record<string, number>>;

/** A count under way, started with `countFileSystemCalls`. */
export interface FileSystemCallCounter {
  /** The counts since the count started or was last reset. */
  counts: () => CallCounts;
  /** Starts the counts again from nothing. */
  reset: () => void;
  /** Puts Node's own functions back. */
  stop: () => void;
}

/** Whether `file` is `folder` or inside it. */
function isInside(folder: string, file: unknown) {
  if (typeof file !== 'string' && !(file instanceof URL)) {
    return false;
  }
  const relative = path.relative(folder, file instanceof URL ? file.pathname : file);
  return (
    relative === '' ||
    (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`))
  );
}

/** Each counted function on `fs` and `fs.promises`, with the name its calls count under. */
function countedFunctions() {
  const found: { owner: Record<string, unknown>; key: string; name: string }[] = [];
  const add = (owner: object, key: string, name: string) => {
    if (typeof (owner as Record<string, unknown>)[key] === 'function') {
      found.push({ key, name, owner: owner as Record<string, unknown> });
    }
  };
  for (const name of CALLS) {
    add(fs.promises, name, name);
    add(fs, name, name);
    add(fs, `${name}Sync`, name);
  }
  for (const name of CALLBACK_ONLY_CALLS) {
    add(fs, name, name.replace(/Sync$/u, ''));
  }
  return found;
}

/**
 * Counts the file-system calls on paths inside `folder` until `stop` is called. Counts that run
 * at once stop in the reverse order they started.
 */
export function countFileSystemCalls(folder: string): FileSystemCallCounter {
  let counts: CallCounts = {};
  const swapped = countedFunctions().map(({ owner, key, name }) => {
    const original = owner[key] as (...args: unknown[]) => unknown;
    owner[key] = function counted(this: unknown, ...args: unknown[]) {
      if (isInside(folder, args[0])) {
        counts[name] = (counts[name] ?? 0) + 1;
      }
      return original.apply(this, args);
    };
    return { key, original, owner };
  });
  syncBuiltinESMExports();
  return {
    counts: () => ({ ...counts }),
    reset: () => {
      counts = {};
    },
    stop: () => {
      for (const { owner, key, original } of swapped) {
        owner[key] = original;
      }
      syncBuiltinESMExports();
    },
  };
}
