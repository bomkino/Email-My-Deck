// Minimal WebAssembly wrapper around Google's jpegli encoder.
//
// Produces a plain YCbCr (or 1-component grayscale) JPEG with no JFIF/APP0,
// no Adobe marker, no ICC profile and no XYB: SOI, DQT, SOF0/SOF2, DHT, SOS...,
// EOI only. Intended for embedding in a PDF /DCTDecode stream.
//
// Errors never abort: a setjmp-based libjpeg error manager unwinds back here
// and the call returns NULL (call emd_jpegli_last_error() for the message).

#include <setjmp.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

#include <hwy/highway.h>

#include "lib/jpegli/common.h"
#include "lib/jpegli/encode.h"

#ifdef __EMSCRIPTEN__
#include <emscripten/emscripten.h>
#define EMD_EXPORT extern "C" EMSCRIPTEN_KEEPALIVE
#else
#define EMD_EXPORT extern "C"
#endif

namespace {

struct EmdErrorMgr {
  struct jpeg_error_mgr pub;  // must be first
  jmp_buf jmp;
};

// Everything that must survive a longjmp lives on the heap, reached through a
// pointer that is never modified after setjmp().
struct EmdState {
  struct jpeg_compress_struct cinfo;
  EmdErrorMgr err;
  unsigned char* out_buf;
  unsigned long out_len;  // NOLINT (libjpeg API type)
  bool created;
};

char g_last_error[JMSG_LENGTH_MAX];

void SetError(const char* msg) {
  strncpy(g_last_error, msg, sizeof(g_last_error) - 1);
  g_last_error[sizeof(g_last_error) - 1] = '\0';
}

void EmdErrorExit(j_common_ptr cinfo) {
  EmdErrorMgr* err = reinterpret_cast<EmdErrorMgr*>(cinfo->err);
  (*cinfo->err->format_message)(cinfo, g_last_error);
  longjmp(err->jmp, 1);
}

// Warnings are not printed (no stderr chatter in a Worker).
void EmdOutputMessage(j_common_ptr /*cinfo*/) {}

}  // namespace

EMD_EXPORT const char* emd_jpegli_last_error(void) { return g_last_error; }

// Name of the Highway target compiled in ("WASM" for the SIMD build,
// "EMU128" for the non-SIMD build).
EMD_EXPORT const char* emd_jpegli_simd_target(void) {
  return hwy::TargetName(HWY_STATIC_TARGET);
}

EMD_EXPORT void emd_free(void* p) { free(p); }

// pixels:       interleaved 8-bit samples, rows packed (stride = width*components)
// components:   1 (grayscale -> 1-component JPEG) or 3 (RGB -> YCbCr JPEG)
// quality:      libjpeg-style 1..100 (rounded to int and clamped, like
//               libjpeg), applied via jpegli_set_quality()
// distance:     if > 0, jpegli_set_distance(distance) is used instead of quality
// subsample420: 1 = 4:2:0 chroma, 0 = 4:4:4 (ignored for grayscale)
// progressive:  0 = baseline sequential (SOF0), 1 = progressive (SOF2)
// out_size:     receives the JPEG byte count
// Returns a malloc'd buffer (free with emd_free/free) or NULL on failure.
EMD_EXPORT uint8_t* emd_jpegli_encode(const uint8_t* pixels, int width,
                                      int height, int components,
                                      float quality, float distance,
                                      int subsample420, int progressive,
                                      uint32_t* out_size) {
  g_last_error[0] = '\0';
  if (out_size != nullptr) *out_size = 0;
  if (pixels == nullptr || out_size == nullptr) {
    SetError("emd_jpegli_encode: null pointer argument");
    return nullptr;
  }
  if (width <= 0 || height <= 0 || width > 65535 || height > 65535) {
    SetError("emd_jpegli_encode: width/height must be in 1..65535");
    return nullptr;
  }
  if (components != 1 && components != 3) {
    SetError("emd_jpegli_encode: components must be 1 or 3");
    return nullptr;
  }
  if (distance != distance || (!(distance > 0.0f) && quality != quality)) {
    SetError("emd_jpegli_encode: quality/distance is NaN");
    return nullptr;
  }

  EmdState* const st = static_cast<EmdState*>(calloc(1, sizeof(EmdState)));
  if (st == nullptr) {
    SetError("emd_jpegli_encode: out of memory");
    return nullptr;
  }
  j_compress_ptr cinfo = &st->cinfo;
  cinfo->err = jpegli_std_error(&st->err.pub);
  st->err.pub.error_exit = EmdErrorExit;
  st->err.pub.output_message = EmdOutputMessage;

  if (setjmp(st->err.jmp)) {
    // Error path: jpegli called error_exit -> longjmp.
    if (st->created) jpegli_destroy_compress(&st->cinfo);
    free(st->out_buf);
    free(st);
    return nullptr;
  }

  jpegli_create_compress(cinfo);
  st->created = true;
  jpegli_mem_dest(cinfo, &st->out_buf, &st->out_len);

  cinfo->image_width = static_cast<JDIMENSION>(width);
  cinfo->image_height = static_cast<JDIMENSION>(height);
  cinfo->input_components = components;
  cinfo->in_color_space = components == 1 ? JCS_GRAYSCALE : JCS_RGB;
  jpegli_set_defaults(cinfo);  // YCbCr for RGB, GRAYSCALE for gray; no XYB

  if (components == 3) {
    // Sampling factors must be set before jpegli_set_quality/distance, because
    // jpegli picks different quant matrices for 4:2:0.
    const int f = subsample420 ? 2 : 1;
    cinfo->comp_info[0].h_samp_factor = f;
    cinfo->comp_info[0].v_samp_factor = f;
    for (int c = 1; c < 3; ++c) {
      cinfo->comp_info[c].h_samp_factor = 1;
      cinfo->comp_info[c].v_samp_factor = 1;
    }
  }

  // No APPn markers at all (jpegli defaults, made explicit).
  cinfo->write_JFIF_header = FALSE;
  cinfo->write_Adobe_marker = FALSE;
  cinfo->optimize_coding = TRUE;  // optimised Huffman tables
  jpegli_enable_adaptive_quantization(cinfo, TRUE);  // jpegli default
  jpegli_set_progressive_level(cinfo, progressive ? 2 : 0);

  if (distance > 0.0f) {
    jpegli_set_distance(cinfo, distance, /*force_baseline=*/TRUE);
  } else {
    const float qc = quality < 1.0f ? 1.0f : (quality > 100.0f ? 100.0f : quality);
    const int q = static_cast<int>(qc + 0.5f);
    jpegli_set_quality(cinfo, q, /*force_baseline=*/TRUE);
  }

  jpegli_start_compress(cinfo, TRUE);
  const size_t stride = static_cast<size_t>(width) * components;
  JSAMPROW rows[16];
  while (cinfo->next_scanline < cinfo->image_height) {
    JDIMENSION n = cinfo->image_height - cinfo->next_scanline;
    if (n > 16) n = 16;
    for (JDIMENSION i = 0; i < n; ++i) {
      rows[i] = const_cast<JSAMPROW>(
          pixels + (cinfo->next_scanline + i) * stride);
    }
    if (jpegli_write_scanlines(cinfo, rows, n) == 0) {
      SetError("emd_jpegli_encode: encoder made no progress");
      jpegli_destroy_compress(cinfo);
      free(st->out_buf);
      free(st);
      return nullptr;
    }
  }
  jpegli_finish_compress(cinfo);

  uint8_t* out = st->out_buf;
  const unsigned long len = st->out_len;  // NOLINT
  st->out_buf = nullptr;
  jpegli_destroy_compress(cinfo);
  free(st);

  // The memory destination grows by doubling; give back the slack.
  if (len > 0) {
    uint8_t* shrunk = static_cast<uint8_t*>(realloc(out, len));
    if (shrunk != nullptr) out = shrunk;
  }
  *out_size = static_cast<uint32_t>(len);
  return out;
}
