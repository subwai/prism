---
'prism': patch
---

A library on a network share that is offline now opens and browses from what Prism already knows of it: the folder tree, grid, filmstrip, sorting, filters and the thumbnails made before all work, instead of the library saying its folder no longer exists. Reading folders, photo details and thumbnails waits for the share rather than failing over and over, and picks up, with a check for what changed, within a few seconds of the share coming back.
