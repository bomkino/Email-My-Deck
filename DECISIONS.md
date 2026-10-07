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
| Flatten, the nuke (2026-10-06) | Opt-in third way when a deck can't fit: PDF.js draws every slide, each is re-saved at eight rungs (2400 px at q82 down to 1024 px at q50), once by the browser's JPEG encoder and once by jpegli, and each version is scored for clarity at screen size; slides step down where it costs the least clarity per byte, never below a clarity floor of 0.7 | The team wanted a last resort before splitting or a link, squeezed hard but still clear. Photos lose little clarity per byte and small print loses a lot, so photos give way first. Below the floor small print stops reading, so the result is an honest miss instead. Never automatic, because text and links are lost. |
| Image encoders (2026-10-06) | jpegli (WebAssembly) for every JPEG, each searched to the lightest setting that still scores the rung's SSIMULACRA2 target on its worst tiles; Lanczos3 resizing; libdeflate level 12 for Flate. The browser's own encoders stay as the fallback, per image | The team asked for max minmax: smallest decks that still look good, speed be damned. Matched per image, jpegli needs 10 to 16% fewer bytes than the browser's JPEG; a fixed setting can't do that without letting some photos look worse. Scoring tiles keeps a 4K photo's check as cheap as a small one's. MozJPEG was slower and no smaller; palette PNG, font trimming and dedupe found nothing to win. Each encoder is a small file fetched only when a deck needs it. |
| Speed (2026-10-06) | Care over speed: a big deck takes minutes, and the page says so up front, in the waiting card and in the FAQ | The team said speed doesn't matter, only the result. Each photo is encoded up to six times per rung and scored, about ten times the work of one browser encode, all on the sender's device. The progress bar hears from the engine at least every second, and the watchdog only counts visible time, so a long run is never mistaken for a stuck one. |
| Image sizing (2026-10-06) | Pixels across the slide, measured from where each image is actually drawn | Deck exporters disagree about page size (Keynote 1920 pt, PowerPoint 960 pt, A4 595 pt), so DPI targets either wreck or ignore images. Images drawn somewhere we cannot follow keep their full size. |
| Engine (2026-10-06) | QPDF WASM plus WebAssembly image encoders (the browser's own codecs as fallback); no Ghostscript | Ghostscript could not start inside the worker, was tuned for print, re-rendered every page, and cost a 17 MB download. QPDF changes only the images and leaves text, fonts and links byte for byte. |
| Quality floor | When a single readable file cannot fit, say why and let the sender choose: one link, parts split where they pick, or a flattened deck | A tiny but unreadable deck is worse than two honest attachments. Each way costs something different, so the sender decides with the costs in front of them. |
| Split policy (2026-10-06) | Fewest emails first, then the sharpest rung that needs no more of them, with a reason the page can explain | Each extra email is a real cost to the sender; the floor (1440 px across) still reads well on a laptop screen. When even the floor cannot fit, the sender is told what is in the way. |
| Protected PDFs | Refuse rewriting and ask for a flattened copy | Forms, signatures, attachments, scripts, and passwords can carry semantics that a compressor cannot promise to preserve. |
| Size estimate | Reserve space for MIME/base64 overhead and body text; every limit in decimal MB | The attachment bytes are not the same as the transmitted message bytes. Mail providers count 25 MB as 25,000,000 bytes, so custom limits do too. |
| Output names | `-email-version` and numbered `-part-XX-of-YY` suffixes | Users should know what a file is for before attaching it. |
| Hosting | A static page on pitch.dog, shipped from `bomkino/pitchdog-cloudflare-sites`; a standalone Pages deploy runs by hand only | No upload API, storage, database, or paid runtime is needed. |
| License | AGPL-3.0-or-later | Improvements to a hosted version remain available to the community. |
| Home and analytics (2026-10-06) | A page on pitch.dog at `/email-my-deck/`, using the site's Google Analytics tag with session replay off | The team wanted visit counts like every other pitch.dog page. The tool sends no file, file name or contents; copy says we count visits and never claims "no analytics". |
| Page layout (2026-10-07) | Headline, then the tool, then everything else; the mailbox setting as four cards in plain sight | People testing the page found the side-by-side hero confusing on desktop and never saw the mailbox setting behind a "Change" link. The tool now sits centred under the headline as three numbered steps (where it's going, add your deck, what comes back), Most mailboxes already picked. Its glow is decoration only: without WebGL, with reduced motion or on Save-Data, a still CSS glow stays. |

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
