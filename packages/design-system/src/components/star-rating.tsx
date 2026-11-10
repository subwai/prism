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
  // Which star the pointer is on: until it leaves, the stars show what choosing it would rate,
  // the ones it would add only half lit, so the rating as it is still reads.
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
              'rounded-control inline-flex size-5.5 items-center justify-center transition-colors focus-visible:focus-ring',
              stars > shown && 'text-label-tertiary',
              stars <= shown && (stars <= (value ?? 0) ? 'text-rating' : 'text-rating/50'),
            )}
            onPointerEnter={() => setPointed(stars)}
            onClick={() => onChoose(stars)}
          >
            {/* Filled stars keep a stroke of their own colour, which rounds their points. */}
            <Star
              size={13}
              strokeWidth={stars <= shown ? 1.5 : 1.25}
              className={cn(stars <= shown && 'fill-current')}
            />
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

/**
 * How many stars a photo, video or folder is rated, over the corner of its picture: white on a
 * blurred pill, as other marks over photos are, so a grid of rated photos stays calm and the
 * stars read on light pictures as on dark ones.
 */
export function RatingBadge({ stars }: { stars: number }) {
  return (
    <span
      aria-label={starsLabel(stars)}
      className="text-on-media bg-scrim/50 pointer-events-none absolute top-1.5 left-1.5 z-1 flex items-center gap-px rounded-full px-1 py-0.5 backdrop-blur-sm"
    >
      {STARS.slice(0, stars).map((star) => (
        <Star key={star} size={9} strokeWidth={1.5} className="fill-current" />
      ))}
    </span>
  );
}
