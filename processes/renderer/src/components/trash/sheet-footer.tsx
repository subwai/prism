import { Button } from '@prism/design-system';
import type { ReactNode } from 'react';

/** The foot of the sheet: what the view says or offers, then its `actions` and the way out. */
export function SheetFooter({
  children,
  actions,
  onClose,
}: {
  children?: ReactNode;
  actions?: ReactNode;
  onClose: () => void;
}) {
  return (
    <footer className="border-separator flex items-center gap-3 border-t px-5 py-3">
      {children}
      <span className="ml-auto flex gap-2">
        {actions}
        <Button onClick={onClose}>Close</Button>
      </span>
    </footer>
  );
}
