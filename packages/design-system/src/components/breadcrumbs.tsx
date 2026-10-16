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
      className="text-headline flex min-w-0 flex-1 scrollbar-none items-center overflow-auto"
    >
      {items.map((item, index) => (
        <span key={item.key} className="text-label-quaternary flex shrink-0 items-center gap-0.5">
          {index > 0 && <ChevronRight size={12} />}
          <button
            type="button"
            aria-current={index === items.length - 1 ? 'location' : undefined}
            onClick={() => onSelect(index)}
            className="rounded-inner text-label-secondary hover:bg-fill aria-[current]:text-label px-1.5 py-1 whitespace-nowrap aria-[current]:font-semibold"
          >
            {item.label}
          </button>
        </span>
      ))}
    </nav>
  );
}
