# Email My Deck — governing product brief

Status: specification, not an implemented or validated product.
This brief supersedes conflicting decisions in PRODUCT-THESIS.md and SECOND-PASS.md.

Applied workflow: [Actual Goal](https://github.com/bomkino/actual-goal/blob/main/skills/actual-goal/SKILL.md).
Scope of this revision: enrich and correct the specification; do not start implementation, deploy, or send email.

## Ready-to-use brief

Help a non-technical person prepare a presentation PDF for an email attachment while keeping the presentation useful to its recipient and the document private during processing.

Produce the least-damaged version found under a stated file-size budget. Use the available budget when it buys useful fidelity; proximity to the ceiling has no value by itself. Preserve an original that already fits. If a suitable single-file result is not found, offer ordered, individually measured parts or explain the remaining limitation.

Keep the ordinary experience to choosing a PDF and downloading a result. Choose sensible defaults; expose extra decisions only when they materially affect the outcome. Do not require an account, payment, email address, provider login, or upload. Preserve the original and name the downloadable copy with -email-version.pdf.

Make measured facts, estimates, assumptions, and unverified properties distinguishable. A file under a byte cap is not proof of email delivery; a PDF that opens is not proof of fidelity; selectable text is not proof of accessibility; a local worker is not proof of privacy.

Select engines and defaults from artifact-level evidence on representative decks and devices. Treat current library recommendations and target sizes as candidates until those checks are complete. Deliver a useful, truthful result even when compression cannot meet the chosen budget.

## What must become true

The sender can identify the correct attachment and the next action without understanding MIME, DPI, codecs, or PDF internals.

The recipient can read the pitch, financial figures, charts, screenshots, and contact information; follow ordinary links; and use existing text/search behavior without surprising degradation. The selected delivery assumptions are explicit, but delivery remains unverified until actually received.

The operator has a no-fee dependency and static-hosting path within a documented usage budget. Free for users is a requirement. Zero recurring provider spend is a target to demonstrate at an explicit traffic level, not a promise of unlimited free infrastructure.

The recipient outcome is inferred from the user's desire for the best visual decks. We do not add a conversion, lead-generation, engagement, or fundraising-success objective.

## Optimize the right thing

The user's request to approach the sending limit means spending bytes to avoid unnecessary damage. It does not justify padding, upscaling, duplicating data, or favoring a bigger file with worse detail.

Among candidates satisfying the budget and document requirements:

1. Prefer preservation of useful information and document behavior.
2. Prefer useful visual fidelity, especially on the worst affected slides.
3. Prefer smaller files when fidelity is equivalent.
4. Bound processing time and memory so the operation completes on supported devices.

Do not rank quality solely by output size, DPI, a JPEG setting, compression percentage, or an average similarity score. A higher-DPI image with severe JPEG artifacts can be worse than a moderately downsampled image.

Each lossy candidate must start from the untouched original. Do not repeatedly recompress the previous candidate. Retain the best eligible result and label it as the best version found within the search budget, not a proven global optimum.

If the original already fits, return its exact bytes under the requested filename. Changing its metadata or rewriting it is unnecessary unless the user separately requests that transformation.

## Rich judgment, simple interface

Default flow:

1. Choose or drop one PDF.
2. Process locally, with understandable stages and a cancel action.
3. Show one recommended result, its actual PDF size, and one download action.

Suggested ordinary result copy:

“Your email version is ready. 12.6 MB.”
“Prepared for the selected size limit. Recipient limits can vary.”

Put alternate targets, transport-size calculations, processing details, source links, and comparisons behind optional controls. Important feature-loss or verification failures must remain visible. Do not create a composite “emailability” or “quality confidence” score that implies evidence we do not have.

A before/after preview is useful, but asking every person to inspect every page would defeat the simplicity goal. Automatically surface risky slides when possible. Give the user an optional zoomed comparison; when fidelity is uncertain, prefer an explicitly qualified result or a better-preserved split.

Name single outputs deck-email-version.pdf. Avoid repeated suffixes on reprocessed files. Name split outputs deck-email-version-part-01-of-02.pdf. Keep the original untouched.

## Delivery budget: facts versus product policy

Keep sender limits, recipient limits, client limits, and encoded message limits distinct. A provider name alone cannot identify every limit along a message's path.

Candidate product policies from the initial research:

| Policy | PDF budget | Meaning |
| --- | ---: | --- |
| Common 25 MB message budget | 17,500,000 bytes | Conservative MIME calculation under an assumed 25 MB encoded cap and 500 KB body/header reserve |
| Strict 20 MB message budget | 14,000,000 bytes | Leaves room under an assumed 20 MB encoded cap with the same reserve |
| Higher Gmail budget | 23,000,000 bytes | Conditional option based on the sender/client and known recipient allowance |
| Custom PDF budget | User value | A known attachment budget, including room needed for other attachments |

The 17.5 MB policy is the provisional default. The relative value of this default versus 14 MB has not been established by delivery or usability testing. Do not call either “universal,” “safe for all email,” or a measured probability of delivery.

Under wrapped MIME Base64, estimate attachment bytes as 4 × ceil(rawBytes / 3), plus approximately two bytes per 76-character line. Add a clearly stated body/header reserve. Do not subtract encoding overhead from every provider's published attachment limit: some published limits already refer to pre-encoding bytes.

Provider facts need source URLs, checked dates, units, scope, and encoding basis where documented. Undocumented semantics remain unknown. Current research sources include:

- [Gmail attachments](https://support.google.com/mail/answer/6584?hl=en)
- [Workspace sending limits](https://knowledge.workspace.google.com/admin/gmail/gmail-sending-limits-in-google-workspace)
- [Outlook.com sending limits](https://support.microsoft.com/en-us/outlook/sending-limits-in-outlook-com)
- [Outlook client guidance](https://support.microsoft.com/en-us/outlook/reduce-attachment-size-to-send-large-files-with-outlook)
- [iCloud limits](https://support.apple.com/en-us/102198)
- [MIME encoding](https://www.rfc-editor.org/rfc/rfc2045.html)

Do not infer verified delivery from those documents. Representative sender-to-recipient tests must be conducted separately with consenting test accounts; this brief does not authorize sending messages.

## Honest outcomes and recovery

Distinguish:

- Already fits: unchanged bytes, renamed download.
- Target met and checks passed: verified size and explicitly scoped preservation checks.
- Target met, fidelity needs review: identify the affected pages or properties.
- Target not met: readable best attempt, with measured size and further choices.
- Split available: each final part serialized and measured independently.
- Unsupported input, device/resource limit, cancelled, or verification failed: specific next action and no success label.

“Could not find a suitable version within these settings and time” is different from “no solution exists.” Do not claim an automatic quality floor is objectively calibrated before testing supports it.

Splitting must keep contiguous page order and account for duplicated fonts/images and file overhead. Two halves are not necessarily half the byte size. Internal links to pages in another part may stop working; check or disclose this.

Show “Send one part per email.” Putting both parts into the same message does not solve the combined attachment limit. Do not offer a ZIP as the default fix. Do not inject new slides or alter the pitch to label parts.

If one page remains too large, say so. A smaller export from the source application may preserve more quality than another PDF rewrite; offer source-specific guidance only when the application is known or selected. A user-managed sharing link is another option, with different hosting/access implications. Neither path uploads anything automatically.

## Fidelity and document behavior

Protect the content that changes what a recipient understands: numbers, chart labels, fine lines, screenshot text, QR codes, color distinctions, and contact links. Photographic similarity alone is insufficient.

Preserve text, vector content, page dimensions/orientation/order, and useful existing document behavior. Existing accessibility tags and reading order matter separately from text selection.

Preflight signatures, encryption, forms, annotations, attachments, scripts, layers, unusual fonts, and color/transparency features. For v1, unsupported cases may be clearly refused or restricted to a verified preservation path. Never silently decrypt, flatten, strip features, or rewrite signed files as though signature validity survives.

Whole-page rasterization is excluded from the default product; adding it as an emergency feature is deferred.

Metadata removal is optional and specific. Local processing protects the document from this service; it does not redact confidential content or guarantee that hidden information is safe to share. Do not claim otherwise.

## Engine hypotheses, not an architectural commitment

Compare a structural QPDF pass, selective image recompression, and a controlled downsampling engine on the same corpus and budgets.

QPDF image optimization is lossy and must be separated from its lossless structural pass. QPDF does not resample image dimensions. Ghostscript is a viable downsampling candidate, with document-rewrite and licensing tradeoffs. PDF.js can provide previews and checks; it is not the compressor.

Do not ship multiple large engines simply because they appeared in the research. Measure the marginal success rate, fidelity, latency, bundle transfer, and maintenance burden of each stage. Select the simplest combination that meets the product requirements.

Do not force PDF linearization for email; it serves a different use and can add overhead. Do not assume a knob changes output without an integration test against the exact engine build.

## Privacy and sustainable distribution

Local file handling is a hard product requirement, including failure paths. Do not upload files, filenames, extracted text, previews, passwords, or document-derived telemetry. Keep user document data out of persistent application caches; cache only application assets.

Treat the surrounding website as part of the design. Marketing scripts on the same page can undermine the file tool. Prefer a dedicated origin with no analytics or third-party scripts; link or embed it without sending document data to the parent page. A worker alone is not a confidentiality boundary.

Serve pinned, self-hosted assets; restrict network capabilities; disable document scripts and automatic external-resource loading; terminate workers and release object URLs on clear/cancel. Do not claim cryptographic erasure from browser memory. Explain ordinary hosting logs and downstream email-provider handling.

CSP and an in-app “0 bytes sent” label are not independent proof. Use external browser request interception and offline tests across success, errors, previews, cancellation, splitting, and download. Document exactly what was observed.

Budget static bandwidth, bundle transfers, hosting quotas, maintenance, and security updates. Free-tier compatibility needs evidence at an explicit traffic level and a clear stop before paid overages. Do not shift costs into ads, tracking, or paid user tiers contrary to the brief.

Document the license for the complete chosen tool and all engines. An MIT wrapper does not remove an AGPL dependency's obligations. Publishing the tool's source and exact engine build recipe supports the stated open-source goal; do not infer that unrelated website code automatically has the same licensing obligations.

## Verification and false-win cases

These are proposed acceptance cases, not executed test results.

| Case | False success to reject | Required behavior/evidence |
| --- | --- | --- |
| Original 8 MB deck fits a 17.5 MB budget | Recompressing to show a savings badge | Byte-identical download with the suffix |
| Equally faithful 9 MB and 17.4 MB candidates | Choosing the larger because it is nearer the ceiling | Prefer the smaller |
| One financial table becomes unreadable | Good average similarity across all slides | Page/crop-level assessment and review or rejection |
| PDF opens, but a contact link changes | Parser success or unchanged link count | Check destination and function, not count alone |
| File is 24 MB, recipient cap unknown | Green “will deliver” badge | Exact size result with conditional delivery status |
| Fifty scans have no selectable text initially | Claiming text was preserved or newly made searchable | Preserve existing behavior; no OCR claim |
| Split files share a large font/image resource | Assuming half the pages means half the size | Serialize and measure every final part |
| Phone cannot complete a job | Silent server fallback or an endless spinner | Bounded work, cancellation, specific local-only failure |
| Main website includes session replay | Worker-based privacy badge | Isolated tool deployment and request checks |
| One engine wins on a synthetic photo PDF | Declaring it production-ready | Unseen deck corpus and supported-device checks |

Runtime checks should cover exact bytes, page count/order/geometry, parsing, and document features to the extent supported. Link counts and text extraction are useful signals, not full proofs. If visual inspection samples pages, report sampling rather than claiming complete fidelity.

Release evaluation should use properly licensed or consented decks from common export tools, plus adversarial synthetic cases. Include small text, fonts, vector charts, screenshots, photographic pages, scans, accessibility tags, protected/signed files, already-optimized inputs, malformed PDFs, and resource-stress cases.

Use human review of representative and worst-affected details, multiple viewers, and supported browsers/devices. Keep unseen holdouts so tuning to examples cannot substitute for reliability. Record file size, transformations, fidelity failures, time, memory/resource failures, and target success. Do not interpret downloads as successful sends.

## Current evidence and next decision

Provider documentation and package-level experiments support feasibility. Earlier subagent reports include synthetic PDF and Chromium smoke tests; they are not a verified product acceptance suite.

Still unverified: fidelity across real PowerPoint, Keynote, Canva, and Figma exports; mobile reliability; usable noob flow; default delivery profile; sustainable operating envelope; final dependency/license composition.

The next authorized implementation phase, when requested, should begin with a representative engine comparison and the smallest complete local flow. The acceptance question is whether an ordinary person obtains a useful attachment or a clear recovery path without sacrificing the privacy requirement.

Do not add email sending, OAuth, bulk document management, Office conversion, cloud uploads, or a generic PDF toolbox to make the project appear richer.
