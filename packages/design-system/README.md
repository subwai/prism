# @app/design-system

macOS-style tokens and React primitives for dark, vibrancy-backed Electron windows.

## Setup

```css
/* app stylesheet */
@import 'tailwindcss';
@import '@app/design-system/theme.css';
```

The theme registers this package as a Tailwind source, so its components' classes are generated
automatically. The window should be created with `vibrancy: 'sidebar'` and a transparent
background on macOS; the page itself is transparent and each surface paints its own colour.

## Tokens

Only the semantic palette exists (`--color-*: initial`), so use these instead of raw colours:

| Kind      | Utilities                                                                                     |
| --------- | --------------------------------------------------------------------------------------------- |
| Text      | `text-label`, `text-label-secondary`, `-tertiary`, `-quaternary`, `text-accent`               |
| Fills     | `bg-fill`, `bg-fill-strong`, `bg-fill-selected`, `bg-accent`, `bg-surface`                    |
| Materials | `bg-sidebar`, `bg-content-fade` (beside a sidebar), `bg-window` (full window)                 |
| Lines     | `border-separator`                                                                            |
| Type      | `text-micro` · `caption` · `footnote` · `body` · `headline` · `title-3` · `title` · `display` |
| Radii     | `rounded-control`, `rounded-field`, `rounded-card`, `rounded-window`                          |
| Chrome    | `h-titlebar`, `pl-traffic-lights`, `h-statusbar`, `w-sidebar`, `drag`, `no-drag`              |

## Components

`Window`, `TitleBar`, `Sidebar` (+ `SidebarTitleBar`, `SidebarHeading`, `SidebarRow`,
`SidebarFooter`), `Toolbar`, `ToolbarGroup`, `StatusBar`, `Button`, `IconButton`,
`SegmentedControl`, `SearchField`, `TextField`, `Select`, `Slider`, `Breadcrumbs`, `Dialog`, `Banner`,
`Toast`, `EmptyState`, `Badge`, `Kbd`, `StatusIndicator`, `ShimmerText`, `LoadingState`, `LoadingScreen`, and the `cn` helper. Text shimmer comes from [tw-shimmer](https://www.assistant-ui.com/tw-shimmer), imported by `theme.css`.
