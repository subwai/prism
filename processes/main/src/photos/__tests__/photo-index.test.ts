import { exifFrom, readExif } from '#photos/exif';
import { PhotoLibrary } from '#photos/library';
import { type IndexedFile, PhotoIndex } from '#photos/photo-index';
import type { PhotoEntry, ScanOptions } from '@prism/shared';
import { mkdtemp, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { expect, onTestFinished, test } from 'vitest';

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'photo-index-'));
  onTestFinished(() => rm(root, { force: true, recursive: true }));
  return root;
}

function openIndex(file: string) {
  const index = PhotoIndex.open(file);
  onTestFinished(() => index.close());
  return index;
}

function photo(file: string, overrides: Partial<IndexedFile> = {}): IndexedFile {
  return { dev: 1, file, ino: 10, mtimeMs: 1000, size: 50, ...overrides };
}

/** A small JPEG that `model` took. */
function jpeg(model: string) {
  return sharp({ create: { background: 'red', channels: 3, height: 8, width: 8 } })
    .jpeg()
    .withExif({
      IFD0: { Make: 'Canon', Model: model },
      IFD2: { DateTimeOriginal: '2023:05:01 12:34:56', FNumber: '28/10' },
    })
    .toBuffer();
}

async function collect(library: PhotoLibrary, options: ScanOptions) {
  const scanId = library.startScan(options);
  const listed: PhotoEntry[] = [];
  let batch;
  do {
    batch = await library.nextBatch(scanId);
    listed.push(...batch.entries);
  } while (!batch.done);
  return listed;
}

test('a row counts only while its file is as it was read', () => {
  const index = openIndex(':memory:');
  index.remember(photo('/a.jpg'), { camera: 'Canon EOS R5' });
  expect(index.exif(photo('/a.jpg'))).toEqual({ camera: 'Canon EOS R5' });
  expect(index.exif(photo('/a.jpg', { mtimeMs: 2000 }))).toBeUndefined();
  expect(index.exif(photo('/a.jpg', { size: 51 }))).toBeUndefined();
});

test('a renamed file is found by its place on disk, and its row moves with it', () => {
  const index = openIndex(':memory:');
  index.remember(photo('/a.jpg'), { iso: 400 });
  index.flush();
  expect(index.exif(photo('/b.jpg'))).toEqual({ iso: 400 });
  index.flush();
  expect(index.exif(photo('/a.jpg', { ino: 11 }))).toBeUndefined();
  expect(index.exif(photo('/b.jpg', { ino: 0 }))).toEqual({ iso: 400 });
});

test('the index outlasts the session, and one it cannot read starts afresh', async () => {
  const file = path.join(await fixture(), 'index.db');
  const first = PhotoIndex.open(file);
  first.remember(photo('/a.jpg'), { iso: 100 });
  first.close();
  expect(openIndex(file).exif(photo('/a.jpg'))).toEqual({ iso: 100 });

  const broken = path.join(path.dirname(file), 'broken.db');
  await writeFile(broken, 'not a database, but long enough to look like a damaged one');
  const index = openIndex(broken);
  expect(index.exif(photo('/a.jpg'))).toBeUndefined();
  index.remember(photo('/a.jpg'), { iso: 200 });
  expect(index.exif(photo('/a.jpg'))).toEqual({ iso: 200 });
});

test('camera names leave out a make the model repeats, and missing tags stay missing', () => {
  expect(exifFrom({ Make: 'Canon', Model: 'Canon EOS R5' })).toEqual({ camera: 'Canon EOS R5' });
  expect(exifFrom({ Make: 'FUJIFILM', Model: 'X-T5' })).toEqual({ camera: 'FUJIFILM X-T5' });
  expect(exifFrom({ FNumber: 0, ISO: 'high', Make: ' ' })).toEqual({});
  expect(exifFrom()).toEqual({});
});

test('tags come from Windows, XMP and IPTC keywords, once each whatever their case', () => {
  const windows = Buffer.from('Sun;Sea\0', 'utf16le');
  expect(
    exifFrom({ Keywords: ['sun', 'Holiday'], XPKeywords: [...windows], subject: 'Sea' }),
  ).toEqual({
    tags: ['Sun', 'Sea', 'Holiday'],
  });
  expect(exifFrom({ XPKeywords: 'beach; ;family', subject: ['Beach'] })).toEqual({
    tags: ['beach', 'family'],
  });
});

test('photos are read with the keywords editors write in XMP', async () => {
  const root = await fixture();
  const file = path.join(root, 'tagged.jpg');
  const xmp = `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:subject><rdf:Bag><rdf:li>beach</rdf:li><rdf:li>family</rdf:li></rdf:Bag></dc:subject></rdf:Description></rdf:RDF></x:xmpmeta>`;
  await writeFile(
    file,
    await sharp({ create: { background: 'red', channels: 3, height: 8, width: 8 } })
      .jpeg()
      .withExif({ IFD0: { Make: 'Canon', Model: 'EOS R5', XPKeywords: 'sunset' } })
      .withXmp(xmp)
      .toBuffer(),
  );
  expect(await readExif(file)).toEqual({
    camera: 'Canon EOS R5',
    tags: ['sunset', 'beach', 'family'],
  });
});

test('scans list EXIF details, read once and then taken from the index', async () => {
  const root = await fixture();
  const indexFile = path.join(await fixture(), 'index.db');
  const file = path.join(root, 'shot.jpg');
  // A whole second, which setting the time again can match exactly.
  const taken = new Date(2024, 0, 1);
  await writeFile(file, await jpeg('EOS R5'));
  await utimes(file, taken, taken);
  await writeFile(path.join(root, 'notes.txt'), 'no photo');
  const scan = async () => {
    const library = await PhotoLibrary.open(root, PhotoIndex.open(indexFile));
    // Listed from the disk each time, rather than as the index stored the folder.
    library.forget();
    const listed = await collect(library, { directoryId: '.', exif: true });
    await library.close();
    return listed;
  };
  const first = (await scan()).find((entry) => entry.kind === 'image');
  expect(first?.metadata).toBeDefined();
  expect(first?.exif).toMatchObject({
    aperture: 2.8,
    camera: 'Canon EOS R5',
    takenMs: new Date(2023, 4, 1, 12, 34, 56).getTime(),
  });

  // Rewritten in place with the same size and time, it looks unchanged, so the index answers.
  const before = await stat(file);
  const replacement = await jpeg('EOS R6');
  expect(replacement.byteLength).toBe(before.size);
  await writeFile(file, replacement);
  await utimes(file, taken, taken);
  const second = (await scan()).find((entry) => entry.kind === 'image');
  expect(second?.exif?.camera).toBe('Canon EOS R5');

  // Any other edit reads it again.
  await utimes(file, taken, new Date(taken.getTime() + 5000));
  const third = (await scan()).find((entry) => entry.kind === 'image');
  expect(third?.exif?.camera).toBe('Canon EOS R6');
});

test('scans without EXIF leave it out, and a listing with it serves them', async () => {
  const root = await fixture();
  await writeFile(path.join(root, 'shot.jpg'), await jpeg('EOS R5'));
  const library = await PhotoLibrary.open(root);
  onTestFinished(() => library.close());
  const [plain] = await collect(library, { directoryId: '.', metadata: true });
  expect(plain?.exif).toBeUndefined();
  await collect(library, { directoryId: '.', exif: true });
  const [remembered] = await collect(library, { directoryId: '.', metadata: true });
  expect(remembered?.exif?.camera).toBe('Canon EOS R5');
});

test('EXIF details are read for listed photos only', async () => {
  const root = await fixture();
  await writeFile(path.join(root, 'shot.jpg'), await jpeg('EOS R5'));
  await writeFile(path.join(root, 'clip.mp4'), '');
  await writeFile(path.join(root, 'unlisted.jpg'), await jpeg('EOS R6'));
  const library = await PhotoLibrary.open(root);
  onTestFinished(() => library.close());
  const scanId = library.startScan({ directoryId: '.' });
  await library.nextBatch(scanId);
  await rm(path.join(root, 'unlisted.jpg'));
  await writeFile(path.join(root, 'later.jpg'), await jpeg('EOS R6'));
  const [shot, clip, later] = await library.readExif(['shot.jpg', 'clip.mp4', 'later.jpg']);
  expect(shot?.camera).toBe('Canon EOS R5');
  expect(clip).toBeNull();
  expect(later).toBeNull();
});
