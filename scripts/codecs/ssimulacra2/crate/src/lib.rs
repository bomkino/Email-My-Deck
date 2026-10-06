//! Minimal C-ABI wrapper around the `ssimulacra2` crate for wasm32-unknown-unknown.
//!
//! Exports (plain wasm functions, no wasm-bindgen glue, no imports):
//!   emd_alloc(len: usize) -> *mut u8          null on failure or len == 0
//!   emd_free(ptr: *mut u8, len: usize)
//!   emd_ssimulacra2(ref_ptr, dist_ptr, width, height, channels) -> f64
//!
//! Inputs are interleaved 8-bit sRGB (channels = 3), 8-bit gray (channels = 1,
//! used as R = G = B) or 8-bit RGBA (channels = 4, alpha ignored).
//!
//! SSIMULACRA2 scores can legitimately be negative (very strong distortion), so
//! errors are reported with sentinels far below any real score: every value
//! <= -1_000_000 is an error (see `ERR_*`).

use ssimulacra2::{compute_frame_ssimulacra2, ColorPrimaries, LinearRgb, Rgb, TransferCharacteristic};
use std::alloc::{alloc, dealloc, Layout};

/// Null pointer, zero dimension, or unsupported channel count.
pub const ERR_INVALID_ARGS: f64 = -1_000_001.0;
/// Width or height smaller than 8 pixels (metric requirement).
pub const ERR_TOO_SMALL: f64 = -1_000_002.0;
/// Size overflow, or not enough WebAssembly memory for the working buffers.
pub const ERR_TOO_LARGE: f64 = -1_000_003.0;
/// The crate returned an error we did not anticipate.
pub const ERR_INTERNAL: f64 = -1_000_004.0;

const ALIGN: usize = 16;

/// Allocate `len` bytes (16-byte aligned) in linear memory. Returns null if
/// `len` is 0 or the allocation fails.
#[no_mangle]
pub extern "C" fn emd_alloc(len: usize) -> *mut u8 {
    if len == 0 {
        return core::ptr::null_mut();
    }
    match Layout::from_size_align(len, ALIGN) {
        // SAFETY: the layout has a non-zero size.
        Ok(layout) => unsafe { alloc(layout) },
        Err(_) => core::ptr::null_mut(),
    }
}

/// Free a block returned by `emd_alloc(len)`. Null or zero length is a no-op.
///
/// # Safety
/// `ptr` must come from `emd_alloc` called with the same `len` and not be freed yet.
#[no_mangle]
pub unsafe extern "C" fn emd_free(ptr: *mut u8, len: usize) {
    if ptr.is_null() || len == 0 {
        return;
    }
    if let Ok(layout) = Layout::from_size_align(len, ALIGN) {
        dealloc(ptr, layout);
    }
}

/// 8-bit sRGB -> linear lookup table computed with the crate's own transfer
/// function, so the result is bit-identical to feeding `Rgb { SRGB, BT709 }`
/// with values `v / 255.0` (the crate's canonical path, used by its own test).
fn srgb_to_linear_lut() -> [f32; 256] {
    let data: Vec<[f32; 3]> = (0..256u32)
        .map(|v| {
            let f = v as f32 / 255.0;
            [f, f, f]
        })
        .collect();
    let rgb = Rgb::new(data, 256, 1, TransferCharacteristic::SRGB, ColorPrimaries::BT709)
        .expect("256x1 matches the data length");
    let lin = LinearRgb::try_from(rgb).expect("sRGB / BT.709 to linear cannot fail");
    let mut lut = [0f32; 256];
    for (o, p) in lut.iter_mut().zip(lin.data()) {
        *o = p[0];
    }
    lut
}

fn to_linear(px: &[u8], channels: usize, lut: &[f32; 256], w: usize, h: usize) -> LinearRgb {
    let l = |v: u8| lut[v as usize];
    let data: Vec<[f32; 3]> = match channels {
        1 => px.iter().map(|&g| [l(g), l(g), l(g)]).collect(),
        3 => px.chunks_exact(3).map(|c| [l(c[0]), l(c[1]), l(c[2])]).collect(),
        _ => px.chunks_exact(4).map(|c| [l(c[0]), l(c[1]), l(c[2])]).collect(),
    };
    LinearRgb::new(data, w, h).expect("dimensions were validated")
}

/// Check up front that the working buffers fit, so running out of memory is
/// reported as `ERR_TOO_LARGE` instead of trapping halfway through. Allocates
/// blocks shaped like the real ones (two linear-RGB images, twelve f32 planes,
/// the blur scratch plane, plus slack for the first downscale), then frees them;
/// the allocator keeps the grown memory for the real computation.
fn memory_available(pixels: usize) -> bool {
    let Some(rgb) = pixels.checked_mul(12) else { return false };
    let plane = pixels * 4;
    let mut sizes = vec![rgb, rgb, rgb / 2];
    sizes.extend(std::iter::repeat(plane).take(13));
    let mut held: Vec<Vec<u8>> = Vec::with_capacity(sizes.len());
    for size in sizes {
        let mut block = Vec::new();
        if block.try_reserve_exact(size).is_err() {
            return false;
        }
        held.push(block);
    }
    true
}

/// Safe core: score two interleaved 8-bit buffers. Returns a score or an `ERR_*` sentinel.
pub fn score_u8(reference: &[u8], distorted: &[u8], width: usize, height: usize, channels: usize) -> f64 {
    if width == 0 || height == 0 || !matches!(channels, 1 | 3 | 4) {
        return ERR_INVALID_ARGS;
    }
    if width < 8 || height < 8 {
        return ERR_TOO_SMALL;
    }
    let Some(pixels) = width.checked_mul(height) else { return ERR_TOO_LARGE };
    let Some(len) = pixels.checked_mul(channels) else { return ERR_TOO_LARGE };
    if reference.len() != len || distorted.len() != len {
        return ERR_INVALID_ARGS;
    }
    if !memory_available(pixels) {
        return ERR_TOO_LARGE;
    }
    let lut = srgb_to_linear_lut();
    let a = to_linear(reference, channels, &lut, width, height);
    let b = to_linear(distorted, channels, &lut, width, height);
    match compute_frame_ssimulacra2(a, b) {
        Ok(s) => s,
        Err(ssimulacra2::Ssimulacra2Error::InvalidImageSize) => ERR_TOO_SMALL,
        Err(_) => ERR_INTERNAL,
    }
}

/// Score `dist` against `ref`; both buffers hold `width * height * channels` bytes.
///
/// # Safety
/// Both pointers must be valid for reads of `width * height * channels` bytes.
#[no_mangle]
pub unsafe extern "C" fn emd_ssimulacra2(
    ref_ptr: *const u8,
    dist_ptr: *const u8,
    width: u32,
    height: u32,
    channels: u32,
) -> f64 {
    if ref_ptr.is_null() || dist_ptr.is_null() {
        return ERR_INVALID_ARGS;
    }
    let (w, h, c) = (width as usize, height as usize, channels as usize);
    if w == 0 || h == 0 || !matches!(c, 1 | 3 | 4) {
        return ERR_INVALID_ARGS;
    }
    let Some(len) = w.checked_mul(h).and_then(|n| n.checked_mul(c)) else {
        return ERR_TOO_LARGE;
    };
    let a = core::slice::from_raw_parts(ref_ptr, len);
    let b = core::slice::from_raw_parts(dist_ptr, len);
    score_u8(a, b, w, h, c)
}
