import light from '#brand/light.svg';
import prism from '#brand/prism.svg';
import { cn } from '#cn';
import { useId } from 'react';

// The app icon's own layers, cropped to the artwork. The box leaves room around the prism's
// rounded top (its arc peaks at y=118).
const VIEW_BOX = '0 110 1024 712',
  SIZE = 1024;

/**
 * The Prism mark from the app icon, decorative, for brand moments such as the loading screen.
 * The light fades in and out at its ends, as there is no tile edge here to meet.
 */
export function PrismMark({ className }: { className?: string }) {
  const id = useId(),
    fade = `${id}-fade`;
  return (
    <svg viewBox={VIEW_BOX} aria-hidden className={cn('w-52', className)}>
      <defs>
        <linearGradient id={`${fade}-gradient`} x2={SIZE} gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#fff" stopOpacity="0" />
          <stop offset="0.22" stopColor="#fff" />
          <stop offset="0.72" stopColor="#fff" />
          <stop offset="0.84" stopColor="#fff" stopOpacity="0.55" />
          <stop offset="0.93" stopColor="#fff" stopOpacity="0.18" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <mask id={fade}>
          <rect width={SIZE} height={SIZE} fill={`url(#${fade}-gradient)`} />
        </mask>
      </defs>
      <image href={light} width={SIZE} height={SIZE} mask={`url(#${fade})`} />
      <image href={prism} width={SIZE} height={SIZE} />
    </svg>
  );
}
