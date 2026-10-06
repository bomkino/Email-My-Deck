# Synthetic corpus

Generated locally with `scripts/generate-corpus.mjs`. These files contain no user data. They are fixtures, not a claim that the compressor is ready for every real deck.

| File | Exercises |
| --- | --- |
| vector-deck.pdf | Already fits: returned untouched |
| photo-deck.pdf | Camera-sized photos on 1280×720 slides: resized to screen size in one file |
| shared-resources-deck.pdf | LibreOffice-style shared resources: images handled once, split parts carry only their own images |
| email-pressure-test.pdf | Noise images that cannot compress: measured split |
| design-tool-deck.pdf | Figma and iLovePDF shapes: photos inside nested groups, JPEGs deflated twice, soft masks, lossless gray photos: one file |
| forms-deck.pdf | The photo deck plus a form field: refused as protected |
| restricted-deck.pdf | The photo deck, opening without a password but forbidding changes: refused as restricted |
