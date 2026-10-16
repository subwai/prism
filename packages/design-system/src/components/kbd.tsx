import type { ReactNode } from 'react';

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="font-sans text-caption text-label-tertiary">{children}</kbd>;
}
