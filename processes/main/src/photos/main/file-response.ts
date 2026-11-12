import { mediaType } from '@prism/media';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { Readable } from 'node:stream';

const PARTIAL_CONTENT = 206;
const RANGE_NOT_SATISFIABLE = 416;

/** The first range of a `Range` header, inclusive; `null` without one, or for `bytes=*`. */
export function parseRange(header: string | null, size: number) {
  const { from = '', to = '' } = /^bytes=(?<from>\d*)-(?<to>\d*)/u.exec(header ?? '')?.groups ?? {};
  if (!from && !to) {
    return null;
  }
  // `bytes=-500` is the last 500 bytes.
  const start = from ? Number(from) : Math.max(0, size - Number(to));
  const end = from && to ? Math.min(Number(to), size - 1) : size - 1;
  return { end, start };
}

/**
 * Serves `file`, honouring byte ranges, which video elements need to seek. `net.fetch` of a
 * file URL slices the body but answers 200 without saying which bytes, so seeking fails.
 */
export async function fileResponse(file: string, request: Request, headers: Headers) {
  const { size } = await stat(file);
  headers.set('Accept-Ranges', 'bytes');
  headers.set('Content-Type', mediaType(file));
  const range = parseRange(request.headers.get('Range'), size);
  if (range && (range.start > range.end || range.start >= size)) {
    headers.set('Content-Range', `bytes */${size}`);
    return new Response(null, { headers, status: RANGE_NOT_SATISFIABLE });
  }
  const { start, end } = range ?? { end: size - 1, start: 0 };
  headers.set('Content-Length', String(Math.max(0, end - start + 1)));
  if (range) {
    headers.set('Content-Range', `bytes ${start}-${end}/${size}`);
  }
  const body =
    request.method === 'HEAD' || size === 0
      ? null
      : (Readable.toWeb(createReadStream(file, { end, start })) as ReadableStream<Uint8Array>);
  return new Response(body, { headers, status: range ? PARTIAL_CONTENT : 200 });
}
