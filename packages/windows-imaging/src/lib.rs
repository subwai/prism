//! Converts images with Windows' imaging component (WIC), which reads HEIF photos with the codecs
//! from the Microsoft Store. It runs in the photo worker, on libuv's thread pool, so converting a
//! photo neither starts a process nor holds up the worker's JavaScript.

use napi::bindgen_prelude::{AbortSignal, AsyncTask, Buffer};
use napi::{Env, Error, Result, Status, Task};
use napi_derive::napi;

mod wic;

pub struct Conversion {
  path: String,
  quality: f32,
}

impl Task for Conversion {
  type Output = Vec<u8>;
  type JsValue = Buffer;

  fn compute(&mut self) -> Result<Vec<u8>> {
    // The HRESULT leads the message, so JavaScript can tell a missing codec from a broken file.
    wic::convert_to_jpeg(&self.path, self.quality).map_err(|error| {
      Error::new(
        Status::GenericFailure,
        format!("{:08X} {}", error.code().0 as u32, error.message()),
      )
    })
  }

  fn resolve(&mut self, _env: Env, output: Vec<u8>) -> Result<Buffer> {
    Ok(output.into())
  }
}

/// A JPEG of the image at `path`, of `quality` from 0 to 1, turned upright as its orientation
/// asks. A failure's message starts with its HRESULT, in eight hexadecimal digits.
#[napi]
pub fn convert_to_jpeg(
  path: String,
  quality: f64,
  signal: Option<AbortSignal>,
) -> AsyncTask<Conversion> {
  AsyncTask::with_optional_signal(
    Conversion {
      path,
      quality: quality as f32,
    },
    signal,
  )
}
