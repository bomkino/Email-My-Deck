# Changelog

## Unreleased — engine rebuild

- Replaced Ghostscript with QPDF plus the browser's own image codecs. Text, fonts and links are never re-rendered; only images are rewritten, once each, by object number.
- Sized images in pixels across the slide, measured from where each image is drawn, with a four-rung ladder (3840, 2880, 2400, 1920 px) and a split below the floor.
- Fixed LibreOffice-style decks (every page sharing one resource dictionary) that timed out, and split parts that carried every image.
- Stopped refusing clean files: structure, forms, signatures, attachments, scripts and encryption are read through QPDF's JSON instead of a byte scan. Permission-restricted files are now told apart from password-protected ones.
- Custom limits are decimal MB, like the presets; sizes are shown in decimal units.
- Progress events with a stage and a fraction that never goes backwards; error messages carry a code. Optional `autoSplit` splits in the same job.
- Spread image work over nested workers; the 50 MB audit deck went from three emails in 33 s to one file in about 7 s.
- Added CI on every pull request: tests with real QPDF WASM, the build, an engine check of the built site in Chromium, and the page smoke test, all against the shipped headers.

## Current release — privacy and handoff hardening

- Moved Ghostscript and output inspection into the PDF worker.
- Added job IDs, worker replacement, cancellation, watchdog timeout, and stale-result guards.
- Rebuilt split parts from clean source page ranges and rejected oversized single pages.
- Added parsed protected-feature detection for forms, signatures, attachments, scripts, and passwords.
- Added page-count and page-geometry verification.
- Corrected common/strict raw budgets and made Gmail’s conditional behavior explicit.
- Added output filename visibility, dynamic split counts, separated subject/attachment plans, clipboard failure guidance, and custom-limit mobile layout.
- Added focus management, modal keyboard handling, reduced-motion support, focus-visible styles, favicon, cache headers, provenance, SBOM, and CI browser smoke.
- Added PDF inspection and splitting regression tests.

## Initial release

- Built the local-first React/Vite app and responsive upload/result/split states.
- Added QPDF and Ghostscript WASM candidate engines.
- Added synthetic corpus generation and local privacy smoke testing.
- Added Cloudflare Pages deployment workflow and source-link disclosure.
