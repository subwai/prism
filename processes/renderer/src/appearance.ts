import { setAccentColor } from '@app/design-system';

let loading: Promise<void> | undefined;

/** Follows the system's accent colour: read once before the first frame, then as it changes. */
export function loadAccentColor() {
  loading ??= (async () => {
    globalThis.app.appearance.onAccentColorChange(setAccentColor);
    setAccentColor(await globalThis.app.appearance.getAccentColor());
  })();
  return loading;
}
