# Third-party notices

The production build includes these open-source components:

| Component | Use | License / obligation |
| --- | --- | --- |
| QPDF | Structural PDF optimization and eligible JPEG recompression | Apache-2.0 (QPDF project); `@neslinesli93/qpdf-wasm` wrapper is ISC |
| Ghostscript | Strong image downsampling candidate | AGPL-3.0-or-later for the engine; the browser wrapper is MIT. The corresponding Ghostscript source and notices must remain available. |
| PDF-Lib | Inspection support and measured page splitting | MIT |
| React, React DOM, Vite, Vitest | UI and build tooling | MIT |

The exact dependency versions are pinned in `package-lock.json`. Before a public release, generate and commit an SBOM and the exact Ghostscript/QPDF source or source offer used to build each shipped WASM asset. Do not describe the MIT wrapper as changing the Ghostscript engine's license.
