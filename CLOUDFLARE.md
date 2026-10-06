# Cloudflare Pages handoff

Create a Pages project from `bomkino/Email-My-Deck`:

```text
Build command: npm run build
Output directory: dist
Node: 20+
```

The checked-in workflow deploys `main` after `npm test` and `npm run build`. Add these repository settings before enabling it:

- secret `CLOUDFLARE_API_TOKEN` with Pages edit permission;
- secret `CLOUDFLARE_ACCOUNT_ID` set to the pitch.dog Cloudflare account;
- optional repository variable `CF_PAGES_PROJECT` (defaults to `email-my-deck`).

The app is static. It should not use Pages Functions, Workers, R2, D1, KV, or an upload route for PDF bytes. Keep `public/_headers` in the output so the same-origin CSP and privacy boundary ship with the site.

For the pitch.dog website, the safest first integration is a route or link owned by the main site that points at this Pages project. A later merge can copy the built surface into `pitchdog-cloudflare-sites/apps/main-site` only after the main-site build has an explicit route and the deployment checks have been reviewed. The standalone repository remains the canonical source for the tool. The pitch.dog copy is produced by `npm run build:pitchdog` and served at `/email-my-deck/` from `apps/main-site`; that site's `_headers` carries the route's CSP, which adds only the Google Analytics hosts to this one. See the README section "On pitch.dog".

The build assumes it is served at the origin root (`/`) and deliberately sends `frame-ancestors 'none'`. Use a same-origin route or a link from pitch.dog; do not iframe this standalone deployment without an explicit base-path and CSP review.
