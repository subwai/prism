import { type Ref, useId } from 'react';

/** A labelled single-line text input, styled like the search field, with an optional error. */
export function TextField({
  label,
  name,
  defaultValue,
  required,
  autoFocus,
  error,
  ref
}: {
  label: string;
  name?: string;
  defaultValue?: string;
  required?: boolean;
  /** Takes focus when its dialog opens; see `Dialog`. */
  autoFocus?: boolean;
  error?: string | null;
  ref?: Ref<HTMLInputElement>;
}) {
  const errorId = useId();
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-label-secondary text-sm">{label}</span>
      <input
        ref={ref}
        type="text"
        name={name}
        defaultValue={defaultValue}
        required={required}
        data-autofocus={autoFocus || undefined}
        spellCheck={false}
        autoComplete="off"
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        className="rounded-field bg-fill text-label aria-invalid:inset-ring-danger-border h-7 min-w-0 px-2.5 text-base aria-invalid:inset-ring"
      />
      {error && (
        <span id={errorId} role="alert" className="text-danger text-sm">
          {error}
        </span>
      )}
    </label>
  );
}
