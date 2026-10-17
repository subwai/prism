import { cn } from '#cn';
import type { CSSProperties, MouseEventHandler, ReactNode } from 'react';

/** Full-height, resizable source list. Its background lets the window's vibrancy through. */
export function Sidebar({ children }: { children: ReactNode }) {
  return (
    <aside className="w-sidebar border-separator bg-sidebar flex max-w-[35vw] min-w-44 shrink-0 resize-x flex-col overflow-hidden border-r">
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
  accessory
}: {
  children: ReactNode;
  accessory?: ReactNode;
}) {
  return (
    <div className="text-footnote text-label-tertiary flex items-center justify-between pt-1 pr-3 pb-1.5 pl-4.5 font-semibold">
      <span>{children}</span>
      {accessory}
    </div>
  );
}

/**
 * A selectable sidebar row. Positioning props let virtualized lists place rows; `active` marks
 * the keyboard position in a list that holds focus itself.
 */
export function SidebarRow({
  children,
  id,
  selected = false,
  active = false,
  className,
  style,
  role,
  ariaLevel,
  ariaExpanded,
  onContextMenu
}: {
  children: ReactNode;
  id?: string;
  selected?: boolean;
  active?: boolean;
  className?: string;
  style?: CSSProperties;
  role?: string;
  ariaLevel?: number;
  ariaExpanded?: boolean;
  onContextMenu?: MouseEventHandler<HTMLDivElement>;
}) {
  return (
    <div
      id={id}
      onContextMenu={onContextMenu}
      role={role}
      data-active={active || undefined}
      aria-selected={selected}
      aria-level={ariaLevel}
      aria-expanded={ariaExpanded}
      className={cn(
        // Controls inside draw no ring of their own; the row shows focus with its rounded shape.
        'flex h-8 items-center gap-0.5 rounded-control pr-2 aria-selected:bg-fill-strong has-focus-visible:outline-2 has-focus-visible:-outline-offset-2 has-focus-visible:outline-accent/70 data-active:in-focus-visible:outline-2 data-active:in-focus-visible:-outline-offset-2 data-active:in-focus-visible:outline-accent/70 [&_button]:focus-visible:outline-none',
        className
      )}
      style={style}
    >
      {children}
    </div>
  );
}

export function SidebarFooter({ children }: { children: ReactNode }) {
  return (
    <div className="h-statusbar border-separator text-footnote text-label-secondary flex shrink-0 items-center gap-2 border-t px-4.5">
      {children}
    </div>
  );
}
