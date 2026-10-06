# Actual-goal product brief

This document applies the Actual Goal lens to Email My Deck.

## The real outcome

A person has a presentation PDF that is too large for the email path they intend to use. After one short interaction, they have either:

- one readable PDF that is likely to arrive as an attachment;
- several readable PDFs that are individually sendable; or
- a clear explanation that the requested attachment constraint cannot be met without harming the deck, plus practical next options.

The person should not need to understand MIME, DPI, JPEG quality, PDF object streams, or the difference between a sender limit and a recipient limit.

The file should remain on the person's device. The tool must not solve the size problem by silently uploading the deck to our servers or by silently converting it into a cloud link.

## Beneficiaries

The sender needs confidence and a simple action.

The recipient needs a deck that opens, looks right, retains useful text and links, and arrives through the intended email path.

The project owner needs a static, open-source service whose operating costs and privacy claims remain manageable as usage grows.

## Hard constraints

- Free for users and free to operate at modest scale.
- No account and no email OAuth.
- Browser-first and local processing.
- Source code, build instructions, dependencies, licenses, and WASM provenance are public.
- Original input remains untouched.
- No promise of universal delivery when provider policies are unknown.
- No silent loss of signatures, forms, links, fonts, or embedded content.
- No server fallback when a device runs out of memory.
- Output names must end in email-version.pdf, with clear part suffixes when split.

## The costliest false successes

### Small enough but undeliverable

A PDF can be under a visible 20 or 25 MB number and still fail because the sender, recipient, client, corporate gateway, MIME encoding, body, signature, or inline images use a different limit.

Countercheck: show the exact PDF byte size, an estimated transmitted size, the profile assumptions, and a confidence label. Store provider facts with a source URL and checked date. Use “likely fit” or “best effort,” never “guaranteed.”

### Small enough but visibly broken

A PDF can shrink dramatically while losing selectable text, fonts, links, transparency, accessibility, forms, or signatures.

Countercheck: inspect the document before processing; render representative text-heavy, image-heavy, and chart-heavy pages; compare extracted text and links; verify page geometry and count; state what changed.

### Private by slogan but observable in practice

A page can claim local processing while loading third-party scripts, sending telemetry, caching documents, or falling back to an upload endpoint.

Countercheck: self-host assets, use a restrictive CSP, disable document network access, run end-to-end tests that intercept requests, publish a DevTools verification guide, provide an offline/self-hostable build, and never store PDF bytes in browser persistence.

### “Done” but no useful next action

A compressor can say “unable to reach target” and leave the user stuck.

Countercheck: offer a readable best attempt, page-balanced split files, a copyable multi-email subject/body plan, and a link-based alternative the user can choose in their own mail provider.

### Free at launch but expensive at scale

A browser tool avoids document processing infrastructure, but large WASM assets create bandwidth and caching costs.

Countercheck: lazy-load the strong engine, compress and cache immutable assets, measure asset transfer, expose a self-hostable release, and keep a donation or sponsorship path separate from tracking.

## The richer product

The primary action should be Make email-ready.

Before processing, show a small assumption card:

Common 25 MB mail systems — recommended — aim for 17.5 MB PDF.

The advanced choices should be:

- Strict 20 MB message limits — aim for about 14 MB PDF.
- Gmail sender to Gmail/Google Workspace recipients — aim for about 23 MB PDF.
- Custom target.

After processing, show an Emailability result rather than only a compression percentage:

- PDF size;
- estimated transmitted size;
- target and profile;
- confidence: likely fit, best effort, or conditional;
- status: target met, already under target, quality floor reached, or split required;
- pages preserved;
- text and links preserved;
- features changed or at risk;
- a visual contact sheet with zoom for representative slides.

The user should be able to inspect “what changed” without seeing implementation jargon:

- photos were downsampled;
- JPEG quality was reduced;
- vector text and slide dimensions were preserved;
- metadata was preserved or removed;
- signatures/forms/interactive content were not preserved.

Metadata removal should be an explicit option, not a hidden side effect.

If the target is missed, provide three actions:

- Try a smaller version, with a visible quality warning.
- Split into two or more individually measured PDFs.
- Keep the readable version and use a trusted link in the user's own mail provider.

When splitting, generate names such as name-email-version-part-01-of-02.pdf and provide a copyable subject such as “Deck — part 1 of 2.”

## Product truth model

The engine result should use explicit states:

- target_met;
- already_under_target;
- quality_floor;
- split_required;
- unsupported_feature;
- encrypted_requires_password;
- malformed_pdf;
- device_limit;
- cancelled;
- unverified.

Never collapse “not tested,” “could not verify,” and “failed” into one success-looking result.

The profile model should retain:

- profile ID;
- target raw bytes;
- wire budget;
- body/header reserve;
- MIME estimate factor;
- sender/recipient assumptions;
- provider source URL;
- checked date;
- confidence and caveat.

## Verification contract

A release is successful only when the artifact is checked, not when the worker returns bytes.

For every output:

- reopen it with an independent parser;
- verify page count and dimensions;
- compare extracted text on representative pages;
- compare link and annotation counts;
- render representative pages at normal and high zoom;
- check output bytes against the selected target;
- calculate the transmitted-size estimate;
- confirm that no file bytes crossed the network;
- preserve the original input.

The corpus must include vector decks, photo decks, scans, charts, transparency, CMYK, indexed images, multilingual fonts, encryption, signatures, forms, links, attachments, malformed files, and mobile-stress cases.

## What this changes in implementation

Use a low-risk QPDF-WASM path first. QPDF can validate, structurally optimize, and recompress some image streams while keeping document structure. If the target is still missed, route ordinary presentation PDFs through a pinned Ghostscript-WASM worker with fixed safe arguments and controlled resolution/quality candidates. Keep special-feature files on the low-risk path or stop with a clear warning.

Choose the highest-fidelity candidate that is actually under the selected byte target. Do not assume size is monotonic and do not use compression percentage as a quality metric.

The first public version should be narrow:

- one PDF at a time;
- local inspection;
- three target profiles;
- one readable output or measured split;
- local preview and verification;
- deterministic naming;
- no cloud integrations;
- no generic PDF toolbox.

The richer value comes from trustworthy decisions and recovery paths, not from adding unrelated PDF features.
