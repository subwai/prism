//! Moves files to the system's Trash, saying where each one landed, and moves them back from
//! there. Electron's `shell.trashItem` says neither, and each system names an item anew in its
//! Trash when the name is taken. It runs in the photo worker, on libuv's thread pool.

use napi::{Env, Error, Result, Status, Task};
use napi_derive::napi;
use std::path::PathBuf;

#[cfg(target_os = "linux")]
mod linux;
#[cfg(target_os = "linux")]
use linux as system;
#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "macos")]
use macos as system;
#[cfg(target_os = "windows")]
mod windows;
#[cfg(target_os = "windows")]
use windows as system;

/// An error JavaScript sees, with the system's words for it.
fn failure(message: String) -> Error {
  Error::new(Status::GenericFailure, message)
}

pub struct Trashing {
  path: PathBuf,
}

impl Task for Trashing {
  type Output = String;
  type JsValue = String;

  fn compute(&mut self) -> Result<String> {
    let landed = system::trash(&self.path).map_err(failure)?;
    landed
      .into_os_string()
      .into_string()
      .map_err(|_| failure("The Trash gave it a name that is not Unicode.".into()))
  }

  fn resolve(&mut self, _env: Env, output: String) -> Result<String> {
    Ok(output)
  }
}

pub struct Restoring {
  landed: PathBuf,
  to: PathBuf,
}

impl Task for Restoring {
  type Output = ();
  type JsValue = ();

  fn compute(&mut self) -> Result<()> {
    system::restore(&self.landed, &self.to).map_err(failure)
  }

  fn resolve(&mut self, _env: Env, _output: ()) -> Result<()> {
    Ok(())
  }
}

/// Moves the file or folder at `path` to the Trash; resolves with where it landed there.
#[napi]
pub fn trash_item(path: String) -> napi::bindgen_prelude::AsyncTask<Trashing> {
  napi::bindgen_prelude::AsyncTask::new(Trashing { path: path.into() })
}

/// Moves what `trashItem` put at `landed` back to `to`, with whatever the Trash kept of it.
#[napi]
pub fn restore_item(landed: String, to: String) -> napi::bindgen_prelude::AsyncTask<Restoring> {
  napi::bindgen_prelude::AsyncTask::new(Restoring {
    landed: landed.into(),
    to: to.into(),
  })
}
