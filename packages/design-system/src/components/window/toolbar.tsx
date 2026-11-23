import { cn } from '#cn';
import type { ReactNode } from 'react';

/**
 * Window toolbar; doubles as the title bar, so empty space drags the window. It is a size
 * container: what is inside adapts to the toolbar's own width with `@` variants, such as
 * `@3xl:w-52`, since a sidebar beside it can narrow it without the window changing size.
 */
export function Toolbar({ children }: { children: ReactNode }) {
  return (
    <header className="drag h-titlebar border-separator @container shrink-0 border-b">
      <div className="flex h-full items-center gap-1 px-2.5 @2xl:gap-3 @2xl:px-3.5">{children}</div>
    </header>
  );
}

export function ToolbarGroup({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('flex items-center gap-0.5', className)}>{children}</div>;
}

/** Bottom bar for status text and small controls; matches the sidebar footer height. */
export function StatusBar({ children }: { children: ReactNode }) {
  return (
    <footer className="h-statusbar border-separator text-label-tertiary flex shrink-0 items-center gap-3.5 border-t px-6.5 text-sm">
      {children}
    </footer>
  );
}
