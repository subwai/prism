import { tv } from '#cn';
import type { Shortcut } from '#components/kbd';
import { Tooltip } from '#components/tooltip';
import { type MouseEventHandler, type ReactNode, useId } from 'react';
import type { VariantProps } from 'tailwind-variants';

interface BaseButtonProps {
  children: ReactNode;
  className?: string;
  disabled?: boolean;
  onClick?: MouseEventHandler<HTMLButtonElement>;
  title?: string;
  type?: 'button' | 'submit';
}

// Icons inside take the control's size, so call sites leave theirs unset.
const button = tv({
  base: 'inline-flex items-center justify-center icon-md',
  defaultVariants: { variant: 'plain' },
  variants: {
    variant: {
      plain:
        'gap-1.75 rounded-control px-2 py-1.5 text-sm text-label-secondary enabled:hover:bg-fill enabled:hover:text-label',
      primary:
        'gap-2.5 rounded-field bg-accent px-4.5 py-2.5 font-semibold text-on-accent shadow-button enabled:hover:bg-accent-hover',
    },
  },
});

const iconButton = tv({
  base: 'inline-flex size-7 shrink-0 items-center justify-center rounded-control text-label-secondary icon-md enabled:hover:bg-fill enabled:hover:text-label aria-pressed:bg-fill-strong aria-pressed:text-label',
});

export function Button({
  children,
  className,
  disabled,
  onClick,
  title,
  type = 'button',
  variant,
}: BaseButtonProps & VariantProps<typeof button>) {
  return (
    <button
      // oxlint-disable-next-line react/button-has-type -- Narrowed by the prop type.
      type={type}
      className={button({ className, variant })}
      disabled={disabled}
      onClick={onClick}
      title={title}
    >
      {children}
    </button>
  );
}

/**
 * Square icon-only button. The label is required because there is no visible text; it also
 * shows as a tooltip, with the keyboard shortcut if there is one, which screen readers are told
 * about too.
 */
export function IconButton({
  children,
  className,
  disabled,
  label,
  onClick,
  pressed,
  shortcut,
  type = 'button',
}: Omit<BaseButtonProps, 'title'> & { label: string; pressed?: boolean; shortcut?: Shortcut }) {
  const tooltip = useId();
  return (
    <>
      <button
        // oxlint-disable-next-line react/button-has-type -- Narrowed by the prop type.
        type={type}
        aria-label={label}
        aria-pressed={pressed}
        aria-keyshortcuts={shortcut?.keys}
        // oxlint-disable-next-line react/no-unknown-property -- Interest invokers; typed in tooltip.tsx.
        interestfor={tooltip}
        className={iconButton({ className })}
        disabled={disabled}
        onClick={onClick}
      >
        {children}
      </button>
      <Tooltip id={tooltip} label={label} shortcut={shortcut} />
    </>
  );
}
