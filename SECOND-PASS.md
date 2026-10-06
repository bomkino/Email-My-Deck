# Second-pass audit

This is a re-check of the original product thesis. The important change is that this is not primarily a generic PDF compressor. It is an email-ready deck optimizer.

## The problem we should actually solve

The user does not want “a smaller PDF.” They want to answer three questions without understanding PDFs or email protocols:

1. Will this file probably arrive as an attachment?
2. Will the deck still look good when someone opens it?
3. If one file cannot satisfy both constraints, what should I do next?

The product should optimize those answers, in that order, while keeping all document bytes on the user's device.

A universal target remains impossible. Provider caps differ, some limits are measured before MIME encoding and some systems enforce encoded message limits, body/signature text consumes room, and recipient gateways may be stricter than the sender. A 20 MB PDF can become roughly 27.4 MB in transit under MIME Base64. The UI must show this as an estimate and never use “guaranteed delivery” language.

## Revised default profiles

The default should be one simple action: Make email-ready.

When the user has no provider information, use the balanced profile:

- label: Common 25 MB mail systems
- target PDF: 17.5 MB
- estimated encoded message: about 24 MB before the user's email body and provider-specific behavior
- confidence: likely for common 25 MB systems, not guaranteed

Keep a strict profile available:

- label: Strict 20 MB limits
- target PDF: about 14 MB
- estimated encoded message: about 19–20 MB
- use for iCloud, older Outlook clients, and company gateways

Keep the Gmail profile advanced:

- label: Gmail / Google Workspace maximum
- target PDF: 23–24 MB
- warning: Gmail's sender limit is not a recipient guarantee; another provider can reject the message or a managed account can use different limits

Do not call the Gmail profile “unsafe.” Say exactly what is conditional. Do not expose the 50 MB Enterprise Plus case in the first release; it is plan-, admin-, rollout-, web-, and recipient-dependent.

Provider values belong in versioned data with a source URL, checked date, unit, whether the cap is pre- or post-encoding, and a caveat. Use bytes internally and round only in the interface.

## What the first thesis understated

### Compression is not the only success path

The product needs three outcomes:

- one optimized PDF;
- multiple individually sendable PDF parts;
- an honest “this cannot fit without damaging the deck” result.

Splitting should be content-aware where possible. Page count alone is a poor balance because one page may contain a full-bleed photograph. Measure candidate part sizes, preserve page order, and name files with the pattern name-email-part-01-of-02.pdf. Give users a copyable subject/body suggestion so they know how to send the parts in order.

If one page alone cannot fit the target, say so. Do not keep lowering quality forever.

### “Preserve quality” needs a definition

The default must preserve text selection, search, vector graphics, slide dimensions, and ordinary links/bookmarks. The tool should inspect forms, signatures, embedded files, JavaScript, annotations, colour profiles, transparency, and fonts before choosing a lossy engine.

A rewritten PDF can invalidate digital signatures and alter interactive content. The original must remain available, and the result must say what changed.

Whole-page PDF-to-canvas rasterization should be an explicit emergency option, never the default. It makes a file look like slides while removing useful document behavior.

### Privacy includes the deployment, not only the algorithm

“No upload” is an architectural promise about PDF bytes, not a claim that a website has no network traffic. The production site should:

- ship all application code and WASM from our own origin;
- avoid third-party scripts, fonts, upload SDKs, analytics, and error reporters;
- use a restrictive CSP and pinned integrity hashes;
- avoid putting PDFs in localStorage, IndexedDB, service-worker caches, URLs, or query strings;
- revoke object URLs and terminate workers after each job;
- provide an offline/PWA build and a self-hostable release;
- document that normal hosting/CDN request logs can still contain IP addresses and asset requests;
- include a visible network test and source links so the privacy claim can be checked.

The app should never silently fall back to a server when a phone runs out of memory.

### “Free” has a bandwidth cost

Client-side processing avoids compute, storage, and deletion infrastructure, but a Ghostscript WASM bundle is large. Lazy-load it only after the user starts compression, serve immutable compressed assets, cache them, and measure bandwidth before choosing a hosting arrangement. Free static hosting may be sufficient at modest traffic, but the project should not pretend the service has zero operating cost. Donations or sponsorship can be considered later without adding ads or tracking.

## Revised engine plan

Use a two-tier engine:

1. Lower-risk path: QPDF-WASM validation, structural optimization, Flate recompression, object streams, and image JPEG optimization where it makes the file smaller. Stop here when the target is reached.
2. Strong path: Ghostscript-WASM with controlled image downsampling and JPEG quality search, only after preflight says the document is an ordinary deck and the user accepts the possibility of semantic changes.

QPDF does not resample image dimensions, so it cannot solve every large photo deck by itself. Ghostscript's pdfwrite is powerful but can change colours, transparency, fonts, forms, annotations, attachments, and signatures. The worker must pass fixed arguments, use safe mode, expose no arbitrary command line, enforce timeouts, and run with an in-memory virtual filesystem.

For the Ghostscript distribution, prefer a pinned, auditable browser wrapper with worker isolation, provenance, SBOM, and third-party notices. Ghostscript remains AGPL-licensed even when the JavaScript wrapper is permissively licensed. Publish the corresponding source/build recipe and notices, and get a legal review before presenting the overall application license.

The long-term permissive alternative is a maintained image-object rewriting layer based on QPDF or pdfcpu. That is more engineering work but could reduce licensing friction. It should be evaluated after the first measured prototype, not assumed to exist.

## Evaluation that would prove the product

Build a synthetic and properly licensed corpus containing:

- vector-only pitch decks;
- photo-heavy decks;
- scanned pages;
- charts, transparency, CMYK, and indexed images;
- multilingual and unembedded fonts;
- forms, links, bookmarks, annotations, attachments, encryption, and signatures;
- already-optimized PDFs;
- files large enough to stress mobile memory.

For each profile, record output bytes, encoded-size estimate, page count, text extraction, link/annotation counts, image resolution, processing time, peak memory, and rendering differences at normal and high zoom. Add human review for a representative slide set. Test current Chrome, Safari/iOS, Firefox, and mobile Chromium.

The release bar is not a dramatic compression percentage. It is predictable behavior: the app gets the largest readable file it can, explains what it preserved, and offers a sensible next action when it cannot meet the target.

## What should remain out of scope

Do not add email OAuth, server uploads, Office conversion, a general PDF toolbox, password recovery, or silent cloud-link creation. Those features weaken the single-purpose privacy story.

The next implementation slice should be the smallest measurable vertical path: local file inspection, provider target math, QPDF-WASM lossless output, PDF.js verification, deterministic filenames, and a test corpus. Add Ghostscript only after that path can prove preservation and failure behavior.
