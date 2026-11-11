import type { FrameReader } from '#thumbnails';
import { HEIF_CODECS_MISSING } from '@prism/shared';
import { convertToJpeg } from '@prism/windows-imaging';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile),
  QUALITY = 90,
  TIMEOUT_MS = 60_000,
  // What Windows' imaging component reports when no codec reads the file, and what Media
  // Foundation reports when the HEVC decoder the HEIF one relies on is missing.
  CODEC_MISSING_CODES = ['88982F50', 'C00D5212'],
  UNSUPPORTED = 'HEIC photos can be shown on macOS and Windows only.';

/** Why converting failed: on Windows, a missing codec is told apart from a broken photo. */
function conversionError(error: unknown, detail: string): Error {
  if (CODEC_MISSING_CODES.some((code) => detail.startsWith(code))) {
    return new Error(HEIF_CODECS_MISSING);
  }
  return new Error(`The system could not read this photo. ${detail}`.trim(), { cause: error });
}

/** A JPEG of `source` from `sips`, which writes a file, read and removed again. */
async function convertWithSips(source: string, signal: AbortSignal): Promise<Uint8Array> {
  const target = path.join(tmpdir(), `prism-${randomUUID()}.jpg`);
  try {
    await execFileAsync(
      'sips',
      ['-s', 'format', 'jpeg', '-s', 'formatOptions', String(QUALITY), source, '--out', target],
      { signal, timeout: TIMEOUT_MS },
    );
    return new Uint8Array(await readFile(target));
  } catch (error) {
    signal.throwIfAborted();
    throw conversionError(error, String((error as { stderr?: unknown }).stderr ?? ''));
  } finally {
    await rm(target, { force: true });
  }
}

/** A JPEG of `source` from Windows' imaging component, which the addon calls in this process. */
async function convertWithWindows(source: string, signal: AbortSignal): Promise<Uint8Array> {
  try {
    return await convertToJpeg(source, QUALITY / 100, signal);
  } catch (error) {
    signal.throwIfAborted();
    throw conversionError(error, error instanceof Error ? error.message : String(error));
  }
}

/**
 * A full-size JPEG of the HEIF photo `source`, for the viewer. Quick Look and the Windows shell
 * only render small stills, so this takes the system's decoder itself: `sips` on macOS, and the
 * imaging component on Windows. Both turn the picture upright, `sips` by keeping the photo's
 * orientation for the window to apply.
 */
export function convertHeif(source: string, signal: AbortSignal): Promise<Uint8Array> {
  if (process.platform === 'darwin') {
    return convertWithSips(source, signal);
  }
  if (process.platform === 'win32') {
    return convertWithWindows(source, signal);
  }
  return Promise.reject(new Error(UNSUPPORTED));
}

/**
 * The still a HEIF photo's thumbnail is made from: the full-size JPEG the viewer shows, which the
 * thumbnail pipeline shrinks itself. Quick Look's stills sit about half a pixel lower than the
 * picture does, which shows as a jump once the viewer swaps its thumbnail for the original, and a
 * still from the very picture the viewer shows cannot. Converting is quick enough for a grid:
 * `sips` decodes faster than it scales, and separate processes run side by side.
 */
export const heifThumbnail: FrameReader = (source, _size, signal) => convertHeif(source, signal);
