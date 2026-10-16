import { Kbd } from '#components/kbd';
import { Search } from 'lucide-react';

export function SearchField({
  label,
  placeholder,
  shortcut,
  value,
  onChange
}: {
  label: string;
  placeholder?: string;
  shortcut?: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    // Fills its container, so the caller decides how wide the field is.
    <label className="flex h-7 w-full items-center gap-1.75 rounded-field border border-transparent bg-fill px-2.25 text-label-tertiary focus-within:border-accent">
      <Search size={15} />
      <input
        aria-label={label}
        type="search"
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-full min-w-0 flex-1 border-0 bg-transparent text-label placeholder:text-label-tertiary focus-visible:outline-none"
      />
      {shortcut && <Kbd>{shortcut}</Kbd>}
    </label>
  );
}
