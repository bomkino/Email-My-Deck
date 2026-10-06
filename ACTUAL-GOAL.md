# Email My Deck — actual goal

This is the governing product brief for the implementation in this repository.

## User outcome

Help a non-technical person prepare a presentation PDF for an email attachment while keeping the presentation useful to its recipient and the document private during processing.

The tool should produce the least-damaged version found under a stated file-size budget. It should preserve an original that already fits, use the available budget only when that buys useful fidelity, and offer ordered measured parts when a suitable single file is not found.

The ordinary flow should be choosing a PDF and downloading a useful result. It should not require an account, payment, email address, provider login, upload, or knowledge of MIME, DPI, codecs, or PDF internals. The original stays untouched and the downloadable copy ends in `-email-version.pdf`.

## Truth boundary

An attachment under a byte cap is not proof of delivery. A PDF that opens is not proof that every visual or semantic feature survived. A local worker is not, by itself, proof of privacy. The interface and documentation must distinguish measurements, estimates, assumptions, and unverified properties.

## Quality order

Among eligible candidates under the chosen budget:

1. Preserve useful document behavior and information.
2. Preserve visual fidelity, especially on the worst affected slides.
3. Prefer smaller files when fidelity is equivalent.
4. Bound processing time and memory on supported devices.

Every lossy candidate starts from the untouched original. The product never pads a file merely to approach the ceiling, and it does not repeatedly recompress previous candidates.

## Privacy and scope

Processing remains local, assets are self-hosted, document bytes are not persisted, and the app has no upload route or document telemetry. Protected PDFs are refused rather than silently flattened. The product is a focused email-ready deck tool, not a generic PDF toolbox, Office converter, cloud drive, or email-sending service.

For the implemented decisions, evidence, limitations, and next work, read [HANDOFF.md](HANDOFF.md), [DECISIONS.md](DECISIONS.md), and [PRIVACY.md](PRIVACY.md).
