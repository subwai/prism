---
'prism': patch
---

Opening a library no longer reads every folder again in the background: only folders that something was added to, removed from or renamed in since the app last read them are read. On a large network share that turns minutes of work at each launch into a quick look at each folder. A file edited in place is picked up when you open its folder.
