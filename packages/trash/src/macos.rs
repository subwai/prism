use objc2::rc::autoreleasepool;
use objc2_foundation::{NSFileManager, NSString, NSURL};
use std::path::{Path, PathBuf};

/// Moves `path` to the Trash of its volume, as Finder does, which says where it put it.
pub fn trash(path: &Path) -> Result<PathBuf, String> {
  let path = path.to_str().ok_or("Its path is not Unicode.")?;
  // libuv's threads have no pool of their own for what Foundation hands back.
  autoreleasepool(|_| {
    let url = NSURL::fileURLWithPath(&NSString::from_str(path));
    let mut landed = None;
    NSFileManager::defaultManager()
      .trashItemAtURL_resultingItemURL_error(&url, Some(&mut landed))
      .map_err(|error| error.localizedDescription().to_string())?;
    landed
      .and_then(|url| url.path())
      .map(|path| PathBuf::from(path.to_string()))
      .ok_or_else(|| "The Trash did not say where it put it.".into())
  })
}

/// Moves an item back out of the Trash. Finder keeps nothing else of it.
pub fn restore(landed: &Path, to: &Path) -> Result<(), String> {
  std::fs::rename(landed, to).map_err(|error| error.to_string())
}
