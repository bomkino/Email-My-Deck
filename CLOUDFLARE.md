# Cloudflare Pages handoff

Create a Pages project from `bomkino/Email-My-Deck`:

```text
Build command: npm run build
Output directory: dist
Node: 20+
```

The app is static. It should not use Pages Functions, Workers, R2, D1, KV, or an upload route for PDF bytes. Keep `public/_headers` in the output so the same-origin CSP and privacy boundary ship with the site.

For the pitch.dog website, the safest first integration is a route or link owned by the main site that points at this Pages project. A later merge can copy the built surface into `pitchdog-cloudflare-sites/apps/main-site` only after the main-site build has an explicit route and the deployment checks have been reviewed. The standalone repository remains the canonical source for the tool.
