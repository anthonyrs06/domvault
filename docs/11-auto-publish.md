# 11 — Auto-publish (public map without a second PR)

The public Explorer at https://dys5315.github.io/domvault/constellation/ reads
**https://domvault-registry.vercel.app** — a static, git-backed `universe.json`
built from `frameworks/*.md`. That is the map visitors see.

**https://domvault-registry.fly.dev** is the live signed-POST registry (the
long-term write path: strip, diff, sign, POST). It is also the flaky one
(500s / timeouts). Writes there do not currently refresh the Vercel snapshot,
so a Fly publish would not show up on github.io.

This Action is the bridge: after it lands on `main`, new opt-in notes can reach
the public Vercel/github.io map without opening another human PR.

## What runs on main

`.github/workflows/constellation-publish.yml` (contents: write):

- **push to main on frameworks/\*\*** — rebuild `registry-static/` and commit if `universe.json` changed
- **workflow_dispatch** — rebuild-only (no payload). Use this once after merge so deploy is automatic even if `frameworks/` did not change
- **repository_dispatch type constellation-publish** — optional `{ filename, content }` note is written into `frameworks/`, then rebuild + commit

The job pushes the rebuilt registry to `main`. Vercel deploys from that commit.
The Action does not POST to Fly. Bot commits are skipped so the rebuild cannot recurse.

## Weekday loop (after merge)

Mark a note publish: true in 30-frameworks/ or 80-synthesis/ (never sparks).
Frontmatter needs title, handle, star, author, galaxy.

From a clone of this repo:
  npx tsx scripts/publish-from-vault.ts /home/box/my-brain

That copies matching notes into local frameworks/, rebuilds universe.json,
and prints the gh command. Add the dispatch flag to fire
repository_dispatch via gh (needs write on dys5315/domvault).

filename is a basename only (kebab-case.md, not README.md, no paths).
content is the complete markdown note. Empty payload means rebuild-only.

## Permissions

Dispatching to dys5315/domvault requires contents:write on that repo.
Anthony cannot push there today; dispatch will 403 until the operator adds
him as a collaborator. On 403 the CLI prints the command and exits 2; it
does not crash. This script will not invent a token.

Until write is granted, the fallback is still a PR. After write is granted,
dispatch (or a frameworks/ push to main) is the no-second-PR path.

## Long-term

Signed POST to the live Fly registry remains the right end state (consent
stripper, content-addressed ids, first-publish-wins). This Action is what
makes the public Vercel/github.io map update in the meantime.
