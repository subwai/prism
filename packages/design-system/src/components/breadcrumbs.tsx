import { ChevronRight } from 'lucide-react';

export interface Crumb {
  key: string;
  label: string;
}

/** Path of locations; the last one is current. Scrolls rather than wraps when long. */
export function Breadcrumbs({
  label,
  items,
  onSelect
}: {
  label: string;
  items: Crumb[];
  onSelect: (index: number) => void;
}) {
  return (
    <nav
      aria-label={label}
      className="scrollbar-none flex min-w-0 flex-1 items-center overflow-auto text-headline"
    >
      {items.map((item, index) => (
        <span key={item.key} className="flex shrink-0 items-center gap-0.5 text-label-quaternary">
          {index > 0 && <ChevronRight size={12} />}
          <button
            type="button"
            aria-current={index === items.length - 1 ? 'location' : undefined}
            onClick={() => onSelect(index)}
            className="rounded-inner px-1.5 py-1 whitespace-nowrap text-label-secondary hover:bg-fill aria-[current]:font-semibold aria-[current]:text-label"
          >
            {item.label}
          </button>
        </span>
      ))}
    </nav>
  );
}
