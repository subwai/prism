import { exifFrom, readExif } from '#photos/exif';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { expect, onTestFinished, test } from 'vitest';

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'photo-exif-'));
  onTestFinished(() => rm(root, { force: true, recursive: true }));
  return root;
}

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
