import type { FrameReader } from '#photos/thumbnails';
import { HEIF_CODECS_MISSING } from '@prism/shared';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import sharp from 'sharp';

const execFileAsync = promisify(execFile),
  QUALITY = 90,
  TIMEOUT_MS = 60_000,
  // What Windows' imaging component reports when no codec reads the file, and what Media
  // Foundation reports when the HEVC decoder the HEIF one relies on is missing.
  CODEC_MISSING_CODES = ['88982F50', 'C00D5212'],
  UNSUPPORTED = 'HEIC photos can be shown on macOS and Windows only.';

/**
 * Writes `$env:PRISM_TARGET` as a JPEG of the photo `$env:PRISM_SOURCE`, through Windows' imaging
 * component, which reads HEIF with the Store's codecs. It reports a failure by its HRESULT.
 *
 * The imaging component reports a HEIF photo's rotation and mirroring as an EXIF orientation,
 * from 1 to 8, rather than applying it, so the script turns the picture upright itself. The JPEG
 * leaves out the photo's metadata, which its encoder may refuse in HEIF's layout, and with it the
 * orientation, which would otherwise be applied twice.
 */
const WINDOWS_SCRIPT = `
$ErrorActionPreference = 'Stop'
try {
  Add-Type -AssemblyName PresentationCore
  $source = [IO.File]::OpenRead($env:PRISM_SOURCE)
  try {
    $decoder = [Windows.Media.Imaging.BitmapDecoder]::Create($source,
      [Windows.Media.Imaging.BitmapCreateOptions]::None,
      [Windows.Media.Imaging.BitmapCacheOption]::OnLoad)
    $frame = $decoder.Frames[0]
    $orientation = 1
    # The photo property system's name for it, then the HEIF codec's own.
    foreach ($query in 'System.Photo.Orientation', '/heifProps/{ushort=1}') {
      try {
        $value = $frame.Metadata.GetQuery($query)
        if ($value) { $orientation = [int]$value; break }
      } catch {}
    }
    # Turned clockwise, then mirrored, as each EXIF orientation asks.
    $transforms = New-Object Windows.Media.TransformGroup
    $angle = @{ 3 = 180; 4 = 180; 5 = 90; 6 = 90; 7 = 270; 8 = 270 }[$orientation]
    if ($angle) { $transforms.Children.Add((New-Object Windows.Media.RotateTransform $angle)) }
    if ($orientation -in 2, 4, 5, 7) {
      $transforms.Children.Add((New-Object Windows.Media.ScaleTransform -1, 1))
    }
    $picture = $frame
    if ($transforms.Children.Count) {
      $picture = New-Object Windows.Media.Imaging.TransformedBitmap $frame, $transforms
    }
    $encoder = New-Object Windows.Media.Imaging.JpegBitmapEncoder
    $encoder.QualityLevel = ${QUALITY}
    $encoder.Frames.Add([Windows.Media.Imaging.BitmapFrame]::Create($picture, $null, $null, $null))
    $target = [IO.File]::Create($env:PRISM_TARGET)
    try { $encoder.Save($target) } finally { $target.Dispose() }
  } finally { $source.Dispose() }
} catch {
  $exception = $_.Exception
  while ($exception.InnerException) { $exception = $exception.InnerException }
  [Console]::Error.Write(('{0:X8} {1}' -f $exception.HResult, $exception.Message))
  exit 1
}
`;

/** Why converting failed: on Windows, a missing codec is told apart from a broken photo. */
function conversionError(error: unknown): Error {
  const stderr = String((error as { stderr?: unknown }).stderr ?? '');
  if (CODEC_MISSING_CODES.some((code) => stderr.startsWith(code))) {
    return new Error(HEIF_CODECS_MISSING);
  }
  return new Error(`The system could not read this photo. ${stderr}`.trim(), { cause: error });
}

/**
 * Writes `target` as a full-size JPEG of the HEIF photo `source`, for the viewer. Quick Look and
 * the Windows shell only render small stills, so this takes the system's decoder itself: `sips`
 * on macOS, and the imaging component through PowerShell on Windows.
 */
export async function convertHeif(
  source: string,
  target: string,
  signal: AbortSignal,
): Promise<void> {
  const options = { signal, timeout: TIMEOUT_MS, windowsHide: true };
  try {
    if (process.platform === 'darwin') {
      await execFileAsync(
        'sips',
        ['-s', 'format', 'jpeg', '-s', 'formatOptions', String(QUALITY), source, '--out', target],
        options,
      );
    } else if (process.platform === 'win32') {
      await execFileAsync(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', WINDOWS_SCRIPT],
        // Passed as variables rather than in the script, so no name needs quoting.
        { ...options, env: { ...process.env, PRISM_SOURCE: source, PRISM_TARGET: target } },
      );
    } else {
      throw new Error(UNSUPPORTED);
    }
  } catch (error) {
    signal.throwIfAborted();
    throw error instanceof Error && error.message === UNSUPPORTED ? error : conversionError(error);
  }
}

/**
 * Thumbnails of HEIF photos from the system's thumbnailer, `read`, or none without one. Quick
 * Look fills the box it is given, cropping what overflows, so the box takes the photo's shape,
 * which sharp can read though it cannot decode the picture. Where no codec reads the photo, the
 * system answers with the file's icon, which unlike a photo is not opaque.
 */
export function heifThumbnails(read?: FrameReader): FrameReader {
  return async (source, size, signal) => {
    if (!read) {
      throw new Error(UNSUPPORTED);
    }
    const { autoOrient } = await sharp(source).metadata();
    const scale = Math.min(1, size.width / autoOrient.width, size.height / autoOrient.height);
    const image = await read(
      source,
      {
        height: Math.max(1, Math.round(autoOrient.height * scale)),
        width: Math.max(1, Math.round(autoOrient.width * scale)),
      },
      signal,
    );
    if (!(await sharp(image).stats()).isOpaque) {
      throw new Error(
        process.platform === 'win32'
          ? HEIF_CODECS_MISSING
          : 'The system could not read this photo.',
      );
    }
    return image;
  };
}
