# Third-party notices

The production build includes these open-source components:

| Component | Use | License / obligation |
| --- | --- | --- |
| QPDF | PDF inspection, image extraction and replacement, lossless optimization and page splitting | Apache-2.0 (QPDF project); `@neslinesli93/qpdf-wasm` wrapper is ISC |
| PDF.js (`pdfjs-dist`) | Drawing slides for flatten, loaded only when a visitor flattens | Apache-2.0 (Mozilla Foundation) |
| PDF.js data files shipped with it: standard fonts | Stand-ins for fonts a PDF names but does not embed | Foxit fonts: BSD-3-Clause (PDFium); Liberation Sans 1.x: GPL-2.0 with font exception, shipped as separate, unmodified files (`LICENSE_LIBERATION`) |
| PDF.js data files shipped with it: CMaps | Character maps for CJK text | BSD-3-Clause (Adobe) |
| PDF.js data files shipped with it: OpenJPEG and JBIG2 decoders (WASM) | Decoding JPEG 2000 and JBIG2 images while drawing | BSD-2-Clause (OpenJPEG), BSD-3-Clause (PDFium), PDF.js wrappers BSD |
| jpegli (google/jpegli), compiled to WebAssembly | Writing every JPEG the tool re-saves | BSD-3-Clause (the JPEG XL Project Authors) plus Google's patent grant (`PATENTS`) |
| Highway, compiled into jpegli | SIMD for jpegli | Apache-2.0 or BSD-3-Clause (Google LLC, Arm Limited); BSD-3-Clause elected |
| libjpeg-turbo API headers, compiled into jpegli | The libjpeg API jpegli implements | IJG License and BSD-3-Clause. **This software is based in part on the work of the Independent JPEG Group.** |
| SSIMULACRA2 (`ssimulacra2` crate 0.5.1 and `v_frame` 0.3.9, patched), compiled to WebAssembly | Checking that each re-saved JPEG still looks right | BSD-2-Clause (ssimulacra2), BSD-2-Clause (v_frame); see `scripts/codecs/ssimulacra2/` |
| libdeflate, compiled to WebAssembly | Flate for re-saved drawings and graphics | MIT (Eric Biggers) |
| `@jsquash/resize` and the `resize` crate it wraps | Lanczos3 resizing of photos | Apache-2.0 (jSquash); MIT (PistonDevelopers) |
| Emscripten runtime, musl libc, LLVM libc++/libc++abi/compiler-rt, linked into the jpegli and libdeflate WebAssembly | C/C++ runtime | MIT or NCSA (Emscripten), MIT (musl), Apache-2.0 WITH LLVM-exception |
| React, React DOM, Vite, Vitest | UI and build tooling | MIT |
| PDF-Lib, jpeg-js, `@jsquash/jpeg` (MozJPEG) | Tests, benches and the synthetic corpus only; not shipped | MIT, BSD-3-Clause, Apache-2.0 |

The image encoders above are separate WebAssembly files, fetched only when a deck needs images re-saved; if one cannot load, the browser's built-in codecs are used instead. Their build scripts and pins are in `scripts/codecs/`, and their licence texts in `scripts/codecs/licenses/`, which `npm run build:pitchdog` copies into `licenses/encoders/`. The licence texts for PDF.js and its data files are in `node_modules/pdfjs-dist/{.,standard_fonts,cmaps,wasm}/LICENSE*`; `npm run build:pitchdog` copies them into `licenses/pdfjs/`. The exact dependency versions are pinned in `package-lock.json`. Before a public release, keep the SBOM current and keep the QPDF source or source offer for the shipped WASM asset available.
