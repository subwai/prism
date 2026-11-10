import { tv } from '#cn';
import type { Shortcut } from '#components/kbd';
import { Tooltip } from '#components/tooltip';
import { useRender } from '@base-ui/react/use-render';
import { type MouseEventHandler, type ReactElement, type ReactNode, useId } from 'react';
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
        'gap-1.75 rounded-control px-2 py-1.5 text-sm text-label-secondary not-disabled:hover:bg-fill not-disabled:hover:text-label',
      primary:
        'gap-2.5 rounded-field bg-accent px-4.5 py-2.5 font-semibold text-on-accent shadow-button not-disabled:hover:bg-accent-hover',
    },
  },
});

const iconButton = tv({
  base: 'inline-flex size-7 shrink-0 items-center justify-center rounded-control text-label-secondary icon-md enabled:hover:bg-fill enabled:hover:text-label aria-pressed:bg-fill-strong aria-pressed:text-label',
});

/**
 * A text button. With `render`, such as a router's `<Link />`, it is that element instead,
 * styled as a button, as a link that should look like one is.
 */
export function Button({
  children,
  className,
  disabled,
  onClick,
  render,
  title,
  type = 'button',
  variant,
}: BaseButtonProps & VariantProps<typeof button> & { render?: ReactElement }) {
  return useRender({
    defaultTagName: 'button',
    props: {
      children,
      className: button({ className, variant }),
      // Only a button has these; another element given as `render` keeps its own.
      ...(render ? {} : { disabled, type }),
      onClick,
      title,
    },
    render,
  });
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
