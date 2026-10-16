import type { ReactNode } from 'react';

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="text-caption text-label-tertiary font-sans">{children}</kbd>;
}
