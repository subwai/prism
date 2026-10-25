import { type ReactNode, useId } from 'react';

export function Section({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} data-catalog={title} className="flex flex-col gap-4 p-6">
      <h2 id={id} className="eyebrow">
        {title}
      </h2>
      {children}
    </section>
  );
}

/** A labelled cell in a grid of examples. */
export function Example({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-2">
      {children}
      <span className="text-label-tertiary text-xs">{label}</span>
    </div>
  );
}
