# Third-party licenses: jpegli WebAssembly build

This note covers `jpegli.js`, `jpegli.wasm`, `jpegli-nosimd.js` and
`jpegli-nosimd.wasm`. It lists every component compiled or linked into those
files, using the license headers of the files that were actually built (from
the dependency list ninja recorded and the wasm-ld link map). Full license texts
are in `licenses/`.

**Required notice (IJG license, clause 2):**
This software is based in part on the work of the Independent JPEG Group.

## Components

| Component | Version / pin | What is compiled in | License (from the files) | Text |
|---|---|---|---|---|
| **jpegli** (google/jpegli) | `031a0077f5799a6041004267fc12b956c1f52a20` | `lib/jpegli/*.cc` (encoder plus shared code), `lib/base/*.h` | BSD-3-Clause, "Copyright (c) the JPEG XL Project Authors" (every file header points to `LICENSE`). There is also a separate Google patent grant in `PATENTS`. | `licenses/jpegli-LICENSE`, `licenses/jpegli-PATENTS`, `licenses/jpegli-AUTHORS` |
| **Highway** (google/highway) | `271a9a0ed9de1232d9117f1572c3fe28f8542ec1` | header-only SIMD ops, plus `hwy/abort.cc` and `hwy/aligned_allocator.cc` | Your choice of Apache-2.0 **or** BSD-3-Clause (each file has `SPDX-License-Identifier: Apache-2.0` and `SPDX-License-Identifier: BSD-3-Clause`). Copyright Google LLC and Arm Limited. The CC0 file `hwy/contrib/random` is **not** used. | `licenses/highway-LICENSE` |
| **libjpeg-turbo** (headers only) | `8ecba3647edb6dd940463fedf38ca33a8e2a73d1` | `jpeglib.h`, `jmorecfg.h` (struct and type definitions for the libjpeg API that jpegli implements), and `jconfig.h` generated from `jconfig.h.in` | `jpeglib.h` and `jmorecfg.h` use the **IJG License** (README.ijg): Copyright (C) 1991-1998 Thomas G. Lane, Guido Vollbeding, D. R. Commander, Google. `jconfig.h.in` belongs to the build system, which is under **BSD-3-Clause** (`LICENSE.md`). No libjpeg-turbo `.c` code is compiled. | `licenses/libjpeg-turbo-README.ijg`, `licenses/libjpeg-turbo-LICENSE.md` |
| Wrapper `emd_jpegli.cc` | this project | `emd_jpegli_encode`, `emd_free` and helpers | Same license as the host project | none |
| **Emscripten** runtime and JS glue | emsdk 6.0.11 | `jpegli.js` loader, `emmalloc`, `sbrk`, small libc glue, `emscripten_setjmp`/`emscripten_memcpy`/`emscripten_memset` | MIT **or** University of Illinois/NCSA (dual) | `licenses/emscripten-LICENSE` |
| **musl libc** (bundled with Emscripten) | emsdk 6.0.11 | `vsnprintf`/`fprintf`/`fwrite`, `memchr`/`strlen`/`strncpy`, `expf`/`powf`/`exp2f`/`sqrtf`/`roundf`/`frexp`, errno | MIT | `licenses/musl-COPYRIGHT` |
| **LLVM libc++ / libc++abi** (no-exceptions build) | emsdk 6.0.11 | `operator new`/`delete` (`new.o`, `new_helpers.o`), `cxa_guard`, abort handlers | Apache-2.0 WITH LLVM-exception | `licenses/llvm-libcxx-LICENSE.TXT`, `licenses/llvm-libcxxabi-LICENSE.TXT` |
| **LLVM compiler-rt builtins** | emsdk 6.0.11 | `__ashlti3`, `__lshrti3`, `__trunctfdf2`, stack ops | Apache-2.0 WITH LLVM-exception | `licenses/llvm-compiler-rt-LICENSE.TXT` |

These are **not** included: the other jpegli submodules (lcms, skcms, libpng,
zlib, sjpeg, googletest), all libjpeg-turbo `.c` sources and SIMD code, dlmalloc
(emmalloc is used instead), and Highway's `targets.cc` (dynamic dispatch is
disabled).

## Compatibility with AGPL-3.0-or-later (the host project)

Nothing here is incompatible with AGPL-3.0-or-later:

- **BSD-3-Clause** (jpegli, Highway, libjpeg-turbo build system): permissive and GPL/AGPL-compatible.
- **Apache-2.0** (Highway's alternative, LLVM): compatible with GPLv3 and AGPLv3 but **not** with GPLv2-only. That does not matter for AGPL-3.0-or-later. For Highway you can elect BSD-3-Clause anyway.
- **Apache-2.0 WITH LLVM-exception** (libc++, libc++abi, compiler-rt): compatible. Under the exception, code embedded in object form by compiling does not trigger the attribution clauses 4(a), 4(b) and 4(d).
- **IJG License** (libjpeg API headers): the FSF lists it as a GPL-compatible permissive license. Its one practical obligation is the sentence in clause 2, shown in bold at the top of this file. Keep that sentence in your about or third-party notices page. The IJG license also forbids using the IJG's name in advertising.
- **MIT, and MIT or NCSA** (musl, Emscripten): permissive and compatible.
- **jpegli `PATENTS`**: an extra royalty-free patent grant from Google. It terminates only for a party that brings patent litigation over the implementation. It adds a permission and imposes no restriction, so it is AGPL-compatible. The same pattern is used for WebM/libvpx.

## What you must do when serving these files

1. Ship or link this file and `licenses/` with the web app, for example on a third-party notices page. BSD-3-Clause requires that binary redistributions reproduce the copyright notice, the conditions and the disclaimer. Serving the `.wasm` to browsers counts as a binary redistribution.
2. Include the IJG sentence above.
3. AGPL-3.0 §13 applies to the host project's own Corresponding Source. That source should include `build.sh`, `emd_jpegli.cc` and the pinned SHAs, so the `.wasm` can be rebuilt from source.
