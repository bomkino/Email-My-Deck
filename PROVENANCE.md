# Build provenance

The engine uses:

- `@neslinesli93/qpdf-wasm` 0.3.0, embedding QPDF 12.x in the browser worker.
- The browser's own image codecs (`createImageBitmap`, `OffscreenCanvas`, `CompressionStream`). Nothing extra is downloaded for them.

Ghostscript was removed on 2026-10-06. `pdf-lib` is now used only by tests and the corpus generator and is not shipped.

Engine arguments are fixed in `src/lib/engine/`; user input cannot become a command-line argument. QPDF runs on an in-memory filesystem inside the worker.

The exact dependency versions are pinned in `package-lock.json` (SHA-256: `88bde0e5ac9832462715980e5920c361863a261de9a0f4ec4ff5dc11b19d5b9e` for this release candidate). The reproducible build is `npm ci && npm run build`; the generated WASM hash from that build is recorded below:

| Built asset | SHA-256 |
| --- | --- |
| `qpdf-C3Giu3T4.wasm` | `abd933f4ccace4f732999381b21aec8b7e3726f18a5b167fafd57f88dd440876` |

`SBOM.cdx.json` lists the shipped runtime components and their pinned package URLs. The public Cloudflare deployment must serve these notices with the build.
