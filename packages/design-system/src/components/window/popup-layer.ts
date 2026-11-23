import { createContext, type RefObject } from 'react';

/**
 * Where pop-ups such as a field's list open: the modal dialog they are in, or with none, the
 * body. A modal dialog sits in the top layer and leaves everything outside it inert, so a list
 * opened in the body would show behind it, out of reach.
 */
export const PopupLayer = createContext<RefObject<HTMLElement | null> | null>(null);
