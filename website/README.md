# AI Tip public website

This directory is a tracker-free static site. It intentionally has no build step and no remote runtime resources.

## Local verification

Run `node scripts/test-release-readiness.mjs` from the repository root after the store screenshots exist.

## Publishing

The canonical public origin is `https://lrh478116-ops.github.io/ai-tip-support-site`. The contents of this directory are mirrored to the dedicated public `lrh478116-ops/ai-tip-support-site` repository so the compliance URLs remain stable independently of application releases. Run `pnpm release:verify:online` after every publication. Apple App Store Connect should receive direct URLs for `/privacy/` and `/account-deletion/`.

For distribution in mainland China, replace any filing placeholder only after the real operator, domain and access provider have completed the required ICP/APP filing. Never insert a fabricated filing number.
