# Changelog

## Unreleased

- The tool comes first. Under the headline it sits front and centre, in a pink-edged panel with a slow WebGL glow round it (a still glow without WebGL, with reduced motion or on Save-Data). Inside are three numbered steps: where it's going, with the four mailbox settings as cards and Most mailboxes already picked, so nobody misses the choice; add your deck; and what comes back. The drop zone breathes, shows a ghost deck dropping in until you touch it, leans toward the pointer, fans its cards when a file is over it, and asks to be tapped on phones. While it's on screen it answers a drag itself; the full-page "Drop it anywhere" card only shows once it has scrolled away. Next and download buttons are pitch.dog pink. Below come the lede and promises, a redrawn phone QR ticket (pink eyes, our logo in the middle, checked with ZXing; `scripts/make-qr.py` draws it), What it's for, then a pitch.dog block with the logo and a way to hire us.
- The moment a deck is dropped, the page says what it will weigh as an email against the mailbox picked, including the deck that looks under 25 MB but isn't. The ready screens confirm it: why the deck had to change, or that it fits, packing and all.
- When a deck can't fit one email, the page says so, gives the reason and the lightest size reached, then offers one link (our pick) before the parts, and Gmail to Gmail when that would fit. Splitting is the last resort.
- Nothing is split until the visitor chooses to. The split card starts at parts of about the same size, lets them move each split with a slider, and shows every part's size before anything is made. A part that would be too big is flagged, and the button waits until it fits. From the parts, "Change where it splits" goes back to the choice.
- Engine: a result that doesn't fit carries `splitPlan` (`sharedBytes`, `pageBytes`), measured after QPDF gives each page only the resources it uses. On a 66-slide design-tool deck it lands within 2% of the real parts. `split` takes `breakAfter` to split exactly there and marks each part's `fits`. A split the visitor starts gets the whole progress bar.
- The page names all three ways out. Step 05, the FAQ and the engine panel now include flattening as the last resort, and the engine panel's ladder, leftover-room fill and drawing rounding match what the engine does.
- A split or flatten that fails, or stalls, goes back to the ways with a note on the way that failed, on a fresh engine, instead of to an error page that loses the deck already made.
- Downloads keep their link for a minute instead of four seconds, so Safari on iPhone, which asks before it downloads, doesn't fail on a slow tap.
- Long runs stay alive. A phone that sleeps mid-run, or a tab left in the background for a minute, no longer comes back to "too heavy for this device": the watchdog only counts time the page is visible, and its limit is two minutes without word from the engine. While it works, the page asks the screen to stay on where the browser allows it, and asks before you leave. The busy screen has more to say on a long wait: new notes at five and ten minutes, more lines, the dog fact only once, and a bar that no longer sits at 97% through a slow last stretch.
- The waiting card has two new lines for the photo step, about the look check that saves each photo a few ways and keeps the lightest one that still looks the same, and two new curve balls. Squeezing now takes longer, and more lines mean the card repeats itself less.
- The page speaks the squeeze: the receipt says photos went "to at least" the lightest size used (the fill makes many sharper) and owns up to trimmed drawings; the can't-fit reason says how much of the deck we can only trim, or keep exactly, when the engine reports `weight`; the last pass gets its own step words ("Spending the room left on sharper photos"); and "an 8 MB limit" reads as said.
- The page says up front that a big deck takes a few minutes: under the drop zone, on the waiting card and in step 03, which says why. A new FAQ, "Why does it take so long?", explains the care in plain words, the phone answer asks for several minutes, the engine panel has a "Why it’s slow" note, and the flatten card counts the extra time among its costs. The engine panel's flatten line now matches the engine (both encoders, eight sizes, least clarity lost per byte). README has a Stack section and a "How long it takes" section; HANDOFF and DECISIONS cover the three ways, the link guide and care over speed.

- Engine: the progress bar never goes quiet for long. While the squeeze waits for drawings to finish rounding, and while a flatten opens the deck or draws a slow slide, the bar still hears from the engine every 400 ms. During a flatten it creeps forward on how long slides have taken so far. Every beat repeats the last slide count, so "slide 5 of 66" under the bar no longer blinks off between slides. In Chrome, the longest silence on the 24 MB Figma deck drops from 1.9 s to 0.6 s when squeezing, and from 2.3 s to 0.8 s when flattening. A slow phone is much less likely to hit the page's watchdog. Output is byte for byte the same on all nine benchmark decks. One wait is left: QPDF reading a single very large image (1.4 s on the giant-page deck), which can't be split.
- Engine: the bar keeps its pace on slow squeezes. The last pass that spends leftover room on sharper photos gets a share of the bar sized to its work (on the 24 MB Figma deck it now moves from 84% to 96% instead of sitting near 88% for half a minute), and drawings compressed by libdeflate let the heartbeat through every 50 ms, so the longest silence at the start of resizing drops from 6.3 s to under 1 s. Output sizes are unchanged.

### Engine: lighter photos that look better

Every photo is now written by jpegli, Google's JPEG encoder compiled to WebAssembly, and gets the lightest setting that still looks right at its size. Before a photo is kept, a perceptual check (SSIMULACRA2) scores it on its busiest and smoothest parts. Busy photos give bytes back, smooth skies keep theirs, and no photo comes out heavier than before. The room saved goes back into sharper photos. Squeezing takes about ten times longer (30 to 60 s for the audit decks, about three minutes for the Figma deck on our test machine); that was the trade.

- The 24 MB Figma deck, in Chrome: for 25 MB mailboxes no photo is now below 2880 px across, where before some were at 1920 (17.5 MB). For strict 20 MB ones, none below 1920 instead of 1680 (13.8 MB). Given 10 MB for the file (a 14 MB mailbox), it is now one 9.7 MB file with no photo below 1680 px, where before it needed a split.
- The audit decks, in Chrome: those that fit at full sharpness come out up to 15% lighter (a 21 MB A4 report: 14.3 → 12.1 MB). Those that have to give, give less. At 20 MB the A4 report now keeps every photo at full sharpness, where before some went to 2880 px. A Keynote-style deck at 25 MB keeps its photos at 2880 px or more instead of 2400. At a 6 MB limit, five of them keep 10 to 31% more pixels. No deck went from one file to a split.
- On the bench photos, each rung costs 0.84 to 0.95 of the bytes it did, and the worst-looking photo at each rung now scores close to the rung's typical look instead of far under it (`bench/README.md`).
- No photo is heavier than the browser's own resize and encoder would have made it. When looking right would cost more, the photo gets the best look within those bytes, or the browser's own JPEG.
- Photos are resized with Lanczos3: crisper, and the same in every browser. Drawings and lossless images are compressed with libdeflate at its strongest level, 8 to 10% smaller than the browser's zlib.
- If the encoders can't load, or fail on one photo, the browser's own encoders write it, as before. Each encoder is a separate file on pitch.dog, fetched only when a deck needs it; the deck never leaves the browser.
- `scripts/codecs/` has the build scripts, pinned sources and licences of the three WebAssembly modules; each rebuilds bit for bit. `bench/` has the benches. MozJPEG, palette PNG, font trimming and deduplicating images were measured and dropped.
- The engine check's split cases use a 15 MB custom limit, so they split however well the encoders do, and the custom limit is checked on the way.

### Engine: flatten (the nuke)

When a deck can't fit one email, the page can now offer a third way: turn every slide into one picture and squeeze those. It only runs when the visitor asks for it. Text stops being searchable and links stop working, but the deck stays one file. In Chrome, the 24 MB Figma deck flattens to one 13.9 MB file for strict 20 MB mailboxes with every slide still 2400 px across, in about 80 s. At a 6 MB limit it still fits, with no slide below 1216 px.

- PDF.js draws each slide at 2400 px in the PDF worker, on its own nested worker for parsing. Fonts are drawn as outlines. The standard fonts, CMaps and the JPEG 2000 and JBIG2 decoders are bundled files, fetched only when a deck needs them, so nothing leaves the browser. They are loaded only when someone flattens.
- Each slide is re-saved at eight rungs, from 2400 px at JPEG quality 82 down to 1024 px at 50, on a few nested workers while the next slide is drawn. Full size at low quality comes before smaller sizes: on a screen it reads sharper for the same bytes.
- Every version is scored against the sharp drawing at screen size, 1920 px across. The score is structural similarity of 8×8 blocks of luminance, weighted by how much contrast each block holds and pulled down by the worst-hit 5% (`src/lib/engine/perceptual.ts`).
- Slides step down where a step gives up the least clarity per byte saved, so photos give way before small print. Room the last step left goes back where it helps most.
- No slide goes below a clarity floor (0.7, set by eye: 8 pt text on a 16:9 slide still reads cleanly at screen size). When even that doesn't fit, the result comes back over budget (`fits: false`) with the lightest size reached, instead of as mush.
- `compress` takes `mode: 'flatten'`, and the result is `candidate.engine: 'flattened'` with `receipt.flatten` (`pages`, `longEdgePx` and `jpegQuality` of the lightest slide, and the lowest `clarity`). Progress has a `flatten` stage with slide counts. `ENGINE_FEATURES.flatten` is on.
- Protected PDFs (forms, signatures, attachments, scripts, restrictions) are still refused, flattened or not.
- Each rung is written twice, by the browser's JPEG encoder and by jpegli, and both versions are scored. A slide takes whichever reads as clearly for fewer bytes, so the room saved buys sharper slides elsewhere. In Chrome at an 8 MB limit, the files weigh the same but are sharper: the 24 MB Figma deck keeps more pixels on 36 of its 66 slides and none goes below 1728 px across (was 1440). The Keynote-style deck's least clear slide rises from 0.82 to 0.88, and the 157 MB deck's lightest slide goes from 1024 px to 1216. No slide anywhere came out smaller. At 20 MB most decks were already at full size and barely change. Flattening takes about twice as long (the Figma deck at 8 MB: 43 s to 90 s). If jpegli can't load, or fails on a slide, that slide uses the browser's version alone, as before.

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
