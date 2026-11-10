import type { ComponentProps } from 'react';

/**
 * A card in a grid of photos, videos and folders: hovered, selected, and filled in the accent
 * while the grid has keyboard focus, as a `SidebarRow` is in a list. The grid takes focus and
 * the keys, and points at its cells with `aria-activedescendant`, so cells are only clicked.
 */
export function GridCell({
  children,
  id,
  role,
  title,
  onClick,
  onDoubleClick,
  onContextMenu,
  'aria-selected': ariaSelected,
  'aria-label': ariaLabel,
  'aria-description': ariaDescription,
  'aria-setsize': ariaSetSize,
  'aria-posinset': ariaPosInSet,
}: Pick<
  ComponentProps<'div'>,
  | 'children'
  | 'id'
  | 'role'
  | 'title'
  | 'onClick'
  | 'onDoubleClick'
  | 'onContextMenu'
  | 'aria-selected'
  | 'aria-label'
  | 'aria-description'
  | 'aria-setsize'
  | 'aria-posinset'
>) {
  return (
    // oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/interactive-supports-focus, jsx-a11y/no-static-element-interactions
    <div
      id={id}
      role={role}
      aria-selected={ariaSelected}
      aria-label={ariaLabel}
      // oxlint-disable-next-line jsx-a11y/role-supports-aria-props -- ARIA 1.3 allows it on any role; the rule predates it.
      aria-description={ariaDescription}
      aria-setsize={ariaSetSize}
      aria-posinset={ariaPosInSet}
      title={title}
      className="rounded-card hover:bg-fill aria-selected:bg-fill-strong aria-selected:in-focus-visible:bg-fill-focused flex min-w-0 cursor-default flex-col p-1.5"
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
    >
      {children}
    </div>
  );
}
