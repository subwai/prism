---
'electron-starter': patch
---

Moving between videos no longer flickers dark: the viewer keeps the previous photo or video on screen until the next video has a frame of its own to show, rather than its poster, which could paint late and looked darker than the video.
