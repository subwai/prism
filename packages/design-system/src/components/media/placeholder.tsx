import { tv } from '#cn';

const placeholder = tv({
  base: 'bg-fill shimmer shimmer-bg',
  variants: {
    shape: {
      /** A page of A- or B-series paper, as the reader shows pages. */
      page: 'aspect-page',
      /** A grid's square thumbnail. */
      square: 'aspect-square rounded-inner',
    },
  },
});

/** A shimmering stand-in for a photo or page not read yet, holding its place in its shape. */
export function Placeholder({ shape }: { shape: 'page' | 'square' }) {
  return <div aria-hidden className={placeholder({ shape })} />;
}
