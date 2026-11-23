import { useShareOffline } from '#data/activity/activity-store';
import { EmptyState } from '@prism/design-system';

/**
 * Why the original cannot be shown, which counts as shown once it is on screen. While the share
 * is offline, that is why, whatever the original: the worker does not look for one then.
 */
export function Unavailable({
  title,
  description,
  onShown,
}: {
  title: string;
  description: string;
  onShown?: () => void;
}) {
  const offline = useShareOffline();
  return (
    <div
      ref={(node) => {
        if (node) {
          onShown?.();
        }
      }}
      className="contents"
    >
      {offline ? (
        <EmptyState
          className="absolute inset-0"
          title="The share is offline"
          description="This original is on a share Prism can’t reach. It shows once the share is back."
        />
      ) : (
        <EmptyState className="absolute inset-0" title={title} description={description} />
      )}
    </div>
  );
}
