// Thin C API over libdeflate for Email My Deck: zlib-format (FlateDecode) compression only.
#include <stdint.h>
#include <stdlib.h>
#include "libdeflate.h"

// Compress `in` into a zlib stream at `level` (1-12). Returns a malloc'd buffer and its size in *out_len, or NULL.
uint8_t* emd_zlib_compress(const uint8_t* in, size_t in_len, int level, size_t* out_len) {
  struct libdeflate_compressor* compressor = libdeflate_alloc_compressor(level);
  if (!compressor) return NULL;
  size_t bound = libdeflate_zlib_compress_bound(compressor, in_len);
  uint8_t* out = (uint8_t*)malloc(bound);
  size_t written = out ? libdeflate_zlib_compress(compressor, in, in_len, out, bound) : 0;
  libdeflate_free_compressor(compressor);
  if (!written) {
    free(out);
    return NULL;
  }
  *out_len = written;
  return out;
}
