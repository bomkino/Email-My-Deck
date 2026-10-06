# Third-party notices

The production build includes these open-source components:

| Component | Use | License / obligation |
| --- | --- | --- |
| QPDF | PDF inspection, image extraction and replacement, lossless optimization and page splitting | Apache-2.0 (QPDF project); `@neslinesli93/qpdf-wasm` wrapper is ISC |
| PDF.js (`pdfjs-dist`) | Drawing slides for flatten, loaded only when a visitor flattens | Apache-2.0 (Mozilla Foundation) |
| PDF.js data files shipped with it: standard fonts | Stand-ins for fonts a PDF names but does not embed | Foxit fonts: BSD-3-Clause (PDFium); Liberation Sans 1.x: GPL-2.0 with font exception, shipped as separate, unmodified files (`LICENSE_LIBERATION`) |
| PDF.js data files shipped with it: CMaps | Character maps for CJK text | BSD-3-Clause (Adobe) |
| PDF.js data files shipped with it: OpenJPEG and JBIG2 decoders (WASM) | Decoding JPEG 2000 and JBIG2 images while drawing | BSD-2-Clause (OpenJPEG), BSD-3-Clause (PDFium), PDF.js wrappers BSD |
| React, React DOM, Vite, Vitest | UI and build tooling | MIT |
| PDF-Lib, jpeg-js | Tests and the synthetic corpus only; not shipped | MIT, BSD-3-Clause |

Image resizing and re-saving use the browser's built-in codecs, so no image library ships with the site. The licence texts for PDF.js and its data files are in `node_modules/pdfjs-dist/{.,standard_fonts,cmaps,wasm}/LICENSE*`; `npm run build:pitchdog` copies them into `licenses/pdfjs/`. The exact dependency versions are pinned in `package-lock.json`. Before a public release, keep the SBOM current and keep the QPDF source or source offer for the shipped WASM asset available.
