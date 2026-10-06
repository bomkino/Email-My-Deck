# Build provenance

This first implementation uses:

- `@neslinesli93/qpdf-wasm` 0.3.x, embedding QPDF 12.x in the browser.
- `@wasm-zoo/ghostscript` 0.7.x, embedding Ghostscript 10.08.0 in an isolated worker.
- `pdf-lib` 1.17.x for document inspection and split output.

Engine arguments are fixed in `src/lib/compression.ts`; user input cannot become a command-line argument. Strong compression uses safe mode, an in-memory filesystem, explicit image resolutions, and `PreserveAnnots`.

Before launch, record the final package-lock hash, WASM SHA-256 hashes, source commit for each engine, and an SBOM. The public Cloudflare deployment must serve these notices with the build.
