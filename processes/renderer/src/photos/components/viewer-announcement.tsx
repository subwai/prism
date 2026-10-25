import { LiveRegion } from '@prism/design-system';
import type { PhotoEntry } from '@prism/shared';

/**
 * Says which photo is shown, and where it falls, each time that changes while the viewer has
 * focus; a slideshow, which would otherwise talk over everything, stays quiet.
 */
export function ViewerAnnouncement({
  focused,
  playing,
  entry,
  index,
  count
}: {
  focused: boolean;
  playing: boolean;
  entry: PhotoEntry | null;
  index: number;
  count: number;
}) {
  return (
    <LiveRegion active={focused && !playing}>
      {entry && index !== -1 ? `${entry.name}, ${index + 1} of ${count.toLocaleString()}` : ''}
    </LiveRegion>
  );
}
