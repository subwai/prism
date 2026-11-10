import { cn } from '#cn';
import { Star } from 'lucide-react';
import { useState } from 'react';

const STARS = [1, 2, 3, 4, 5] as const;

function starsLabel(stars: number) {
  return stars === 1 ? '1 star' : `${stars} stars`;
}

/**
 * Five stars to rate something with, filled up to its rating. Pointing at a star fills the
 * stars up to it, as choosing it would; choosing the star of its rating again is for the app to
 * take as taking the rating away. Each star is a toggle button, pressed at the rating.
 */
export function StarRating({
  label = 'Rating',
  value,
  onChoose,
  disabled = false,
  error,
}: {
  label?: string;
  /** The stars it is rated, if any. */
  value: number | undefined;
  onChoose: (stars: 1 | 2 | 3 | 4 | 5) => void;
  disabled?: boolean;
  /** Why the last rating did not take, said beside the stars and to screen readers. */
  error?: string;
}) {
  // Which star the pointer is on, which the stars show until it leaves.
  const [pointed, setPointed] = useState<number | null>(null);
  const shown = pointed ?? value ?? 0;
  return (
    <div className="flex items-center gap-1.5">
      <div
        role="group"
        aria-label={label}
        className="flex items-center"
        onPointerLeave={() => setPointed(null)}
      >
        {STARS.map((stars) => (
          <button
            key={stars}
            type="button"
            aria-label={starsLabel(stars)}
            aria-pressed={value === stars}
            disabled={disabled}
            className={cn(
              'rounded-control inline-flex size-5.5 items-center justify-center focus-visible:focus-ring enabled:hover:bg-fill',
              stars <= shown ? 'text-rating' : 'text-label-quaternary',
            )}
            onPointerEnter={() => setPointed(stars)}
            onClick={() => onChoose(stars)}
          >
            <Star size={13} strokeWidth={1.75} className={cn(stars <= shown && 'fill-current')} />
          </button>
        ))}
      </div>
      {error && (
        <span role="alert" className="text-warning truncate text-sm">
          {error}
        </span>
      )}
    </div>
  );
}

/** How many stars a photo, video or folder is rated, over the corner of its picture. */
export function RatingBadge({ stars }: { stars: number }) {
  return (
    <span
      aria-label={starsLabel(stars)}
      className="text-rating drop-shadow-overlay pointer-events-none absolute top-1.5 left-1.5 z-1 flex items-center gap-px"
    >
      {STARS.slice(0, stars).map((star) => (
        <Star key={star} size={10} strokeWidth={0} className="fill-current" />
      ))}
    </span>
  );
}
