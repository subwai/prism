# prism

## 0.6.1

### Patch Changes

- Recursive views, such as the filmstrip, list folders on network shares several times faster, reading many folders at once. ([#15](https://github.com/subwai/prism/pull/15)) Thanks [@subwai](https://github.com/subwai)!
- In the grid, Shift-Space on a folder previews its cover photo or video, and closes the preview again. ([#13](https://github.com/subwai/prism/pull/13)) Thanks [@subwai](https://github.com/subwai)!
- Browsing photos with the arrow keys in a photo opened from a folder preview no longer flashes the folder's grid over the photo. ([#10](https://github.com/subwai/prism/pull/10)) Thanks [@subwai](https://github.com/subwai)!
- Gallery cards show their name over the picture, beside an icon for a folder, photo or video, instead of below it. An empty folder says so in the middle of its card. ([#14](https://github.com/subwai/prism/pull/14)) Thanks [@subwai](https://github.com/subwai)!
- A folder with no photos or videos of its own now takes its cover from the first folder inside it that has some, however deep, instead of showing a plain folder icon. ([#4](https://github.com/subwai/prism/pull/4)) Thanks [@subwai](https://github.com/subwai)!
- Downloads on the releases page are now named after Prism, such as `prism-0.6.1-mac-arm64.dmg`. ([#12](https://github.com/subwai/prism/pull/12)) Thanks [@subwai](https://github.com/subwai)!
- Going back to a large folder, or switching between grid and filmstrip, no longer reads every photo in it again: folders you have already opened show at once, and stay up to date as files change. ([#9](https://github.com/subwai/prism/pull/9)) Thanks [@subwai](https://github.com/subwai)!
- While a large folder is still being read, the status bar counts what it has found so far, such as "1,234 photos so far…", instead of only saying "Reading folder…". ([#7](https://github.com/subwai/prism/pull/7)) Thanks [@subwai](https://github.com/subwai)!
- Folders on a network share no longer show up more than once after the share reconnects, and ([#6](https://github.com/subwai/prism/pull/6)) Thanks [@subwai](https://github.com/subwai)!
  Prism keeps noticing changes in them after the share drops or the Mac sleeps.
- Keys without Shift now get around and keys with Shift work the photo or video shown: Space opens and closes the preview, Left and Right always move between photos and videos, and Shift-Space plays and pauses, Shift-Left and Shift-Right skip, and Shift-M mutes. If you rebound any of these in your keybindings.json, check they still do what you want. ([#11](https://github.com/subwai/prism/pull/11)) Thanks [@subwai](https://github.com/subwai)!

  The preview now belongs to the grid alone: the filmstrip and the reader already show photos large, so Space, Enter and double-clicking there no longer open one over them.

- A focused slider's knob now turns the accent colour along with its bar, instead of staying grey. ([#14](https://github.com/subwai/prism/pull/14)) Thanks [@subwai](https://github.com/subwai)!
- Sorting by date or size no longer reads the whole folder again: Prism fills in the dates and sizes of what it has already found, and keeps the photos on screen while it does. ([#16](https://github.com/subwai/prism/pull/16)) Thanks [@subwai](https://github.com/subwai)!
- Folder covers no longer stay out of date when photos arrive in a folder while Prism is reading it, such as during a copy. ([#8](https://github.com/subwai/prism/pull/8)) Thanks [@subwai](https://github.com/subwai)!
- A video browsed quickly past in a preview no longer keeps playing unseen, and heard, after moving on or closing the preview. ([#10](https://github.com/subwai/prism/pull/10)) Thanks [@subwai](https://github.com/subwai)!

## 0.6.0

### Minor Changes

- A third view, the reader, shows a folder's photos one below the other, in full, for reading comics and scanned books. It scrolls as a web page does, with the trackpad, Up and Down, Space and Page Up and Down, while Left and Right turn to the next or previous page. It shows only the photos in the folder itself, not its videos or subfolders, and the status bar names the page at the top. A slider in the status bar sets how wide pages are. Like the viewer, it has controls along the top for turning pages, a slideshow that turns a page at a time, and full screen, which double-clicking a page or Cmd-Shift-F also enters. Cmd-G (Ctrl-G on Windows and Linux) and View > Switch View, which replaces Switch Grid/Filmstrip, now step through all three views. ([`52ce4bc`](https://github.com/subwai/prism/commit/52ce4bcaf93a56f1b43108282c20e0aeadf93ae8)) Thanks [@subwai](https://github.com/subwai)!

### Patch Changes

- Double-clicking a photo or video in the preview or the filmstrip shows it full screen, and double-clicking again brings it back; Option-double-click (Alt on Windows and Linux) now switches a photo between fit and actual size. In full screen, the controls and the pointer hide after two seconds without moving the mouse, unless it rests on the controls, and come back as soon as it moves. ([`f2c5e3f`](https://github.com/subwai/prism/commit/f2c5e3fc1c3d099dc36b80b70de897c69e0815b6)) Thanks [@subwai](https://github.com/subwai)!
- Prism is now licensed under the GNU General Public License v3.0, and the license text ships with the app. ([`7ee6a48`](https://github.com/subwai/prism/commit/7ee6a48a55c233efb49abd76f441ff2e4895a1c0)) Thanks [@subwai](https://github.com/subwai)!
- The badge above the folders in the sidebar says Network when the open folder is on a network share, such as an SMB or NFS drive, rather than always Local. ([`29c97ce`](https://github.com/subwai/prism/commit/29c97cef7bff34a7a3229758ebcb1e65c2dca3d0)) Thanks [@subwai](https://github.com/subwai)!
- Prism checks for updates without a GitHub token, now that its repository is public. ([#1](https://github.com/subwai/prism/pull/1)) Thanks [@subwai](https://github.com/subwai)!
- A photo that changes on disk while it is open now always updates on screen. Before, it could keep showing the old version if Prism read the file again, such as to make its thumbnail, before it noticed the change. ([`207f4a0`](https://github.com/subwai/prism/commit/207f4a04f24c54906851947f0dc5fa6e4177502b)) Thanks [@subwai](https://github.com/subwai)!

## 0.5.0

### Minor Changes

- d667a8e: Rename photos, videos and folders from the right-click menu. The name before the extension starts selected, a name already in use is refused rather than replaced, and renaming the folder you are in keeps it open under its new name.
- 7716c83: The app is now called Prism, with the original Prism's icon, and updates from the `subwai/prism` repository. Its new app ID means existing installations don't update to it: install this version by hand. Settings and thumbnails start fresh.

### Patch Changes

- ef44413: Works better with screen readers and the keyboard. F2, or File > Rename…, renames the selected photo, video or folder, and Shift-F10, or the menu key, opens its right-click menu just below it. Going to another folder or view from the toolbar keeps focus in the grid. Screen readers hear each item's position in the folder, whether it is a folder or a video, which photo the viewer moves to, and the video's time as you scrub.

  Screen readers announce each button's keyboard shortcut. With Increase Contrast on, faint labels, lines and fills are stronger; with Reduce Transparency on, the window's content is opaque; and in Windows high contrast themes, what is selected or pressed is outlined.

- d667a8e: Shift-F switches between fit and actual size wherever focus is, not only after clicking the photo.
- 04436c4: Prism now runs on Electron 45, with Chromium 156 and Node 24.22.
- 6c23d08: Large and deeply nested folders open and scroll faster: thumbnails are cached by file rather than path and made with more of the CPU, the folder's worker talks to the window directly, and covers and listings load only while shown. The sidebar no longer collapses after reading many folders, the thumbnail size stays put between folders, and Back closes a preview.
- 945541c: A slider under the sidebar sizes its folder covers, as the grid's slider sizes thumbnails, in place of the footer's Local badge. Double-clicking either slider resets it, and dragging one snaps to its default until held there for a moment.
- b469397: Shift-Cmd-F (Shift-Ctrl-F on Windows and Linux), or the new button in the viewer's toolbar, shows just the photo or video full screen, and Escape brings it back. The whole window still goes full screen with Ctrl-Cmd-F (F11 on Windows and Linux).
- b469397: Keyboard shortcuts work as in VS Code: the defaults ship in a file of their own, which File > Default Keyboard Shortcuts shows, and yours go in `keybindings.json` (File > Keyboard Shortcuts…), applied on top as soon as you save. Rules that cannot be used are pointed out, and the rest still apply.
- 6be7a99: The loading screen now shows the prism from the app icon, and the icon itself is glossier and midnight blue.
- 6be7a99: On macOS, Prism's icon now has the rounded-square shape and margins of other Mac apps.
- d667a8e: M mutes and unmutes the video you are watching.
- ddcc08b: The thumbnail size and playback sliders, and the dot beside the status bar's count, are drawn in the same grey as the icons around them rather than in the accent.
- b6a5760: Folders in the sidebar slide open and closed, and show a folder icon while their cover loads. The folder or photo the keyboard is on fills with the accent instead of showing an outline, in the sidebar and in the grid and filmstrip.
- b469397: Videos no longer jump as they start playing: the viewer keeps the previous photo or video on screen until the next video's first frame is ready, then shows that frame rather than a thumbnail from further in.
- d14a377: Buttons, selections and focus rings take on the accent colour you chose for your system, on macOS and Windows, and follow it when you change it; where the system has none, Prism uses macOS's blue. Errors, such as a name already in use when renaming, show in red, and controls share one focus ring and one icon size.
- d667a8e: Cmd-G (Ctrl-G on Windows and Linux) switches between the grid and the filmstrip.
- 04436c4: Once an update has downloaded, the Prism menu offers Restart to Update, with a "1 Update" badge on macOS 14 and up. On Windows it is in the File menu.
- b469397: Videos take the keys a video player would. Space plays and pauses, and Shift-Space now opens and closes the preview. Left and Right still browse until you play, pause, click, seek or scrub a video; from then on they skip five seconds, and Shift-Left and Shift-Right move to the previous or next item.
- 99084b6: Moving between videos no longer flickers dark: the viewer keeps the previous photo or video on screen until the next video has a frame of its own to show, rather than its poster, which could paint late and looked darker than the video.

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
