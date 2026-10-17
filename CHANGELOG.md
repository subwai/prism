# electron-starter

## 0.4.0

### Minor Changes

- 7fbc8ca: Show and play videos (MP4, M4V, MOV and WebM) alongside photos, with thumbnails, playback controls, and shortcuts: Shift-Space to play or pause, and Shift-Left or Shift-Right to skip five seconds. Slideshows play each video to the end before moving on.
- 7fbc8ca: Keep the open folder up to date as files change on disk: added, removed, renamed and edited photos and videos, and new or removed folders, appear without refreshing, and an edited photo that is open in the viewer updates in place.

### Patch Changes

- 7fbc8ca: Folder covers prefer photos over videos, and skip files that have no picture, such as a damaged video, instead of showing a generic file icon.
- 7fbc8ca: Add File › Reset Thumbnail Cache, which deletes the saved thumbnails and makes them again.
- 7fbc8ca: Right-click a photo, video or folder to reveal it in Finder, File Explorer, or your file manager on Linux.

## 0.3.1

### Patch Changes

- d977be8: Keep the current photo on screen while the next one loads when browsing quickly with the arrow keys, instead of flashing a loading label, and show the shimmering loading label when a photo opens before its thumbnail is ready.

## 0.3.0

### Minor Changes

- 38fa256: Give the window a native macOS look with a hidden title bar, a translucent sidebar, square photo thumbnails, the Public Sans typeface and a shimmering loading label, built on a new reusable design-system package, reopen the last folder on launch, and add an application menu with consistent keyboard shortcuts, keyboard navigation in the sidebar and shortcut tooltips.
- 26cef5e: Add a photo browser with route-based folder navigation, virtualized grid and filmstrip views, shallow folder previews, and on-demand thumbnails.
- dc249ae: Add a typed photo API with incremental directory scans, shallow folder covers, and cancellable cached thumbnails in an Electron utility process.
- c1cff7f: Zoom and pan photos in the viewer: pinch or ⌘-scroll to zoom, scroll or drag to pan, and double-click to switch between fit and actual size.

### Patch Changes

- 440f377: Fix macOS release builds waiting for an interactive certificate trust prompt, and update electron-builder to fix temporary keychain password handling.

## 0.2.0

### Minor Changes

- a327cb6: Add automatic updates and GitHub Releases builds for macOS, Windows, and Linux.
