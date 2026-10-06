# Confirmed decisions

- Default target: Common 25 MB mail systems, aiming for a 17.5 MB PDF.
- Compression: QPDF first, then Ghostscript when stronger reduction is needed.
- Launch bar: desktop and mobile beta with core edge cases.
- Product remains local-only, free, open source, and single-purpose.

The default is a best-effort profile for common 25 MB systems, not a universal delivery guarantee. Strict 20 MB and Gmail-specific profiles remain advanced options.

Ghostscript's AGPL obligations are acceptable for this project. We will publish the corresponding source/build recipe, licenses, notices, and provenance, and keep Ghostscript behind a measured worker pipeline.
