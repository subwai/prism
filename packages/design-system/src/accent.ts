/**
 * Sets the accent the theme derives its accent colours from, such as the system's, as CSS
 * colour text (`#0a84ffff`), or goes back to the theme's own with `null`.
 */
export function setAccentColor(color: string | null) {
  const root = document.documentElement.style;
  if (color) {
    root.setProperty('--system-accent', color);
  } else {
    root.removeProperty('--system-accent');
  }
}
