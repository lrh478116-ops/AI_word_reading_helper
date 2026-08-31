# AI Tip public website

This directory is a tracker-free static site. It intentionally has no build step and no remote runtime resources.

## Local verification

Run `node scripts/test-release-readiness.mjs` from the repository root after the store screenshots exist.

## Publishing

Publish this directory at a stable HTTPS origin, then set `VITE_AI_TIP_PUBLIC_SITE_URL` to that origin before building the store package. The default GitHub Pages path in the source is suitable for development only. Apple App Store Connect should receive direct URLs for `/privacy/` and `/account-deletion/`.

For distribution in mainland China, replace any filing placeholder only after the real operator, domain and access provider have completed the required ICP/APP filing. Never insert a fabricated filing number.
