# Email My Deck

Email My Deck turns one large presentation PDF into the best readable attachment that fits the mailbox profile you choose. It runs in the browser: the PDF is read by a worker on your device, and the app has no upload endpoint, account flow, email integration, analytics, or third-party fonts.

The default profile is **Common 25 MB mail systems**, which leaves room for MIME/base64 overhead and the email body. The app reports the estimated transmitted message size and says when a result is conditional. If the quality floor cannot be met in one file, it creates measured, sequential `-email-version-part-01-of-02.pdf` files and a copyable send plan.

## Run locally

```bash
npm install
npm run corpus   # optional: create synthetic test decks in corpus/
npm run dev
```

The production checks are:

```bash
npm test
npm run build
npm run smoke   # starts from a running Vite server; checks a real local PDF flow
```

`npm run smoke` uses the synthetic corpus and a Playwright browser. It fails if a request leaves the local origin.

## Architecture

- React + Vite UI with responsive desktop/mobile states.
- A dedicated worker owns parsing, candidate generation, split generation, and output transfer.
- QPDF WASM performs the first structural and eligible-image passes.
- Ghostscript WASM is lazy-loaded only when stronger downsampling is needed.
- Candidates always start from the untouched original. The winner is the highest-fidelity eligible candidate under the raw PDF budget; a small file is never padded toward the ceiling.
- `pdf-lib` handles page-balanced split recovery and verification.

Large engine assets are bundled and self-hostable. The Ghostscript WebAssembly distribution is AGPL-3.0-or-later; see `THIRD-PARTY-LICENSES.md` and `PROVENANCE.md` before redistribution.

## Cloudflare Pages

The app is a static Vite build. Deploy `dist/` from the `main` branch with:

- build command: `npm run build`
- output directory: `dist`
- Node version: 20 or newer

The checked-in `public/_headers` file supplies a restrictive CSP and security headers. Use a dedicated Pages project or a path mount in `pitchdog-cloudflare-sites`; do not add a Worker upload route. A pitch.dog integration can link to or mount the built surface while keeping this repository the source of truth.

## Privacy boundary

Document bytes are kept in memory only. They are not written to localStorage, IndexedDB, service-worker caches, URL parameters, or a server. Hosting providers can still see ordinary request metadata such as IP address and asset requests; the app never sends the PDF itself. See `PRIVACY.md`.

## License

The application code is licensed under the GNU Affero General Public License v3.0 or later. The repository keeps engine provenance, hashes, and third-party notices alongside the source so a self-hosted build can be reproduced and its corresponding source can be found.
