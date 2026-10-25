---
'electron-starter': patch
---

Large and deeply nested folders open and scroll faster: thumbnails are cached by file rather than path and made with more of the CPU, the folder's worker talks to the window directly, and covers and listings load only while shown. The sidebar no longer collapses after reading many folders, the thumbnail size stays put between folders, and Back closes a preview.
