#!/usr/bin/env bash
# Build libdeflate's zlib compressor as a standalone WebAssembly module (no JS glue).
# libdeflate v1.24 (MIT), commit 96836d7d9d10e3e0d53e6edb54eb908514e336c4.
set -euo pipefail
# Run from the repo root: sources and output go to .codecs-build/libdeflate (ROOT overrides).
SCRIPTS=$(cd "$(dirname "$0")" && pwd)
HERE=${ROOT:-$PWD/.codecs-build/libdeflate}
SRC=$HERE/src/libdeflate
[ -d "$SRC" ] || git clone --depth 1 --branch v1.24 https://github.com/ebiggers/libdeflate.git "$SRC"
test "$(git -C "$SRC" rev-parse HEAD)" = 96836d7d9d10e3e0d53e6edb54eb908514e336c4
mkdir -p "$HERE/dist"
emcc -O3 -flto -DNDEBUG -I"$SRC" \
  "$SRC"/lib/deflate_compress.c "$SRC"/lib/zlib_compress.c "$SRC"/lib/adler32.c "$SRC"/lib/utils.c "$SCRIPTS/emd_deflate.c" \
  --no-entry -sSTANDALONE_WASM=1 -sALLOW_MEMORY_GROWTH=1 -sINITIAL_MEMORY=4MB -sMAXIMUM_MEMORY=2GB -sFILESYSTEM=0 \
  -sEXPORTED_FUNCTIONS=_malloc,_free,_emd_zlib_compress -sERROR_ON_UNDEFINED_SYMBOLS=1 \
  -o "$HERE/dist/libdeflate.wasm"
ls -l "$HERE/dist/libdeflate.wasm"
