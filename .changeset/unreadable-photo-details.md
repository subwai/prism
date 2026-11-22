---
'prism': patch
---

Photos whose details can't be read, such as a file that can't be opened, are now tried once and remembered, rather than tried again on every launch, so the status bar's Photo details row reaches "All read". It says how many couldn't be read, and they're tried again once the file changes, or with File › Reset Photo Details. A share that's offline doesn't count: its photos are tried again once it's back.
