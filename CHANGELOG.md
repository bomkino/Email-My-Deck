# Changelog

## Unreleased

- The moment a deck is dropped, the page says what it will weigh as an email against the mailbox picked, including the deck that looks under 25 MB but isn't. The ready screens confirm it: why the deck had to change, or that it fits, packing and all.
- When a deck can't fit one email, the page says so, gives the reason and the lightest size reached, then offers one link (our pick) before the parts, and Gmail to Gmail when that would fit. Splitting is the last resort.
- Nothing is split until the visitor chooses to. The split card starts at parts of about the same size, lets them move each split with a slider, and shows every part's size before anything is made. A part that would be too big is flagged, and the button waits until it fits. From the parts, "Change where it splits" goes back to the choice.
- Engine: a result that doesn't fit carries `splitPlan` (`sharedBytes`, `pageBytes`), measured after QPDF gives each page only the resources it uses. On a 66-slide design-tool deck it lands within 2% of the real parts. `split` takes `breakAfter` to split exactly there and marks each part's `fits`. A split the visitor starts gets the whole progress bar.

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
