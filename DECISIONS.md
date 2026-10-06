# Product and engineering decisions

These are the decisions behind the current implementation. They are here to prevent a future “improvement” from creating a false success.

| Decision | Chosen approach | Reason |
| --- | --- | --- |
| Where PDFs are processed | In the browser, inside a worker | The PDF never needs to reach a server; the worker prevents heavy WASM work from freezing the UI. |
| Product scope | One narrow job: make a deck email-ready | Fewer controls make the tool understandable to non-technical senders. |
| Mailbox target | Profiles plus custom limit | Provider and gateway limits vary. A single universal number creates false confidence. |
| Gmail option | Conditional Gmail-to-Gmail/Workspace profile | It can use a larger attachment budget, but recipients and gateways may still reject it. |
| Compression order | Original → QPDF structure/image pass → Ghostscript only if needed | Preserve the highest-fidelity candidate that fits; avoid needless lossy work. |
| Quality floor | Split when a single readable file cannot fit | A tiny but unreadable deck is worse than two honest attachments. |
| Protected PDFs | Refuse rewriting and ask for a flattened copy | Forms, signatures, attachments, scripts, and passwords can carry semantics that a compressor cannot promise to preserve. |
| Size estimate | Reserve space for MIME/base64 overhead and body text | The attachment bytes are not the same as the transmitted message bytes. |
| Output names | `-email-version` and numbered `-part-XX-of-YY` suffixes | Users should know what a file is for before attaching it. |
| Hosting | Static Cloudflare Pages build | No upload API, storage, database, or paid runtime is needed. |
| License | AGPL-3.0-or-later | Improvements to a hosted version remain available to the community. |

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
