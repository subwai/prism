# @prism/brand

Prism's logo and app icons. `src/` holds the logo's vector layers, which the design system's logo
and the icons are made from, and `icons/` the app icons that the build and the
window use: `icon-mac.png` with the margin, corners and shadow of Apple's icon grid, and
`icon.png`, a full-bleed circle for Windows and Linux.

After changing a layer in `src/`, run `pnpm turbo icons -F @prism/brand` to render the icons
again with sharp, and commit them.
