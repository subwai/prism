---
'prism': patch
---

A view of every photo in the library now reads only the folders that changed since they were last read, as each launch's check does, rather than every folder, which on a large network share took several minutes each launch. Folders new to the library are read without first being checked, and a folder holding names that end in a dot or a space, which a network share lists but cannot look at, is no longer read again in full at every launch. Opening a folder and **View › Refresh** still read in full.
