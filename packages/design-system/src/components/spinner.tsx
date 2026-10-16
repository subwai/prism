import { LoaderCircle } from 'lucide-react';

/** Indeterminate progress, sized to sit inline with text. */
export function Spinner({ size = 12, label }: { size?: number; label?: string }) {
  return (
    <LoaderCircle
      size={size}
      strokeWidth={2.25}
      className="animate-spin text-label-tertiary"
      aria-label={label}
      aria-hidden={label ? undefined : true}
    />
  );
}
