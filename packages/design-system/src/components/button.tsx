import { cn } from '#cn';
import type { Shortcut } from '#components/kbd';
import { Tooltip } from '#components/tooltip';
import { type MouseEventHandler, type ReactNode, useId } from 'react';

interface BaseButtonProps {
  children: ReactNode;
  className?: string;
  disabled?: boolean;
  onClick?: MouseEventHandler<HTMLButtonElement>;
  title?: string;
  type?: 'button' | 'submit';
}

const VARIANTS = {
  plain:
    'gap-1.75 rounded-control px-2 py-1.5 text-footnote text-label-secondary enabled:hover:bg-fill enabled:hover:text-label',
  primary:
    'gap-2.5 rounded-field bg-accent px-4.5 py-2.5 font-semibold text-on-accent shadow-button enabled:hover:bg-accent-hover'
};

export function Button({
  children,
  className,
  disabled,
  onClick,
  title,
  type = 'button',
  variant = 'plain'
}: BaseButtonProps & { variant?: keyof typeof VARIANTS }) {
  return (
    <button
      // oxlint-disable-next-line react/button-has-type -- Narrowed by the prop type.
      type={type}
      className={cn('inline-flex items-center justify-center', VARIANTS[variant], className)}
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
  type = 'button'
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
        className={cn(
          'inline-flex size-7 shrink-0 items-center justify-center rounded-control text-label-secondary enabled:hover:bg-fill enabled:hover:text-label',
          className
        )}
        disabled={disabled}
        onClick={onClick}
      >
        {children}
      </button>
      <Tooltip id={tooltip} label={label} shortcut={shortcut} />
    </>
  );
}
