# Changelog

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
