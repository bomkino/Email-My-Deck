# Third-party notices

The production build includes these open-source components:

| Component | Use | License / obligation |
| --- | --- | --- |
| QPDF | PDF inspection, image extraction and replacement, lossless optimization and page splitting | Apache-2.0 (QPDF project); `@neslinesli93/qpdf-wasm` wrapper is ISC |
| React, React DOM, Vite, Vitest | UI and build tooling | MIT |
| PDF-Lib, jpeg-js | Tests and the synthetic corpus only; not shipped | MIT, BSD-3-Clause |

Image resizing and re-saving use the browser's built-in codecs, so no image library ships with the site. The exact dependency versions are pinned in `package-lock.json`. Before a public release, keep the SBOM current and keep the QPDF source or source offer for the shipped WASM asset available.
