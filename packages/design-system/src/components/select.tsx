import { Check, ChevronsUpDown } from 'lucide-react';

declare module 'react' {
  // oxlint-disable-next-line typescript/no-namespace -- Must match React's declaration to merge with it.
  namespace JSX {
    interface IntrinsicElements {
      /** Shows a copy of the chosen option inside a customizable select's button. */
      selectedcontent: DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement>;
    }
  }
}

export interface SelectOption<Value extends string> {
  value: Value;
  label: string;
}

/**
 * Pop-up button with a menu drawn by the app rather than the OS, so it matches the theme. It is
 * a customizable `<select>`, so the browser still provides what a native one does: the keys,
 * typing to jump to an option, placing the menu, and what screen readers are told.
 */
export function Select<Value extends string>({
  label,
  value,
  options,
  onChange,
  showLabel = false
}: {
  label: string;
  /** Show the label before the button; toolbars usually rely on the value alone. */
  showLabel?: boolean;
  value: Value;
  options: SelectOption<Value>[];
  onChange: (value: Value) => void;
}) {
  return (
    <div className="text-footnote flex items-center gap-1.5 whitespace-nowrap">
      {showLabel && (
        <span className="text-label-tertiary hidden min-[850px]:inline" aria-hidden>
          {label}
        </span>
      )}
      <select
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value as Value)}
        // The menu is placed below the button by the browser, flipped if it does not fit. The
        // button shows the chosen option's label, without its check mark.
        className="appearance-base-select rounded-control text-body text-label-secondary hover:bg-fill hover:text-label open:bg-fill open:text-label [&::picker(select)]:material [&::picker(select)]:rounded-menu [&::picker(select)]:bg-menu/90 [&::picker(select)]:text-label border-0 bg-transparent py-1 pr-1 pl-2 [&_selectedcontent_svg]:hidden [&::picker(select)]:mt-1 [&::picker(select)]:min-w-36 [&::picker(select)]:p-1 [&::picker-icon]:hidden"
      >
        <button type="button" className="flex items-center gap-1">
          <selectedcontent />
          <ChevronsUpDown size={12} className="text-label-tertiary" />
        </button>
        {options.map((option) => (
          <option
            key={option.value}
            value={option.value}
            className="group rounded-control checked:text-label hover:bg-accent hover:text-on-accent focus-visible:bg-accent focus-visible:text-on-accent flex items-center gap-1.5 py-1 pr-3 pl-1.5 focus-visible:outline-none [&::checkmark]:hidden"
          >
            <Check size={13} className="invisible group-checked:visible" />
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}
