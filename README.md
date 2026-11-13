<div align="center">
  <img src="packages/brand/icons/icon-mac.png" alt="" width="128" height="128">
  <h1>Prism</h1>
  <p><strong>A fast, keyboard-friendly browser for the photos and videos on your computer.</strong></p>
  <p>
    <a href="#install">Install</a> ·
    <a href="#getting-around">Getting around</a> ·
    <a href="#clearing-out-what-you-dont-want">Clearing out</a> ·
    <a href="#keyboard-shortcuts">Shortcuts</a> ·
    <a href="#for-developers">For developers</a>
  </p>
  <p>
    <img src="https://img.shields.io/badge/macOS%20%C2%B7%20Windows%20%C2%B7%20Linux-1e1f4b?style=flat-square" alt="macOS, Windows and Linux">
    <a href="LICENSE"><img src="https://img.shields.io/badge/license-GPL--3.0-4f5aa8?style=flat-square" alt="GPL-3.0 license"></a>
  </p>
</div>

---

Point Prism at a folder and browse it straight from disk: no importing, no library to manage,
nothing uploaded anywhere.

- 🗂️ **Your folders, as they are.** A sidebar of folders with covers, a grid of what's inside,
  a filmstrip that runs through every subfolder too, and a reader for comics and scanned books.
- 🎞️ **Photos and videos.** Common photo formats, iPhone HEIC photos included, and videos
  side by side, with playback built in.
- ⚡ **Quick with big folders.** Thumbnails are made on demand and kept, and Prism remembers
  what each folder holds, so folders open fast the second time, even after a restart, and
  scrolling stays smooth with thousands of files.
- 🔄 **Always up to date.** Files added, renamed, edited or removed on disk show up without a
  refresh, including while Prism was closed.
- 🗑️ **Clear out in bulk.** Rate as you go, then move everything rated two stars or less to the
  Trash in one go, with a look at what's rated higher first, and Undo.
- 🔍 **Look closer.** Pinch or ⌘-scroll to zoom, drag to pan, run a slideshow, or show a photo
  full screen.
- ⌨️ **Made for the keyboard.** Every action has a shortcut, and you can change them all.
- ♿ **Accessible.** Works with screen readers, and follows your system's accent colour,
  Increase Contrast and Reduce Transparency settings.

## Install

Download the installer for your system from the
[latest release](https://github.com/subwai/prism/releases/latest):

| System  | Download                                      |
| ------- | --------------------------------------------- |
| macOS   | `.dmg` for Apple silicon or Intel             |
| Windows | `.exe` installer                              |
| Linux   | `.AppImage` (make it executable, then run it) |

Prism updates itself: it downloads new versions in the background and installs them the next
time you quit. **Prism › Check for Updates…** (**File › Check for Updates…** on Windows and
Linux) looks for one straight away. Once one is ready, the window offers to **Restart** into it, and
the same menu item becomes **Restart to Update**; either installs it right away.

> [!NOTE]
> Prism is in testing, so **macOS builds aren't notarized.** The first launch may ask you to
> confirm you want to open it, and updates need the test signing certificate trusted in Keychain
> Access (see [Releasing](docs/releasing.md#self-signed-macos-test-builds)).

## Getting around

1. **Open a folder** with **File › Open Folder…** (⌘O). Prism opens it again next time.
2. **Browse** in the grid, which shows the folder's own photos and subfolders, or press ⌘G to
   switch to the filmstrip, which also includes everything in its subfolders, and again for the
   reader, which shows the folder's photos one below the other: scroll through them, or turn a
   page with Left and Right.
3. **Preview** with Space to take a quick look at a photo or peek inside a folder, or with
   Shift-Space to see a folder's cover, and press **Enter** to open it.
4. **Manage files** from the right-click menu: rename them, reveal them in Finder, File
   Explorer or your file manager, or copy their path.
5. **Rate** a photo, video or folder from one to five stars: press **1** to **5** with it
   selected or shown in a preview or the viewer, use **File › Rating**, or click its stars in
   the status bar, the viewer or a folder's preview. Choosing the same rating again, or pressing
   **0**, takes it away.

Use the sliders to size thumbnails, folder covers and the reader's pages; double-click a slider
to reset it. Prism remembers these sizes, and the widths of the sidebar and filmstrip, the next
time it opens, and which folders you opened in the sidebar for each folder you open. It also
opens where you left off: in the same window size and place, in the view and sort you last used,
on the folder you were in, with videos at the volume you left them, muted if you muted them.

Sort by name, by **Date Taken** from the photos' camera data, or by when files were modified or
created, and by their size. The search field also filters: as you type, it suggests a format, photos
or videos, ratings, the camera and lens photos were taken with, and their tags (the keywords Windows
Explorer, Lightroom and other editors save in photos). A rating filter keeps everything with at
least or at most that many stars, or what has none, folders included: type `>=3` to find
**≥ 3 stars**, `<=2` for **≤ 2 stars**, or `unrated`. **≤** leaves out what has no rating, so add
**Unrated** too for everything still to sort through. Click the empty field to browse instead: it
lists those kinds, and choosing one lists its values. Choose a value with the arrow keys and
**Enter**, or a click, and it becomes a chip; **Backspace** or a chip's **×** removes it. Chips of
one kind match any of them, and text you type alongside them still searches names. Once photos'
camera data is read, searching finds photos by their tags too, and a photo's preview shows its
camera settings and tags. Prism reads each photo's camera data once and keeps it, so sorting or
filtering a folder by it is quick the next time. If a tool edits photos without changing their
modified time, **File › Reset Photo Details** reads them all again.

Photos keep their rating in the file itself, as XMP's `xmp:Rating`, which Lightroom, Bridge and
Windows Explorer read and write too, so a rating travels with the photo. Rating a photo rewrites
its file, so its modified time changes. Folders and videos have nowhere to keep one, so Prism
keeps theirs itself, by where they are: renaming them in Prism keeps their rating, but moving or
renaming them in another app loses it. Ratings photos had before you updated Prism show once
**File › Reset Photo Details** has read them again.

## Clearing out what you don't want

Rate as you browse, then clear out the low-rated ones in one go. Search or filter a folder, say
**≤ 2 stars**, and a trash button appears in the toolbar: it moves everything that matches to the
Trash, from the folder you're in and every folder inside it, at any depth. Nothing moves until you
confirm, and the button only shows while something narrows the view, so it never offers a
whole folder.

It opens a sheet listing what would go and why:

- **A folder that matches goes whole,** with everything in it. If something inside it is rated
  higher and wouldn't match on its own, it gets a row of its own, set to **Keep**. Keeping it
  keeps the folder too, though everything else in it still goes, or **Rescue** moves it up out
  of the folder so the folder can still go whole.
  A matching folder can also go as **Only matches**: what's inside is judged on its own, and the
  folder goes only if that leaves it empty.
- **Folders left empty** go too, and files that would keep one from being empty, such as RAW
  files, get rows of their own, set to keep. Sidecars (`.xmp`, `.aae`) go with their photo.
- **Every row is one click,** Keep or Trash. The switches at the top set the defaults for each
  kind of row, and **Reset to defaults** takes back what you changed by hand. Select many rows
  with ⌘-click, Shift-click or ⌘A, then press **K** to keep, **T** to trash, **R** to rescue or
  **O** for only the matches. The tabs and the search field narrow what the sheet shows, never
  what goes: the button always counts everything.
- **Files** lists every file that goes, one by one, and **How this works** (ⓘ) explains the
  rules.

Where it goes is always said on the button, in the sheet and in the message afterwards:

- **On your own disks,** to the Trash (the Recycle Bin on Windows). **Undo**, or ⌘Z later,
  puts everything back, and so does the Trash's own Put Back. If something has taken a place
  meanwhile, the item comes back beside it as `photo (restored).jpg`.
- **On a network share,** which has no Trash of its own, to **Prism's Trash**: a hidden
  `.prism-trash` folder at the top of the share. Undo works the same. **Prism's Trash**
  appears below the folders in the sidebar once it holds anything. It lists each move, with the
  folder and filters it came from, so you can **Put Back** or **Delete Permanently** a move, or
  **Empty Trash**. Prism doesn't empty it by itself.
- **Where Prism can't keep a Trash,** as on a read-only share, it deletes them permanently. It
  says so in red first, and won't start until you tick **I understand these can't be
  recovered**. There's no Undo.

Ratings come back with what you put back: photos carry theirs in the file, and Prism keeps the
ones it holds for folders and videos at the paths they came from.

## Keyboard shortcuts

Every action has a shortcut. The menus show them beside each item, buttons show theirs in their
tooltips, and **File › Default Keyboard Shortcuts** lists them all.

### Change your shortcuts

Shortcuts work like VS Code's. **File › Keyboard Shortcuts…** opens your own `keybindings.json`,
and **File › Default Keyboard Shortcuts** shows the built-in ones to copy from. Your rules apply
on top of the defaults as soon as you save:

```jsonc
[
  // Press N for the next photo in the viewer.
  { "key": "n", "command": "next", "when": "viewerFocus" },
  // Stop Shift-S from starting a slideshow.
  { "key": "shift+s", "command": "-slideshow" },
]
```

For any key, the last rule that applies wins, and a command starting with `-` removes the
defaults for it. Prism points out any rule it can't use and applies the rest.

## For developers

Prism is built with Electron, React Router and TypeScript.

- **[Development](docs/development.md)**: set up, run, test and lay out the code.
- **[Architecture](docs/architecture.md)**: how the processes, routes, data and photo API fit
  together.
- **[Releasing](docs/releasing.md)**: changesets, release builds, automatic updates and
  signing.

See the [changelog](CHANGELOG.md) for what's new.

## License

Prism is free software under the [GNU General Public License v3.0](LICENSE). You may use, change
and share it, and anything you distribute that is built from it must be released under the same
license, with its source code.

All earlier versions of Prism in this repository's history, and their releases, are also
available under the GNU General Public License v3.0.
