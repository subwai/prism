//! The Recycle Bin, through the shell's `IFileOperation`, whose progress sink is told the item
//! each deleted one became in the Recycle Bin: a `$R…` file beside a `$I…` record of it.

use std::cell::RefCell;
use std::path::{Path, PathBuf};
use windows::Win32::Foundation::E_ABORT;
use windows::Win32::System::Com::{
  CLSCTX_ALL, COINIT_APARTMENTTHREADED, COINIT_DISABLE_OLE1DDE, CoCreateInstance, CoInitializeEx,
  CoUninitialize,
};
use windows::Win32::UI::Shell::{
  FOF_ALLOWUNDO, FOF_NOCONFIRMATION, FOF_NOERRORUI, FOF_SILENT, FOFX_EARLYFAILURE,
  FOFX_RECYCLEONDELETE, FileOperation, IFileOperation, IFileOperationProgressSink,
  IFileOperationProgressSink_Impl, IShellItem, SHCreateItemFromParsingName, SIGDN_FILESYSPATH,
  TSF_DELETE_RECYCLE_IF_POSSIBLE,
};
use windows_core::{ComObject, HRESULT, HSTRING, PCWSTR, Ref, implement};

/// Undoes `CoInitializeEx` on this thread when dropped.
struct Apartment;

impl Drop for Apartment {
  fn drop(&mut self) {
    unsafe { CoUninitialize() };
  }
}

/// Hears where the deleted item went, and keeps an item the Recycle Bin can't take from being
/// deleted for good instead.
#[implement(IFileOperationProgressSink)]
struct Sink {
  landed: RefCell<Option<Result<PathBuf, String>>>,
}

impl IFileOperationProgressSink_Impl for Sink_Impl {
  fn StartOperations(&self) -> windows_core::Result<()> {
    Ok(())
  }
  fn FinishOperations(&self, _result: HRESULT) -> windows_core::Result<()> {
    Ok(())
  }
  fn PreRenameItem(&self, _: u32, _: Ref<IShellItem>, _: &PCWSTR) -> windows_core::Result<()> {
    Ok(())
  }
  fn PostRenameItem(
    &self,
    _: u32,
    _: Ref<IShellItem>,
    _: &PCWSTR,
    _: HRESULT,
    _: Ref<IShellItem>,
  ) -> windows_core::Result<()> {
    Ok(())
  }
  fn PreMoveItem(
    &self,
    _: u32,
    _: Ref<IShellItem>,
    _: Ref<IShellItem>,
    _: &PCWSTR,
  ) -> windows_core::Result<()> {
    Ok(())
  }
  fn PostMoveItem(
    &self,
    _: u32,
    _: Ref<IShellItem>,
    _: Ref<IShellItem>,
    _: &PCWSTR,
    _: HRESULT,
    _: Ref<IShellItem>,
  ) -> windows_core::Result<()> {
    Ok(())
  }
  fn PreCopyItem(
    &self,
    _: u32,
    _: Ref<IShellItem>,
    _: Ref<IShellItem>,
    _: &PCWSTR,
  ) -> windows_core::Result<()> {
    Ok(())
  }
  fn PostCopyItem(
    &self,
    _: u32,
    _: Ref<IShellItem>,
    _: Ref<IShellItem>,
    _: &PCWSTR,
    _: HRESULT,
    _: Ref<IShellItem>,
  ) -> windows_core::Result<()> {
    Ok(())
  }
  fn PreDeleteItem(&self, flags: u32, _: Ref<IShellItem>) -> windows_core::Result<()> {
    // Without it, the shell would delete the item for good: on a volume with no Recycle Bin.
    if flags & TSF_DELETE_RECYCLE_IF_POSSIBLE.0 as u32 == 0 {
      *self.landed.borrow_mut() = Some(Err("Its volume has no Recycle Bin.".into()));
      return Err(E_ABORT.into());
    }
    Ok(())
  }
  fn PostDeleteItem(
    &self,
    _: u32,
    _: Ref<IShellItem>,
    result: HRESULT,
    created: Ref<IShellItem>,
  ) -> windows_core::Result<()> {
    let landed = if let Err(error) = result.ok() {
      Err(error.message())
    } else if let Some(item) = created.as_ref() {
      unsafe { item.GetDisplayName(SIGDN_FILESYSPATH) }
        .map(|name| {
          let path = unsafe { name.to_string() };
          unsafe { windows::Win32::System::Com::CoTaskMemFree(Some(name.0 as _)) };
          path.map(PathBuf::from).map_err(|error| error.to_string())
        })
        .map_err(|error| error.message())
        .and_then(|path| path)
    } else {
      Err("It was deleted rather than moved to the Recycle Bin.".into())
    };
    *self.landed.borrow_mut() = Some(landed);
    Ok(())
  }
  fn PreNewItem(&self, _: u32, _: Ref<IShellItem>, _: &PCWSTR) -> windows_core::Result<()> {
    Ok(())
  }
  fn PostNewItem(
    &self,
    _: u32,
    _: Ref<IShellItem>,
    _: &PCWSTR,
    _: &PCWSTR,
    _: u32,
    _: HRESULT,
    _: Ref<IShellItem>,
  ) -> windows_core::Result<()> {
    Ok(())
  }
  fn UpdateProgress(&self, _: u32, _: u32) -> windows_core::Result<()> {
    Ok(())
  }
  fn ResetTimer(&self) -> windows_core::Result<()> {
    Ok(())
  }
  fn PauseTimer(&self) -> windows_core::Result<()> {
    Ok(())
  }
  fn ResumeTimer(&self) -> windows_core::Result<()> {
    Ok(())
  }
}

/// Moves `path` to the Recycle Bin on this thread, which must be in a single-threaded apartment.
unsafe fn recycle(path: &Path) -> Result<PathBuf, String> {
  let fail = |error: windows_core::Error| error.message();
  unsafe {
    let item: IShellItem =
      SHCreateItemFromParsingName(&HSTRING::from(path.as_os_str()), None).map_err(fail)?;
    let operation: IFileOperation = CoCreateInstance(&FileOperation, None, CLSCTX_ALL).map_err(fail)?;
    operation
      .SetOperationFlags(
        FOF_ALLOWUNDO
          | FOF_NOCONFIRMATION
          | FOF_NOERRORUI
          | FOF_SILENT
          | FOFX_EARLYFAILURE
          | FOFX_RECYCLEONDELETE,
      )
      .map_err(fail)?;
    let sink = ComObject::new(Sink {
      landed: RefCell::new(None),
    });
    let told: IFileOperationProgressSink = sink.to_interface();
    operation.DeleteItem(&item, &told).map_err(fail)?;
    let performed = operation.PerformOperations();
    let landed = sink.landed.borrow_mut().take();
    match landed {
      Some(landed) => landed,
      None => Err(performed.err().map_or("It was not moved.".into(), fail)),
    }
  }
}

/// Moves `path` to the Recycle Bin of its volume; says where it landed there.
pub fn trash(path: &Path) -> Result<PathBuf, String> {
  let path = path.to_owned();
  // `IFileOperation` needs a single-threaded apartment, which libuv's threads may not join.
  std::thread::spawn(move || unsafe {
    let _apartment = CoInitializeEx(None, COINIT_APARTMENTTHREADED | COINIT_DISABLE_OLE1DDE)
      .is_ok()
      .then_some(Apartment);
    recycle(&path)
  })
  .join()
  .map_err(|_| "Moving it to the Recycle Bin failed.".to_string())?
}

/// Moves an item back out of the Recycle Bin, and drops the `$I…` record of it.
pub fn restore(landed: &Path, to: &Path) -> Result<(), String> {
  std::fs::rename(landed, to).map_err(|error| error.to_string())?;
  let name = landed.file_name().and_then(|name| name.to_str()).unwrap_or("");
  if let Some(rest) = name.strip_prefix("$R") {
    let _ = std::fs::remove_file(landed.with_file_name(format!("$I{rest}")));
  }
  Ok(())
}
