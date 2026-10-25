import { type ClassNameValue, extendTailwindMerge } from 'tailwind-merge';
import { createTV } from 'tailwind-variants';

/**
 * The theme's own names, which tailwind-merge cannot know from Tailwind's defaults. Without
 * them it would read `shadow-button` as a shadow colour, say, and keep a default it should
 * replace. Keep it in step with `theme.css`.
 */
const twMergeConfig = {
  extend: {
    classGroups: {
      'app-region': ['drag', 'no-drag'],
      eyebrow: ['eyebrow'],
      'icon-size': [{ icon: ['xs', 'sm', 'md', 'lg'] }],
      sheet: ['sheet-large', 'sheet-medium'],
    },
    theme: {
      animate: ['spin-once'],
      ease: ['jelly', 'swift'],
      radius: ['inner', 'control', 'field', 'card', 'menu', 'window', 'pill-end', 'icon'],
      shadow: ['raised', 'button', 'toast', 'window', 'photo', 'icon'],
      spacing: ['titlebar', 'traffic-lights', 'statusbar', 'sidebar'],
      // The scale's sizes are T-shirt sizes, which it knows, besides this one.
      text: ['base'],
      'text-shadow': ['overlay'],
      tracking: ['eyebrow', 'loading'],
    },
  },
};

const merge = extendTailwindMerge<keyof typeof twMergeConfig.extend.classGroups>(twMergeConfig);

/**
 * Joins class names, skipping falsy entries so conditions can be written inline. Later classes
 * win over earlier ones they conflict with, so a `className` prop can replace a default.
 */
export function cn(...classes: ClassNameValue[]) {
  return merge(...classes);
}

/** Variants and slots for components, merging classes the same way as `cn`. */
export const tv = createTV({ twMergeConfig });
