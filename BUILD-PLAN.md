# Email My Deck — build plan

This plan assumes:

- Common 25 MB mail systems are the default target: 17.5 MB PDF.
- Strict 20 MB and Gmail-specific profiles are advanced options.
- The application is open source and may ship QPDF plus AGPL Ghostscript.
- First launch supports current desktop and mobile browsers.
- The first release is one PDF at a time, local-only, with split fallback.

## The first live version

A user can:

1. Drop or choose one PDF.
2. See its original size and page count.
3. Click Make email-ready.
4. Watch local progress and cancel safely.
5. Download a verified PDF named with email-version.
6. See actual output size, estimated transmitted size, and what was preserved.
7. Receive a readable best attempt or measured split parts when one file cannot fit.
8. Use the app without an account, upload, email address, or cloud integration.

The default flow should have one result and one download action. Advanced profiles, previews, metadata controls, and technical details stay secondary.

## Scope for v1

Included:

- PDF validation and feature inspection;
- QPDF structural optimization;
- controlled image recompression/downsampling;
- PDF.js preview and verification;
- target-size candidate search;
- profiles for common 25 MB, strict 20 MB, Gmail-specific, and custom size;
- deterministic output filenames;
- page-balanced splitting;
- text/link/page-count checks;
- encrypted, signed, malformed, unsupported, cancelled, and resource-limit states;
- privacy page, source links, third-party notices, and offline/self-hostable build.

Deferred:

- email sending and OAuth;
- Office, PowerPoint, Keynote, Canva, or Figma conversion;
- bulk processing;
- generic PDF editing;
- server fallback;
- automatic cloud links;
- password recovery;
- whole-page rasterization as a default path.

## Architecture

The page handles selection, simple status, previews, and downloads.

A dedicated worker handles parsing, candidate generation, compression, verification, cancellation, and cleanup.

The low-risk pipeline runs first:

- validate the PDF;
- preserve the original bytes;
- run structural QPDF optimization;
- optimize eligible image streams only when measured output improves;
- stop if the result meets the target without unnecessary visual change.

The strong pipeline runs only when needed and only for ordinary presentation PDFs:

- lazy-load the Ghostscript WASM engine;
- use fixed, reviewed arguments;
- use safe mode and an in-memory filesystem;
- test a bounded set of DPI and quality candidates from the original;
- keep the highest-fidelity candidate under the target;
- run a final verification pass.

Special files such as signed PDFs, forms, embedded files, unusual annotations, encrypted files, and unsupported color/font features require a warning, a preservation path, or a clear refusal. They must never be silently rewritten.

## Quality policy

Optimize fidelity under the size ceiling. Do not optimize for the largest file.

Quality evidence should include:

- page count and dimensions;
- extracted text on representative pages;
- link and annotation checks;
- representative renders at normal and high zoom;
- preservation or loss of forms, signatures, attachments, and metadata;
- exact output bytes and estimated transmitted size.

Do not claim a global “quality score.” Show a clear result and disclose uncertainty.

## Test corpus

Before public launch, create or obtain properly licensed examples covering:

- vector-only decks;
- photo-heavy decks;
- scans;
- charts and small text;
- screenshots and QR codes;
- transparency and CMYK;
- multilingual and unembedded fonts;
- links, bookmarks, forms, annotations, attachments;
- encrypted and signed files;
- already-optimized files;
- malformed files;
- large files on mobile-sized memory budgets.

Use unseen holdout files for final evaluation. Record size, visual changes, semantic changes, time, memory, failures, and target outcomes.

## Privacy and operations

- Self-host application and WASM assets.
- Do not include analytics, session replay, third-party fonts, upload libraries, or error reporters.
- Do not persist document bytes.
- Add browser request-interception tests for every flow.
- Offer an offline build.
- Publish source, lockfile, build instructions, engine versions, notices, hashes, and SBOM/provenance.
- Pin provider-limit sources with checked dates.
- Lazy-load the large engine and measure bandwidth.
- Track hosting quotas and define a stop before paid overages.
- Publish a clear privacy policy that explains hosting logs and downstream email-provider handling.

## Launch gates

Do not call the app live until:

- the core flow works on supported Chrome, Safari/iOS, Firefox, and mobile Chromium;
- output files reopen successfully;
- original-under-target files remain byte-identical;
- split parts are individually measured;
- cancellations release workers and object URLs;
- no PDF bytes leave the browser in automated tests;
- the privacy and license pages match the shipped build;
- strong compression has been tested on the holdout corpus;
- unsupported and failed cases produce actionable messages;
- a fresh reviewer can use the app without reading implementation documentation.

## Estimate

Assuming one experienced engineer working full-time:

- 1–2 days: repository setup, app shell, file flow, filename handling.
- 3–5 days: worker boundary, local inspection, QPDF pass, target math.
- 3–5 days: preview, verification, result states, split fallback.
- 4–7 days: Ghostscript integration, candidate search, feature warnings.
- 3–5 days: corpus harness, browser/device testing, performance work.
- 2–4 days: privacy, licensing, offline build, deployment, launch polish.

That is approximately 3–5 weeks to a credible public beta and 6–8 weeks to a polished first release with broad edge-case coverage. A fast desktop-only beta could be live in 7–10 working days, but it would defer mobile reliability, deep fidelity checks, and several special-PDF cases.

The build should start with the local vertical slice and corpus harness, not visual polish. The engine and quality policy should be chosen from measured results before the final interface is locked.
