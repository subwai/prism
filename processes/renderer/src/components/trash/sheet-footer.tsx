import { Button } from '@prism/design-system';
import type { ReactNode } from 'react';

/** The foot of the sheet: what the view says or offers, then the way out. */
export function SheetFooter({ children, onClose }: { children?: ReactNode; onClose: () => void }) {
  return (
    <footer className="border-separator flex items-center gap-3 border-t px-5 py-3">
      {children}
      <Button className="ml-auto" onClick={onClose}>
        Close
      </Button>
    </footer>
  );
}
