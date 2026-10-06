# Build provenance

The engine uses:

- `@neslinesli93/qpdf-wasm` 0.3.0, embedding QPDF 12.x in the browser worker.
- `pdfjs-dist` 6.4.299 (legacy build), only for flatten: loaded on demand, with its own worker, the standard fonts, the CMaps and the OpenJPEG and JBIG2 WASM decoders bundled as separate assets. Its scripting (QuickJS) and colour-profile (qcms) WASM files are not shipped.
- WebAssembly image encoders built from pinned sources by the scripts in `scripts/codecs/` and vendored in `src/lib/encoders/wasm/`: jpegli (google/jpegli `031a0077f5799a6041004267fc12b956c1f52a20`, Highway `271a9a0ed9de1232d9117f1572c3fe28f8542ec1`, emsdk 6.0.11), SSIMULACRA2 (`ssimulacra2` 0.5.1 and `v_frame` 0.3.9 from crates.io, checksummed and patched, rustc 1.97, binaryen 132.0.0) and libdeflate (v1.24, `96836d7d9d10e3e0d53e6edb54eb908514e336c4`, emsdk 6.0.11). Each script rebuilds its files bit for bit. Lanczos3 resizing is `@jsquash/resize` 2.1.1 from npm. They are fetched only when a deck needs images re-saved.
- The browser's own image decoder (`createImageBitmap`, `OffscreenCanvas`), and its encoders and `CompressionStream` as the fallback when the WebAssembly encoders can't load.

Ghostscript was removed on 2026-10-06. `pdf-lib` is now used only by tests and the corpus generator and is not shipped.

Engine arguments are fixed in `src/lib/engine/`; user input cannot become a command-line argument. QPDF runs on an in-memory filesystem inside the worker.

The exact dependency versions are pinned in `package-lock.json` (SHA-256: `789cbadecba9cb6728d9b0acfd37326f63c62183fc2c89969e272966862d9516` for this release candidate). The reproducible build is `npm ci && npm run build`; the generated WASM hashes from that build are recorded below:

| Built asset | SHA-256 |
| --- | --- |
| `qpdf-C3Giu3T4.wasm` | `abd933f4ccace4f732999381b21aec8b7e3726f18a5b167fafd57f88dd440876` |
| `openjpeg-tw7Aizcv.wasm` (PDF.js, flatten only) | `95e5002597af0824004aa57b1900fe019715db389e37640b1e58395e42f00cc5` |
| `jbig2-BUnLb-NU.wasm` (PDF.js, flatten only) | `466f45c2a61a698152fb5400c27e56ff2ceb73dcb71fde3fc366a502308eaab0` |
| `jpegli.wasm` (vendored) | `254ff7acd8608ed2fdc83c3c171f0a206bf337e64fc79386d6983c5e5a5c47f0` |
| `jpegli-nosimd.wasm` (vendored) | `cd92b44443aec0184a979e8ce85b95c0ea9d521b4134b566b90e5c68e13059a8` |
| `jpegli.js` (vendored glue) | `65d0f8c723bcd71a576d82d762bcc09298087269e3ccfecbf0ec8eca025eb8c3` |
| `ssimulacra2.wasm` (vendored) | `2f4fc16f00ddab11885ed4c2ae4eb0d05e71cf6cc5b6ead9cad6c3e10abb31f0` |
| `ssimulacra2-nosimd.wasm` (vendored) | `a99a443b4993688783fb9922cea84d696edfa7eb0931119ef328c8a1c232637f` |
| `ssimulacra2-relaxed.wasm` (vendored) | `10c2816533f8d67cabfdaa550ccb68f8167631d7e9f3dbdba1af2594500ef60e` |
| `libdeflate.wasm` (vendored) | `0ab6b91c9301a68cae9d45a9ab86b944e7931da7efe24798f82c9f6177eed15e` |

`SBOM.cdx.json` lists the shipped runtime components and their pinned package URLs. The public Cloudflare deployment must serve these notices with the build.
