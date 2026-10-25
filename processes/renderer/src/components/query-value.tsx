import {
  type QueryKey,
  useSuspenseQuery,
  type UseSuspenseQueryOptions,
} from '@tanstack/react-query';
import { type ReactNode, Suspense } from 'react';

interface QueryValueProps<Value, Key extends QueryKey> {
  query: UseSuspenseQueryOptions<Value, Error, Value, Key>;
  /** Called without a value until it first arrives. */
  children: (value?: Value) => ReactNode;
}

function Read<Value, Key extends QueryKey>({ query, children }: QueryValueProps<Value, Key>) {
  return children(useSuspenseQuery(query).data);
}

/**
 * Renders a query's data, or `undefined` until it first arrives. Once there, it stays on
 * screen while a change or refresh reads it again.
 */
export function QueryValue<Value, Key extends QueryKey>({
  query,
  children,
}: QueryValueProps<Value, Key>) {
  return (
    <Suspense fallback={children()}>
      <Read query={query}>{children}</Read>
    </Suspense>
  );
}
