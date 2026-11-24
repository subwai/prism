# @prism/design-system

Tokens and React primitives for Prism's dark, translucent windows. The app draws its own look,
the same on macOS, Windows and Linux, rather than following any one platform's guidelines; only
the accent colour comes from the system.

## Setup

```css
/* app stylesheet */
@import 'tailwindcss';
@import '@prism/design-system/theme.css';
```

The theme registers this package as a Tailwind source, so its components' classes are generated
automatically. On macOS the window should be created with `vibrancy: 'sidebar'` and a transparent
background; the page itself is transparent and each surface paints its own colour.

To follow the system's accent colour, pass it to `setAccentColor` (the renderer does this before
its first frame). Hover colours and text on the accent derive from it, and its lightness is held
in a range that reads on the dark surfaces, so any accent works. `null` keeps the theme's own blue.

## Catalog

Every token and component, in its states, is on one screen: in development, choose
**View › Design System**. The end-to-end test `e2e/tests/design-system.test.ts` screenshots
each section and fails when one changes; run it with `-u` to record the new look once a change is
intended. Each platform keeps its own screenshots, and a missing one is recorded rather than
failed; CI uploads the Linux ones it records as the `linux-screenshots` artifact, to commit.

## Tokens

Only the semantic palette exists (`--color-*: initial`), so use these instead of raw colours:

| Kind       | Utilities                                                                                                           |
| ---------- | ------------------------------------------------------------------------------------------------------------------- |
| Text       | `text-label`, `-secondary`, `-tertiary`, `-quaternary`, `text-accent`, `text-on-accent`                             |
| Fills      | `bg-fill`, `bg-fill-strong`, `bg-fill-selected`, `bg-accent`, `bg-accent-hover`                                     |
| Surfaces   | `bg-surface` (dialogs), `bg-menu`, `bg-hud` (under `material`), `bg-sidebar`                                        |
| Backdrops  | `bg-content-fade` (beside a sidebar), `bg-window` (full window), `bg-scrim`                                         |
| Lines      | `border-separator`, `border-edge` (sheets), `border-edge-subtle` (menus)                                            |
| Status     | `warning`, `warning-fill`, `-border`, `-surface`; `danger`, `danger-fill`, `danger-border`                          |
| Over media | `text-on-media` with `text-shadow-overlay`, over `to-scrim`                                                         |
| Type       | `text-3xs` 8px · `2xs` 9 · `xs` 10 · `sm` 11 · `base` 12 (body) · `md` 13 · `lg` 14 · `xl` 15 · `2xl` 24 · `3xl` 34 |
| Radii      | `rounded-inner`, `-control`, `-field`, `-card`, `-menu`, `-window`, `-icon`                                         |
| Shadows    | `shadow-raised`, `-button`, `-toast`, `-photo`, `-icon`, `-window`                                                  |
| Chrome     | `h-titlebar`, `pl-traffic-lights`, `h-statusbar`, `w-sidebar`, `drag`, `no-drag`                                    |
| Motion     | `ease-jelly`, `animate-spin-once`, `interpolate-size`                                                               |

The type scale is plain sizes, so the names promise no role; `base` is body text.

Utilities for common combinations:

- `material`: a translucent floating surface, with `bg-menu/90` or `bg-hud/80` under it.
- `focus-ring`: the one focus indicator, which `:focus-visible` uses; controls that draw their
  own use it too, as with `has-focus-visible:focus-ring`.
- `icon-xs` · `sm` · `md` · `lg` (12–18px): sizes the icons inside a control, so icons are
  passed without a `size`. `Button`, `IconButton` and `SegmentedControl` use `icon-md`.
- `eyebrow`: a small, widely spaced uppercase line over a heading or under a title. Write its
  text in sentence case; the utility capitalises it.
- `sheet-large`, `sheet-medium`: `Dialog`'s floating sizes.

Variants: `fullscreen:` (an element the app shows on its own across the screen, marked
`data-full-screen`), and `picker:`,
`picker-icon:` and `checkmark:` for the parts of a customizable select.

`Toolbar` is a container, so what sits in it adapts with `@` variants (`@2xl:`, `@3xl:`) to the
toolbar's own width, which a sidebar beside it changes, not the window's.

## Layout

| Where                     | What it holds                                                                               |
| ------------------------- | ------------------------------------------------------------------------------------------- |
| `src/theme.css`           | The tokens, utilities and variants above. Every token is defined here, in `@theme`.         |
| `src/components/<group>/` | The components, a folder per group, below. Each component's tests are in its `__tests__/`.  |
| `src/catalog/`            | The View › Design System screen, exported as `@prism/design-system/catalog`.                |
| `src/*.ts`                | Helpers the components and the app share: `tv` and `cn`, the accent colour, fonts and refs. |
| `src/index.ts`            | The package's main entry, `@prism/design-system`.                                           |

The app imports components only from the main entry, never from a file inside `src/`.

## Components

| Folder      | Components                                                                                                                                                                                                                                                                                                                                    |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `window/`   | `Window`, `TitleBar`, `Toolbar`, `ToolbarGroup`, `StatusBar`, `Sidebar` (+ `SidebarTitleBar`, `SidebarHeading`, `SidebarRow`, `SidebarDisclosure`, `SidebarFooter`), `ResizeHandle`, `Breadcrumbs`, `Dialog` (+ `DialogTitle`, `DialogFooter`), `PreviewSheet`, `FloatingToolbar` (+ `FloatingToolbarDivider`), `FloatingControls`, `Tooltip` |
| `buttons/`  | `Button`, `IconButton`, `ChoiceToggle`, `SegmentedControl`, `Kbd` (+ the `Shortcut` type)                                                                                                                                                                                                                                                     |
| `fields/`   | `TextField`, `TokenSearchField`, `Select`, `Slider`, `StarRating`, `RatingBadge`                                                                                                                                                                                                                                                              |
| `lists/`    | `ListRow`, `GridCell`                                                                                                                                                                                                                                                                                                                         |
| `media/`    | `MediaCaption`, `Placeholder`, `PrismMark`                                                                                                                                                                                                                                                                                                    |
| `feedback/` | `Banner`, `Toast`, `Badge`, `EmptyState`, `StatusIndicator`, `Spinner`, `LoadingState`, `LoadingScreen`, `ShimmerText`, `LiveRegion`                                                                                                                                                                                                          |

## Writing components

- Build variants with `tv` from this package, not the plain `tailwind-variants` export: it knows
  the theme's names, so a `className` passed in replaces the default it conflicts with. `cn`
  merges the same way. When adding a token whose name Tailwind's defaults would not recognise
  (a radius, shadow, spacing or tracking name, or a new utility), add it to `cn.ts` too; its
  tests say which kinds need it.
- Take a `className` only where callers need to place or size the component, and merge it last.
- Icons come from `lucide-react`; let the control size them with `icon-*`.
- Add each new component, in its states, to the catalog
  (`src/catalog`), and record its screenshot.
