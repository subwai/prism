use windows::Win32::Foundation::GENERIC_READ;
use windows::Win32::Graphics::Imaging::{
  CLSID_WICImagingFactory, GUID_ContainerFormatJpeg, GUID_WICPixelFormat24bppBGR,
  IWICBitmapFrameDecode, IWICImagingFactory, WICBitmapDitherTypeNone, WICBitmapEncoderNoCache,
  WICBitmapPaletteTypeCustom, WICBitmapTransformFlipHorizontal, WICBitmapTransformFlipVertical,
  WICBitmapTransformOptions, WICBitmapTransformRotate0, WICBitmapTransformRotate90,
  WICBitmapTransformRotate180, WICBitmapTransformRotate270, WICDecodeMetadataCacheOnDemand,
};
use windows::Win32::System::Com::StructuredStorage::{PROPBAG2, PROPVARIANT, PropVariantToUInt16};
use windows::Win32::System::Com::{
  CLSCTX_INPROC_SERVER, COINIT_MULTITHREADED, CoCreateInstance, CoInitializeEx, CoUninitialize,
  STATFLAG_NONAME, STATSTG, STREAM_SEEK_SET,
};
use windows::Win32::System::Variant::VARIANT;
use windows::Win32::UI::Shell::SHCreateMemStream;
use windows::core::{Error, HSTRING, Result, w};

/// The names WIC knows a photo's EXIF orientation by: the photo property system's, which covers
/// most formats, then the HEIF codec's own.
const ORIENTATION_QUERIES: [&str; 2] = ["System.Photo.Orientation", "/heifProps/{ushort=1}"];

/// Undoes `CoInitializeEx` on this thread when dropped.
struct Apartment;

impl Drop for Apartment {
  fn drop(&mut self) {
    unsafe { CoUninitialize() };
  }
}

/// The JPEG of the image at `path`: decoded, turned upright, converted to the JPEG encoder's
/// pixel format, and encoded in memory.
pub fn convert_to_jpeg(path: &str, quality: f32) -> Result<Vec<u8>> {
  unsafe {
    // libuv's threads may already be in the multithreaded apartment, which still counts as
    // joining it; one already in a single-threaded apartment works there instead.
    let _apartment = CoInitializeEx(None, COINIT_MULTITHREADED)
      .is_ok()
      .then_some(Apartment);
    let factory: IWICImagingFactory =
      CoCreateInstance(&CLSID_WICImagingFactory, None, CLSCTX_INPROC_SERVER)?;
    let decoder = factory.CreateDecoderFromFilename(
      &HSTRING::from(path),
      None,
      GENERIC_READ,
      WICDecodeMetadataCacheOnDemand,
    )?;
    let frame = decoder.GetFrame(0)?;

    let rotator = factory.CreateBitmapFlipRotator()?;
    rotator.Initialize(&frame, transform(orientation(&frame)))?;
    let converter = factory.CreateFormatConverter()?;
    converter.Initialize(
      &rotator,
      &GUID_WICPixelFormat24bppBGR,
      WICBitmapDitherTypeNone,
      None,
      0.0,
      WICBitmapPaletteTypeCustom,
    )?;

    let stream = SHCreateMemStream(None).ok_or_else(Error::from_thread)?;
    let encoder = factory.CreateEncoder(&GUID_ContainerFormatJpeg, std::ptr::null())?;
    encoder.Initialize(&stream, WICBitmapEncoderNoCache)?;
    let mut target = None;
    let mut options = None;
    encoder.CreateNewFrame(&mut target, &mut options)?;
    let target = target.ok_or_else(Error::empty)?;
    if let Some(options) = &options {
      let name = PROPBAG2 {
        pstrName: windows::core::PWSTR(w!("ImageQuality").as_ptr().cast_mut()),
        ..Default::default()
      };
      options.Write(1, &name, &VARIANT::from(quality))?;
    }
    target.Initialize(options.as_ref())?;
    let (mut width, mut height) = (0, 0);
    converter.GetSize(&mut width, &mut height)?;
    target.SetSize(width, height)?;
    let mut format = GUID_WICPixelFormat24bppBGR;
    target.SetPixelFormat(&mut format)?;
    target.WriteSource(&converter, std::ptr::null())?;
    target.Commit()?;
    encoder.Commit()?;

    let mut stat = STATSTG::default();
    stream.Stat(&mut stat, STATFLAG_NONAME)?;
    stream.Seek(0, STREAM_SEEK_SET, None)?;
    let mut jpeg = vec![0u8; stat.cbSize as usize];
    let mut read = 0;
    stream
      .Read(jpeg.as_mut_ptr().cast(), jpeg.len() as u32, Some(&mut read))
      .ok()?;
    jpeg.truncate(read as usize);
    Ok(jpeg)
  }
}

/// The EXIF orientation of `frame`, from 1 to 8, which WIC reports but does not apply; 1, upright,
/// if it has none.
fn orientation(frame: &IWICBitmapFrameDecode) -> u16 {
  let Ok(reader) = (unsafe { frame.GetMetadataQueryReader() }) else {
    return 1;
  };
  ORIENTATION_QUERIES
    .iter()
    .find_map(|query| {
      let mut value = PROPVARIANT::default();
      unsafe { reader.GetMetadataByName(&HSTRING::from(*query), &mut value) }.ok()?;
      unsafe { PropVariantToUInt16(&value) }.ok()
    })
    .filter(|orientation| (1..=8).contains(orientation))
    .unwrap_or(1)
}

/// What WIC does to show a picture of EXIF `orientation` upright. It flips first, then turns
/// clockwise, so 5 turns as 8 does once flipped, and 7 as 6 does.
fn transform(orientation: u16) -> WICBitmapTransformOptions {
  let (turn, flip) = match orientation {
    2 => (
      WICBitmapTransformRotate0,
      Some(WICBitmapTransformFlipHorizontal),
    ),
    3 => (WICBitmapTransformRotate180, None),
    4 => (
      WICBitmapTransformRotate0,
      Some(WICBitmapTransformFlipVertical),
    ),
    5 => (
      WICBitmapTransformRotate270,
      Some(WICBitmapTransformFlipHorizontal),
    ),
    6 => (WICBitmapTransformRotate90, None),
    7 => (
      WICBitmapTransformRotate90,
      Some(WICBitmapTransformFlipHorizontal),
    ),
    8 => (WICBitmapTransformRotate270, None),
    _ => (WICBitmapTransformRotate0, None),
  };
  flip.map_or(turn, |flip| WICBitmapTransformOptions(turn.0 | flip.0))
}
