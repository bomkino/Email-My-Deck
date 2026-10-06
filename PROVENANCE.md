# Build provenance

This first implementation uses:

- `@neslinesli93/qpdf-wasm` 0.3.x, embedding QPDF 12.x in the browser.
- `@wasm-zoo/ghostscript` 0.7.x, embedding Ghostscript 10.08.0 in an isolated worker.
- `pdf-lib` 1.17.x for document inspection and split output.

Engine arguments are fixed in `src/lib/compression.ts`; user input cannot become a command-line argument. Strong compression uses safe mode, an in-memory filesystem, explicit image resolutions, and `PreserveAnnots`.

The exact dependency versions are pinned in `package-lock.json` (SHA-256: `697885bc87a3ad99aafc985cb4eb8f22e880af824abb75928f0164fa60d31a47` for this release candidate). The reproducible build is `npm ci && npm run build`; the generated WASM hashes from that build are recorded below:

| Built asset | SHA-256 |
| --- | --- |
| `gs-core-CfF09MT_.wasm` | `13615a78029576ca8ebfebe1801a91441ee0485d944c89a8b16d409b649a214e` |
| `qpdf-C3Giu3T4.wasm` | `abd933f4ccace4f732999381b21aec8b7e3726f18a5b167fafd57f88dd440876` |

`SBOM.cdx.json` lists the shipped runtime components and their pinned package URLs. The public Cloudflare deployment must serve these notices with the build.
