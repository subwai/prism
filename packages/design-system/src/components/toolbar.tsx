import { cn } from '#cn';
import type { ReactNode } from 'react';

/** Window toolbar; doubles as the title bar, so empty space drags the window. */
export function Toolbar({ children }: { children: ReactNode }) {
  return (
    <header className="drag flex h-titlebar shrink-0 items-center gap-1 border-b border-separator px-2.5 min-[850px]:gap-3 min-[850px]:px-3.5">
      {children}
    </header>
  );
}

export function ToolbarGroup({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('flex items-center gap-0.5', className)}>{children}</div>;
}

/** Bottom bar for status text and small controls; matches the sidebar footer height. */
export function StatusBar({ children }: { children: ReactNode }) {
  return (
    <footer className="flex h-statusbar shrink-0 items-center gap-3.5 border-t border-separator px-6.5 text-footnote text-label-tertiary">
      {children}
    </footer>
  );
}
