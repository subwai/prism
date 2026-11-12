//! The Trash of the freedesktop.org Trash specification, which file managers share. Prism
//! writes it itself, as GIO, which Electron trashes with, does not say what name it chose.

use std::ffi::OsString;
use std::fs::{self, DirBuilder, OpenOptions};
use std::io::{ErrorKind, Write};
use std::os::unix::ffi::{OsStrExt, OsStringExt};
use std::os::unix::fs::{DirBuilderExt, MetadataExt, PermissionsExt};
use std::path::{Path, PathBuf};

/// A Trash: its `files` and `info` folders, and the folder the paths it records are relative
/// to, or `None` for the home Trash, which records them in full.
struct Trash {
  dir: PathBuf,
  top: Option<PathBuf>,
}

/// The folder the home Trash is in, `$XDG_DATA_HOME`, by default `~/.local/share`.
fn data_home() -> Result<PathBuf, String> {
  match std::env::var_os("XDG_DATA_HOME").filter(|dir| !dir.is_empty()) {
    Some(dir) => Ok(dir.into()),
    None => std::env::var_os("HOME")
      .map(|home| Path::new(&home).join(".local/share"))
      .ok_or_else(|| "There is no home folder to keep a Trash in.".into()),
  }
}

/// The device of `path`, or of the nearest folder above it that exists.
fn device_of(path: &Path) -> Option<u64> {
  path
    .ancestors()
    .find_map(|dir| fs::metadata(dir).ok())
    .map(|info| info.dev())
}

/// The top of the volume `path` is on: the highest folder above it on the same device.
fn top_of(path: &Path, device: u64) -> PathBuf {
  let mut top = path.to_path_buf();
  for dir in path.ancestors().skip(1) {
    match fs::metadata(dir) {
      Ok(info) if info.dev() == device => top = dir.to_path_buf(),
      _ => break,
    }
  }
  top
}

/// The Trash for an item on `device` at `path`: the home Trash on its own volume, or else the
/// volume's, `$top/.Trash/$uid` where an administrator made `.Trash`, or `$top/.Trash-$uid`.
fn trash_for(path: &Path, device: u64) -> Result<Trash, String> {
  let home = data_home()?.join("Trash");
  if device_of(&home) == Some(device) {
    return Ok(Trash { dir: home, top: None });
  }
  let top = top_of(path, device);
  let uid = unsafe { libc::getuid() };
  let shared = top.join(".Trash");
  // The specification asks for a sticky folder that is no link, so no one else can swap it.
  let usable = fs::symlink_metadata(&shared)
    .is_ok_and(|info| info.is_dir() && info.permissions().mode() & 0o1000 != 0);
  let dir = if usable {
    shared.join(uid.to_string())
  } else {
    top.join(format!(".Trash-{uid}"))
  };
  Ok(Trash { dir, top: Some(top) })
}

/// `bytes` as the specification records a path: percent-encoded, as in a URL, but for `/`.
fn encoded(bytes: &[u8]) -> String {
  let mut out = String::new();
  for &byte in bytes {
    if byte.is_ascii_alphanumeric() || b"/-._~".contains(&byte) {
      out.push(byte as char);
    } else {
      out.push_str(&format!("%{byte:02X}"));
    }
  }
  out
}

/// Now in local time, as the specification records when an item was trashed.
fn deletion_date() -> String {
  unsafe {
    let now = libc::time(std::ptr::null_mut());
    let mut local: libc::tm = std::mem::zeroed();
    libc::localtime_r(&now, &mut local);
    format!(
      "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}",
      local.tm_year + 1900,
      local.tm_mon + 1,
      local.tm_mday,
      local.tm_hour,
      local.tm_min,
      local.tm_sec,
    )
  }
}

/// The `n`th name to try for `name` in a Trash: itself, then `photo 2.jpg`, `photo 3.jpg`...
fn nth_name(name: &Path, n: u32) -> OsString {
  if n == 1 {
    return name.as_os_str().to_owned();
  }
  let stem = name.file_stem().unwrap_or(name.as_os_str()).as_bytes();
  let mut out = [stem, format!(" {n}").as_bytes()].concat();
  if let Some(extension) = name.extension().filter(|_| !stem.is_empty()) {
    out.push(b'.');
    out.extend_from_slice(extension.as_bytes());
  }
  OsString::from_vec(out)
}

/// Moves `path` to its volume's Trash, with a record of where it was and when it went.
pub fn trash(path: &Path) -> Result<PathBuf, String> {
  let path = std::path::absolute(path).map_err(|error| error.to_string())?;
  let info = fs::symlink_metadata(&path).map_err(|error| error.to_string())?;
  let name = Path::new(path.file_name().ok_or("It has no name to trash it by.")?);
  let trash = trash_for(&path, info.dev())?;
  let (files, records) = (trash.dir.join("files"), trash.dir.join("info"));
  for dir in [&files, &records] {
    DirBuilder::new()
      .recursive(true)
      .mode(0o700)
      .create(dir)
      .map_err(|error| format!("Its volume has no Trash that can be used: {error}"))?;
  }
  let recorded = match &trash.top {
    Some(top) => path.strip_prefix(top).unwrap_or(&path),
    None => &path,
  };
  let record = format!(
    "[Trash Info]\nPath={}\nDeletionDate={}\n",
    encoded(recorded.as_os_str().as_bytes()),
    deletion_date(),
  );
  for n in 1.. {
    let chosen = nth_name(name, n);
    let mut record_name = chosen.clone();
    record_name.push(".trashinfo");
    let record_path = records.join(record_name);
    // Making the record first claims the name, as the specification asks.
    let mut file = match OpenOptions::new().write(true).create_new(true).open(&record_path) {
      Ok(file) => file,
      Err(error) if error.kind() == ErrorKind::AlreadyExists => continue,
      Err(error) => return Err(error.to_string()),
    };
    let landed = files.join(&chosen);
    if fs::symlink_metadata(&landed).is_ok() {
      let _ = fs::remove_file(&record_path);
      continue;
    }
    let moved = file
      .write_all(record.as_bytes())
      .and_then(|()| fs::rename(&path, &landed));
    if let Err(error) = moved {
      let _ = fs::remove_file(&record_path);
      return Err(error.to_string());
    }
    return Ok(landed);
  }
  unreachable!("names run out only after u32::MAX tries")
}

/// Moves an item back out of the Trash, and drops the record of it.
pub fn restore(landed: &Path, to: &Path) -> Result<(), String> {
  fs::rename(landed, to).map_err(|error| error.to_string())?;
  let name = landed.file_name().ok_or("It has no name in the Trash.")?;
  let mut record = name.to_owned();
  record.push(".trashinfo");
  if let Some(dir) = landed.parent().and_then(Path::parent) {
    let _ = fs::remove_file(dir.join("info").join(record));
  }
  Ok(())
}
