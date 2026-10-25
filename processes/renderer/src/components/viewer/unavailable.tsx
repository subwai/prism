import { EmptyState } from '@prism/design-system';

/** Why the original cannot be shown, which counts as shown once it is on screen. */
export function Unavailable({
  title,
  description,
  onShown,
}: {
  title: string;
  description: string;
  onShown?: () => void;
}) {
  return (
    <div
      ref={(node) => {
        if (node) {
          onShown?.();
        }
      }}
      className="contents"
    >
      <EmptyState className="absolute inset-0" title={title} description={description} />
    </div>
  );
}
