import type { PhotoEntry } from '@prism/shared';
import { useEffect, useEffectEvent } from 'react';

/** How long a slideshow shows each photo. */
const SLIDE_MS = 3500;

/**
 * While `running`, calls `advance` once the photo `shown` has been shown a while; a video
 * moves on itself when it ends. Each photo gets its full time however it came up; nothing
 * else, such as the list growing or the parent re-rendering, starts the clock again.
 */
export function useSlideshowTimer(
  running: boolean,
  shown: PhotoEntry | null | undefined,
  advance: () => void
) {
  const tick = useEffectEvent(advance);
  const timing = running && shown?.kind !== 'video' ? shown?.id : undefined;
  useEffect(() => {
    if (timing === undefined) {
      return;
    }
    const timer = setTimeout(() => tick(), SLIDE_MS);
    return () => clearTimeout(timer);
  }, [timing]);
}
