import { unzipSync } from 'fflate';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const CRX_MAGIC = 'Cr24';
const CRX_VERSION = 3;

/** The ZIP inside a CRX3 file, which follows a magic number, a version and a sized header. */
export function crxZip(crx: Buffer): Buffer {
  if (crx.toString('latin1', 0, 4) !== CRX_MAGIC || crx.readUInt32LE(4) !== CRX_VERSION) {
    throw new Error('Not a CRX3 file');
  }
  return crx.subarray(12 + crx.readUInt32LE(8));
}

/** Unpacks a ZIP into `folder`, refusing any file that would land outside it. */
export async function unzip(zip: Buffer, folder: string): Promise<void> {
  for (const [name, data] of Object.entries(unzipSync(zip))) {
    const target = path.join(folder, name);
    if (!target.startsWith(folder + path.sep)) {
      throw new Error(`The ZIP has a file outside its folder: ${name}`);
    }
    if (name.endsWith('/')) {
      await mkdir(target, { recursive: true });
      continue;
    }
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, data);
  }
}
