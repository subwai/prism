---
'prism': patch
---

Reading a large library is many times faster again: each folder read looked through every photo in the library to find what the catalog already had of that folder, which on a library of two million photos made a first read take over an hour and the weekly full read over two. Each folder is now looked up on its own, in well under a millisecond.
