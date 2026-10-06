#!/usr/bin/env bash
# Reproducible build of the SSIMULACRA2 WebAssembly scorer.
#
# Produces, next to this script:
#   ssimulacra2.wasm          wasm32 + simd128                  (baseline SIMD build)
#   ssimulacra2-nosimd.wasm   wasm32 without SIMD               (fallback)
#   ssimulacra2-relaxed.wasm  wasm32 + simd128 + relaxed-simd   (fast path; ssimulacra2.js only
#                             uses it after checking that the engine's relaxed madd is fused)
#
# Pinned inputs:
#   - ssimulacra2 0.5.1 and its whole dependency graph: crate/Cargo.lock, built with --locked.
#   - ssimulacra2 0.5.1 and v_frame 0.3.9 are fetched as .crate tarballs from static.crates.io,
#     checked against the sha256 below (the crates.io checksums) and patched from ./patches:
#       v_frame-0.3.9-no-wasm-bindgen.patch      drop the unconditional wasm-bindgen dependency
#                                                 (it adds 3 imports and ~70 exports to the module)
#       ssimulacra2-0.5.1-wasm-exact-fma-and-perf.patch
#                                                 exact f32 FMA on wasm without libm's soft fmaf,
#                                                 per-plane processing (about half the memory),
#                                                 relaxed-SIMD blur kernels. Same results.
#   - binaryen (wasm-opt), npm package pinned below.
#
# Requirements: cargo/rustc with the wasm32-unknown-unknown target (tested with 1.97.0),
# curl, sha256sum, tar, patch, gzip, node + npm (binaryen and the size report).
# Usage: ./build.sh               SKIP_WASM_OPT=1 ./build.sh   (no wasm-opt pass)
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$HERE"
export PATH="${CARGO_HOME:-$HOME/.cargo}/bin:$PATH"

BINARYEN_VERSION="132.0.0"

# name version sha256 (the crates.io checksum, as in Cargo.lock files)
VENDORED=(
  "v_frame 0.3.9 666b7727c8875d6ab5db9533418d7c764233ac9c0cff1d469aec8fa127597be2"
  "ssimulacra2 0.5.1 700cb4e17f98c3f36756815b18dbec2b2e3c4f5028e9cdee3e23dd8c285e736c"
)

# output name | extra rustc flag | extra wasm-opt feature flags
VARIANTS=(
  "ssimulacra2|-Ctarget-feature=+simd128|--enable-simd"
  "ssimulacra2-nosimd||"
  "ssimulacra2-relaxed|-Ctarget-feature=+simd128,+relaxed-simd|--enable-simd --enable-relaxed-simd"
)
# Panic-location strings embed source paths; map the local ones to fixed names so the
# output does not depend on (or reveal) where it was built.
REMAP=(
  "--remap-path-prefix=$HERE=/ssimulacra2-wasm"
  "--remap-path-prefix=${CARGO_HOME:-$HOME/.cargo}/registry/src=/cargo-registry"
)
# Post-MVP features rustc 1.97 uses by default for wasm32-unknown-unknown (the module
# carries no target_features section, so wasm-opt has to be told).
BASE_FEATURES="--enable-bulk-memory --enable-bulk-memory-opt --enable-sign-ext --enable-reference-types
  --enable-nontrapping-float-to-int --enable-mutable-globals --enable-multivalue"

log() { printf '\n== %s\n' "$*"; }

vendor_crate() {
  local name="$1" ver="$2" sum="$3"
  local dl="$HERE/vendor/dl" dst="$HERE/vendor/$name-$ver"
  mkdir -p "$dl"
  local tarball="$dl/$name-$ver.crate"
  if [[ ! -f "$tarball" ]] || ! echo "$sum  $tarball" | sha256sum -c --status; then
    curl -sSfL --retry 3 -o "$tarball.tmp" "https://static.crates.io/crates/$name/$name-$ver.crate"
    mv "$tarball.tmp" "$tarball"
  fi
  echo "$sum  $tarball" | sha256sum -c --quiet
  rm -rf "$dst"
  tar -xzf "$tarball" -C "$HERE/vendor"
  local p
  for p in "$HERE"/patches/"$name-$ver"-*.patch; do
    [[ -e "$p" ]] || continue
    echo "$name $ver: applying $(basename "$p")"
    patch -s -p1 -d "$dst" < "$p"
  done
}

log "vendoring patched crates"
for entry in "${VENDORED[@]}"; do
  # shellcheck disable=SC2086
  vendor_crate $entry
done

mkdir -p build-out
for v in "${VARIANTS[@]}"; do
  IFS='|' read -r name flag _ <<< "$v"
  rustflags=(${flag:+"$flag"} "${REMAP[@]}")
  log "cargo build $name (rustflags: ${flag:-none} + path remapping)"
  # CARGO_ENCODED_RUSTFLAGS (0x1f-separated) overrides any RUSTFLAGS in the environment
  # and keeps paths with spaces intact.
  ( cd crate && CARGO_ENCODED_RUSTFLAGS="$(IFS=$'\x1f'; echo "${rustflags[*]}")" \
      cargo build --locked --release --lib --target wasm32-unknown-unknown --target-dir "target-$name" )
  cp "crate/target-$name/wasm32-unknown-unknown/release/ssimulacra2_wasm.wasm" "build-out/$name.raw.wasm"
done

if [[ "${SKIP_WASM_OPT:-0}" == "1" ]]; then
  for v in "${VARIANTS[@]}"; do IFS='|' read -r name _ _ <<< "$v"; cp "build-out/$name.raw.wasm" "$name.wasm"; done
else
  log "wasm-opt -O3 (binaryen $BINARYEN_VERSION)"
  installed="$(node -p 'require("./tools/node_modules/binaryen/package.json").version' 2>/dev/null || true)"
  if [[ "$installed" != "$BINARYEN_VERSION" ]]; then
    mkdir -p tools
    ( cd tools && npm install --no-audit --no-fund --silent --no-save "binaryen@$BINARYEN_VERSION" )
  fi
  WASM_OPT="$HERE/tools/node_modules/.bin/wasm-opt"
  "$WASM_OPT" --version
  for v in "${VARIANTS[@]}"; do
    IFS='|' read -r name _ feats <<< "$v"
    # shellcheck disable=SC2086
    "$WASM_OPT" -O3 --strip-debug --strip-producers $BASE_FEATURES $feats \
      "build-out/$name.raw.wasm" -o "$name.wasm"
    # Report which post-MVP features the module really needs (validation fails without them).
    needs=""
    for f in bulk-memory-opt sign-ext reference-types nontrapping-float-to-int mutable-globals \
             multivalue simd relaxed-simd; do
      "$WASM_OPT" --all-features "--disable-$f" "$name.wasm" -o /dev/null 2>/dev/null || needs="$needs $f"
    done
    echo "$name.wasm needs:$needs"
  done
fi

log "sizes (bytes)"
printf '%-38s %9s %9s %9s\n' file raw gzip-9 brotli-11
for v in "${VARIANTS[@]}"; do
  IFS='|' read -r name _ _ <<< "$v"
  for f in "build-out/$name.raw.wasm" "$name.wasm"; do
    raw=$(wc -c < "$f")
    gz=$(gzip -9 -n -c "$f" | wc -c)
    br=$(node -e 'const z=require("zlib"),fs=require("fs");const b=fs.readFileSync(process.argv[1]);process.stdout.write(String(z.brotliCompressSync(b,{params:{[z.constants.BROTLI_PARAM_QUALITY]:11,[z.constants.BROTLI_PARAM_LGWIN]:24}}).length))' "$f" 2>/dev/null || echo n/a)
    printf '%-38s %9s %9s %9s\n' "$f" "$raw" "$gz" "$br"
  done
done
log "sha256"
sha256sum ssimulacra2.wasm ssimulacra2-nosimd.wasm ssimulacra2-relaxed.wasm
