# Build provenance

The engine uses:

- `@neslinesli93/qpdf-wasm` 0.3.0, embedding QPDF 12.x in the browser worker.
- `pdfjs-dist` 6.4.299 (legacy build), only for flatten: loaded on demand, with its own worker, the standard fonts, the CMaps and the OpenJPEG and JBIG2 WASM decoders bundled as separate assets. Its scripting (QuickJS) and colour-profile (qcms) WASM files are not shipped.
- The browser's own image codecs (`createImageBitmap`, `OffscreenCanvas`, `CompressionStream`). Nothing extra is downloaded for them.

Ghostscript was removed on 2026-10-06. `pdf-lib` is now used only by tests and the corpus generator and is not shipped.

Engine arguments are fixed in `src/lib/engine/`; user input cannot become a command-line argument. QPDF runs on an in-memory filesystem inside the worker.

The exact dependency versions are pinned in `package-lock.json` (SHA-256: `a044f374cc8d1d4dec05cb128a78f90d65eef3344219ff28cc36bc84ee80d346` for this release candidate). The reproducible build is `npm ci && npm run build`; the generated WASM hashes from that build are recorded below:

| Built asset | SHA-256 |
| --- | --- |
| `qpdf-C3Giu3T4.wasm` | `abd933f4ccace4f732999381b21aec8b7e3726f18a5b167fafd57f88dd440876` |
| `openjpeg-tw7Aizcv.wasm` (PDF.js, flatten only) | `95e5002597af0824004aa57b1900fe019715db389e37640b1e58395e42f00cc5` |
| `jbig2-BUnLb-NU.wasm` (PDF.js, flatten only) | `466f45c2a61a698152fb5400c27e56ff2ceb73dcb71fde3fc366a502308eaab0` |

`SBOM.cdx.json` lists the shipped runtime components and their pinned package URLs. The public Cloudflare deployment must serve these notices with the build.
