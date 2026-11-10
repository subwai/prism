import type { Ref, RefCallback } from 'react';

/**
 * One ref that sets every ref in `refs`, and cleans each up as React would. Each call makes a
 * new one, which React detaches and attaches again, so call it where React Compiler memoizes it,
 * or memoize it yourself in a component that opts out.
 */
export function mergeRefs<Value>(...refs: (Ref<Value> | undefined)[]): RefCallback<Value> {
  return (value) => {
    const cleanups = refs.map((ref) => {
      if (typeof ref === 'function') {
        return ref(value);
      }
      if (ref) {
        ref.current = value;
      }
      return () => {
        if (ref) {
          ref.current = null;
        }
      };
    });
    return () => {
      for (const cleanup of cleanups) {
        if (typeof cleanup === 'function') {
          cleanup();
        }
      }
    };
  };
}
