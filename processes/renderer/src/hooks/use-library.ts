import type { LibrarySession } from '#data/library';
import { createContext, useContext } from 'react';

export const LibraryContext = createContext<LibrarySession | null>(null);
export function useLibrary() {
  const library = useContext(LibraryContext);
  if (!library) {
    throw new Error('A photo library is required');
  }
  return library;
}
