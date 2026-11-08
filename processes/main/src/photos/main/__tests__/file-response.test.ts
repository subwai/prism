import { fileResponse, parseRange } from '#photos/main/file-response';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, onTestFinished, test } from 'vitest';

async function served(range?: string, method = 'GET') {
  const root = await mkdtemp(path.join(tmpdir(), 'file-response-'));
  onTestFinished(() => rm(root, { force: true, recursive: true }));
  const file = path.join(root, 'clip.mp4');
  await writeFile(file, '0123456789');
  const request = new Request('media://original/clip.mp4', {
    headers: range ? { Range: range } : {},
    method,
  });
  return fileResponse(file, request, new Headers());
}

test('parses single byte ranges, open-ended and from the end', () => {
  expect(parseRange('bytes=2-5', 10)).toEqual({ end: 5, start: 2 });
  expect(parseRange('bytes=2-', 10)).toEqual({ end: 9, start: 2 });
  expect(parseRange('bytes=-3', 10)).toEqual({ end: 9, start: 7 });
  expect(parseRange('bytes=2-50', 10)).toEqual({ end: 9, start: 2 });
  expect(parseRange(null, 10)).toBeNull();
  expect(parseRange('bytes=-', 10)).toBeNull();
});

test('answers a range with the partial content and says which bytes it is', async () => {
  const response = await served('bytes=2-5');
  expect(response.status).toBe(206);
  expect(response.headers.get('Content-Range')).toBe('bytes 2-5/10');
  expect(response.headers.get('Content-Length')).toBe('4');
  expect(response.headers.get('Content-Type')).toBe('video/mp4');
  await expect(response.text()).resolves.toBe('2345');
});

test('serves the whole file without a range, and only headers for HEAD', async () => {
  const whole = await served();
  expect(whole.status).toBe(200);
  expect(whole.headers.get('Accept-Ranges')).toBe('bytes');
  await expect(whole.text()).resolves.toBe('0123456789');
  const head = await served(undefined, 'HEAD');
  expect(head.headers.get('Content-Length')).toBe('10');
  await expect(head.text()).resolves.toBe('');
});

test('rejects ranges past the end', async () => {
  const response = await served('bytes=20-');
  expect(response.status).toBe(416);
  expect(response.headers.get('Content-Range')).toBe('bytes */10');
});
