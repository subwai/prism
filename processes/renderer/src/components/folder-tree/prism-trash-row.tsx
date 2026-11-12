import { prismTrashQuery } from '#data/prism-trash';
import { useLibrary } from '#hooks/use-library';
import { Badge, SidebarRow } from '@prism/design-system';
import { useQuery } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import { Link, useLocation } from 'react-router';

/**
 * Prism's Trash on the folder's share, below the tree once it holds anything, so what went
 * there can be found, put back or deleted. A folder off a share has the system's Trash instead.
 */
export function PrismTrashRow() {
  const library = useLibrary();
  const location = useLocation();
  const { data: trash } = useQuery({
    ...prismTrashQuery(library),
    enabled: library.root.location === 'network',
  });
  if (!trash || trash.batches.length === 0) {
    return null;
  }
  const selected = location.pathname === '/library/trash';
  return (
    <div className="border-separator shrink-0 border-t px-2 py-1.5">
      <SidebarRow selected={selected}>
        <Link
          to={{ pathname: '/library/trash', search: location.search }}
          aria-current={selected ? 'page' : undefined}
          className="flex h-full min-w-0 flex-1 items-center gap-2 pl-2.5 text-base"
          viewTransition
        >
          <Trash2 size={14} className="text-label-secondary shrink-0" />
          <span className="truncate">Prism’s Trash</span>
          <span className="ml-auto">
            <Badge>{trash.batches.length.toLocaleString()}</Badge>
          </span>
        </Link>
      </SidebarRow>
    </div>
  );
}
