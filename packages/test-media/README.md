# @prism/test-media

Small photos and videos for tests, shared by the window's component tests and the end-to-end
tests: three JPEGs (landscape, portrait and one smaller than any window) and one clip as MP4 and
as WebM. Import a file by its name, such as `@prism/test-media/clip.webm?url` in a component
test, or resolve it with `require.resolve` to copy it into a test's folder.

Add a file only when a test needs a kind of media these don't cover, keep it small, and list it
in `exports` in `package.json`.
