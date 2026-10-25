import { cn } from '@prism/design-system';
import type { ReactNode, Ref } from 'react';
import {
  type ReactZoomPanPinchContentRef,
  type ReactZoomPanPinchContextState,
  TransformComponent,
  TransformWrapper,
  useTransformContext
} from 'react-zoom-pan-pinch';

/** Zoom is relative to the fitted photo, so this leaves room past actual size for large photos. */
const MAX_ZOOM = 20;

/** The zoom that shows the photo pixel for pixel, since it is laid out shrunk to fit. */
function actualScale({ instance }: ReactZoomPanPinchContextState) {
  const image = instance.contentComponent?.querySelector('img');
  if (!image?.offsetWidth) {
    return 1;
  }
  return Math.min(Math.max(image.naturalWidth / image.offsetWidth, 1), MAX_ZOOM);
}

/** Zooms to fit, or to actual size around `point` (the centre by default). */
export function zoomToFit(
  controls: ReactZoomPanPinchContentRef,
  fit: boolean,
  point?: { clientX: number; clientY: number }
) {
  if (fit) {
    return controls.centerView(1);
  }
  const scale = actualScale(controls);
  return point
    ? controls.zoomToPoint(scale, point.clientX, point.clientY)
    : controls.centerView(scale);
}

/** Pans and zooms the `ZoomedPhoto` inside it. Key it by photo, so each opens fresh. */
export function PhotoZoom({
  ref,
  onFitChange,
  children
}: {
  ref: Ref<ReactZoomPanPinchContentRef>;
  onFitChange: (fit: boolean) => void;
  children: ReactNode;
}) {
  return (
    <TransformWrapper
      ref={ref}
      centerOnInit
      centerZoomedOut
      maxScale={MAX_ZOOM}
      // Like Preview: a scroll pans, and a pinch (a wheel with Ctrl held) or ⌘-scroll zooms.
      wheel={{ activationKeys: (keys) => keys.includes('Control') || keys.includes('Meta') }}
      trackPadPanning={{ disabled: false }}
      // The viewer toggles between fit and actual size itself.
      doubleClick={{ disabled: true }}
      onZoomStop={({ state }) => onFitChange(state.scale <= 1)}
    >
      {children}
    </TransformWrapper>
  );
}

/** A photo laid out to fit at zoom 1. Opened unfitted, it zooms to actual size once loaded. */
export function ZoomedPhoto({
  src,
  alt,
  fit,
  className,
  onReady,
  onError
}: {
  src: string;
  alt: string;
  fit: boolean;
  className?: string;
  onReady: () => void;
  onError: () => void;
}) {
  const zoom = useTransformContext();
  return (
    // Sized by container units, since the zoomed content has no box to take percentages of.
    <TransformComponent wrapperClass="size-full! @container-size">
      <img
        ref={(node) => {
          // A photo the browser already decoded is ready before its load event would fire.
          if (node?.complete && node.naturalWidth > 0) {
            onReady();
          }
          // The library lays out again once the photo has a size, which actual size needs.
          return fit
            ? undefined
            : zoom.onInit((controls) => {
                controls.centerView(actualScale(controls), 0);
              });
        }}
        className={cn(
          'block max-h-[calc(100cqh-(--spacing(10)))] max-w-[calc(100cqw-(--spacing(10)))] shadow-photo',
          className
        )}
        src={src}
        alt={alt}
        onLoad={onReady}
        onError={onError}
        draggable={false}
      />
    </TransformComponent>
  );
}
