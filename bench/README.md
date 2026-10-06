# Encoder benches

How the WebAssembly encoders in `src/lib/encoders/` were chosen and tuned, and how to check them again. Everything runs in headless Chromium through Vite (`bench/vite.config.ts`), on the real engine and codec code.

| Script | What it measures |
| --- | --- |
| `run-encoders.mjs` | Every encoder setting on a set of photos at each size: bytes, encode time and SSIMULACRA2 against the resized original. `analyze-encoders.py` summarises the rows. |
| `calibrate.mjs` | Per ladder rung: today's canvas output (bytes and worst-tile score) next to Lanczos3 + jpegli searched to a target score. This is how `JPEGLI_LOOKS` was set. |
| `resize-crops.mjs` | Crops of canvas and Lanczos3 resizes, to compare by eye. |
| `run-decks.mjs` | The whole engine on decks at mailbox budgets, with `canvas` (the browser's encoders) or `wasm` (what the app loads). `BENCH_SAVE=dir` keeps the outputs. |

Photos, decks and results stay outside the repo; pass their paths on the command line. Private decks must never be committed or saved.

## What was tried

Measured on 19 photos from a Keynote deck and 4 screenshots, at the ladder's sizes (3840 to 1440 px across):

- **jpegli** (Google's libjpeg-compatible encoder with adaptive quantisation), progressive, 4:2:0, searched per image to the score canvas reaches: **0.84 to 0.90** of canvas bytes at 1920 px. A fixed jpegli setting that never looks worse than canvas costs **1.17 to 1.66** of canvas bytes: canvas quality varies a lot from photo to photo, so only a per-image check can save bytes without letting some photos get worse. Progressive is about 4% smaller than baseline at the same score; 4:4:4 is never smaller.
- **MozJPEG**: 0.86 to 1.01 of canvas bytes when matched per image, 7 to 14 times slower than jpegli. Dropped.
- **Lanczos3** resizing (the `resize` crate via `@jsquash/resize`) instead of the browser's: visibly crisper, and the same in every browser. It costs a few percent more bytes at the same score, because there is more detail to keep.
- **libdeflate** level 12 instead of the browser's zlib: 10% smaller on outlined text and 8% on Flate images, lossless. Level 10 gets most of that at half the time; 12 is kept because time matters less than bytes here.
- **Palette PNG / oxipng** on screenshots: 0.79 to 1.0 of today's predictors plus libdeflate, and it needs new image dictionaries. Not worth it yet.
- **Font subsetting**: decks we have seen already embed subset fonts of a few KB, and design-tool decks outline their text. Nothing to win.
- **Deduplicating identical images**: 0.02 MB on a 24 MB Figma deck. Nothing to win.

## The look check

For every JPEG it writes, the app searches jpegli's distance (a secant search on log distance, usually 2 to 4 encodes) for the lightest setting whose SSIMULACRA2 score still reaches the rung's target (`looks.ts`). It scores three 384 px tiles at full resolution: the two most detailed (where blur shows) and the smoothest one that isn't flat (where blocking shows), and the worst tile counts. Tiles keep the scorer's time and memory the same for a 4K photo as for a small one.

Targets (`JPEGLI_LOOKS` in `src/lib/encoders/index.ts`) were set with `calibrate.mjs` so each rung spends no more bytes than canvas did on the bench photos, while no photo falls far below the rung's typical look. Final calibration (`calibrate.mjs`, 19 photos):

| Rung | Target | Bytes vs canvas | Worst tile: canvas median / min | Worst tile: new median / min |
| --- | --- | --- | --- | --- |
| 3840 px, q0.85 | 85.0 | 0.87 | 85.8 / 72.2 | 85.3 / 85.1 |
| 2880 px, q0.82 | 78.6 | 0.92 | 81.3 / 69.5 | 78.9 / 78.6 |
| 2400 px, q0.80 | 75.9 | 0.92 | 78.7 / 68.7 | 76.2 / 75.9 |
| 1920 px, q0.76 | 72.7 | 0.92 | 74.2 / 62.9 | 73.0 / 72.7 |
| 1680 px, q0.72 | 68.6 | 0.97 | 73.6 / 59.0 | 68.9 / 68.6 |
| 1440 px, q0.66 | 63.9 | 0.99 | 68.9 / 50.3 | 64.1 / 63.9 |

Whole-image scores at 1920 px: canvas median 74.8, worst 63.7; new median 74.2, worst 71.5. The new photos are also resized with Lanczos3, which these scores don't credit (each is scored against its own resize). Searches took 0.6 to 1.5 s per image (median), 2.9 s at most.

If the scorer can't load, every JPEG gets the table's distance (the median the search found). If a search fails or its scores make no sense, that image gets the table's distance too. If jpegli fails on an image, the browser's encoder writes it.

## Running them

```sh
# Encoders on photos (config: see the header of run-encoders.mjs)
node bench/run-encoders.mjs out.jsonl config.json photos/*.jpg
python3 bench/analyze-encoders.py out.jsonl 0.85,0.76,0.66

# Ladder targets
node bench/calibrate.mjs cal.jsonl cal.json photos/*.jpg

# Decks: codecs, budgets in decimal MB (17.825792 and 14.155776 are the raw budgets of the 25 and 20 MB profiles)
node bench/run-decks.mjs decks.jsonl canvas,wasm 17.825792,14.155776 decks/*.pdf
```

Set `CHROMIUM_PATH` if Chromium is not at the path in the scripts.
