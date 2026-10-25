import { useContextKey } from '#photos/hooks/use-context-key';
import type { PhotoEntry } from '@prism/shared';
import { useState } from 'react';

/**
 * Whether the video `shown` is being watched: paused, played or seeked since it came up. Until
 * then Left and Right flip past it, so a slideshow or a quick browse never gets stuck seeking;
 * afterwards they seek, as in a video player. Moving on starts over. The viewer calls `watch`
 * from the video's own pause and seek events, so the controls change as an effect of a pause,
 * once the press that paused it is over, never under the pointer mid-click.
 * While `active`, the keymap sees it as the `watching` context.
 */
export function useWatching(shown: PhotoEntry | null | undefined, active: boolean) {
  const [watched, setWatched] = useState(false);
  // Coming back to a video is a new visit: it starts out browsable again.
  const [visiting, setVisiting] = useState(shown?.id);
  if (shown?.id !== visiting) {
    setVisiting(shown?.id);
    setWatched(false);
  }
  const watching = shown?.kind === 'video' && watched;
  useContextKey('watching', active && watching);
  function watch() {
    if (shown?.kind === 'video') {
      setWatched(true);
    }
  }
  return { watch, watching };
}
