import { cn } from '#cn';
import type { ReactNode } from 'react';

/** Root of a window: fills it, and keeps text from being selected like native chrome. */
export function Window({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <main className={cn('flex h-dvh flex-col overflow-hidden select-none', className)}>
      {children}
    </main>
  );
}

/** Invisible title bar for screens without a toolbar, so the window can still be dragged. */
export function TitleBar({ children }: { children?: ReactNode }) {
  return (
    <div className="drag absolute inset-x-0 top-0 flex h-titlebar items-center justify-center">
      {children}
    </div>
  );
}
