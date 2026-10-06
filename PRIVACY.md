# Privacy

Email My Deck is designed so the PDF stays in the browser.

- No account, email address, upload endpoint, OAuth, session replay, advertising SDK, or error reporter is used.
- On pitch.dog, the page loads the same Google Analytics tag as the rest of the site (`/assets/site-analytics.js`, with session replay switched off). It records page views, scroll depth and contact-link clicks, with a fixed page title and a cleaned page URL. It never receives the PDF, its file name or its contents: the tool has no form, downloads use a detached link to a `blob:` URL, and `scripts/smoke.mjs` fails if any request mentions the test deck's name. The standalone build does not ship that loader, so it sends no analytics.
- The selected PDF is kept in memory and passed to a dedicated worker. Output object URLs are revoked after download.
- No PDF bytes are stored in localStorage, IndexedDB, service-worker caches, URL parameters, or cookies.
- Engine assets are self-hosted. The standalone CSP limits network connections to the same origin; the pitch.dog route adds only the Google Analytics and Cloudflare Web Analytics hosts the rest of the site uses.
- When the app is hosted on Cloudflare, Cloudflare can still receive normal request metadata for the HTML, JavaScript, CSS, and WASM assets. It does not receive the selected PDF through this app.
- After a user downloads a result, their email provider applies its own attachment and retention policies.

This is a browser privacy boundary, not a promise that a mailbox provider or a hosting provider has no metadata. The source and smoke test make the boundary reviewable.
