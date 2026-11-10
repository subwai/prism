import { cn } from '#cn';
import { ChevronRight } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';

/** Full-height, resizable source list. Its background lets the window's vibrancy through. */
export function Sidebar({ label, children }: { label: string; children: ReactNode }) {
  return (
    <aside
      aria-label={label}
      className="w-sidebar border-separator bg-sidebar flex max-w-[35vw] min-w-44 shrink-0 resize-x flex-col overflow-hidden border-r"
    >
      {children}
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
