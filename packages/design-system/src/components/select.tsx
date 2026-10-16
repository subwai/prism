import { Check, ChevronsUpDown } from 'lucide-react';
import { type KeyboardEvent, useId, useRef } from 'react';

export interface SelectOption<Value extends string> {
  value: Value;
  label: string;
}

/**
 * Pop-up button with a menu drawn by the app rather than the OS, so it matches the theme.
 * The menu is a light-dismiss popover anchored below the button's left edge; it flips if needed.
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
  const id = useId();
  const menu = useRef<HTMLDivElement>(null);
  // useId output (e.g. «r1») is not a valid CSS ident, so keep only safe characters.
  const anchor = `--select-${id.replaceAll(/[^\w-]/gu, '')}`;
  const current = options.find((option) => option.value === value);

  function items() {
    return [...(menu.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? [])];
  }
  function handleKey(event: KeyboardEvent) {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') {
      return;
    }
    event.preventDefault();
    const list = items();
    const index = list.indexOf(document.activeElement as HTMLButtonElement);
    const step = event.key === 'ArrowDown' ? 1 : -1;
    list.at((index + step) % list.length)?.focus();
  }

  return (
    <div className="flex items-center gap-1.5 text-footnote whitespace-nowrap">
      {showLabel && (
        <span className="hidden text-label-tertiary min-[850px]:inline" aria-hidden>
          {label}
        </span>
      )}
      <button
        type="button"
        popoverTarget={`${id}-menu`}
        aria-label={`${label}: ${current?.label ?? value}`}
        aria-haspopup="listbox"
        className="flex items-center gap-1 rounded-control py-1 pr-1 pl-2 text-body text-label-secondary hover:bg-fill hover:text-label"
        style={{ anchorName: anchor }}
      >
        {current?.label ?? value}
        <ChevronsUpDown size={12} className="text-label-tertiary" />
      </button>
      <div
        ref={menu}
        id={`${id}-menu`}
        popover="auto"
        role="listbox"
        aria-label={label}
        onKeyDown={handleKey}
        onToggle={(event) => {
          if (event.newState === 'open') {
            items()
              .find((item) => item.getAttribute('aria-selected') === 'true')
              ?.focus();
          }
        }}
        // Popovers default to `inset: 0`; clear it, then place the menu below the trigger.
        className="material inset-auto top-[anchor(bottom)] left-[anchor(left)] m-0 mt-1 min-w-36 rounded-menu bg-menu/90 p-1 text-body text-label [position-try-fallbacks:flip-block,flip-inline]"
        style={{ positionAnchor: anchor }}
      >
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            role="option"
            aria-selected={option.value === value}
            className="group flex w-full items-center gap-1.5 rounded-control py-1 pr-3 pl-1.5 text-left hover:bg-accent hover:text-on-accent focus-visible:bg-accent focus-visible:text-on-accent focus-visible:outline-none"
            onClick={() => {
              onChange(option.value);
              menu.current?.hidePopover();
            }}
          >
            <Check size={13} className="invisible group-aria-selected:visible" />
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}
