# Cloudflare

Email My Deck is static. It never needs Pages Functions, R2, D1, KV or an upload route for PDF bytes.

## pitch.dog (the live home)

`pitch.dog/email-my-deck/` is built here with `npm run build:pitchdog` and shipped from `bomkino/pitchdog-cloudflare-sites`:

- `apps/main-site/email-my-deck/` holds the build, and `BUILD.json` names the commit.
- `apps/main-site/_headers` carries the route's CSP. It is this repository's CSP plus the Google Analytics and Cloudflare Web Analytics hosts.
- `workers/email-my-deck/` serves the page, and the nav dropdown files, from a static-assets Worker on the `pitch.dog/email-my-deck*` route. The rest of pitch.dog is untouched. Its "Deploy Email My Deck" workflow needs the `CLOUDFLARE_API_TOKEN` secret in that repository.

The README section "On pitch.dog" has the step-by-step.

## Standalone Pages project (optional)

`.github/workflows/deploy-pages.yml` runs by hand only. It runs the same checks as CI, then deploys `dist/` to a Pages project. Before running it, add:

- secret `CLOUDFLARE_API_TOKEN` with Pages edit permission;
- secret `CLOUDFLARE_ACCOUNT_ID` set to the pitch.dog Cloudflare account;
- optional repository variable `CF_PAGES_PROJECT` (defaults to `email-my-deck`).

The standalone build assumes it is served at the origin root and sends `frame-ancestors 'none'`. Link to it; never iframe it.
