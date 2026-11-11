/** Whether a saved value is one a preference may take. */
type Accepts<Preferences> = { [Key in keyof Preferences]: (value: unknown) => boolean };

/**
 * Preferences kept in local storage under `key`, for `useSyncExternalStore`. Chromium saves local
 * storage in the app's profile and reads it back at once, so a view's first frame already has
 * them; a file would need a round trip to the main process. Each is its default where what was
 * saved is missing or not one `accepts` takes.
 */
export function storedPreferences<Preferences extends object>(
  key: string,
  defaults: Preferences,
  accepts: Accepts<Preferences>,
) {
  let preferences: Preferences | undefined;
  const listeners = new Set<() => void>();

  function read(): Preferences {
    let saved: Partial<Record<keyof Preferences, unknown>> = {};
    try {
      saved = JSON.parse(localStorage.getItem(key) ?? '{}') ?? {};
    } catch {
      // Unreadable, they start over from the defaults.
    }
    const loaded = { ...defaults };
    for (const name of Object.keys(defaults) as (keyof Preferences)[]) {
      const value = saved[name];
      if (accepts[name](value)) {
        loaded[name] = value as Preferences[keyof Preferences];
      }
    }
    return loaded;
  }

  /** The preferences as saved, or as set since. */
  function current(): Preferences {
    preferences ??= read();
    return preferences;
  }

  return {
    current,
    defaults,
    /** Sets some of the preferences and saves them. */
    set(changes: Partial<Preferences>) {
      preferences = { ...current(), ...changes };
      try {
        localStorage.setItem(key, JSON.stringify(preferences));
      } catch {
        // Unsaved, they still hold for as long as the window is open.
      }
      for (const listener of listeners) {
        listener();
      }
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** Whether `value` is a finite number. */
export function isNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Whether `value` is `true` or `false`. */
export function isBoolean(value: unknown) {
  return typeof value === 'boolean';
}
