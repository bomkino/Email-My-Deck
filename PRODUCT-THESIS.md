# Email My Deck — product thesis

Status: discovery, October 2026

Email My Deck should do one thing well: turn a presentation PDF into the largest readable version that is likely to arrive as a normal email attachment.

The tool must be local-first. A user drops a PDF into the page, chooses a simple delivery target when needed, waits while the browser works, and downloads a file named with `-email-version.pdf`. The original file is never replaced.

## The actual problem

“Under 25 MB” is not a universal delivery guarantee.

- Personal Gmail documents a 25 MB total attachment limit and replaces larger attachments with a Google Drive link. [Gmail Help](https://support.google.com/mail/answer/6584?hl=en)
- Outlook.com documents a 25 MB file attachment limit, while Microsoft’s Outlook guidance for internet accounts describes a 20 MB message limit including the body and attachments. [Outlook.com limits](https://support.microsoft.com/en-us/outlook/sending-limits-in-outlook-com), [Outlook attachment guidance](https://support.microsoft.com/en-us/outlook/reduce-attachment-size-to-send-large-files-with-outlook)
- Yahoo Mail documents a 25 MB total attachment limit. [Yahoo Help](https://help.yahoo.com/kb/SLN5673.html)
- iCloud Mail documents a 20 MB direct message limit; Mail Drop is a separate link-based service, not a universal SMTP attachment allowance. [Apple iCloud limits](https://support.apple.com/en-au/102198), [Mail Drop](https://support.apple.com/en-us/108329)
- Work and school accounts can be administrator-configured. Google documents 25 MB for several Workspace editions and up to 50 MB for Enterprise Plus web Gmail, but that is plan-, admin-, sender-, and recipient-dependent. [Google Workspace sending limits](https://knowledge.workspace.google.com/admin/gmail/gmail-sending-limits-in-google-workspace), [Workspace update](https://workspaceupdates.googleblog.com/2026/02/ending-larger-attachments-in-gmail-new-50MB-limit-for-Enterprise-Plus.html)
- MIME Base64 encoding expands binary attachments by about 33% and wraps lines at 76 characters. [RFC 2045](https://www.rfc-editor.org/rfc/rfc2045.html)

The product therefore has to distinguish:

1. the PDF bytes on disk;
2. the estimated encoded message size; and
3. the recipient/provider's unknown policy.

It must never promise that a downloaded file will be accepted by every recipient.

## Product promise

“Drop your deck. We make the best-looking email-sized PDF we can, on your device. If it cannot fit safely, we tell you why and split it for you.”

The default experience should have one primary action and one quiet advanced control:

1. Drop or choose a PDF.
2. Show the filename, page count, and current size.
3. Default to **I do not know the recipient's provider**.
4. Compress locally.
5. Show before/after PDF size, estimated encoded size, pages preserved, and a small visual preview.
6. Download `original-name-email-version.pdf`.
7. If the target cannot be reached without a visibly bad result, offer page-balanced parts and explain the tradeoff.

## Delivery profiles

The UI should avoid making everyone understand MIME. The advanced explanation can be one sentence below each profile.

| Profile | PDF target | Use |
| --- | ---: | --- |
| Maximum compatibility | 14–15 MB | Unknown recipient, strict corporate gateways, iCloud-like 20 MB caps. This leaves room for encoding and message text. |
| Common 25 MB limits | 17–18 MB | Gmail/Yahoo/Proton/Outlook.com style limits when the recipient is not known to be strict. Label this “best effort,” not guaranteed. |
| Gmail personal / Workspace Standard | 23–24 MB | Gmail’s own documented 25 MB sending rule. Warn that the recipient or an intermediate server can still reject it. |
| Gmail Enterprise Plus web | 45–49 MB | Advanced, only when the account and recipient are known to support it. Never show this as a default. |
| Custom | user value | For a known company gateway or an explicit attachment budget. |

The product should show an estimated wire size such as “17.8 MB PDF ≈ 24.4 MB in email” and keep at least a small body/header margin. The estimate is guidance, not a protocol guarantee.

A future provider table should be data-driven, versioned, and easy to update. It should carry the source URL, the date checked, whether the cap is pre- or post-encoding, and a confidence note. The UI should say “limits change” and expose the source in the help panel.

## What “best visual deck” means

A deck is not a scanned document. A useful email version should preserve:

- selectable and searchable text;
- vector shapes, charts, and logos;
- font appearance and page dimensions;
- hyperlinks, bookmarks, and ordinary annotations where possible;
- page count and order;
- transparency and colour well enough for screen viewing.

The main size lever is usually embedded raster imagery. The compressor should downsample images to a screen-appropriate effective DPI and recompress them, while leaving vector content alone. Whole-page rasterization is a last resort because it destroys text selection, accessibility, links, forms, and often signatures.

The tool must detect and explain files that are special:

- encrypted or password-protected PDFs;
- digitally signed PDFs (rewriting invalidates signatures);
- interactive forms, JavaScript, attachments, or unusual annotations;
- already-optimized PDFs;
- decks whose size is mostly vector or font data and therefore cannot shrink much without changing the document.

If a PDF is signed, the default should be to stop and say that any compressed copy will not retain the original signature. If the user explicitly continues, the output filename and result card should make that loss visible.

## Compression pipeline

Use a staged pipeline in a dedicated Web Worker.

### Pass 0: validate and inspect

Read the local bytes, identify the PDF, count pages, detect encryption/signatures/forms, and inventory image streams. Do not execute PDF JavaScript. Set explicit memory and page-count limits so a hostile or pathological file cannot lock up the tab.

Use PDF.js for rendering and inspection previews. PDF.js is Apache-2.0 and is a parser/renderer, not a compressor. [PDF.js](https://github.com/mozilla/pdf.js)

### Pass 1: lossless structural cleanup

Run QPDF compiled to WebAssembly:

- generate compressed object streams;
- recompress Flate streams where useful;
- deduplicate objects/images where supported;
- optionally remove non-content metadata only when the user chooses it;
- linearize only when it does not make the target larger.

QPDF is Apache-2.0 and explicitly supports image optimization, but it does not downsample image dimensions. [QPDF](https://qpdf.readthedocs.io/en/stable/cli.html), [QPDF license](https://qpdf.sourceforge.io/)

If this pass reaches the target, stop. Do not apply lossy processing to a file that already fits.

### Pass 2: deck-safe lossy candidates

Use Ghostscript `pdfwrite` in a worker for candidates with controlled image resolution and JPEG quality. Ghostscript documents `screen`, `ebook`, `printer`, `prepress`, and `default` settings, but also warns that presets alter input and that the highest fidelity is the default/no-preset path. [Ghostscript vector devices](https://ghostscript.readthedocs.io/en/latest/VectorDevices.html), [Ghostscript optimization notes](https://ghostscript.com/blog/optimizing-pdfs.html)

Do not expose arbitrary Ghostscript arguments to the browser. Maintain a small, reviewed set of presets, for example:

- high: 180–220 DPI, high JPEG quality;
- balanced: 140–170 DPI, medium-high quality;
- compact: 100–130 DPI, medium quality;
- emergency: 72–96 DPI, lower quality, explicit warning.

The exact values must be tuned against a representative deck corpus rather than guessed.

Generate candidates and choose the highest-quality candidate under the target. A binary search over image quality/resolution can reduce work, but PDF overhead is not perfectly monotonic, so every candidate must be measured. Use a final safety margin instead of aiming at the exact byte ceiling.

### Pass 3: verification

For the chosen output:

- reopen it with a second parser;
- verify page count and page dimensions;
- extract text from representative pages and compare that text is still present;
- check that the output is not encrypted unexpectedly;
- render a contact sheet and a few image-heavy/text-heavy pages;
- report whether forms, links, annotations, and signatures survived;
- verify the output byte size and estimated encoded size.

A quality score can rank candidates, but a human-readable preview and an explicit “text remains selectable” check are more trustworthy than a made-up percentage.

## Split fallback

Compression is not magic. When no candidate can meet the target without unacceptable visual loss:

1. keep the best readable compressed PDF;
2. propose splitting by page boundaries;
3. balance parts by measured output bytes, not just page count;
4. preserve order and include a short part index page only if it fits the budget;
5. name files `original-email-part-01-of-02.pdf`, etc.;
6. show each part's PDF size and estimated encoded size;
7. offer a one-click ZIP only as an optional convenience, since some recipients block archives;
8. mention link-based alternatives such as Drive, OneDrive, or Mail Drop without uploading anything on the user's behalf.

A split is often better than turning a legible deck into a blurry one. The result screen should say that plainly.

## Privacy and security contract

The strongest claim is verifiable and narrow:

- No PDF bytes are sent to our servers.
- No account is required.
- No analytics request is made while a file is selected or processed.
- The app can be installed as a PWA and used after its assets are cached.
- Original and output files exist only in the browser's memory/download flow unless the user saves them.
- Object URLs and worker memory are explicitly released after download or cancel.
- The source, build instructions, dependency lockfile, third-party notices, and exact WASM hashes are public.

“Client-side” is not enough by itself. The site should ship a restrictive Content Security Policy, Subresource Integrity for any unavoidable external asset, no third-party upload SDKs, and a visible “0 bytes of your PDF sent” explanation linked to a small network test. A privacy page should describe the limits of the claim: the browser, extensions, operating system, and the user's eventual email provider are outside our control.

PDF processing is an attack surface. Pin and update the WASM engines, fuzz malformed PDFs, run the engine in a worker, use Ghostscript's safe mode, reject unexpected output, and keep the worker API to fixed commands. Never pass user-controlled command-line strings to Ghostscript.

Ghostscript is AGPL-licensed; QPDF is Apache-2.0. If Ghostscript is shipped, the repository must include its corresponding source/build recipe and notices and the whole application must satisfy the AGPL obligations. If that is not acceptable, ship a QPDF-only lossless mode and document that strong downsampling requires the AGPL engine. [Ghostscript licensing](https://ghostscript.com/faq/index.html)

## UX details that matter

- The drop zone should say “Your file stays on this device.”
- Show progress by phase (“reading,” “trying high quality,” “checking output”), not a fake percentage.
- Never hide a failure behind a generic “something went wrong.” Distinguish encrypted, signed, malformed, too large for this device, and “could not reach target.”
- Offer a “keep text/vector quality” toggle only in advanced settings; it should be on by default.
- Offer “remove metadata” as an explicit choice with a short explanation.
- Preserve the original basename and replace unsafe filename characters; always append `-email-version.pdf`.
- Support keyboard selection, drag and drop, screen readers, reduced motion, narrow screens, and touch devices.
- Do not make users compare four mysterious quality sliders. The profiles above are enough for the first release.

## What to measure before launch

Build a small, licensed or synthetic corpus of presentation PDFs:

- vector-heavy pitch decks;
- photo-heavy decks;
- charts and transparency;
- scanned decks;
- already-compressed decks;
- fonts with non-Latin text;
- forms/links/annotations;
- signed and encrypted examples.

For every corpus item and target profile, record:

- output bytes and estimated wire bytes;
- page count and text extraction;
- image effective DPI and JPEG quality;
- render comparisons at 100% and 200% zoom;
- processing time and peak memory on desktop and mobile browsers;
- whether the pipeline preserved links, annotations, forms, and colour.

A release is not ready because one sample shrank by 80%. It is ready when the tool is predictable about what it can and cannot preserve.

## Deliberate non-goals for the first release

- No server-side fallback that silently receives documents.
- No email sending or Gmail/Outlook OAuth.
- No Office/PPTX conversion.
- No password cracking or signature preservation promises.
- No arbitrary PDF editing suite.
- No “90% smaller” marketing claim.
- No forced cloud link as a substitute for an attachment.

## First implementation slice

1. Set up a small TypeScript web app with a worker boundary.
2. Add file selection, local metadata inspection, original preservation, and deterministic filename generation.
3. Integrate QPDF-WASM for a lossless pass and PDF.js for preview/verification.
4. Add provider profiles and wire-size estimation as pure, unit-tested functions.
5. Add the Ghostscript-WASM candidate engine behind a feature flag.
6. Build a corpus-driven harness that runs candidate profiles and emits size/fidelity reports.
7. Only then polish the one-screen UX and publish the privacy proof.

The success criterion for the first public version is not “it always gets under 25 MB.” It is: “a non-technical person can obtain the largest readable email version available, understand the tradeoff, and never wonder whether their deck was uploaded.”
