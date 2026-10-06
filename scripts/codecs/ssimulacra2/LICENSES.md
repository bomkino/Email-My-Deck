# Licenses: SSIMULACRA2 WebAssembly scorer

Checked against crate/Cargo.lock (`cargo tree --target wasm32-unknown-unknown`) and the
LICENSE files in the crate tarballs. This is an engineering note, not legal advice.

**Summary:** everything compiled into the `.wasm` files is BSD-2-Clause, MIT, or
MIT OR Apache-2.0. All of these are permissive and compatible with AGPL-3.0-or-later.
No copyleft or non-commercial terms were found. The `.wasm` files are binaries, so the
BSD and MIT conditions require the notices in the "Notices to ship" section to go with
them, for example in the host project's third-party notices.

One item to flag (low risk, not a blocker): the v_frame source headers say the code is
"subject to the terms of the BSD 2 Clause License and the Alliance for Open Media Patent
License 1.0". The AOM Patent License is a royalty-free patent grant with a defensive
termination clause. It is not a copyright condition, and the PATENTS file is not in the
crate tarball. v_frame only provides plane and frame buffer types and contains no codec
tools. The same dual wording is on rav1e and libaom, which distributions ship alongside
GPL software. If the project tracks patent licenses, record it.

## Compiled into ssimulacra2.wasm, ssimulacra2-nosimd.wasm, ssimulacra2-relaxed.wasm

| Component | Version | License | Copyright | Notes |
|---|---|---|---|---|
| ssimulacra2 | 0.5.1 | BSD-2-Clause | (c) 2022 the rav1e contributors | **Modified**: patches/ssimulacra2-0.5.1-wasm-exact-fma-and-perf.patch |
| v_frame | 0.3.9 | BSD-2-Clause (+ AOM Patent License 1.0 reference, see above) | (c) 2017-2022 the rav1e contributors | **Modified**: patches/v_frame-0.3.9-no-wasm-bindgen.patch |
| yuvxyb | 0.4.2 | MIT | (c) 2022 Josh Holmer | The patched ssimulacra2 also copies its opsin/XYB constants, attributed in the source |
| yuvxyb-math | 0.1.1 | MIT; cbrtf is a FreeBSD msun port under the Sun notice below | (c) 2022 Josh Holmer; (c) 1993 Sun Microsystems | The patched ssimulacra2 inlines a copy of its `cbrtf_fast`, notice kept |
| av-data | 0.4.4 | MIT | (c) 2017 Luca Barbato | Dependency of yuvxyb (LTO may remove most of it) |
| bytes | 1.12.1 | MIT | (c) 2018 Carl Lerche | Dependency of av-data |
| byte-slice-cast | 1.2.3 | MIT | (c) 2017 Sebastian Dröge | Dependency of av-data |
| aligned-vec | 0.6.4 | MIT | (c) 2022 sarah | Dependency of v_frame |
| equator | 0.4.2 | MIT | (c) 2023 sarah | Dependency of aligned-vec |
| num-traits, num-integer, num-rational, num-bigint | 0.2.19, 0.1.47, 0.4.2, 0.4.8 | MIT OR Apache-2.0 | (c) 2014 The Rust Project Developers | |
| log | 0.4.34 | MIT OR Apache-2.0 | (c) 2014 The Rust Project Developers | |
| thiserror | 2.0.21 | MIT OR Apache-2.0 | David Tolnay (no copyright line in its LICENSE-MIT) | |
| Rust standard library: core, alloc, std, dlmalloc, compiler_builtins (toolchain 1.97.0) | | MIT OR Apache-2.0 | The Rust Project Developers | compiler_builtins also contains code from LLVM compiler-rt (Apache-2.0 WITH LLVM-exception) |
| crate/src/lib.rs (C-ABI wrapper) and ssimulacra2.js | new | BSD-2-Clause (crate/Cargo.toml) | written for the host project | Can be relicensed as AGPL-3.0-or-later if the project prefers; BSD-2-Clause keeps the patches upstreamable |

For the dual-licensed crates, the MIT option is the one to cite. Apache-2.0 would also
work with (A)GPLv3.

## Used at build time only, nothing shipped

| Component | License |
|---|---|
| proc-macro2, quote, syn 2/3, autocfg | MIT OR Apache-2.0 |
| unicode-ident 1.0.26 | (MIT OR Apache-2.0) AND Unicode-3.0 |
| num-derive, thiserror-impl, equator-macro (proc macros) | MIT OR Apache-2.0 / MIT |
| binaryen 132.0.0 (npm, `wasm-opt`) | Apache-2.0 (the optimiser's output is not covered by it) |
| Rust toolchain 1.97.0 | MIT OR Apache-2.0 |

## Used by the tests only, nothing shipped

| Component | License / status |
|---|---|
| cloudinary/ssimulacra2 C++ tool (commit 81feacf6, built outside this folder) | BSD-3-Clause (c) Cloudinary, plus a PATENTS file |
| libhwy, lcms2, libjpeg-turbo (apt packages, used to build the C++ tool) | Apache-2.0 / BSD-3-Clause, MIT, IJG + BSD-3-Clause |
| test/native-ref (unpatched ssimulacra2 0.5.1, native) | same crates and licenses as above (default-features = false, so no `image` or rayon) |
| rust-av/ssimulacra2 test_data/tank_*.png (crate test pair) | from the BSD-2-Clause repo; converted copies end up in test/data/pairs if `--tank-dir` is used |
| Photos in test/data/ | extracted from the project's audit deck PDF; rights unknown. Generated locally by test/run_all.sh; **do not commit or ship test/data** |
| Playwright + Chromium (global npm install, test/browser-test.mjs) | Apache-2.0 / BSD-3-Clause |

## Notices to ship with the .wasm files

The full license texts follow. build.sh puts the patched ssimulacra2 and v_frame sources in vendor/.

### BSD-2-Clause: ssimulacra2 0.5.1, v_frame 0.3.9

    Copyright (c) 2022-2022, the rav1e contributors   (ssimulacra2)
    Copyright (c) 2017-2022, the rav1e contributors   (v_frame)
    All rights reserved.

    Redistribution and use in source and binary forms, with or without
    modification, are permitted provided that the following conditions are met:

    1. Redistributions of source code must retain the above copyright notice, this
       list of conditions and the following disclaimer.

    2. Redistributions in binary form must reproduce the above copyright notice,
       this list of conditions and the following disclaimer in the documentation
       and/or other materials provided with the distribution.

    THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
    AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
    IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
    DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
    FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
    DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
    SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
    CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
    OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
    OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

### MIT: yuvxyb, yuvxyb-math, av-data, bytes, byte-slice-cast, aligned-vec, equator, and the MIT option of num-*, log, thiserror and the Rust standard library

    Copyright (c) 2022 Josh Holmer                  (yuvxyb, yuvxyb-math)
    Copyright (c) 2017 Luca Barbato                 (av-data)
    Copyright (c) 2018 Carl Lerche                  (bytes)
    Copyright (c) 2017 Sebastian Dröge              (byte-slice-cast)
    Copyright (c) 2022, 2023 sarah                  (aligned-vec, equator)
    Copyright (c) 2014 The Rust Project Developers  (num-*, log, Rust standard library)
    David Tolnay                                    (thiserror)

    Permission is hereby granted, free of charge, to any person obtaining a copy
    of this software and associated documentation files (the "Software"), to deal
    in the Software without restriction, including without limitation the rights
    to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
    copies of the Software, and to permit persons to whom the Software is
    furnished to do so, subject to the following conditions:

    The above copyright notice and this permission notice shall be included in all
    copies or substantial portions of the Software.

    THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
    IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
    FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
    AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
    LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
    OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
    SOFTWARE.

### cbrtf (yuvxyb-math, copied into the patched ssimulacra2)

    Conversion to float by Ian Lance Taylor, Cygnus Support, ian@cygnus.com.

    Copyright (C) 1993 by Sun Microsystems, Inc. All rights reserved.

    Developed at SunPro, a Sun Microsystems, Inc. business.
    Permission to use, copy, modify, and distribute this
    software is freely granted, provided that this notice
    is preserved.
