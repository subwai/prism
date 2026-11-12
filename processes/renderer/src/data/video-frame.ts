// Twice the grid's thumbnail edge, so the worker scales it down rather than up.
const THUMBNAIL_EDGE = 768;
const THUMBNAIL_TIMEOUT_MS = 15_000;
// Sharp enough to stand in for the playing video on a large screen.
const OPENING_EDGE = 2560;
// The viewer waits on this, so a video slow to start shows its thumbnail instead.
const OPENING_TIMEOUT_MS = 3000;

/** Resolves on `event`, or rejects if the video fails or `signal` aborts first. */
function settle(video: HTMLVideoElement, event: string, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const fail = () => reject(video.error ?? signal.reason);
    video.addEventListener(event, () => resolve(), { once: true, signal });
    video.addEventListener('error', fail, { once: true, signal });
    signal.addEventListener('abort', fail, { once: true });
  });
}

/** A still from the video at `url`, at its start or halfway in, as a JPEG. */
async function still(
  url: string,
  { start, maxEdge, timeout }: { start: boolean; maxEdge: number; timeout: number },
) {
  const signal = AbortSignal.timeout(timeout);
  const video = document.createElement('video');
  // The original is on another origin, and drawing it unshared would taint the canvas.
  video.crossOrigin = 'anonymous';
  video.muted = true;
  video.preload = 'auto';
  try {
    video.src = url;
    await settle(video, 'loadedmetadata', signal);
    // Halfway in passes fades from black. Recordings without a known length start at once.
    video.currentTime = !start && Number.isFinite(video.duration) ? video.duration / 2 : 0;
    await settle(video, 'seeked', signal);
    const scale = Math.min(1, maxEdge / Math.max(video.videoWidth, video.videoHeight, 1));
    const canvas = new OffscreenCanvas(
      Math.max(1, Math.round(video.videoWidth * scale)),
      Math.max(1, Math.round(video.videoHeight * scale)),
    );
    canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height);
    return await canvas.convertToBlob({ quality: 0.9, type: 'image/jpeg' });
  } finally {
    // Releases the decoder and the connection at once rather than at garbage collection.
    video.removeAttribute('src');
    video.load();
  }
}

/**
 * A still from halfway through the video at `url`, as a JPEG, for formats the system's
 * thumbnailer cannot read but Chromium can play.
 */
export async function captureFrame(url: string): Promise<Uint8Array> {
  const blob = await still(url, {
    maxEdge: THUMBNAIL_EDGE,
    start: false,
    timeout: THUMBNAIL_TIMEOUT_MS,
  });
  return new Uint8Array(await blob.arrayBuffer());
}

/**
 * The frame the video at `url` starts on, to stand in while it loads: a thumbnail from
 * further in would jump to a different picture as playback begins.
 */
export function captureOpeningFrame(url: string): Promise<Blob> {
  return still(url, { maxEdge: OPENING_EDGE, start: true, timeout: OPENING_TIMEOUT_MS });
}
