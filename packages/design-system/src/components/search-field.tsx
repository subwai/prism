import { Kbd, type Shortcut } from '#components/kbd';
import { Search } from 'lucide-react';

export function SearchField({
  label,
  placeholder,
  shortcut,
  value,
  onChange,
}: {
  label: string;
  placeholder?: string;
  shortcut?: Shortcut;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    // Fills its container, so the caller decides how wide the field is.
    <label className="rounded-field bg-fill text-label-tertiary has-focus-visible:focus-ring flex h-7 w-full items-center gap-1.75 px-2.5">
      <Search size={14} />
      <input
        aria-label={label}
        aria-keyshortcuts={shortcut?.keys}
        type="search"
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="text-label placeholder:text-label-tertiary h-full min-w-0 flex-1 border-0 bg-transparent focus-visible:outline-none"
      />
      {/* Screen readers hear the shortcut with the field instead. */}
      {shortcut && (
        <span aria-hidden>
          <Kbd>{shortcut.label}</Kbd>
        </span>
      )}
    </label>
  );
}
