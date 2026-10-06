#!/usr/bin/env bash
# Reproducible build of Google jpegli (encoder) -> single-threaded WebAssembly
# ES module for browser Web Workers (Chromium, Safari, Firefox) and Node.
#
# Layout (ROOT defaults to .codecs-build/jpegli under the current directory;
# this script and the C wrapper live in scripts/codecs/jpegli/ in the repo):
#   src/       upstream git checkouts (treated as untrusted data; nothing in
#              them is executed - no upstream CMake/shell scripts are run, we
#              only compile their C++ sources with our own flags)
#   tools/     emsdk
#   build/     intermediate objects, generated headers, ninja files
#   dist/      deliverables: jpegli.{js,wasm} (WASM SIMD) and
#              jpegli-nosimd.{js,wasm} (Highway EMU128 scalar fallback)
#
# Usage:  scripts/codecs/jpegli/build.sh   # from the repo root: fetch (if needed) + build both variants
# Env:    OPT=-O2|-O3|-Os|-Oz  LINK_OPT=-Oz|-O3|...  LTO=0|1  VECTORIZE=0|1
#         MALLOC=emmalloc|dlmalloc  CLOSURE=1|0  STACK_SIZE=256KB  EXTRA_LDFLAGS=...
#         VARIANTS="simd nosimd"  TAG=<build subdir name>  DIST_DIR=<out dir>
# Then:   copy dist/jpegli.js, jpegli.wasm, jpegli-nosimd.wasm to src/lib/encoders/wasm/
#         and run npm test (tests/encoders.test.ts).
# Needs:  git, python3, ninja, node (emsdk brings clang/wasm-ld/binaryen/node).
set -euo pipefail

# ---------------------------------------------------------------------------
# Pins. Everything that ends up in the binary is fixed by these SHAs.
# ---------------------------------------------------------------------------
JPEGLI_URL=https://github.com/google/jpegli
JPEGLI_SHA=031a0077f5799a6041004267fc12b956c1f52a20  # main, 2026-06-01 "Bump the everything group with 5 updates (#236)"
# Submodules of that jpegli commit (verified below against the gitlink entries):
HWY_URL=https://github.com/google/highway
HWY_SHA=271a9a0ed9de1232d9117f1572c3fe28f8542ec1     # third_party/highway, 2026-01-20
LJT_URL=https://github.com/libjpeg-turbo/libjpeg-turbo
LJT_SHA=8ecba3647edb6dd940463fedf38ca33a8e2a73d1     # third_party/libjpeg-turbo, 2023-02-08 (headers only)
# Toolchain:
EMSDK_URL=https://github.com/emscripten-core/emsdk
EMSDK_SHA=96c657fc60920d2a6a82318aa50e0abf82749604   # emsdk main at time of build
EMSCRIPTEN_VERSION=6.0.11  # emcc 6.0.11 (a0014542110d6078c3a1a7941fa1ddb3a2281f16), = emsdk "recommended" on 2026-10-06

# ---------------------------------------------------------------------------
SCRIPTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="${ROOT:-$PWD/.codecs-build/jpegli}"
SRC_DIR="$ROOT/src"
TOOLS_DIR="$ROOT/tools"
BUILD_ROOT="$ROOT/build"
DIST_DIR="${DIST_DIR:-$ROOT/dist}"

# Defaults chosen by measurement (see report): clang -O2 per TU, then emcc
# link at -Oz (binaryen wasm-opt -Oz). As fast as -O3/-O3+LTO within noise,
# ~25% smaller (brotli) than -O3; -Oz/-Os codegen costs 30% (SIMD) to 4x
# (non-SIMD, EMU128 needs inlining) in speed.
OPT="${OPT:--O2}"            # clang codegen level for each .cc
LINK_OPT="${LINK_OPT:--Oz}"   # emcc link level (wasm-opt passes; LTO codegen if LTO=1)
LTO="${LTO:-0}"
VECTORIZE="${VECTORIZE:-0}"   # 1 = drop upstream's -fno-vectorize/-fno-slp-vectorize
MALLOC="${MALLOC:-emmalloc}"
CLOSURE="${CLOSURE:-1}"
VARIANTS="${VARIANTS:-simd nosimd}"
TAG="${TAG:-release}"
JOBS="${JOBS:-$(nproc)}"
STACK_SIZE="${STACK_SIZE:-256KB}"  # 64KB passes with -sSTACK_OVERFLOW_CHECK=2; 4x headroom
EXTRA_LDFLAGS="${EXTRA_LDFLAGS:-}"   # e.g. "-sSTACK_OVERFLOW_CHECK=2" for diagnostics

JPEGLI_DIR="$SRC_DIR/jpegli"
HWY_DIR="$JPEGLI_DIR/third_party/highway"
LJT_DIR="$JPEGLI_DIR/third_party/libjpeg-turbo"
EMSDK_DIR="$TOOLS_DIR/emsdk"

log() { printf '\n== %s\n' "$*" >&2; }

# --- 1. Sources -------------------------------------------------------------
checkout_pinned() {  # <dir> <url> <sha>
  local dir="$1" url="$2" sha="$3"
  if [ ! -d "$dir/.git" ] && [ ! -f "$dir/.git" ]; then
    mkdir -p "$dir"
    git -C "$dir" init -q
    git -C "$dir" remote add origin "$url"
  fi
  if ! git -C "$dir" cat-file -e "${sha}^{commit}" 2>/dev/null; then
    git -C "$dir" fetch -q --depth 1 origin "$sha"
  fi
  git -C "$dir" -c advice.detachedHead=false checkout -q --detach "$sha"
  local got
  got="$(git -C "$dir" rev-parse HEAD)"
  [ "$got" = "$sha" ] || { echo "SHA mismatch in $dir: $got != $sha" >&2; exit 1; }
}

fetch_sources() {
  log "Fetching jpegli $JPEGLI_SHA"
  mkdir -p "$SRC_DIR"
  checkout_pinned "$JPEGLI_DIR" "$JPEGLI_URL" "$JPEGLI_SHA"
  # The superproject's gitlinks must match our pins (no silent drift).
  local hwy_link ljt_link
  hwy_link="$(git -C "$JPEGLI_DIR" ls-tree HEAD third_party/highway | awk '{print $3}')"
  ljt_link="$(git -C "$JPEGLI_DIR" ls-tree HEAD third_party/libjpeg-turbo | awk '{print $3}')"
  [ "$hwy_link" = "$HWY_SHA" ] || { echo "highway gitlink $hwy_link != pin $HWY_SHA" >&2; exit 1; }
  [ "$ljt_link" = "$LJT_SHA" ] || { echo "libjpeg-turbo gitlink $ljt_link != pin $LJT_SHA" >&2; exit 1; }
  # Only the two submodules the encoder needs, fetched from OUR pinned URLs at
  # the pinned SHAs (upstream's .gitmodules is not consulted).
  log "Fetching highway $HWY_SHA and libjpeg-turbo $LJT_SHA"
  checkout_pinned "$HWY_DIR" "$HWY_URL" "$HWY_SHA"
  checkout_pinned "$LJT_DIR" "$LJT_URL" "$LJT_SHA"
}

# --- 2. Toolchain -----------------------------------------------------------
setup_emsdk() {
  log "Setting up emsdk $EMSCRIPTEN_VERSION"
  mkdir -p "$TOOLS_DIR"
  checkout_pinned "$EMSDK_DIR" "$EMSDK_URL" "$EMSDK_SHA"
  if ! "$EMSDK_DIR/upstream/emscripten/emcc" --version 2>/dev/null | grep -q " $EMSCRIPTEN_VERSION "; then
    (cd "$EMSDK_DIR" && ./emsdk install "$EMSCRIPTEN_VERSION" && ./emsdk activate "$EMSCRIPTEN_VERSION")
  fi
  # shellcheck disable=SC1091
  EMSDK_QUIET=1 source "$EMSDK_DIR/emsdk_env.sh" >/dev/null
  emcc --version | head -1 | grep -q " $EMSCRIPTEN_VERSION " \
    || { echo "emcc is not $EMSCRIPTEN_VERSION" >&2; exit 1; }
}

# --- 3. Generated headers (what lib/jpegli.cmake's configure_file does) -------
gen_headers() {
  local inc="$BUILD_ROOT/gen/include"
  mkdir -p "$inc"
  # JPEGLI_LIBJPEG_LIBRARY_SOVERSION=62 (upstream default) -> JPEG_LIB_VERSION 62
  sed -e 's/@JPEG_LIB_VERSION@/62/' \
      -e 's/@VERSION@//' \
      -e 's/@LIBJPEG_TURBO_VERSION_NUMBER@//' \
      -e 's/@BITS_IN_JSAMPLE@/8/' \
      -e 's|^#cmakedefine MEM_SRCDST_SUPPORTED 1|#define MEM_SRCDST_SUPPORTED 1|' \
      -e 's|^#cmakedefine \(.*\)$|/* #undef \1 */|' \
      "$LJT_DIR/jconfig.h.in" > "$inc/jconfig.h.tmp"
  cmp -s "$inc/jconfig.h.tmp" "$inc/jconfig.h" 2>/dev/null && rm "$inc/jconfig.h.tmp" \
    || mv "$inc/jconfig.h.tmp" "$inc/jconfig.h"
  cp -p "$LJT_DIR/jpeglib.h" "$LJT_DIR/jmorecfg.h" "$inc/"
}

# --- 4. Compile + link --------------------------------------------------------
# Encoder-relevant jpegli sources (lib/jpegli_lists.cmake JPEGLI_INTERNAL_JPEGLI_SOURCES,
# .cc only). Decoder files are compiled too; wasm-ld drops what is unreferenced.
JPEGLI_SRCS=(
  adaptive_quantization bit_writer bitstream color_quantize color_transform
  common decode decode_marker decode_scan destination_manager downsample
  encode encode_finish encode_streaming entropy_coding error huffman idct
  input memory_manager quant render simd source_manager upsample
)
# Highway runtime pieces needed with static dispatch (targets.cc is only for
# dynamic dispatch and is never referenced with HWY_COMPILE_ONLY_STATIC).
HWY_SRCS=(abort aligned_allocator)

EXPORTS='_emd_jpegli_encode,_emd_free,_malloc,_free,_emd_jpegli_last_error,_emd_jpegli_simd_target'

write_ninja() {  # <variant> <objdir> <out_js>
  local variant="$1" obj="$2" out_js="$3"
  local simd_flag
  case "$variant" in
    simd)   simd_flag="-msimd128" ;;     # Highway static target: HWY_WASM
    nosimd) simd_flag="-mno-simd128" ;;  # Highway static target: HWY_EMU128
    *) echo "unknown variant $variant" >&2; exit 1 ;;
  esac
  local lto_flag=""
  [ "$LTO" = "1" ] && lto_flag="-flto"
  local vec_flags="-fno-slp-vectorize -fno-vectorize"  # upstream default
  [ "$VECTORIZE" = "1" ] && vec_flags=""

  # Flags mirror upstream lib/CMakeLists.txt (F_FLAGS + clang/non-WIN32 set),
  # minus warnings, plus single-target Highway and reproducibility maps.
  local cxxflags="-std=c++17 $OPT $simd_flag $lto_flag -DNDEBUG \
-fno-exceptions -fno-cxx-exceptions -fno-rtti \
-fmerge-all-constants -fno-builtin-fwrite -fno-builtin-fread \
-fsized-deallocation -fmath-errno -fnew-alignment=8 \
$vec_flags \
-DHWY_COMPILE_ONLY_STATIC=1 \
-Wno-builtin-macro-redefined -D__DATE__=\\\"redacted\\\" -D__TIMESTAMP__=\\\"redacted\\\" -D__TIME__=\\\"redacted\\\" \
-ffile-prefix-map=$JPEGLI_DIR=. -ffile-prefix-map=$SCRIPTS_DIR=. -ffile-prefix-map=$BUILD_ROOT=. \
-I$JPEGLI_DIR -I$HWY_DIR -I$BUILD_ROOT/gen/include"

  local closure_flag=""
  [ "$CLOSURE" = "1" ] && closure_flag="--closure=1"
  local ldflags="$LINK_OPT $simd_flag $lto_flag $closure_flag \
-fno-exceptions \
-sMODULARIZE=1 -sEXPORT_ES6=1 -sEXPORT_NAME=createJpegliModule \
-sENVIRONMENT=web,worker,node \
-sALLOW_MEMORY_GROWTH=1 -sMAXIMUM_MEMORY=2GB -sINITIAL_MEMORY=32MB -sSTACK_SIZE=$STACK_SIZE \
-sFILESYSTEM=0 -sSUPPORT_LONGJMP=emscripten -sMALLOC=$MALLOC \
-sDYNAMIC_EXECUTION=0 -sTEXTDECODER=2 \
-sINCOMING_MODULE_JS_API=locateFile,wasmBinary,instantiateWasm,print,printErr,onAbort \
-sEXPORTED_FUNCTIONS=$EXPORTS \
-sEXPORTED_RUNTIME_METHODS=HEAPU8,UTF8ToString $EXTRA_LDFLAGS"

  {
    echo "ninja_required_version = 1.7"
    echo "cxxflags = $cxxflags"
    echo "ldflags = $ldflags"
    echo "rule cxx"
    echo "  command = em++ \$cxxflags -MD -MF \$out.d -c \$in -o \$out"
    echo "  depfile = \$out.d"
    echo "  deps = gcc"
    echo "  description = CXX \$out"
    echo "rule link"
    echo "  command = em++ \$ldflags \$in -o \$out"
    echo "  description = LINK \$out"
    local objs=()
    for f in "${JPEGLI_SRCS[@]}"; do
      echo "build $obj/jpegli/$f.o: cxx $JPEGLI_DIR/lib/jpegli/$f.cc"
      objs+=("$obj/jpegli/$f.o")
    done
    for f in "${HWY_SRCS[@]}"; do
      echo "build $obj/hwy/$f.o: cxx $HWY_DIR/hwy/$f.cc"
      objs+=("$obj/hwy/$f.o")
    done
    echo "build $obj/emd_jpegli.o: cxx $SCRIPTS_DIR/emd_jpegli.cc"
    objs+=("$obj/emd_jpegli.o")
    echo "build $out_js | ${out_js%.js}.wasm: link ${objs[*]}"
    echo "default $out_js"
  } > "$obj/build.ninja.tmp"
  cmp -s "$obj/build.ninja.tmp" "$obj/build.ninja" 2>/dev/null && rm "$obj/build.ninja.tmp" \
    || mv "$obj/build.ninja.tmp" "$obj/build.ninja"
}

build_variant() {  # <variant>
  local variant="$1"
  local obj="$BUILD_ROOT/$TAG/$variant"
  local name="jpegli"
  [ "$variant" = "nosimd" ] && name="jpegli-nosimd"
  mkdir -p "$obj/jpegli" "$obj/hwy" "$obj/out"
  write_ninja "$variant" "$obj" "$obj/out/$name.js"
  log "Building $variant (cc $OPT, link $LINK_OPT, LTO=$LTO, VECTORIZE=$VECTORIZE, MALLOC=$MALLOC, CLOSURE=$CLOSURE)"
  ninja -C "$obj" -f build.ninja -j "$JOBS"
  mkdir -p "$DIST_DIR"
  cp "$obj/out/$name.js" "$obj/out/$name.wasm" "$DIST_DIR/"
}

# --- 5. License texts for everything compiled into the .wasm/.js -------------
copy_licenses() {
  local lic="$DIST_DIR/licenses"
  local sys="$EMSDK_DIR/upstream/emscripten/system/lib"
  mkdir -p "$lic"
  cp "$SCRIPTS_DIR/LICENSES.md" "$DIST_DIR/LICENSES.md"
  cp "$JPEGLI_DIR/LICENSE"  "$lic/jpegli-LICENSE"
  cp "$JPEGLI_DIR/PATENTS"  "$lic/jpegli-PATENTS"
  cp "$JPEGLI_DIR/AUTHORS"  "$lic/jpegli-AUTHORS"
  cp "$HWY_DIR/LICENSE"     "$lic/highway-LICENSE"
  cp "$LJT_DIR/README.ijg"  "$lic/libjpeg-turbo-README.ijg"
  cp "$LJT_DIR/LICENSE.md"  "$lic/libjpeg-turbo-LICENSE.md"
  cp "$EMSDK_DIR/upstream/emscripten/LICENSE" "$lic/emscripten-LICENSE"
  cp "$sys/libc/musl/COPYRIGHT"     "$lic/musl-COPYRIGHT"
  cp "$sys/libcxx/LICENSE.TXT"      "$lic/llvm-libcxx-LICENSE.TXT"
  cp "$sys/libcxxabi/LICENSE.TXT"   "$lic/llvm-libcxxabi-LICENSE.TXT"
  cp "$sys/compiler-rt/LICENSE.TXT" "$lic/llvm-compiler-rt-LICENSE.TXT"
}

fetch_sources
setup_emsdk
gen_headers
for v in $VARIANTS; do build_variant "$v"; done
copy_licenses
log "Done. Outputs in $DIST_DIR"
ls -l "$DIST_DIR"/jpegli*.js "$DIST_DIR"/jpegli*.wasm >&2
