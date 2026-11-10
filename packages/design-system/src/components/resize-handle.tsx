import { cn } from '#cn';

const KEYBOARD_STEP = 16;

type Edge = 'top' | 'right' | 'bottom' | 'left';

const EDGES: Record<Edge, string> = {
  bottom: 'inset-x-0 bottom-0 h-1.5 cursor-row-resize',
  left: 'inset-y-0 left-0 w-1.5 cursor-col-resize',
  right: 'inset-y-0 right-0 w-1.5 cursor-col-resize',
  top: 'inset-x-0 top-0 h-1.5 cursor-row-resize',
};

/** Where the pointer is along the way `edge` moves, growing as the pane would. */
function along(edge: Edge, { clientX, clientY }: { clientX: number; clientY: number }) {
  // The pane grows as its edge moves away from it.
  const outward = edge === 'right' || edge === 'bottom' ? 1 : -1;
  return outward * (edge === 'left' || edge === 'right' ? clientX : clientY);
}

/**
 * The edge of a pane that resizes it, as a separator dragged with the pointer or moved with the
 * arrow keys, and reset with a double-click. It goes inside the pane, which positions it, on the
 * `edge` that moves. CSS `resize` only offers a grabber in the corner, and Base UI has no
 * splitter, so the edge is a separator of its own.
 *
 * `value` is the size the pane shows, in pixels; `onResize` asks for a new one, unclamped, so
 * the pane keeps it within what it allows, which `min` and `max` tell screen readers.
 */
export function ResizeHandle({
  edge,
  label,
  controls,
  value,
  min,
  max,
  onResize,
  onReset,
}: {
  edge: Edge;
  label: string;
  /** The id of the pane it resizes. */
  controls: string;
  value: number;
  min: number;
  max: number;
  onResize: (size: number) => void;
  onReset?: () => void;
}) {
  const vertical = edge === 'left' || edge === 'right';
  return (
    <div
      role="separator"
      // A separator between panes side by side is a vertical line.
      aria-orientation={vertical ? 'vertical' : 'horizontal'}
      aria-label={label}
      aria-controls={controls}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={Math.round(value)}
      tabIndex={0}
      className={cn(
        'no-drag focus-visible:bg-accent absolute z-10 focus-visible:outline-none',
        EDGES[edge],
      )}
      onPointerDown={(event) => {
        if (event.button !== 0) {
          return;
        }
        // Capturing the pointer keeps the drag, and its cursor, going outside the handle.
        event.preventDefault();
        const handle = event.currentTarget;
        handle.setPointerCapture(event.pointerId);
        const offset = value - along(edge, event);
        const move = (moved: PointerEvent) => onResize(offset + along(edge, moved));
        handle.addEventListener('pointermove', move);
        handle.addEventListener(
          'lostpointercapture',
          () => handle.removeEventListener('pointermove', move),
          { once: true },
        );
      }}
      onDoubleClick={onReset}
      onKeyDown={(event) => {
        // Each arrow moves the edge its way, as a drag would.
        const keys: Record<string, number> = vertical
          ? { ArrowLeft: -1, ArrowRight: 1 }
          : { ArrowDown: 1, ArrowUp: -1 };
        const direction = keys[event.key];
        if (direction !== undefined) {
          event.preventDefault();
          const step = direction * KEYBOARD_STEP;
          onResize(value + along(edge, { clientX: step, clientY: step }));
        }
      }}
    />
  );
}
