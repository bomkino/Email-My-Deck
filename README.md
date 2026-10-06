# Email My Deck

A local-first, open-source PDF compressor for sending presentation decks as email attachments.

Drop a deck in the browser and download the best-looking email-sized version. The app is designed to process files on the user's device, preserve selectable text and vector artwork, account for email encoding overhead, and explain when compression is no longer a good trade.

The product direction and research are in [PRODUCT-THESIS.md](PRODUCT-THESIS.md). The second review and corrected decisions are in [SECOND-PASS.md](SECOND-PASS.md).

This repository is currently in discovery. The first implementation slice will establish a Web Worker pipeline, QPDF-WASM lossless optimization, PDF.js preview/verification, provider-aware byte targets, and a corpus-driven quality harness before the public UI is finalized.

## Principles

- Free to use, with no account requirement.
- Local-first: PDF bytes do not need to leave the device.
- Honest about provider limits and visual tradeoffs.
- Preserve text, vectors, links, and page structure whenever possible.
- Keep the original file untouched.
- Open source with complete third-party notices and reproducible builds.

## Scope

The first release is intentionally a single-purpose tool. It compresses PDFs for email, names the output with `-email-version.pdf`, and offers a page-balanced split when a readable file cannot fit the selected target.

It does not send email, upload a fallback copy, convert Office files, or promise to preserve digital signatures after rewriting.
