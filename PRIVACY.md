# Privacy

Email My Deck is designed so the PDF stays in the browser.

- No account, email address, upload endpoint, OAuth, analytics, session replay, advertising SDK, or error reporter is used.
- The selected PDF is kept in memory and passed to a dedicated worker. Output object URLs are revoked after download.
- No PDF bytes are stored in localStorage, IndexedDB, service-worker caches, URL parameters, or cookies.
- Engine assets are self-hosted. The shipped CSP limits network connections to the same origin.
- When the app is hosted on Cloudflare, Cloudflare can still receive normal request metadata for the HTML, JavaScript, CSS, and WASM assets. It does not receive the selected PDF through this app.
- After a user downloads a result, their email provider applies its own attachment and retention policies.

This is a browser privacy boundary, not a promise that a mailbox provider or a hosting provider has no metadata. The source and smoke test make the boundary reviewable.
