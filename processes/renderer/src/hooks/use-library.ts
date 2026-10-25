import type { PhotoLibrary } from '#data/library';
import { createContext, useContext } from 'react';

export const LibraryContext = createContext<PhotoLibrary | null>(null);
export function useLibrary() {
  const library = useContext(LibraryContext);
  if (!library) {
    throw new Error('A photo library is required');
  }
  return library;
}
