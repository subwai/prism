import { crxZip, unzip } from '#crx';
import { strToU8, zipSync } from 'fflate';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, test } from 'vitest';

const folders: string[] = [];

afterEach(async () => {
  await Promise.all(
    folders.splice(0).map((folder) => rm(folder, { force: true, recursive: true })),
  );
});

async function temporaryFolder() {
  const created = await mkdtemp(path.join(os.tmpdir(), 'crx-test-'));
  folders.push(created);
  return created;
}

/** A ZIP of text files, keyed by their paths. */
function archive(files: Record<string, string>) {
  const entries = Object.fromEntries(
    Object.entries(files).map(([name, content]) => [name, strToU8(content)]),
  );
  return Buffer.from(zipSync(entries));
}

function crx(content: Buffer, version = 3) {
  const header = Buffer.from('signed header'),
    prefix = Buffer.alloc(12);
  prefix.write('Cr24', 'latin1');
  prefix.writeUInt32LE(version, 4);
  prefix.writeUInt32LE(header.length, 8);
  return Buffer.concat([prefix, header, content]);
}

test('a CRX3 file gives up the ZIP after its header', () => {
  const zip = archive({ 'manifest.json': '{}' });
  expect(crxZip(crx(zip))).toEqual(zip);
});

test('anything but a CRX3 file is refused', () => {
  expect(() => crxZip(crx(Buffer.alloc(0), 2))).toThrow('Not a CRX3 file');
  expect(() => crxZip(Buffer.from('PK not a crx'))).toThrow('Not a CRX3 file');
});

test('a file that would land outside the folder stops the unpacking', async () => {
  const target = await temporaryFolder(),
    zip = archive({ '../escape.txt': 'x' });
  await expect(unzip(zip, target)).rejects.toThrow('outside its folder');
});
