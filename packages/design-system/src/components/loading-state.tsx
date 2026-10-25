import { cn } from '#cn';
import { ShimmerText } from '#components/shimmer-text';

/** Fills its container with a centered, shimmering label while content loads. */
export function LoadingState({
  label = 'Loading…',
  className,
}: {
  label?: string;
  className?: string;
}) {
  return (
    <div role="status" className={cn('flex flex-1 items-center justify-center', className)}>
      <ShimmerText>{label}</ShimmerText>
    </div>
  );
}
