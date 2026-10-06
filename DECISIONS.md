# Product and engineering decisions

These are the decisions behind the current implementation. They are here to prevent a future “improvement” from creating a false success.

| Decision | Chosen approach | Reason |
| --- | --- | --- |
| Where PDFs are processed | In the browser, inside a worker | The PDF never needs to reach a server; the worker prevents heavy WASM work from freezing the UI. |
| Product scope | One narrow job: make a deck email-ready | Fewer controls make the tool understandable to non-technical senders. |
| Mailbox target | Profiles plus custom limit | Provider and gateway limits vary. A single universal number creates false confidence. |
| Gmail option | Conditional Gmail-to-Gmail/Workspace profile | It can use a larger attachment budget, but recipients and gateways may still reject it. |
| Compression order | Original → lossless QPDF tidy → image ladder (3840, 2880, 2400, 1920, 1680, 1440 px across the slide) | Preserve the highest-fidelity candidate that fits; avoid needless lossy work. Each rung starts from the original, so nothing is compressed twice. |
| Squeeze before splitting (2026-10-06) | Go down to 1440 px across the slide, put leftover room back into the photos that cover the most slide per byte, and round drawing coordinates to 0.1 px at 3840 px | The team asked to squeeze every last drop while slides still look good at screen size: a split deck is ugly and the last resort. 1440 px is the lightest rung we still call good-looking on a laptop. |
| Image sizing (2026-10-06) | Pixels across the slide, measured from where each image is actually drawn | Deck exporters disagree about page size (Keynote 1920 pt, PowerPoint 960 pt, A4 595 pt), so DPI targets either wreck or ignore images. Images drawn somewhere we cannot follow keep their full size. |
| Engine (2026-10-06) | QPDF WASM plus the browser's image codecs; no Ghostscript | Ghostscript could not start inside the worker, was tuned for print, re-rendered every page, and cost a 17 MB download. QPDF changes only the images and leaves text, fonts and links byte for byte. |
| Quality floor | Split when a single readable file cannot fit | A tiny but unreadable deck is worse than two honest attachments. |
| Split policy (2026-10-06) | Fewest emails first, then the sharpest rung that needs no more of them, with a reason the page can explain | Each extra email is a real cost to the sender; the floor (1440 px across) still reads well on a laptop screen. When even the floor cannot fit, the sender is told what is in the way. |
| Protected PDFs | Refuse rewriting and ask for a flattened copy | Forms, signatures, attachments, scripts, and passwords can carry semantics that a compressor cannot promise to preserve. |
| Size estimate | Reserve space for MIME/base64 overhead and body text; every limit in decimal MB | The attachment bytes are not the same as the transmitted message bytes. Mail providers count 25 MB as 25,000,000 bytes, so custom limits do too. |
| Output names | `-email-version` and numbered `-part-XX-of-YY` suffixes | Users should know what a file is for before attaching it. |
| Hosting | A static page on pitch.dog, shipped from `bomkino/pitchdog-cloudflare-sites`; a standalone Pages deploy runs by hand only | No upload API, storage, database, or paid runtime is needed. |
| License | AGPL-3.0-or-later | Improvements to a hosted version remain available to the community. |
| Home and analytics (2026-10-06) | A page on pitch.dog at `/email-my-deck/`, using the site's Google Analytics tag with session replay off | The team wanted visit counts like every other pitch.dog page. The tool sends no file, file name or contents; copy says we count visits and never claims "no analytics". |

## Approaches deliberately rejected

- **Server-side upload and compression:** simpler for very large files, but it weakens the privacy promise and creates storage, deletion, abuse, and cost problems.
- **A giant “quality” settings panel:** powerful for experts, overwhelming for the intended user. The engine owns the bounded candidate ladder.
- **Always targeting 20 MB:** safe for some systems but needlessly conservative for others. Profiles explain the tradeoff instead.
- **Always targeting the largest Gmail attachment:** useful only in a conditional ecosystem and unsafe as a universal default.
- **Silently flattening protected PDFs:** unacceptable because the user may not notice a lost field, attachment, signature, or script.
- **Padding small files to reach the ceiling:** size closeness is not the goal when no quality benefit exists.

## The invariant to protect

The app should always be able to answer these three questions honestly:

1. Did the PDF stay on this device?
2. What mailbox assumption was used?
3. What changed, and can the user still read the result?
