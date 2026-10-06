# Email My Deck

Email My Deck answers one narrow question: **“How do I get this deck into an email without making it unreadable?”**

Drop in a presentation PDF, choose the mailbox limit, and get either a verified `-email-version.pdf` or measured sequential parts with a ready-to-copy email plan. The PDF stays in the browser. There is no account, upload endpoint, email integration, or third-party font dependency. On pitch.dog the page counts visits with Google Analytics, like the rest of the site; the PDF, its name and its contents never leave the browser.

This repository is the complete shareable implementation and handoff for the current release. Start with [HANDOFF.md](HANDOFF.md) for the product story, decisions, test evidence, and deployment gates. [DECISIONS.md](DECISIONS.md) records the important tradeoffs so a future contributor does not accidentally undo the privacy or quality guarantees.

## What the tool does

1. Reads and inspects the PDF in a dedicated browser worker.
2. Tries the least destructive local optimization first.
3. Re-saves or resizes photos only as far as it has to, along a ladder measured in pixels across the slide.
4. Verifies that the page count and page geometry survived.
5. Offers a filename ending in `-email-version.pdf` when one file fits.
6. If the quality floor cannot be met, creates measured `-email-version-part-01-of-03.pdf` files and separates each email subject from its attachment name.

The default **Most mailboxes** setting uses a conservative raw-PDF budget (about 17.8 MB) so base64/MIME overhead and message text have room. **Strict or work mailboxes** is safer for 20 MB limits. **Gmail to Gmail only** is deliberately conditional, because a large Gmail attachment can still be rejected by a recipient's mail server.

## Run locally

```bash
npm ci
npm run corpus   # optional: create synthetic test decks in corpus/
npm run dev
```

The checks, as CI runs them on every pull request:

```bash
npm ci
npm run corpus
npm test
npm run build
node scripts/engine-check.mjs
node scripts/serve-dist.mjs dist 5173 &   # serves dist/ with public/_headers
npm run smoke
```

`npm run smoke` uses the synthetic corpus and a Playwright browser. It fails if a request goes anywhere except the page's own origin, the Google Analytics hosts and Cloudflare's Web Analytics beacon (added on pitch.dog itself), or if any request mentions the test deck's file name. Set `SMOKE_URL` to test the pitch.dog build (for example `http://127.0.0.1:8090/email-my-deck/` with `apps/main-site` served locally) and `CHROMIUM_PATH` to use another browser.

## On pitch.dog

The live home for the tool is `pitch.dog/email-my-deck/`, marked beta while we test it on real decks. `index.html` is the whole pitch.dog page; the React tool mounts inside it at `#emd-root`. The page borrows pitch.dog's type system, nav, analytics loader and icons by absolute path, so those only appear when it is served from the main site; under `npm run dev` the tool works but the page is unstyled around it.

```bash
npm run build:pitchdog   # builds dist-pitchdog/ with base /email-my-deck/
```

To ship a change to pitch.dog:

1. Merge it here, then run `npm run build:pitchdog` on a clean checkout. `BUILD.json` records the commit, and `licenses/` carries the AGPL text, third-party notices and provenance.
2. In `bomkino/pitchdog-cloudflare-sites`, replace `apps/main-site/email-my-deck/` with `dist-pitchdog/`, run `node scripts/add-free-stuff-nav.mjs`, and open a pull request. It gets a preview at `https://pr-<number>.pitchdog-website.pages.dev`.
3. Merge it. That repository's "pitch.dog website" workflow deploys `apps/main-site` to pitch.dog and then checks that pitch.dog serves the new commit.

## Architecture

- React + Vite UI with responsive desktop/mobile states.
- A dedicated worker (`src/workers/pdf.worker.ts`) runs the engine in `src/lib/engine/`. The page and the worker speak the message types in `src/lib/engine/protocol.ts`.
- QPDF WASM reads the PDF's structure as JSON (pages, images, forms, encryption), pulls out image data, swaps rewritten images back in by object number, and cuts page ranges for splits. Images are handled once each, even when every page shares one resource dictionary.
- Images are found wherever a page draws them, including inside groups (form XObjects) and as soft masks, which follow their image. JPEGs a PDF compressor deflated again are unwrapped first; 16-bit samples become 8-bit.
- The browser's own codecs resize and re-save images (`createImageBitmap`, `OffscreenCanvas`, `CompressionStream`), spread over a few nested image workers (`src/workers/image.worker.ts`). Canvas only writes three-channel JPEGs, so gray photos and JPEG masks go through the engine's own one-channel encoder (`src/lib/engine/grayjpeg.ts`).
- Order: the untouched original if it fits; a lossless tidy when it could plausibly fit; then a quality ladder measured in pixels across the slide (3840, 2880, 2400, 1920, 1680, then a 1440-pixel floor). Each rung starts from the original, and the sharpest one that measures under the budget wins. When that is not the sharpest rung, the room left goes back into photos: one at a time, the most slide per byte first, each moves to a sharper rung it was already encoded at, and the file is measured again. A deck that fits at the sharpest rung is never padded toward the ceiling.
- Path coordinates in drawings (page content and groups) are rounded so no point moves more than 0.1 px at 3840 px across the slide, following each drawing's own scale. Drawings used by soft masks, patterns or Type 3 glyphs stay exact.
- Below the floor the deck is split into measured parts: the fewest emails, at the sharpest rung that still needs no more of them. The result says why (`quality-floor`, `not-photos`, `kept-images`, `browser-cannot-resize`) and where the lightest version's bytes are.
- Flatten (the nuke, only when the visitor asks): PDF.js (`src/lib/engine/pdfjs.ts`, loaded on demand) draws each slide at 2400 px, nested workers re-save it at eight rungs down to 1024 px (`src/lib/engine/flatpage.ts`), and each version is scored for clarity against the sharp drawing at 1920 px (`src/lib/engine/perceptual.ts`). `src/lib/engine/flatten.ts` steps slides down where it costs the least clarity per byte, never below a clarity floor, and writes an image-only PDF that QPDF tidies.
- Every result is re-read before it is offered: same page count, same page sizes, sound structure.
- The worker reports progress as `{ stage, fraction, label, page?, pages? }`; `fraction` never goes backwards. Stages are `inspect`, `tidy`, `photos`, `resize`, `verify`, `split` and `flatten`. Errors carry a `code` (`not-pdf`, `damaged`, `password`, `restricted`, `protected` with a `reason`, `too-big`, `page-too-large`, `engine`).
- `node scripts/engine-check.mjs` (after `npm run build` and `npm run corpus`) runs the built engine in Chromium on the synthetic corpus, served with the site's own `_headers` by `scripts/serve-dist.mjs`, and checks each deck's result, the progress events and that nothing leaves the origin. CI runs it and `npm run smoke` against the built site on every pull request.

The compression engine never receives user-controlled command-line arguments. A browser-job watchdog stops any job that goes 60 seconds without a progress event, so a pathological file never leaves the interface spinning forever while a big deck that keeps moving is never cut off. Large engine assets are bundled and self-hostable; see [THIRD-PARTY-LICENSES.md](THIRD-PARTY-LICENSES.md) and [PROVENANCE.md](PROVENANCE.md) before redistribution.

## Standalone deploy (optional)

The plain build in `dist/` can also run on its own Cloudflare Pages project. `.github/workflows/deploy-pages.yml` does that, by hand only, once its secrets are set. The checked-in `public/_headers` supplies a restrictive CSP and security headers. Never add an upload route. See [CLOUDFLARE.md](CLOUDFLARE.md).

## Privacy boundary

Document bytes are kept in memory only. They are not written to localStorage, IndexedDB, service-worker caches, URL parameters, cookies, or a server. Hosting providers can still see ordinary request metadata for HTML, JavaScript, CSS, and WASM assets; the app never sends the PDF itself. See [PRIVACY.md](PRIVACY.md).

## Current limitations

- Password-protected or permission-restricted PDFs, and PDFs containing forms, signatures, attachments, or scripts, are refused rather than silently rewritten. Export a flattened copy first.
- The page accepts PDFs up to 200 MiB (about 210 MB), or 80 MiB (about 84 MB) on devices reporting 2 GB of memory or less. Larger PDFs need splitting in the user’s PDF application first.
- Compression is tuned for presentation decks, not archival PDF optimization. Visual differences can occur in raster images; text and page geometry are checked.
- CMYK, indexed and other colour spaces, 1-bit images and JPEG 2000 are left exactly as they are, as are vector drawings (Figma's outlined text can be several MB of a deck).
- `npm run build` assumes the site is served at `/`; `npm run build:pitchdog` builds for `/email-my-deck/`. Any other path needs `EMD_BASE` set at build time.
- `frame-ancestors 'none'` is intentional. The standalone site should not be embedded in an iframe without a security review.

## License

The application code is licensed under the GNU Affero General Public License v3.0 or later. The repository keeps engine provenance, hashes, SBOM, and third-party notices alongside the source so a self-hosted build can be reproduced and its corresponding source can be found.
