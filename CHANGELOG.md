# Changelog

## Unreleased

- The moment a deck is dropped, the page says what it will weigh as an email against the mailbox picked, including the deck that looks under 25 MB but isn't. The ready screens confirm it: why the deck had to change, or that it fits, packing and all.
- When a deck can't fit one email, the page says so, gives the reason and the lightest size reached, then offers one link (our pick) before the parts, and Gmail to Gmail when that would fit. Splitting is the last resort.
- Nothing is split until the visitor chooses to. The split card starts at parts of about the same size, lets them move each split with a slider, and shows every part's size before anything is made. A part that would be too big is flagged, and the button waits until it fits. From the parts, "Change where it splits" goes back to the choice.
- Engine: a result that doesn't fit carries `splitPlan` (`sharedBytes`, `pageBytes`), measured after QPDF gives each page only the resources it uses. On a 66-slide design-tool deck it lands within 2% of the real parts. `split` takes `breakAfter` to split exactly there and marks each part's `fits`. A split the visitor starts gets the whole progress bar.
- The page speaks the squeeze: the receipt says photos went "to at least" the lightest size used (the fill makes many sharper) and owns up to trimmed drawings; the can't-fit reason says how much of the deck we can only trim, or keep exactly, when the engine reports `weight`; the last pass gets its own step words ("Spending the room left on sharper photos"); and "an 8 MB limit" reads as said.

### Engine: flatten (the nuke)

When a deck can't fit one email, the page can now offer a third way: turn every slide into one picture and squeeze those. It only runs when the visitor asks for it. Text stops being searchable and links stop working, but the deck stays one file. In Chrome, the 24 MB Figma deck flattens to one 13.9 MB file for strict 20 MB mailboxes with every slide still 2400 px across, in about 45 s. At a 6 MB limit it still fits, with no slide below 1216 px.

- PDF.js draws each slide at 2400 px in the PDF worker, on its own nested worker for parsing. Fonts are drawn as outlines. The standard fonts, CMaps and the JPEG 2000 and JBIG2 decoders are bundled files, fetched only when a deck needs them, so nothing leaves the browser. They are loaded only when someone flattens.
- Each slide is re-saved at eight rungs, from 2400 px at JPEG quality 82 down to 1024 px at 50, on a few nested workers while the next slide is drawn. Full size at low quality comes before smaller sizes: on a screen it reads sharper for the same bytes.
- Every version is scored against the sharp drawing at screen size, 1920 px across. The score is structural similarity of 8×8 blocks of luminance, weighted by how much contrast each block holds and pulled down by the worst-hit 5% (`src/lib/engine/perceptual.ts`).
- Slides step down where a step gives up the least clarity per byte saved, so photos give way before small print. Room the last step left goes back where it helps most.
- No slide goes below a clarity floor (0.7, set by eye: 8 pt text on a 16:9 slide still reads cleanly at screen size). When even that doesn't fit, the result comes back over budget (`fits: false`) with the lightest size reached, instead of as mush.
- `compress` takes `mode: 'flatten'`, and the result is `candidate.engine: 'flattened'` with `receipt.flatten` (`pages`, `longEdgePx` and `jpegQuality` of the lightest slide, and the lowest `clarity`). Progress has a `flatten` stage with slide counts. `ENGINE_FEATURES.flatten` is on.
- Protected PDFs (forms, signatures, attachments, scripts, restrictions) are still refused, flattened or not.

### Engine: squeeze before splitting

Splitting is now the last resort. In Chrome, all eight audit decks and that 24 MB Figma deck fit one email at both 20 MB and 25 MB. The Figma deck comes back as 13.9 MB for strict 20 MB mailboxes (no photo below 1680 px across the slide, most at 1920) and 17.3 MB for 25 MB ones (none below 1920, most at 2400). Before, it was two emails at 20 MB.

- Two lighter rungs: the ladder is now 3840, 2880, 2400, 1920, 1680 and a 1440 px floor, the lightest we still call good-looking on a laptop.
- Leftover room goes back into photos. Once a rung fits, photos move up to sharper rungs one at a time, most slide covered per byte first, and the result is measured again. When estimates ran high and real room is left, the next sharper rung is encoded for the whole deck and filled again. A deck that fits at the sharpest rung is never padded.
- Drawings lose precision nobody can see. Path coordinates on pages and in groups are rounded so no point moves more than 0.1 px at 3840 px across the slide, following each drawing's own scale. Groups used by soft masks, patterns or Type 3 glyphs, and pages we cannot follow, stay exact. The Figma deck's outlined text is 2.2 MB lighter. Under 64 KB saved in all, nothing is touched.
- Decks whose pages share one resource dictionary now get their photos resized: an image a page names but never draws no longer blocks it, unless something on that page could draw it in a way we do not follow.
- When even the floor cannot fit, the result says why (`splitReason`: `quality-floor`, `not-photos`, `kept-images` or `browser-cannot-resize`) and where the lightest version's bytes are (`weight`: photos, images kept as they are, everything else).
- The receipt names the lightest rung any photo ended on, and `receipt.paths` says how many drawings were rounded and what that saved.

### Engine: decks from design tools

A 24 MB Figma deck run through iLovePDF came back as two emails (17.5 + 6.9 MB), because the engine never touched most of its pictures. It now comes back as one 16.9 MB file in Chrome.

- Photos inside groups (form XObjects, nested any depth) are found, sized from where they are drawn, and rewritten. Before, only images named on the page itself were.
- JPEGs that a PDF compressor deflated a second time (`[/FlateDecode /DCTDecode]`, as iLovePDF writes them) are unwrapped and rewritten instead of skipped.
- Soft masks follow their images: same pages, same placements, resized with them.
- Gray photos, and masks that were already JPEGs, become one-channel JPEGs written by the engine itself (`src/lib/engine/grayjpeg.ts`), because canvas only writes three-channel JPEGs. A 2.2 MB mask in that deck is now 0.8 MB. Masks stored losslessly stay lossless.
- 16-bit images are rewritten as 8-bit instead of skipped.
- Split estimates count images reached through groups.
- New synthetic corpus deck, `design-tool-deck.pdf`, with all of these shapes; the Chromium engine check expects it to fit in one file.

## 0.2.0 — 2026-10-06: on pitch.dog, beta

- Email My Deck is now a page on pitch.dog at `/email-my-deck/`, in the site's type system, nav, footer and theme, marked beta with a short section on how to tell us when it breaks.
- New page sections: what it's for, how it works, the 25 MB riddle, the whole deal, an "I'm a nerd" engine panel, an FAQ, a help section and a closing note.
- A friendlier tool: drop anywhere, a mailbox picker, a progress bar with funny status lines and a loading card that follow each step (one dog fact), a ready receipt built from what the engine measured, a split plan with copyable email text, and plain-language errors.
- The page counts visits with pitch.dog's Google Analytics tag, with session replay off. The smoke test allows only the page and analytics hosts, and fails if any request mentions the file name.
- The standalone Pages deploy now runs by hand only.

### Engine rebuild

- Replaced Ghostscript with QPDF plus the browser's own image codecs. Text, fonts and links are never re-rendered; only images are rewritten, once each, by object number.
- Sized images in pixels across the slide, measured from where each image is drawn, with a four-rung ladder (3840, 2880, 2400, 1920 px) and a split below the floor.
- Fixed LibreOffice-style decks (every page sharing one resource dictionary) that timed out, and split parts that carried every image.
- Stopped refusing clean files: structure, forms, signatures, attachments, scripts and encryption are read through QPDF's JSON instead of a byte scan. Permission-restricted files are now told apart from password-protected ones.
- Custom limits are decimal MB, like the presets; sizes are shown in decimal units.
- Progress events with a stage and a fraction that never goes backwards; error messages carry a code. Optional `autoSplit` splits in the same job.
- Spread image work over nested workers; the 50 MB audit deck went from three emails in 33 s to one file in about 7 s.
- Added CI on every pull request: tests with real QPDF WASM, the build, an engine check of the built site in Chromium, and the page smoke test, all against the shipped headers.

## 0.1.0 — privacy and handoff hardening

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
