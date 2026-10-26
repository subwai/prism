---
'electron-starter': patch
---

A photo that changes on disk while it is open now always updates on screen. Before, it could keep showing the old version if Prism read the file again, such as to make its thumbnail, before it noticed the change.
