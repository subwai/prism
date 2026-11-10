import { cn } from '#cn';
import { ChevronRight } from 'lucide-react';
import { type ComponentProps, type ReactNode, useId, useState } from 'react';

const MIN_WIDTH = 176;
const KEYBOARD_STEP = 16;

/** The widest the sidebar may be: 35% of the window, as its `max-w-[35vw]` says. */
function maxWidth() {
  return Math.round(window.innerWidth * 0.35);
}

function clampWidth(width: number) {
  return Math.round(Math.min(Math.max(width, MIN_WIDTH), maxWidth()));
}

/**
 * Full-height source list, resized by dragging its right edge. Its background lets the window's
 * vibrancy through. CSS `resize` only offers a grabber in the corner, and Base UI has no
 * splitter, so the edge is a separator of its own.
 */
export function Sidebar({ label, children }: { label: string; children: ReactNode }) {
  const id = useId();
  // Until it is resized, the sidebar keeps the theme's width.
  const [width, setWidth] = useState<number>();
  // The width it shows, which the window's size can hold below the one asked for.
  const [shown, setShown] = useState(MIN_WIDTH);

  return (
    <aside
      ref={(aside) => {
        if (!aside) {
          return;
        }
        const observer = new ResizeObserver(() => setShown(aside.offsetWidth));
        observer.observe(aside);
        return () => observer.disconnect();
      }}
      id={id}
      aria-label={label}
      className="w-sidebar border-separator bg-sidebar relative flex max-w-[35vw] min-w-44 shrink-0 flex-col overflow-hidden border-r"
      style={width === undefined ? undefined : { width }}
    >
      {children}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={`Resize ${label}`}
        aria-controls={id}
        aria-valuemin={MIN_WIDTH}
        aria-valuemax={maxWidth()}
        aria-valuenow={shown}
        tabIndex={0}
        className="no-drag focus-visible:bg-accent absolute inset-y-0 right-0 w-1.5 cursor-col-resize focus-visible:outline-none"
        onPointerDown={(event) => {
          if (event.button !== 0) {
            return;
          }
          // Capturing the pointer keeps the drag, and its cursor, going outside the handle.
          event.preventDefault();
          const handle = event.currentTarget;
          handle.setPointerCapture(event.pointerId);
          const offset = shown - event.clientX;
          const move = (moved: PointerEvent) => {
            setWidth(clampWidth(offset + moved.clientX));
          };
          handle.addEventListener('pointermove', move);
          handle.addEventListener(
            'lostpointercapture',
            () => handle.removeEventListener('pointermove', move),
            { once: true },
          );
        }}
        onKeyDown={(event) => {
          const step = { ArrowLeft: -KEYBOARD_STEP, ArrowRight: KEYBOARD_STEP }[event.key];
          if (step !== undefined) {
            event.preventDefault();
            setWidth(clampWidth(shown + step));
          }
        }}
      />
    </aside>
  );
}

/** Top of the sidebar, level with the traffic lights; trailing controls align right. */
export function SidebarTitleBar({ children }: { children?: ReactNode }) {
  return (
    <div className="drag h-titlebar pl-traffic-lights flex shrink-0 items-center justify-end pr-2.5">
      {children}
    </div>
  );
}

export function SidebarHeading({
  children,
  accessory,
}: {
  children: ReactNode;
  accessory?: ReactNode;
}) {
  return (
    <div className="text-label-tertiary flex items-center justify-between pt-1 pr-3 pb-1.5 pl-4.5 text-sm font-semibold">
      <span>{children}</span>
      {accessory}
    </div>
  );
}

/**
 * A selectable sidebar row. Positioning props let virtualized lists place rows; `active` marks
 * the keyboard position in a list that holds focus itself. `selected` is only exposed as
 * `aria-selected` when the row has a role that supports it, such as `treeitem`.
 */
export function SidebarRow({
  children,
  id,
  selected = false,
  active = false,
  className,
  style,
  role,
  onContextMenu,
  'aria-label': ariaLabel,
  'aria-level': ariaLevel,
  'aria-expanded': ariaExpanded,
  'aria-posinset': ariaPosInSet,
  'aria-setsize': ariaSetSize,
}: Pick<
  ComponentProps<'div'>,
  | 'children'
  | 'id'
  | 'className'
  | 'style'
  | 'role'
  | 'onContextMenu'
  | 'aria-label'
  | 'aria-level'
  | 'aria-expanded'
  | 'aria-posinset'
  | 'aria-setsize'
> & { selected?: boolean; active?: boolean }) {
  return (
    <div
      id={id}
      onContextMenu={onContextMenu}
      role={role}
      data-active={active || undefined}
      data-selected={selected || undefined}
      aria-selected={role ? selected : undefined}
      aria-label={ariaLabel}
      aria-level={ariaLevel}
      aria-expanded={ariaExpanded}
      aria-posinset={ariaPosInSet}
      aria-setsize={ariaSetSize}
      className={cn(
        // Controls inside draw no ring of their own; the row shows focus by filling, as the
        // selection does, in the accent. High contrast themes drop fills, so it keeps a ring.
        'flex h-8 items-center gap-0.5 rounded-control pr-2 data-selected:bg-fill-strong has-focus-visible:bg-fill-focused data-active:in-focus-visible:bg-fill-focused forced-colors:has-focus-visible:focus-ring forced-colors:data-active:in-focus-visible:focus-ring [&_button]:focus-visible:outline-none',
        className,
      )}
      style={style}
    >
      {children}
    </div>
  );
}

/**
 * The disclosure triangle at the start of a tree row, which turns down as the row expands. It
 * is only for the pointer: the tree, one tab stop, expands rows from the keyboard and tells
 * screen readers with `aria-expanded`. Without `onToggle` it holds the row's place, empty.
 */
export function SidebarDisclosure({
  expanded,
  onToggle,
}: {
  expanded: boolean;
  onToggle?: () => void;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        'flex h-7 w-4 shrink-0 items-center justify-center text-label-tertiary',
        onToggle && 'cursor-pointer hover:text-label-secondary',
      )}
      onClick={onToggle}
    >
      {onToggle && (
        <ChevronRight
          size={13}
          className={cn(
            'transition-[rotate] duration-150 ease-swift motion-reduce:transition-none',
            expanded && 'rotate-90',
          )}
        />
      )}
    </span>
  );
}

export function SidebarFooter({ children }: { children: ReactNode }) {
  return (
    <div className="h-statusbar border-separator text-label-secondary flex shrink-0 items-center gap-2 border-t px-4.5 text-sm">
      {children}
    </div>
  );
}
