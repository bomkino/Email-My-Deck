# Email My Deck

Email My Deck answers one narrow question: **“How do I get this deck into an email without making it unreadable?”**

Drop in a presentation PDF, choose the mailbox limit, and get either a verified `-email-version.pdf` or measured sequential parts with a ready-to-copy email plan. The PDF stays in the browser. There is no account, upload endpoint, analytics, email integration, or third-party font dependency.

This repository is the complete shareable implementation and handoff for the current release. Start with [HANDOFF.md](HANDOFF.md) for the product story, decisions, test evidence, and deployment gates. [DECISIONS.md](DECISIONS.md) records the important tradeoffs so a future contributor does not accidentally undo the privacy or quality guarantees.

## What the tool does

1. Reads and inspects the PDF in a dedicated browser worker.
2. Tries the least destructive local optimization first.
3. Uses stronger image downsampling only when it is needed.
4. Verifies that the page count and page geometry survived.
5. Offers a filename ending in `-email-version.pdf` when one file fits.
6. If the quality floor cannot be met, creates measured `-email-version-part-01-of-03.pdf` files and separates each email subject from its attachment name.

The default **Common 25 MB mail systems** profile uses a conservative raw-PDF budget so base64/MIME overhead and message text have room. The strict profile is safer for older systems. The Gmail profile is deliberately labelled conditional because a large Gmail attachment can still be rejected by a recipient gateway.

## Run locally

```bash
npm ci
npm run corpus   # optional: create synthetic test decks in corpus/
npm run dev
```

The production checks are:

```bash
npm test
npm run build
npm run smoke   # run while Vite is serving on port 5173
```

For a clean handoff, use this sequence:

```bash
npm ci
npm run corpus
npm test
npm run build
npm run dev -- --host 127.0.0.1
# in another terminal:
npm run smoke
```

`npm run smoke` uses the synthetic corpus and a Playwright browser. It fails if a request leaves the local origin.

## Architecture

- React + Vite UI with responsive desktop/mobile states.
- A dedicated worker (`src/workers/pdf.worker.ts`) runs the engine in `src/lib/engine/`. The page and the worker speak the message types in `src/lib/engine/protocol.ts`.
- QPDF WASM reads the PDF's structure as JSON (pages, images, forms, encryption), pulls out image data, swaps rewritten images back in by object number, and cuts page ranges for splits. Images are handled once each, even when every page shares one resource dictionary.
- The browser's own codecs resize and re-save images (`createImageBitmap`, `OffscreenCanvas`, `CompressionStream`), spread over a few nested image workers (`src/workers/image.worker.ts`).
- Order: the untouched original if it fits; a lossless tidy when it could plausibly fit; then a quality ladder measured in pixels across the slide (3840, 2880, 2400, then a 1920-pixel floor). Each rung starts from the original, and the sharpest one that measures under the budget wins. A small file is never padded toward the ceiling.
- Below the floor the deck is split into measured parts: the fewest emails, at the sharpest rung that still needs no more of them.
- Every result is re-read before it is offered: same page count, same page sizes, sound structure.
- The worker reports progress as `{ stage, fraction, label, page?, pages? }`; `fraction` never goes backwards. Errors carry a `code` (`not-pdf`, `damaged`, `password`, `restricted`, `protected` with a `reason`, `too-big`, `page-too-large`, `engine`).
- `node scripts/engine-check.mjs` (after `npm run build` and `npm run corpus`) runs the built engine in Chromium on the synthetic corpus, served with the site's own `_headers` by `scripts/serve-dist.mjs`, and checks each deck's result, the progress events and that nothing leaves the origin. CI runs it and `npm run smoke` against the built site on every pull request.

The compression engine never receives user-controlled command-line arguments. A 120-second browser-job watchdog prevents a pathological file from leaving the interface spinning forever. Large engine assets are bundled and self-hostable. The Ghostscript WebAssembly distribution is AGPL-3.0-or-later; see [THIRD-PARTY-LICENSES.md](THIRD-PARTY-LICENSES.md) and [PROVENANCE.md](PROVENANCE.md) before redistribution.

## Cloudflare Pages

The app is a static Vite build. Deploy `dist/` from `main` with:

- build command: `npm run build`
- output directory: `dist`
- Node version: 20 or newer

The checked-in `public/_headers` file supplies a restrictive CSP and security headers. Use a dedicated Pages project or a same-origin route in pitch.dog; do not add a Worker upload route. See [CLOUDFLARE.md](CLOUDFLARE.md) for the integration constraint around root paths and iframe embedding.

## Privacy boundary

Document bytes are kept in memory only. They are not written to localStorage, IndexedDB, service-worker caches, URL parameters, cookies, or a server. Hosting providers can still see ordinary request metadata for HTML, JavaScript, CSS, and WASM assets; the app never sends the PDF itself. See [PRIVACY.md](PRIVACY.md).

## Current limitations

- Password-protected PDFs and PDFs containing forms, signatures, attachments, or scripts are rejected rather than silently rewritten. Export a flattened copy first.
- The browser has a first-release memory budget: up to 200 MiB normally, reduced to 80 MiB on devices reporting 2 GiB or less. Very large PDFs may need to be split in the user’s PDF application before opening this tool.
- Compression is tuned for presentation decks, not archival PDF optimization. Visual differences can occur in raster images; text and page geometry are checked.
- The standalone Vite build assumes it is served at `/`. Use a same-origin route or link from pitch.dog unless the base path and worker URLs are deliberately configured.
- `frame-ancestors 'none'` is intentional. The standalone site should not be embedded in an iframe without a security review.

## License

The application code is licensed under the GNU Affero General Public License v3.0 or later. The repository keeps engine provenance, hashes, SBOM, and third-party notices alongside the source so a self-hosted build can be reproduced and its corresponding source can be found.
